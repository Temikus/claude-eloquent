// Config, logging, and paths shared by the three hook entry points.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// Env wins over the plugin option so a shell can override a user's saved config
// for one session without editing it.
export function cfg(envVar, pluginVar, defaultVal) {
  return process.env[envVar] ?? process.env[pluginVar] ?? defaultVal;
}

export function bool(value) {
  return value === '1' || value === 'true' || value === true;
}

export const LOG_FILE = process.env.CLAUDE_ELOQUENT_LOG ?? join(homedir(), '.claude/logs/claude-eloquent.log');
export const MAX_LINES = parseInt(process.env.CLAUDE_ELOQUENT_LOG_MAX_LINES ?? '1000', 10);
export const ELOQUENT_TMP = process.env.CLAUDE_ELOQUENT_TMP ?? process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.claude/tmp/claude-eloquent');
export const SESSIONS_DIR = join(ELOQUENT_TMP, 'sessions');
export const SENTINEL_TTL_MS = 2 * 60 * 60 * 1000;
// Rotation reads the whole log, so only look once the file is big enough to
// plausibly hold MAX_LINES.
const ROTATE_BYTES = 256 * 1024;

// Never throws: a hook that cannot log still has to let the tool call through.
export function log(tag, msg) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    appendFileSync(LOG_FILE, `[${ts}] [${tag}] ${msg}\n`);
    if (statSync(LOG_FILE).size > ROTATE_BYTES) rotateLog();
  } catch { /* logging itself failed */ }
}

export function rotateLog() {
  try {
    const lines = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    if (lines.length > MAX_LINES) {
      writeFileSync(LOG_FILE, lines.slice(-MAX_LINES).join('\n') + '\n');
    }
  } catch { /* file may not exist yet */ }
}

export function validSessionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

// `truncated` tells the caller the payload was cut, so it can skip rather than
// fail on a JSON parse error it cannot explain.
export function readStdin(maxBytes = 8 * 1024 * 1024) {
  const buf = readFileSync(0);
  return { text: buf.slice(0, maxBytes).toString('utf8'), truncated: buf.length > maxBytes };
}
