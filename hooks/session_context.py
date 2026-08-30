#!/usr/bin/env python3
"""SessionStart hook: state the comment rule up front so the PreToolUse denial
stays a backstop rather than a routine event."""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import as_bool, cfg, log, read_stdin  # noqa: E402
from guidance import SESSION_CONTEXT  # noqa: E402

DISABLED = cfg("CLAUDE_ELOQUENT_DISABLED", "CLAUDE_PLUGIN_OPTION_DISABLED", "0")
SESSION_CONTEXT_ON = cfg("CLAUDE_ELOQUENT_SESSION_CONTEXT", "CLAUDE_PLUGIN_OPTION_SESSION_CONTEXT", "1")

try:
    if as_bool(DISABLED) or not as_bool(SESSION_CONTEXT_ON):
        sys.exit(0)

    event = {}
    try:
        event = json.loads(read_stdin(65536)[0])
    except Exception:
        pass  # context does not depend on the payload

    cwd = event.get("cwd") if isinstance(event, dict) else None
    if cwd and os.path.exists(os.path.join(cwd, ".claude-eloquent-skip")):
        sys.exit(0)

    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": SESSION_CONTEXT,
        },
    }, separators=(",", ":"), ensure_ascii=False))
    sys.exit(0)
except SystemExit:
    raise
except Exception as err:
    log("context", "ERROR: unexpected failure: {}".format(err))
    sys.exit(0)
