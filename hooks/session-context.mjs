#!/usr/bin/env node
// SessionStart hook: state the comment rule up front so the PreToolUse denial
// stays a backstop rather than a routine event.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cfg, bool, log, readStdin } from './common.mjs';
import { sessionContext } from './guidance.mjs';

const DISABLED = cfg('CLAUDE_ELOQUENT_DISABLED', 'CLAUDE_PLUGIN_OPTION_DISABLED', '0');
const SESSION_CONTEXT = cfg('CLAUDE_ELOQUENT_SESSION_CONTEXT', 'CLAUDE_PLUGIN_OPTION_SESSION_CONTEXT', '1');

try {
  if (bool(DISABLED) || !bool(SESSION_CONTEXT)) process.exit(0);

  let event = {};
  try { event = JSON.parse(readStdin(65536).text); } catch { /* context does not depend on the payload */ }

  if (event.cwd && existsSync(join(event.cwd, '.claude-eloquent-skip'))) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: sessionContext,
    },
  }));
  process.exit(0);
} catch (err) {
  log('context', `ERROR: unexpected failure: ${err.message}`);
  process.exit(0);
}
