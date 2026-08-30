// Scanner assertions. Expected values are hand-checked against the fixtures;
// chars are trimmed lengths, so indentation does not move them. Each fixture
// opens with an `Expect:` line naming the lines that should count, which is
// itself a comment, so the first block below is always that line.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractComments, detectLang, summarise } from '../hooks/comments.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let failures = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS: ${name}`);
  } else {
    console.error(`FAIL: ${name}\n  expected ${e}\n  actual   ${a}`);
    failures++;
  }
}

function scan(file) {
  const path = join(FIXTURES, file);
  const lang = detectLang(path);
  const r = extractComments(readFileSync(path, 'utf8'), lang);
  return {
    lang,
    commentChars: r.commentChars,
    totalChars: r.totalChars,
    blocks: r.blocks.map(b => [b.startLine, b.lines, b.chars]),
  };
}

// Line block, delimited block, trailing comment, and `//` inside a string.
check('clike.js', scan('clike.js'), {
  lang: 'c', commentChars: 192, totalChars: 309, blocks: [[1, 1, 79], [3, 2, 46], [9, 2, 51]],
});

// Docstring counts as a block, blank line inside it does not split it.
check('docstring.py', scan('docstring.py'), {
  lang: 'py', commentChars: 139, totalChars: 186, blocks: [[1, 1, 51], [4, 4, 39], [11, 2, 49]],
});

// A `SQL = """` assignment is a string, not a docstring: only the docstring
// and the trailing comment count.
check('multistring.py', scan('multistring.py'), {
  lang: 'py', commentChars: 54, totalChars: 109, blocks: [[2, 4, 34]],
});

// `#` lines inside a heredoc are data; only the comment after EOF counts.
check('heredoc.sh', scan('heredoc.sh'), {
  lang: 'hash', commentChars: 35, totalChars: 92, blocks: [[6, 1, 35]],
});

// SPDX and Copyright lines drop out of both counts.
check('license.go', scan('license.go'), {
  lang: 'c', commentChars: 84, totalChars: 133, blocks: [[1, 1, 62], [7, 1, 22]],
});

// Near-misses ("pragmatic", "the copyright holder", "deprecated in v2") count;
// the anchored directives beside them do not.
check('markers.js', scan('markers.js'), {
  lang: 'c', commentChars: 107, totalChars: 134, blocks: [[2, 3, 107]],
});

// eslint directives drop out; the prose comment beside them does not.
check('lint.js', scan('lint.js'), {
  lang: 'c', commentChars: 108, totalChars: 150, blocks: [[1, 1, 78], [7, 1, 30]],
});

// Shebang excluded, and `$#` is not a comment.
check('trailing.sh', scan('trailing.sh'), {
  lang: 'hash', commentChars: 114, totalChars: 177, blocks: [[2, 1, 60], [7, 1, 32]],
});

check('markup.html', scan('markup.html'), {
  lang: 'html', commentChars: 125, totalChars: 162, blocks: [[1, 1, 50], [3, 2, 53]],
});

check('empty input', extractComments('', 'c'), { commentChars: 0, totalChars: 0, blocks: [] });
check('unknown lang', extractComments('// hi\ncode();', null), { commentChars: 0, totalChars: 0, blocks: [] });

// A blank line ends a block; a code line does too.
check('blank line splits blocks', extractComments('// a\n// b\n\n// c\nx();\n// d', 'c').blocks.map(b => [b.startLine, b.lines]),
  [[1, 2], [4, 1], [6, 1]]);

// A trailing comment counts toward the ratio but never opens a block.
check('trailing comment is not a block', extractComments('x();  // why\ny();', 'c'),
  { commentChars: 6, totalChars: 16, blocks: [] });

check('detectLang skips prose', [detectLang('a.md'), detectLang('a.json'), detectLang('a.unknownext')], [null, null, null]);
check('detectLang by filename', [detectLang('Dockerfile'), detectLang('/x/justfile'), detectLang('Gemfile')], ['hash', 'hash', 'rb']);
check('detectLang honours extra extensions', [detectLang('a.js'), detectLang('a.js', ['js'])], ['c', null]);
check('detectLang honours extra filenames', [detectLang('/x/justfile', ['justfile']), detectLang('/x/justfile', ['js'])], [null, 'hash']);

check('summarise', summarise({ commentChars: 60, totalChars: 100, blocks: [{ lines: 3 }, { lines: 7 }] }),
  { ratio: 0.6, longestBlock: 7, blockCount: 2 });

if (failures > 0) {
  console.error(`${failures} scanner test(s) failed`);
  process.exit(1);
}
console.log('all scanner tests passed');
