#!/usr/bin/env node
// PreToolUse hook for Edit/Write/MultiEdit. Measures how much of the incoming
// text is comment and denies once when it crosses a threshold; an identical
// resubmit is accepted, on the basis that the model looked again and kept them.
//
// Runs on every file write, so: comment text is never logged (only sizes, paths,
// and decisions), and every path that is not a confident deny exits 0 silently.
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cfg, bool, log, rotateLog, readStdin, validSessionId, SESSIONS_DIR, SENTINEL_TTL_MS } from './common.mjs';
import { detectLang, isSkippedExt, extractComments, summarise } from './comments.mjs';
import { denyReason } from './guidance.mjs';

const DISABLED = cfg('CLAUDE_ELOQUENT_DISABLED', 'CLAUDE_PLUGIN_OPTION_DISABLED', '0');
const RATIO = parseFloat(cfg('CLAUDE_ELOQUENT_RATIO', 'CLAUDE_PLUGIN_OPTION_COMMENT_RATIO', '0.40'));
const MIN_CHARS = parseInt(cfg('CLAUDE_ELOQUENT_MIN_CHARS', 'CLAUDE_PLUGIN_OPTION_MIN_CHARS', '200'), 10);
const CHECK_BLOCK_LINES = cfg('CLAUDE_ELOQUENT_CHECK_BLOCK_LINES', 'CLAUDE_PLUGIN_OPTION_CHECK_BLOCK_LINES', '0');
const MAX_BLOCK_LINES = parseInt(cfg('CLAUDE_ELOQUENT_MAX_BLOCK_LINES', 'CLAUDE_PLUGIN_OPTION_MAX_BLOCK_LINES', '6'), 10);
const ALLOW_ON_RETRY = cfg('CLAUDE_ELOQUENT_ALLOW_ON_RETRY', 'CLAUDE_PLUGIN_OPTION_ALLOW_ON_RETRY', '1');
const EXTRA_SKIP_EXT = (process.env.CLAUDE_ELOQUENT_EXTRA_SKIP_EXT ?? '')
  .split(',').map(s => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);

function analysedText(toolName, input) {
  if (toolName === 'Write') return typeof input.content === 'string' ? input.content : null;
  if (toolName === 'Edit') return typeof input.new_string === 'string' ? input.new_string : null;
  if (toolName === 'MultiEdit') {
    if (!Array.isArray(input.edits)) return null;
    return input.edits.map(e => (typeof e?.new_string === 'string' ? e.new_string : '')).join('\n');
  }
  return null;
}

// Sentinels expire so a long session cannot accumulate them, and so an edit
// revisited hours later is judged fresh rather than waved through.
function pruneSentinels(dir) {
  try {
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      try {
        if (now - statSync(full).mtimeMs > SENTINEL_TTL_MS) unlinkSync(full);
      } catch { /* raced with another hook */ }
    }
  } catch { /* dir may not exist yet */ }
}

try {
  if (bool(DISABLED)) process.exit(0);

  const event = JSON.parse(readStdin());
  const toolName = event.tool_name ?? '';
  const input = event.tool_input ?? {};
  const filePath = input.file_path;

  if (!filePath || typeof filePath !== 'string') process.exit(0);

  if (event.cwd && existsSync(join(event.cwd, '.claude-eloquent-skip'))) {
    log('check', 'SKIP: disabled via .claude-eloquent-skip');
    process.exit(0);
  }

  if (isSkippedExt(filePath, EXTRA_SKIP_EXT)) {
    log('check', `SKIP: doc ext ${filePath}`);
    process.exit(0);
  }

  const lang = detectLang(filePath);
  if (!lang) process.exit(0);

  const text = analysedText(toolName, input);
  if (!text) process.exit(0);

  const result = extractComments(text, lang);
  const { ratio, longestBlock, blockCount } = summarise(result);

  const ratioTripped = result.totalChars >= MIN_CHARS && ratio > RATIO;
  const blockTripped = bool(CHECK_BLOCK_LINES) && longestBlock > MAX_BLOCK_LINES;
  if (!ratioTripped && !blockTripped) process.exit(0);

  rotateLog();

  const sessionId = event.session_id ?? '';
  const percent = Math.round(ratio * 100);
  const stats = `${filePath} ${percent}% of ${result.totalChars} chars, ${blockCount} blocks, longest ${longestBlock}`;

  // No usable session id means no sentinel, so deny-once would become
  // deny-always. Fail open instead.
  if (!validSessionId(sessionId)) {
    log('check', `SKIP: invalid session_id (would have denied: ${stats})`);
    process.exit(0);
  }

  const sessionDir = join(SESSIONS_DIR, sessionId);
  const key = createHash('sha256').update(`${filePath}\n${text}`).digest('hex').slice(0, 16);
  const sentinel = join(sessionDir, key);

  if (bool(ALLOW_ON_RETRY)) {
    try {
      mkdirSync(sessionDir, { recursive: true });
      pruneSentinels(sessionDir);
      // Left in place, so a third identical submit is allowed too.
      if (existsSync(sentinel)) {
        log('check', `ALLOW (retry): ${stats}`);
        process.exit(0);
      }
      writeFileSync(sentinel, '');
    } catch (err) {
      // Unwritable sentinel dir turns deny-once into deny-always, so allow.
      log('check', `ALLOW (no sentinel: ${err.message}): ${stats}`);
      process.exit(0);
    }
  }

  log('check', `DENY: ${stats}`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: denyReason({ file: filePath, percent, blocks: blockCount, longestBlock, allowRetry: bool(ALLOW_ON_RETRY) }),
    },
  }));
  process.exit(0);
} catch (err) {
  log('check', `ERROR: unexpected failure: ${err.message}`);
  process.exit(0);
}
