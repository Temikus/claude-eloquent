# Security Policy

## Supported versions

Only the latest released version of claude-eloquent receives security fixes. Please upgrade before reporting an issue against an older release.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

Please report security issues privately through [GitHub's private vulnerability reporting](https://github.com/Temikus/claude-eloquent/security/advisories/new) rather than opening a public issue.

Include, where you can:

1. A description of the issue and its impact.
2. Steps to reproduce, or a proof of concept.
3. The plugin version and your Claude Code version.
4. Any suggested fix or mitigation.

This is a hobby project maintained in spare time, so expect an acknowledgement within a week and a fix timeline agreed with you once the report is triaged. Please give a reasonable window for a fix before disclosing publicly.

## Scope

claude-eloquent is a Claude Code plugin. It runs hook scripts (`hooks/*.mjs`) on your machine under your own Claude Code process. Those scripts read the text of pending `Edit`/`Write`/`MultiEdit` calls, write empty sentinel files under the plugin data path, and append decision lines to a log. They make no external network calls and use no API keys.

In scope:

- Arbitrary code execution or command injection via hook scripts or edit content.
- Path traversal or unintended file writes from the sentinel path or a crafted `session_id`.
- Leaking edited file contents outside the local machine.
- Privilege or permission escalation beyond what the hooks are declared to need.

Out of scope:

- Vulnerabilities in Claude Code itself - report those to Anthropic.
- The plugin failing open. Every path that is not a confident denial exits 0 by design; a missed over-commented edit is not a security issue.
- Findings that require an attacker to already have write access to your repository or your Claude Code configuration.
