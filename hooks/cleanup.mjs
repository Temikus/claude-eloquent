#!/usr/bin/env node
// SessionEnd hook: drop this session's retry sentinels. The TTL prune in
// check-comments.mjs covers sessions that end without this hook firing.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { log, readStdin, validSessionId, SESSIONS_DIR } from './common.mjs';

try {
  const event = JSON.parse(readStdin(65536).text);
  const sessionId = event.session_id ?? '';
  if (!validSessionId(sessionId)) process.exit(0);

  const dir = join(SESSIONS_DIR, sessionId);
  rmSync(dir, { recursive: true, force: true });
  log('cleanup', `REMOVED: sentinels for session=${sessionId}`);
  process.exit(0);
} catch (err) {
  log('cleanup', `ERROR: unexpected failure: ${err.message}`);
  process.exit(0);
}
