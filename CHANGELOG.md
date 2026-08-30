# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Hooks are Python rather than Node. macOS ships no `node`, and the Claude Code binary no longer carries one, so the hooks could not run on a stock Mac; the stock `python3` (3.9) satisfies the new 3.8+ floor. Behaviour, configuration, and environment variables are unchanged.
- `hooks.json` invokes `hooks/py.sh`, which locates a supported interpreter and execs the hook.

### Fixed

- A machine without the hook runtime now gets one message a day saying comment checking is off. Previously the hook exited 127 on every edit and the `PreToolUse` gate stood open with nothing to say so.

## [0.1.0] - 2026-08-30

### Changed

- `.gitignore` ignores `.claude/tmp/` rather than all of `.claude/`, so a project `.claude/settings.json` can be committed.
- `just release` depends on `check`, matches only `v*` tags when reading the previous version, prints the planned tag, and pushes only when called with `confirm=yes`.
- README states that the `min_chars` floor is measured after shebang, licence, and lint lines are excluded.

### Added

- This changelog. `just release` moves the Unreleased entries under the new version heading.

## [0.1.0] - 2026-08-28

### Added

- Initial release: comment-ratio and block-length checks on `Edit`, `Write`, and `MultiEdit`, deny-once sentinels, session context injection, and cleanup on session end.
