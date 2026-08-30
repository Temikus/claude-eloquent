#!/bin/sh
# Find a working Python 3 interpreter and exec the hook with it.
#
# hooks.json names this shim rather than an interpreter, so a machine without
# Python produces one legible message instead of a hook that exits 127 on every
# edit. The PreToolUse hook is a gate: a silent exec failure leaves it open
# while the user believes edits are still being checked.
#
# Usage, from hooks.json:
#   sh "${CLAUDE_PLUGIN_ROOT}/hooks/py.sh" "${CLAUDE_PLUGIN_ROOT}/hooks/check_comments.py"

# PEP 540. Windows Python defaults to cp1252, which raises on any path byte
# outside it - a non-ASCII file_path would then fail the whole hook. No-op on
# macOS and Linux. Must be set before Python starts.
export PYTHONUTF8=1

# Git Bash hands POSIX paths (`/c/Users/...`) to this shim. A Windows python.exe
# reads the leading `/` as the current drive root and fails with ENOENT.
# `cygpath` is absent off Windows, where the guard makes this a no-op.
if command -v cygpath >/dev/null 2>&1; then
    converted=""
    for a in "$@"; do
        case "$a" in
            /*) a=$(cygpath -w "$a") ;;
        esac
        converted="$converted \"$a\""
    done
    eval "set -- $converted"
fi

# Presence on PATH is not proof of a working interpreter: Windows ships a
# Microsoft Store stub named python3 that exits 49 silently in a non-TTY
# subprocess. Probe by running it.
probe() {
    "$@" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null
}

# The hooks use only the standard library, so the floor is the oldest Python
# that runs them rather than anything a dependency asks for. 3.8 covers stock
# macOS (3.9) and every supported distro.
supported() {
    case "$1" in
        3.[89]|3.[1-9][0-9]|[4-9].*|[1-9][0-9].*) return 0 ;;
        *) return 1 ;;
    esac
}

for cmd in "python3" "python" "py -3"; do
    # shellcheck disable=SC2086
    v=$(probe $cmd) || continue
    if supported "$v"; then
        # shellcheck disable=SC2086
        exec $cmd "$@"
    fi
done

# No interpreter. Warn without blocking: systemMessage on stdout with exit 0 is
# accepted on every event this plugin hooks, so an edit is never denied because
# the runtime is missing.
#
# Throttled to once a day. This runs on every Edit/Write, so an unthrottled
# message would repeat on each one.
marker_dir="${CLAUDE_ELOQUENT_TMP:-${CLAUDE_PLUGIN_DATA:-$HOME/.claude/tmp/claude-eloquent}}"
marker="$marker_dir/no-python-$(date -u +%Y%m%d 2>/dev/null || echo undated)"
if [ -f "$marker" ]; then
    exit 0
fi
mkdir -p "$marker_dir" 2>/dev/null && : > "$marker" 2>/dev/null

printf '%s\n' '{"systemMessage":"claude-eloquent: no working Python 3.8+ interpreter found (tried python3, python, py -3), so comment checking is off. Install Python 3, then start a new session."}'
exit 0
