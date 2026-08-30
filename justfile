set shell := ["bash", "-uc"]

default:
    @just --list

# Validate JSON manifests and JS syntax
lint:
    jq empty .claude-plugin/plugin.json
    jq empty hooks/hooks.json
    node --check hooks/check-comments.mjs
    node --check hooks/session-context.mjs
    node --check hooks/cleanup.mjs
    node --check hooks/comments.mjs
    node --check hooks/common.mjs
    node --check hooks/guidance.mjs

# Scanner unit tests against tests/fixtures
test-comments:
    #!/usr/bin/env bash
    set -euo pipefail
    node tests/comments-test.mjs

# PreToolUse decisions: deny once, allow on retry, skips, fail-open
test-hook:
    #!/usr/bin/env bash
    set -euo pipefail
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT
    export CLAUDE_ELOQUENT_TMP="$tmpdir/data"
    export CLAUDE_ELOQUENT_LOG="$tmpdir/log"
    rc=0

    commenty=$(cat tests/samples/commenty.js)
    tiny=$(cat tests/samples/tiny.js)
    blocky=$(cat tests/samples/blocky.js)

    payload() {
      jq -n --arg sid "$1" --arg text "$2" --arg old "${3:-OLD}" --arg fp "${4:-/tmp/sample.js}" \
        '{session_id:$sid, tool_name:"Edit", cwd:"/tmp", tool_input:{file_path:$fp, old_string:$old, new_string:$text}}'
    }
    run() { node hooks/check-comments.mjs; }
    ok() { echo "PASS: $1"; }
    fail() { echo "FAIL: $1" >&2; rc=1; }

    # 1. Commenty edit is denied and leaves a sentinel behind.
    out=$(payload s1 "$commenty" | run)
    echo "$out" | grep -q '"permissionDecision":"deny"' && ok "1 commenty edit denied" || fail "1 expected deny, got: $out"
    [ "$(find "$tmpdir/data/sessions/s1" -type f | wc -l)" -eq 1 ] && ok "1 sentinel written" || fail "1 expected one sentinel"

    # 2. Identical resubmit is accepted.
    out=$(payload s1 "$commenty" | run)
    [ -z "$out" ] && ok "2 identical resubmit allowed" || fail "2 expected empty stdout, got: $out"

    # 3. Same text, different anchor: the hash ignores old_string.
    out=$(payload s1 "$commenty" "DIFFERENT ANCHOR" | run)
    [ -z "$out" ] && ok "3 retry allowed despite new old_string" || fail "3 expected empty stdout, got: $out"

    # 4. allow_on_retry off denies every time.
    out=$(payload s4 "$commenty" | CLAUDE_ELOQUENT_ALLOW_ON_RETRY=0 run)
    echo "$out" | grep -q '"permissionDecision":"deny"' || fail "4 first submit should deny"
    out=$(payload s4 "$commenty" | CLAUDE_ELOQUENT_ALLOW_ON_RETRY=0 run)
    echo "$out" | grep -q '"permissionDecision":"deny"' && ok "4 denied on every submit" || fail "4 second submit should deny too"
    echo "$out" | jq -e '.hookSpecificOutput.permissionDecisionReason | test("resubmit the same edit") | not' >/dev/null && ok "4 reason omits the retry promise" || fail "4 reason should not promise a retry"

    # 5. Below min_chars the ratio check does not apply.
    out=$(payload s5 "$tiny" | run)
    [ -z "$out" ] && ok "5 short edit allowed" || fail "5 expected empty stdout, got: $out"

    # 6. Prose files are skipped before scanning, and log nothing: the line fired
    # on nearly every call and carried no decision.
    log6="$tmpdir/log6"
    out=$(payload s6 "$commenty" OLD /tmp/notes.md | CLAUDE_ELOQUENT_LOG="$log6" run)
    [ -z "$out" ] && [ ! -s "$log6" ] && ok "6 markdown skipped silently" || fail "6 expected silent doc-ext skip"

    # 6b. CLAUDE_ELOQUENT_EXTRA_SKIP takes a bare filename, and the old
    #     CLAUDE_ELOQUENT_EXTRA_SKIP_EXT name still works as an alias.
    out=$(payload s6b "$commenty" OLD /tmp/justfile | CLAUDE_ELOQUENT_EXTRA_SKIP=justfile run)
    [ -z "$out" ] && ok "6b extra skip by filename" || fail "6b expected empty stdout, got: $out"
    out=$(payload s6c "$commenty" | CLAUDE_ELOQUENT_EXTRA_SKIP_EXT=js run)
    [ -z "$out" ] && ok "6c legacy extra-skip alias honoured" || fail "6c expected empty stdout, got: $out"

    # 7. MultiEdit concatenates its edits, so one commenty edit is enough.
    #    Retained for older clients; current Claude Code no longer ships the tool.
    out=$(jq -n --arg text "$commenty" '{session_id:"s7", tool_name:"MultiEdit", cwd:"/tmp", tool_input:{file_path:"/tmp/sample.js", edits:[{old_string:"a",new_string:"const a = 1;"},{old_string:"b",new_string:$text},{old_string:"c",new_string:"const c = 3;"}]}}' | run)
    echo "$out" | grep -q '"permissionDecision":"deny"' && ok "7 MultiEdit denied" || fail "7 expected deny, got: $out"

    # 8. Block-length detector is opt-in.
    out=$(payload s8 "$blocky" | run)
    [ -z "$out" ] && ok "8 long block allowed by default" || fail "8 expected empty stdout, got: $out"
    out=$(payload s8b "$blocky" | CLAUDE_ELOQUENT_CHECK_BLOCK_LINES=1 run)
    echo "$out" | grep -q '"permissionDecision":"deny"' && ok "8 long block denied when enabled" || fail "8 expected deny with detector on, got: $out"

    # 9. Malformed stdin fails open, but leaves a trace in the log.
    out=$(printf 'not json' | run) && ec=$? || ec=$?
    [ "$ec" -eq 0 ] && [ -z "$out" ] && ok "9 malformed stdin fails open" || fail "9 expected silent exit 0"
    grep -q 'ERROR' "$tmpdir/log" && ok "9 parse failure logged" || fail "9 expected ERROR in the log"

    # 10. Project opt-out file.
    skipdir="$tmpdir/skipproj"
    mkdir -p "$skipdir"
    touch "$skipdir/.claude-eloquent-skip"
    out=$(jq -n --arg text "$commenty" --arg cwd "$skipdir" '{session_id:"s10", tool_name:"Edit", cwd:$cwd, tool_input:{file_path:"/tmp/sample.js", old_string:"a", new_string:$text}}' | run)
    [ -z "$out" ] && ok "10 .claude-eloquent-skip honoured" || fail "10 expected empty stdout, got: $out"

    # 11. The denial carries the measured numbers Claude needs.
    out=$(payload s11 "$commenty" | run)
    echo "$out" | jq -e '.hookSpecificOutput.permissionDecisionReason | test("[0-9]+% comment")' >/dev/null && ok "11 reason quotes the percentage" || fail "11 reason missing percentage"
    echo "$out" | jq -e '.hookSpecificOutput.permissionDecisionReason | test("resubmit the same edit")' >/dev/null && ok "11 reason offers the retry" || fail "11 reason missing retry sentence"

    # 12. A payload past the read cap is skipped, not parsed into a bogus error.
    big=$(head -c 9000000 /dev/zero | tr '\0' 'x')
    log12="$tmpdir/log12"
    out=$(printf '{"session_id":"s12","tool_name":"Edit","cwd":"/tmp","tool_input":{"file_path":"/tmp/sample.js","old_string":"OLD","new_string":"%s"}}' "$big" | CLAUDE_ELOQUENT_LOG="$log12" run)
    [ -z "$out" ] && grep -q 'SKIP: payload' "$log12" && ok "12 oversized payload skipped" || fail "12 expected payload skip"

    # 13. Rotation runs from log(), so a session that only ever skips still trims.
    log13="$tmpdir/log13"
    # Lines are sized so that MAX_LINES of them still exceed the 256KB rotation
    # guard, which makes the final count exact rather than "somewhere above 100".
    line=$(head -c 3000 /dev/zero | tr '\0' 'y')
    CLAUDE_ELOQUENT_LOG="$log13" CLAUDE_ELOQUENT_LOG_MAX_LINES=100 node -e '
      const { log } = await import("./hooks/common.mjs");
      for (let i = 0; i < 150; i++) log("t", process.argv[1]);
    ' "$line"
    [ "$(wc -l < "$log13")" -eq 100 ] && ok "13 log trimmed to max lines" || fail "13 expected 100 lines, got $(wc -l < "$log13")"

    # 13. The plugin-option variable is read when no env override is set.
    out=$(payload s13 "$commenty" | CLAUDE_PLUGIN_OPTION_COMMENT_RATIO=0.99 run)
    [ -z "$out" ] && ok "13 plugin option raises the threshold" || fail "13 expected empty stdout, got: $out"

    # 14. Env wins over the plugin option.
    out=$(payload s14 "$commenty" | CLAUDE_PLUGIN_OPTION_COMMENT_RATIO=0.99 CLAUDE_ELOQUENT_RATIO=0.10 run)
    echo "$out" | grep -q '"permissionDecision":"deny"' && ok "14 env overrides the plugin option" || fail "14 expected deny, got: $out"

    exit $rc

# SessionStart context injection
test-context:
    #!/usr/bin/env bash
    set -euo pipefail
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT
    export CLAUDE_ELOQUENT_LOG="$tmpdir/log"
    rc=0

    out=$(echo '{"session_id":"c1","source":"startup","cwd":"/tmp"}' | node hooks/session-context.mjs)
    echo "$out" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null || { echo "FAIL: wrong hookEventName" >&2; rc=1; }
    len=$(echo "$out" | jq -r '.hookSpecificOutput.additionalContext | length')
    [ "$len" -gt 0 ] && [ "$len" -lt 400 ] && echo "PASS: context present and under 400 chars ($len)" || { echo "FAIL: context length $len" >&2; rc=1; }

    out=$(echo '{"session_id":"c2","cwd":"/tmp"}' | CLAUDE_ELOQUENT_SESSION_CONTEXT=0 node hooks/session-context.mjs)
    [ -z "$out" ] && echo "PASS: silent when disabled" || { echo "FAIL: expected empty stdout when disabled" >&2; rc=1; }

    out=$(echo '{"session_id":"c3","cwd":"/tmp"}' | CLAUDE_ELOQUENT_DISABLED=1 node hooks/session-context.mjs)
    [ -z "$out" ] && echo "PASS: silent when plugin disabled" || { echo "FAIL: expected empty stdout when plugin disabled" >&2; rc=1; }

    exit $rc

# SessionEnd sentinel cleanup
test-cleanup:
    #!/usr/bin/env bash
    set -euo pipefail
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT
    export CLAUDE_ELOQUENT_TMP="$tmpdir/data"
    export CLAUDE_ELOQUENT_LOG="$tmpdir/log"
    rc=0

    mkdir -p "$tmpdir/data/sessions/mine" "$tmpdir/data/sessions/theirs"
    touch "$tmpdir/data/sessions/mine/aaaa" "$tmpdir/data/sessions/theirs/bbbb"

    echo '{"session_id":"mine","reason":"clear"}' | node hooks/cleanup.mjs
    [ ! -d "$tmpdir/data/sessions/mine" ] && echo "PASS: own session dir removed" || { echo "FAIL: own session dir survived" >&2; rc=1; }
    [ -f "$tmpdir/data/sessions/theirs/bbbb" ] && echo "PASS: other session untouched" || { echo "FAIL: other session removed" >&2; rc=1; }

    echo '{"session_id":"../escape"}' | node hooks/cleanup.mjs
    [ -f "$tmpdir/data/sessions/theirs/bbbb" ] && echo "PASS: invalid session id rejected" || { echo "FAIL: path traversal not rejected" >&2; rc=1; }

    exit $rc

# Run all tests
test: test-comments test-hook test-context test-cleanup

# Lint + all tests
check: lint test

# Create a release: just release [patch|minor|major]
release segment="patch":
    #!/usr/bin/env bash
    set -euo pipefail
    manifest=".claude-plugin/plugin.json"
    latest=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
    IFS='.' read -r major minor patch <<< "${latest#v}"
    case "{{segment}}" in
      major) major=$((major + 1)); minor=0; patch=0 ;;
      minor) minor=$((minor + 1)); patch=0 ;;
      patch) patch=$((patch + 1)) ;;
      *) echo "Usage: just release [patch|minor|major]"; exit 1 ;;
    esac
    new="v${major}.${minor}.${patch}"
    bare="${new#v}"
    jq --arg v "$bare" '.version = $v' "$manifest" > "${manifest}.tmp" && mv "${manifest}.tmp" "$manifest"
    git add "$manifest"
    git commit -m "release: bump version to ${bare}"
    echo "Tagging ${latest} -> ${new}"
    git tag -a "$new" -m "Release ${new}"
    git push origin HEAD --follow-tags
    echo "Released ${new}"

# Install instructions
install-hint:
    @echo "In Claude Code, run:"
    @echo "  /plugin marketplace add Temikus/claude-plugins"
    @echo "  /plugin install claude-eloquent@temikus"

# Install the current working copy locally via a transient marketplace.
# Uninstall with `just uninstall-dev`. Restart Claude Code after running.
install-dev:
    #!/usr/bin/env bash
    set -euo pipefail
    MP_NAME="claude-eloquent-dev"
    MP_DIR="${TMPDIR:-/tmp}/${MP_NAME}-marketplace"
    rm -rf "$MP_DIR"
    mkdir -p "$MP_DIR/.claude-plugin"
    # Symlink the plugin into the marketplace tree so the marketplace source
    # can be a relative path (which is what the schema validator accepts).
    ln -s "$PWD" "$MP_DIR/claude-eloquent"
    jq -n --arg name "$MP_NAME" '{
      name: $name,
      owner: {name: "local-dev"},
      plugins: [{
        name: "claude-eloquent",
        description: "Local dev build (transient)",
        source: "./claude-eloquent"
      }]
    }' > "$MP_DIR/.claude-plugin/marketplace.json"
    claude plugin uninstall "claude-eloquent@${MP_NAME}" 2>/dev/null || true
    claude plugin marketplace remove "$MP_NAME" 2>/dev/null || true
    claude plugin marketplace add "$MP_DIR"
    claude plugin install "claude-eloquent@${MP_NAME}" --scope user
    echo ""
    echo "Installed claude-eloquent from $PWD via transient marketplace '$MP_NAME'."
    echo "Restart Claude Code to pick up the new hooks."
    echo "Run 'just uninstall-dev' to clean up."

# Install the published version from the Temikus/claude-plugins marketplace
install-public:
    #!/usr/bin/env bash
    set -euo pipefail
    MP_NAME="temikus"
    claude plugin uninstall "claude-eloquent@${MP_NAME}" 2>/dev/null || true
    if ! claude plugin marketplace list 2>/dev/null | grep -q "^  ❯ ${MP_NAME}$"; then
      claude plugin marketplace add "Temikus/claude-plugins"
    fi
    claude plugin install "claude-eloquent@${MP_NAME}" --scope user
    echo ""
    echo "Installed claude-eloquent from Temikus/claude-plugins marketplace."
    echo "Restart Claude Code to pick up the plugin."
    echo "Run 'just uninstall-public' to remove."

# Remove the public install (keeps the marketplace registered)
uninstall-public:
    #!/usr/bin/env bash
    set -euo pipefail
    claude plugin uninstall "claude-eloquent@temikus" 2>/dev/null || true
    echo "Removed public install. Restart Claude Code."

# Remove the dev install (and its transient marketplace)
uninstall-dev:
    #!/usr/bin/env bash
    set -euo pipefail
    MP_NAME="claude-eloquent-dev"
    MP_DIR="${TMPDIR:-/tmp}/${MP_NAME}-marketplace"
    claude plugin uninstall "claude-eloquent@${MP_NAME}" 2>/dev/null || true
    claude plugin marketplace remove "$MP_NAME" 2>/dev/null || true
    rm -rf "$MP_DIR"
    echo "Removed dev install. Restart Claude Code."
