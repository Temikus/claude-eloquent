"""Config, logging, and paths shared by the three hook entry points."""

import os
import re
import sys
import time

HOME = os.path.expanduser("~")

LOG_FILE = os.environ.get("CLAUDE_ELOQUENT_LOG") or os.path.join(HOME, ".claude/logs/claude-eloquent.log")
MAX_LINES = int(os.environ.get("CLAUDE_ELOQUENT_LOG_MAX_LINES") or "1000")
ELOQUENT_TMP = (
    os.environ.get("CLAUDE_ELOQUENT_TMP")
    or os.environ.get("CLAUDE_PLUGIN_DATA")
    or os.path.join(HOME, ".claude/tmp/claude-eloquent")
)
SESSIONS_DIR = os.path.join(ELOQUENT_TMP, "sessions")
SENTINEL_TTL_S = 2 * 60 * 60
# Rotation reads the whole log, so only look once the file is big enough to
# plausibly hold MAX_LINES.
ROTATE_BYTES = 256 * 1024

_SESSION_ID = re.compile(r"^[a-zA-Z0-9_-]+$")


def cfg(env_var, plugin_var, default_val):
    """Env wins over the plugin option so a shell can override a user's saved
    config for one session without editing it."""
    value = os.environ.get(env_var)
    if value is None:
        value = os.environ.get(plugin_var)
    if value is None:
        value = default_val
    return value


def as_bool(value):
    return value == "1" or value == "true" or value is True


def log(tag, msg):
    """Never raises: a hook that cannot log still has to let the tool call through."""
    try:
        directory = os.path.dirname(LOG_FILE)
        if directory:
            os.makedirs(directory, exist_ok=True)
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with open(LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write("[{}] [{}] {}\n".format(ts, tag, msg))
        if os.path.getsize(LOG_FILE) > ROTATE_BYTES:
            rotate_log()
    except Exception:
        pass  # logging itself failed


def rotate_log():
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as fh:
            lines = [ln for ln in fh.read().split("\n") if ln]
        if len(lines) > MAX_LINES:
            with open(LOG_FILE, "w", encoding="utf-8") as fh:
                fh.write("\n".join(lines[-MAX_LINES:]) + "\n")
    except Exception:
        pass  # file may not exist yet


def valid_session_id(session_id):
    return isinstance(session_id, str) and bool(_SESSION_ID.match(session_id))


def read_stdin(max_bytes=8 * 1024 * 1024):
    """`truncated` tells the caller the payload was cut, so it can skip rather
    than fail on a JSON parse error it cannot explain."""
    buf = sys.stdin.buffer.read()
    return buf[:max_bytes].decode("utf-8", "replace"), len(buf) > max_bytes
