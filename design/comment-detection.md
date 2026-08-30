# Comment detection

How `hooks/comments.mjs` decides what counts as a comment. The scanner is line-based and deliberately approximate; the deny-once/allow-on-retry rule in `hooks/check-comments.mjs` is what makes that acceptable.

## Text under analysis

| Tool | Text |
| --- | --- |
| `Edit` | `tool_input.new_string` |
| `Write` | `tool_input.content` |
| `MultiEdit` | `tool_input.edits[].new_string`, newline-joined |

`old_string` is never analysed. It is not part of the retry hash either, so Claude re-anchoring the same edit still reads as a retry.

## Language table

Detection is by extension of `tool_input.file_path`, falling back to the filename for extensionless files (`Dockerfile`, `justfile`, `Makefile`, `Gemfile`, `Rakefile`, `Vagrantfile`, `Brewfile`).

| Family | Line prefix | Block delimiters | Extensions |
| --- | --- | --- | --- |
| C-like | `//` | `/* */` | js, jsx, ts, tsx, mjs, cjs, mts, cts, go, rs, java, kt, kts, swift, c, h, cc, cpp, hpp, cs, scala, dart, php |
| Hash | `#` | none | sh, bash, zsh, pl, r, tf, Dockerfile, justfile, Makefile |
| Python | `#` | `"""` / `'''` | py, pyi |
| Ruby | `#` | `=begin` / `=end` | rb, rake, gemspec, Gemfile, Rakefile |
| Lua | `--` | `--[[ ]]` | lua |
| SQL | `--` | none | sql |
| HTML-ish | none | `<!-- -->` | html, htm, vue, svelte, xml |
| CSS | none | `/* */` | css, scss, less |

Unknown extensions and prose/data extensions (`md`, `mdx`, `txt`, `rst`, `adoc`, `json`, `yaml`, `yml`, `toml`, `csv`, `tsv`, `lock`, `ini`, `cfg`, `conf`, `env`, `properties`, `svg`, `patch`, `diff`, `snap`) exit before any scanning. `CLAUDE_ELOQUENT_EXTRA_SKIP_EXT` adds to that list.

## Rules

- A line is a comment line when, after leading whitespace, it starts with the family's line prefix, or it sits inside an open block delimiter.
- A trailing comment (`x = 1 // why`) counts toward `commentChars` but never opens or extends a block. One explanatory clause per line is not a wall of prose.
- A marker only registers at the start of a line or after whitespace. That is what keeps `$#`, `${#arr}`, and `a//b` from reading as comments. The cost is missing a spaceless trailing comment (`);// x`), which is the safe direction to err.
- Quote tracking is naive and resets at every newline: a marker inside a string literal opened earlier on the same line is ignored, but a marker inside a multi-line string can still be misread.
- Contiguous comment lines form one block. A blank line or a code line ends it.
- In Python, a `"""` or `'''` opens a comment block only when nothing but whitespace precedes it on the line, which covers docstrings. With code before it (`sql = """`) the line counts as code and the string runs to its closing quotes without being counted at all. A blank line inside an open block does not split it.
- In the hash family, a line opening a heredoc (`cat <<EOF`, `<<-'EOF'`) starts a string that runs until a line whose trimmed text equals the tag. Everything between counts as code, so `#` lines inside a heredoc are not comments.
- Character counts use trimmed line lengths, so indentation moves neither the comment count nor the total.

## Exclusions

Dropped from **both** `commentChars` and `totalChars`, so they neither trip a denial nor mask one:

- A shebang on line 1.
- Licence headers in the first 10 lines: `SPDX-`, `Copyright`, `Licensed under`, `All rights reserved`.
- Lint and tooling directives anywhere: `eslint-`, `noqa`, `nolint`, `prettier-ignore`, `type: ignore`, `pragma`, `TODO(`, `FIXME(`, `@ts-`, `istanbul ignore`, `rubocop:`, `shellcheck `, `golint`, `deprecated:`.

## Thresholds

1. **Ratio** (default on): `commentChars / totalChars > comment_ratio` and `totalChars >= min_chars`. Defaults `0.40` and `200`.
2. **Block lines** (default off): any block with `lines > max_block_lines`. Default `6`.

Either firing is a candidate denial.

## Deny-once

Sentinel path: `${CLAUDE_ELOQUENT_TMP}/sessions/<session_id>/<sha256(file_path + "\n" + text)[0:16]>`, with `session_id` validated against `^[a-zA-Z0-9_-]+$`.

- Absent: write it, deny.
- Present: log `ALLOW (retry)`, exit 0. The sentinel is left in place, so a third identical submit is allowed too.

Sentinels older than two hours are pruned on each invocation, and `SessionEnd` removes the session directory outright.

## Known limitations

- Multi-line strings outside Python triple quotes and shell heredocs are still untracked, so a comment marker inside a JS template literal can inflate the count. A retry clears it.
- JSX/TSX `{/* */}` is read as a C-like block comment, which is correct often enough.
- Only the identifier form of heredoc is tracked. A `<<` followed by anything other than a word (a `<<<` here-string aside, which is single-line) is not.
