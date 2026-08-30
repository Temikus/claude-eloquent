# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `.gitignore` ignores `.claude/tmp/` rather than all of `.claude/`, so a project `.claude/settings.json` can be committed.
- `just release` depends on `check`, matches only `v*` tags when reading the previous version, prints the planned tag, and pushes only when called with `confirm=yes`.
- README states that the `min_chars` floor is measured after shebang, licence, and lint lines are excluded.
- CI tests Node 22 and 24. Node 20 reached end-of-life in March 2026 and is no longer in the matrix; the plugin now requires Node 22 or newer.

### Added

- This changelog. `just release` moves the Unreleased entries under the new version heading.

## [0.1.0] - 2026-08-28

### Added

- Initial release: comment-ratio and block-length checks on `Edit`, `Write`, and `MultiEdit`, deny-once sentinels, session context injection, and cleanup on session end.
