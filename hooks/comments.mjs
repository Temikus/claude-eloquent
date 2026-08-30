// Pure comment scanner. No I/O, no config reads — the hook does that and passes
// text in, so this module stays testable with `node -e`.
//
// Line-based on purpose: a real parser per language is not worth it here. False
// negatives are harmless (an edit slips through), and false positives are
// bounded by the caller's deny-once/allow-on-retry rule.

import { basename, extname } from 'node:path';

const FAMILIES = {
  c: { line: ['//'], block: [['/*', '*/']] },
  hash: { line: ['#'], block: [], heredoc: /<<-?\s*['"]?(\w+)['"]?/ },
  // docstringOnly: a triple quote with code before it is a string literal, not
  // a docstring, so it must not open a comment block.
  py: { line: ['#'], block: [['"""', '"""'], ["'''", "'''"]], docstringOnly: true },
  rb: { line: ['#'], block: [['=begin', '=end']] },
  lua: { line: ['--'], block: [['--[[', ']]']] },
  sql: { line: ['--'], block: [] },
  html: { line: [], block: [['<!--', '-->']] },
  css: { line: [], block: [['/*', '*/']] },
};

const BY_EXT = {
  js: 'c', jsx: 'c', ts: 'c', tsx: 'c', mjs: 'c', cjs: 'c', mts: 'c', cts: 'c',
  go: 'c', rs: 'c', java: 'c', kt: 'c', kts: 'c', swift: 'c', c: 'c', h: 'c',
  cc: 'c', cpp: 'c', hpp: 'c', cs: 'c', scala: 'c', dart: 'c', php: 'c',
  py: 'py', pyi: 'py',
  rb: 'rb', rake: 'rb', gemspec: 'rb',
  sh: 'hash', bash: 'hash', zsh: 'hash', pl: 'hash', r: 'hash', tf: 'hash',
  lua: 'lua', sql: 'sql',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html', xml: 'html',
  css: 'css', scss: 'css', less: 'css',
};

// Extensionless files whose name is the language signal.
const BY_NAME = {
  dockerfile: 'hash', justfile: 'hash', makefile: 'hash', gemfile: 'rb',
  rakefile: 'rb', vagrantfile: 'rb', brewfile: 'rb',
};

// Prose and data files. Comment density means nothing here, so the hook exits
// before scanning rather than guessing.
export const SKIP_EXT = new Set([
  'md', 'mdx', 'txt', 'rst', 'adoc', 'json', 'jsonc', 'json5', 'yaml', 'yml',
  'toml', 'csv', 'tsv', 'lock', 'ini', 'cfg', 'conf', 'env', 'properties',
  'svg', 'patch', 'diff', 'snap',
]);

// Comments that exist for a tool or a lawyer, not for a reader. Excluded from
// both the comment count and the total, so they neither trip nor mask a denial.
// Anchored: `^\W*` allows the comment prefix before the word, so `// Deprecated:
// use X` matches and `// this is deprecated: see above` does not.
const LINT_MARKERS = /(\beslint-|\bnoqa\b|\bnolint\b|prettier-ignore|type:\s*ignore|\bpragma\b|\bTODO\(|\bFIXME\(|@ts-|istanbul ignore|rubocop:|shellcheck\s|\bgolint\b|^\W*deprecated:)/i;
const LICENSE_MARKERS = /(\bSPDX-|^\W*Copyright\b|^\W*Licensed under\b|\bAll rights reserved\b)/i;

export function detectLang(filePath) {
  if (!filePath) return null;
  const name = basename(filePath).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const ext = extname(name).slice(1);
  if (!ext) return null;
  if (SKIP_EXT.has(ext)) return null;
  return BY_EXT[ext] ?? null;
}

export function isSkippedExt(filePath, extraSkip = []) {
  if (!filePath) return true;
  const ext = extname(basename(filePath).toLowerCase()).slice(1);
  if (!ext) return false;
  return SKIP_EXT.has(ext) || extraSkip.includes(ext);
}

// Earliest occurrence of any marker that is not inside a string literal opened
// earlier on the same line. Quote tracking is deliberately naive: it resets at
// every newline, so a multi-line string can still be misread as code.
//
// A marker must sit at the start of the line or follow whitespace. That is what
// keeps `$#`, `${#arr}` and `a//b` from reading as comments; the cost is missing
// a spaceless trailing comment like `);// x`, which is the safe direction to err.
function findMarker(line, markers) {
  if (markers.length === 0) return null;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (i === 0 || /\s/.test(line[i - 1])) {
      for (const m of markers) {
        if (line.startsWith(m, i)) return { index: i, marker: m };
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
  }
  return null;
}

export function extractComments(text, lang) {
  const fam = FAMILIES[lang];
  const empty = { commentChars: 0, totalChars: 0, blocks: [] };
  if (!fam || typeof text !== 'string' || text.length === 0) return empty;

  const lines = text.split('\n');
  const openers = fam.block.map(([open]) => open);
  const lineMarkers = fam.line;

  let commentChars = 0;
  let totalChars = 0;
  const blocks = [];
  let current = null;
  let closer = null;
  // Open string literal (heredoc or triple quote). Same shape as `closer`, but
  // its lines go to totalChars only. Either a literal to find, or a predicate
  // on the trimmed line for heredoc terminators.
  let stringCloser = null;

  const startBlock = (lineNo) => {
    if (!current) { current = { startLine: lineNo, lines: 0, chars: 0 }; blocks.push(current); }
  };
  const endBlock = () => { current = null; };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const lineNo = i + 1;

    if (stringCloser !== null) {
      totalChars += trimmed.length;
      endBlock();
      if (typeof stringCloser === 'function' ? stringCloser(trimmed) : raw.includes(stringCloser)) stringCloser = null;
      continue;
    }

    if (closer === null) {
      if (i === 0 && trimmed.startsWith('#!')) continue;
      if (trimmed && LINT_MARKERS.test(trimmed) && isCommentish(trimmed, lineMarkers, openers)) continue;
      if (i < 10 && LICENSE_MARKERS.test(trimmed) && isCommentish(trimmed, lineMarkers, openers)) continue;
    }

    totalChars += trimmed.length;

    if (closer !== null) {
      const end = raw.indexOf(closer);
      if (end === -1) {
        commentChars += trimmed.length;
        startBlock(lineNo);
        current.lines++;
        current.chars += trimmed.length;
        continue;
      }
      const commentPart = raw.slice(0, end + closer.length).trim();
      const rest = raw.slice(end + closer.length).trim();
      commentChars += commentPart.length;
      startBlock(lineNo);
      current.lines++;
      current.chars += commentPart.length;
      closer = null;
      if (rest) endBlock();
      continue;
    }

    if (trimmed === '') { endBlock(); continue; }

    if (fam.heredoc && !isCommentish(trimmed, lineMarkers, openers)) {
      const m = fam.heredoc.exec(raw);
      if (m) {
        const tag = m[1];
        stringCloser = (t) => t === tag;
        endBlock();
        continue;
      }
    }

    const lineHit = findMarker(raw, lineMarkers);
    const blockHit = findMarker(raw, openers);
    const hit = pickEarliest(lineHit, blockHit);

    if (!hit) { endBlock(); continue; }

    const isLineComment = lineHit && hit.index === lineHit.index && hit.marker === lineHit.marker;
    const codeBefore = raw.slice(0, hit.index).trim();

    if (!isLineComment && fam.docstringOnly && codeBefore) {
      const [open, close] = fam.block.find(([o]) => o === hit.marker);
      if (raw.indexOf(close, hit.index + open.length) === -1) stringCloser = close;
      endBlock();
      continue;
    }

    if (isLineComment) {
      const commentPart = raw.slice(hit.index).trim();
      commentChars += commentPart.length;
      if (codeBefore) {
        // Trailing comment: counts toward the ratio, but does not open or extend
        // a block — one `x = 1 // why` per line is not a wall of prose.
        endBlock();
      } else {
        startBlock(lineNo);
        current.lines++;
        current.chars += commentPart.length;
      }
      continue;
    }

    const [open, close] = fam.block.find(([o]) => o === hit.marker);
    const afterOpen = raw.indexOf(close, hit.index + open.length);
    if (afterOpen === -1) {
      const commentPart = raw.slice(hit.index).trim();
      commentChars += commentPart.length;
      closer = close;
      if (codeBefore) {
        endBlock();
      } else {
        startBlock(lineNo);
        current.lines++;
        current.chars += commentPart.length;
      }
      continue;
    }

    const commentPart = raw.slice(hit.index, afterOpen + close.length).trim();
    const rest = raw.slice(afterOpen + close.length).trim();
    commentChars += commentPart.length;
    if (codeBefore || rest) {
      endBlock();
    } else {
      startBlock(lineNo);
      current.lines++;
      current.chars += commentPart.length;
    }
  }

  return { commentChars, totalChars, blocks };
}

function isCommentish(trimmed, lineMarkers, openers) {
  return [...lineMarkers, ...openers].some(m => trimmed.startsWith(m));
}

function pickEarliest(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.index !== b.index) return a.index < b.index ? a : b;
  // Same position, e.g. `--` vs `--[[` in Lua: the longer marker wins.
  return a.marker.length >= b.marker.length ? a : b;
}

export function summarise(result) {
  const ratio = result.totalChars > 0 ? result.commentChars / result.totalChars : 0;
  const longestBlock = result.blocks.reduce((m, b) => Math.max(m, b.lines), 0);
  return { ratio, longestBlock, blockCount: result.blocks.length };
}
