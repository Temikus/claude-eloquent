# claude-eloquent

[![CI](https://github.com/Temikus/claude-eloquent/actions/workflows/ci.yml/badge.svg)](https://github.com/Temikus/claude-eloquent/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

> A Claude Code plugin that keeps Claude's comments terse.

Claude over-comments. It narrates what the code already says, records implementation history ("previously this used X"), references behaviour you deleted three edits ago, and editorialises about "the win here". Prompt rules asking for terse comments work, then drift over a long session.

claude-eloquent enforces the rule at the harness level instead. A `PreToolUse` hook measures how much of every `Edit` / `Write` / `MultiEdit` is comment. When it crosses the threshold, the call is denied **once**, with guidance on what to keep and what to cut. If Claude resubmits the same content unchanged, it goes through - the model looked again and judged the comments necessary. A short `SessionStart` note states the rule up front so denials stay rare.

No API calls, no extra tokens spent on scoring, no dependencies. Just a line-based scanner and a threshold.

## What it does

| Event | Script | Behaviour |
| --- | --- | --- |
| `SessionStart` | `hooks/session-context.mjs` | Injects a ~380 char comment-style instruction |
| `PreToolUse` (`Edit\|Write`) | `hooks/check-comments.mjs` | Denies once when the edit is too commenty, allows the identical retry |
| `SessionEnd` | `hooks/cleanup.mjs` | Removes this session's retry sentinels |

`SessionStart` fires on startup, resume, clear, and compaction. Re-injecting after a compaction is deliberate: the summary may have dropped the rule, and the note is ~380 characters.

What Claude sees on a denial:

> claude-eloquent: this edit to `src/parse.js` is 71% comment (2 comment blocks, longest 9 lines). Rewrite the comments before resubmitting. Keep only what a reader of this code cannot infer from the code itself: non-obvious intent, invariants, dangers, quirks of an external API, and why an unusual choice was made. Remove narration of what the code does, implementation history, references to old behaviour, "previously"/"now"/"the win here" phrasing, and anything that restates the identifier names. If every remaining comment is genuinely needed, resubmit the same edit unchanged and it will be accepted.

With `allow_on_retry` off, the last sentence is replaced by "This check denies every time; reduce the comments."

## Install

```
/plugin marketplace add Temikus/claude-plugins
/plugin install claude-eloquent@temikus
```

Restart Claude Code afterwards. Requires `node` on `PATH` (20+).

For a local working copy: `just install-dev`, then `just uninstall-dev` to clean up.

## Configuration

Set these in `/plugin` config, or override per shell with the environment variable (env wins).

| Option | Default | Environment variable |
| --- | --- | --- |
| `disabled` | `false` | `CLAUDE_ELOQUENT_DISABLED` |
| `comment_ratio` | `0.40` | `CLAUDE_ELOQUENT_RATIO` |
| `min_chars` | `200` | `CLAUDE_ELOQUENT_MIN_CHARS` |
| `check_block_lines` | `false` | `CLAUDE_ELOQUENT_CHECK_BLOCK_LINES` |
| `max_block_lines` | `6` | `CLAUDE_ELOQUENT_MAX_BLOCK_LINES` |
| `session_context` | `true` | `CLAUDE_ELOQUENT_SESSION_CONTEXT` |
| `allow_on_retry` | `true` | `CLAUDE_ELOQUENT_ALLOW_ON_RETRY` |

Two detectors, either one is enough to trip a denial:

1. **Ratio** (on): comment characters exceed `comment_ratio` of the edit, and the edit is at least `min_chars` long. The floor stops a three-line edit with one comment from tripping it.
2. **Block lines** (off): a single contiguous comment block is longer than `max_block_lines`.

`allow_on_retry=false` denies every time, which is stricter than it sounds - Claude has no way to force an edit through.

Environment-only settings:

| Variable | Default |
| --- | --- |
| `CLAUDE_ELOQUENT_LOG` | `~/.claude/logs/claude-eloquent.log` |
| `CLAUDE_ELOQUENT_LOG_MAX_LINES` | `1000` (trim target, applied once the log passes 256 KB) |
| `CLAUDE_ELOQUENT_TMP` | `~/.claude/tmp/claude-eloquent` |
| `CLAUDE_ELOQUENT_EXTRA_SKIP_EXT` | (empty) comma-separated extensions to ignore |

Drop a `.claude-eloquent-skip` file in a project root to disable the plugin for that project.

## What gets scanned

Source files only. Prose and data files (`.md`, `.txt`, `.rst`, `.json`, `.yaml`, `.toml`, `.csv`, `.lock`, and friends) exit before any scanning, as does any extension the scanner does not recognise.

Languages: C-like (`//`, `/* */`), hash (`#`), Python (`#` plus docstrings), Ruby (`#`, `=begin`/`=end`), Lua/SQL (`--`), HTML-ish (`<!-- -->`), and CSS (`/* */`). Full table in [`design/comment-detection.md`](design/comment-detection.md).

Never counted against you: shebangs, licence headers (`SPDX`, `Copyright`, `Licensed under`), and lint directives (`eslint-`, `noqa`, `nolint`, `@ts-`, `TODO(`, `FIXME(`, and similar).

## Privacy and failure behaviour

Comment text is never logged. The log records file paths, sizes, percentages, and decisions only.

Every path that is not a confident denial exits 0 silently: malformed input, a payload over 8 MB, a missing `file_path`, an unknown extension, a scanner exception, an unwritable sentinel directory, or a missing session id. A hook that cannot decide lets the edit through.

## Development

```
just lint     # JSON manifests + node --check
just test     # scanner, hook decisions, session context, cleanup
just check    # both
```

Tests are bash and `node`, no framework. CI runs the suite on Node 20, 22, and 24.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
