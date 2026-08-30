#!/usr/bin/env python3
"""PreToolUse hook for Edit/Write/MultiEdit. Measures how much of the incoming
text is comment and denies once when it crosses a threshold; an identical
resubmit is accepted, on the basis that the model looked again and kept them.

Runs on every file write, so: comment text is never logged (only sizes, paths,
and decisions), and every path that is not a confident deny exits 0 silently.
"""

import hashlib
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (  # noqa: E402
    SENTINEL_TTL_S,
    SESSIONS_DIR,
    as_bool,
    cfg,
    log,
    read_stdin,
    valid_session_id,
)
from comments import detect_lang, extract_comments, is_skipped_ext, summarise  # noqa: E402
from guidance import deny_reason  # noqa: E402

DISABLED = cfg("CLAUDE_ELOQUENT_DISABLED", "CLAUDE_PLUGIN_OPTION_DISABLED", "0")
RATIO = float(cfg("CLAUDE_ELOQUENT_RATIO", "CLAUDE_PLUGIN_OPTION_COMMENT_RATIO", "0.40"))
MIN_CHARS = int(cfg("CLAUDE_ELOQUENT_MIN_CHARS", "CLAUDE_PLUGIN_OPTION_MIN_CHARS", "200"))
CHECK_BLOCK_LINES = cfg("CLAUDE_ELOQUENT_CHECK_BLOCK_LINES", "CLAUDE_PLUGIN_OPTION_CHECK_BLOCK_LINES", "0")
MAX_BLOCK_LINES = int(cfg("CLAUDE_ELOQUENT_MAX_BLOCK_LINES", "CLAUDE_PLUGIN_OPTION_MAX_BLOCK_LINES", "6"))
ALLOW_ON_RETRY = cfg("CLAUDE_ELOQUENT_ALLOW_ON_RETRY", "CLAUDE_PLUGIN_OPTION_ALLOW_ON_RETRY", "1")
EXTRA_SKIP_EXT = [
    s.strip().lstrip(".").lower()
    for s in (os.environ.get("CLAUDE_ELOQUENT_EXTRA_SKIP_EXT") or "").split(",")
    if s.strip()
]


def analysed_text(tool_name, tool_input):
    if tool_name == "Write":
        content = tool_input.get("content")
        return content if isinstance(content, str) else None
    if tool_name == "Edit":
        new_string = tool_input.get("new_string")
        return new_string if isinstance(new_string, str) else None
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits")
        if not isinstance(edits, list):
            return None
        parts = []
        for edit in edits:
            new_string = edit.get("new_string") if isinstance(edit, dict) else None
            parts.append(new_string if isinstance(new_string, str) else "")
        return "\n".join(parts)
    return None


def prune_sentinels(directory):
    """Sentinels expire so a long session cannot accumulate them, and so an edit
    revisited hours later is judged fresh rather than waved through."""
    try:
        now = time.time()
        for name in os.listdir(directory):
            full = os.path.join(directory, name)
            try:
                if now - os.path.getmtime(full) > SENTINEL_TTL_S:
                    os.unlink(full)
            except OSError:
                pass  # raced with another hook
    except OSError:
        pass  # dir may not exist yet


try:
    if as_bool(DISABLED):
        sys.exit(0)

    payload, truncated = read_stdin()
    if truncated:
        log("check", "SKIP: payload over 8MB")
        sys.exit(0)

    event = json.loads(payload)
    tool_name = event.get("tool_name", "")
    tool_input = event.get("tool_input") or {}
    file_path = tool_input.get("file_path")

    if not file_path or not isinstance(file_path, str):
        sys.exit(0)

    cwd = event.get("cwd")
    if cwd and os.path.exists(os.path.join(cwd, ".claude-eloquent-skip")):
        sys.exit(0)

    if is_skipped_ext(file_path, EXTRA_SKIP_EXT):
        sys.exit(0)

    lang = detect_lang(file_path)
    if not lang:
        sys.exit(0)

    text = analysed_text(tool_name, tool_input)
    if not text:
        sys.exit(0)

    result = extract_comments(text, lang)
    stats_summary = summarise(result)
    ratio = stats_summary["ratio"]
    longest_block = stats_summary["longest_block"]
    block_count = stats_summary["block_count"]

    ratio_tripped = result["total_chars"] >= MIN_CHARS and ratio > RATIO
    block_tripped = as_bool(CHECK_BLOCK_LINES) and longest_block > MAX_BLOCK_LINES
    if not ratio_tripped and not block_tripped:
        sys.exit(0)

    session_id = event.get("session_id", "")
    # Half-up, matching the Node implementation this replaced; Python's round()
    # is banker's rounding and would report 70 where the old hook reported 71.
    percent = int(math.floor(ratio * 100 + 0.5))
    stats = "{} {}% of {} chars, {} blocks, longest {}".format(
        file_path, percent, result["total_chars"], block_count, longest_block
    )

    # No usable session id means no sentinel, so deny-once would become
    # deny-always. Fail open instead.
    if not valid_session_id(session_id):
        log("check", "SKIP: invalid session_id (would have denied: {})".format(stats))
        sys.exit(0)

    session_dir = os.path.join(SESSIONS_DIR, session_id)
    key = hashlib.sha256("{}\n{}".format(file_path, text).encode("utf-8")).hexdigest()[:16]
    sentinel = os.path.join(session_dir, key)

    if as_bool(ALLOW_ON_RETRY):
        try:
            os.makedirs(session_dir, exist_ok=True)
            prune_sentinels(session_dir)
            # Left in place, so a third identical submit is allowed too.
            if os.path.exists(sentinel):
                log("check", "ALLOW (retry): {}".format(stats))
                sys.exit(0)
            with open(sentinel, "w"):
                pass
        except SystemExit:
            raise
        except OSError as err:
            # Unwritable sentinel dir turns deny-once into deny-always, so allow.
            log("check", "ALLOW (no sentinel: {}): {}".format(err, stats))
            sys.exit(0)

    log("check", "DENY: {}".format(stats))
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": deny_reason(
                file=file_path,
                percent=percent,
                blocks=block_count,
                longest_block=longest_block,
                allow_retry=as_bool(ALLOW_ON_RETRY),
            ),
        },
    }, separators=(",", ":"), ensure_ascii=False))
    sys.exit(0)
except SystemExit:
    raise
except Exception as err:
    log("check", "ERROR: unexpected failure: {}".format(err))
    sys.exit(0)
