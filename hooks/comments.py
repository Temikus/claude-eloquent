"""Pure comment scanner. No I/O, no config reads - the hook does that and passes
text in, so this module stays testable on its own.

Line-based on purpose: a real parser per language is not worth it here. False
negatives are harmless (an edit slips through), and false positives are bounded
by the caller's deny-once/allow-on-retry rule.
"""

import os
import re

FAMILIES = {
    "c": {"line": ["//"], "block": [("/*", "*/")]},
    "hash": {"line": ["#"], "block": [], "heredoc": re.compile(r"<<-?\s*['\"]?(\w+)['\"]?")},
    # docstring_only: a triple quote with code before it is a string literal, not
    # a docstring, so it must not open a comment block.
    "py": {"line": ["#"], "block": [('"""', '"""'), ("'''", "'''")], "docstring_only": True},
    "rb": {"line": ["#"], "block": [("=begin", "=end")]},
    "lua": {"line": ["--"], "block": [("--[[", "]]")]},
    "sql": {"line": ["--"], "block": []},
    "html": {"line": [], "block": [("<!--", "-->")]},
    "css": {"line": [], "block": [("/*", "*/")]},
}

BY_EXT = {
    "js": "c", "jsx": "c", "ts": "c", "tsx": "c", "mjs": "c", "cjs": "c", "mts": "c", "cts": "c",
    "go": "c", "rs": "c", "java": "c", "kt": "c", "kts": "c", "swift": "c", "c": "c", "h": "c",
    "cc": "c", "cpp": "c", "hpp": "c", "cs": "c", "scala": "c", "dart": "c", "php": "c",
    "py": "py", "pyi": "py",
    "rb": "rb", "rake": "rb", "gemspec": "rb",
    "sh": "hash", "bash": "hash", "zsh": "hash", "pl": "hash", "r": "hash", "tf": "hash",
    "lua": "lua", "sql": "sql",
    "html": "html", "htm": "html", "vue": "html", "svelte": "html", "xml": "html",
    "css": "css", "scss": "css", "less": "css",
}

# Extensionless files whose name is the language signal.
BY_NAME = {
    "dockerfile": "hash", "justfile": "hash", "makefile": "hash", "gemfile": "rb",
    "rakefile": "rb", "vagrantfile": "rb", "brewfile": "rb",
}

# Prose and data files. Comment density means nothing here, so the hook exits
# before scanning rather than guessing.
SKIP_EXT = frozenset([
    "md", "mdx", "txt", "rst", "adoc", "json", "jsonc", "json5", "yaml", "yml",
    "toml", "csv", "tsv", "lock", "ini", "cfg", "conf", "env", "properties",
    "svg", "patch", "diff", "snap",
])

# Comments that exist for a tool or a lawyer, not for a reader. Excluded from
# both the comment count and the total, so they neither trip nor mask a denial.
# Anchored: `^\W*` allows the comment prefix before the word, so `// Deprecated:
# use X` matches and `// this is deprecated: see above` does not.
LINT_MARKERS = re.compile(
    r"(\beslint-|\bnoqa\b|\bnolint\b|prettier-ignore|type:\s*ignore|\bpragma\b|\bTODO\(|\bFIXME\(|@ts-|istanbul ignore|rubocop:|shellcheck\s|\bgolint\b|^\W*deprecated:)",
    re.I,
)
LICENSE_MARKERS = re.compile(
    r"(\bSPDX-|^\W*Copyright\b|^\W*Licensed under\b|\bAll rights reserved\b)", re.I
)


def _ext(file_path):
    return os.path.splitext(os.path.basename(file_path).lower())[1][1:]


def detect_lang(file_path):
    if not file_path:
        return None
    name = os.path.basename(file_path).lower()
    if name in BY_NAME:
        return BY_NAME[name]
    ext = _ext(file_path)
    if not ext:
        return None
    if ext in SKIP_EXT:
        return None
    return BY_EXT.get(ext)


def is_skipped_ext(file_path, extra_skip=()):
    if not file_path:
        return True
    ext = _ext(file_path)
    if not ext:
        return False
    return ext in SKIP_EXT or ext in extra_skip


def _find_marker(line, markers):
    """Earliest occurrence of any marker that is not inside a string literal
    opened earlier on the same line. Quote tracking is deliberately naive: it
    resets at every newline, so a multi-line string can still be misread as code.

    A marker must sit at the start of the line or follow whitespace. That is what
    keeps `$#`, `${#arr}` and `a//b` from reading as comments; the cost is missing
    a spaceless trailing comment like `);// x`, which is the safe direction to err.
    """
    if not markers:
        return None
    quote = None
    i = 0
    n = len(line)
    while i < n:
        ch = line[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if i == 0 or line[i - 1].isspace():
            for m in markers:
                if line.startswith(m, i):
                    return {"index": i, "marker": m}
        if ch in ('"', "'", "`"):
            quote = ch
        i += 1
    return None


def _pick_earliest(a, b):
    if not a:
        return b
    if not b:
        return a
    if a["index"] != b["index"]:
        return a if a["index"] < b["index"] else b
    # Same position, e.g. `--` vs `--[[` in Lua: the longer marker wins.
    return a if len(a["marker"]) >= len(b["marker"]) else b


def _is_commentish(trimmed, line_markers, openers):
    return any(trimmed.startswith(m) for m in list(line_markers) + list(openers))


def extract_comments(text, lang):
    fam = FAMILIES.get(lang)
    if not fam or not isinstance(text, str) or text == "":
        return {"comment_chars": 0, "total_chars": 0, "blocks": []}

    lines = text.split("\n")
    openers = [open_ for open_, _ in fam["block"]]
    line_markers = fam["line"]

    comment_chars = 0
    total_chars = 0
    blocks = []
    current = None
    closer = None
    # Open string literal (heredoc or triple quote). Same shape as `closer`, but
    # its lines go to total_chars only. Either a literal to find, or a predicate
    # on the trimmed line for heredoc terminators.
    string_closer = None

    def start_block(line_no):
        nonlocal current
        if current is None:
            current = {"start_line": line_no, "lines": 0, "chars": 0}
            blocks.append(current)

    def end_block():
        nonlocal current
        current = None

    for i, raw in enumerate(lines):
        trimmed = raw.strip()
        line_no = i + 1

        if string_closer is not None:
            total_chars += len(trimmed)
            end_block()
            if string_closer(trimmed) if callable(string_closer) else string_closer in raw:
                string_closer = None
            continue

        if closer is None:
            if i == 0 and trimmed.startswith("#!"):
                continue
            if trimmed and LINT_MARKERS.search(trimmed) and _is_commentish(trimmed, line_markers, openers):
                continue
            if i < 10 and LICENSE_MARKERS.search(trimmed) and _is_commentish(trimmed, line_markers, openers):
                continue

        total_chars += len(trimmed)

        if closer is not None:
            end = raw.find(closer)
            if end == -1:
                comment_chars += len(trimmed)
                start_block(line_no)
                current["lines"] += 1
                current["chars"] += len(trimmed)
                continue
            comment_part = raw[: end + len(closer)].strip()
            rest = raw[end + len(closer):].strip()
            comment_chars += len(comment_part)
            start_block(line_no)
            current["lines"] += 1
            current["chars"] += len(comment_part)
            closer = None
            if rest:
                end_block()
            continue

        if trimmed == "":
            end_block()
            continue

        if fam.get("heredoc") and not _is_commentish(trimmed, line_markers, openers):
            m = fam["heredoc"].search(raw)
            if m:
                tag = m.group(1)
                string_closer = lambda t, tag=tag: t == tag
                end_block()
                continue

        line_hit = _find_marker(raw, line_markers)
        block_hit = _find_marker(raw, openers)
        hit = _pick_earliest(line_hit, block_hit)

        if not hit:
            end_block()
            continue

        is_line_comment = bool(
            line_hit and hit["index"] == line_hit["index"] and hit["marker"] == line_hit["marker"]
        )
        code_before = raw[: hit["index"]].strip()

        if not is_line_comment and fam.get("docstring_only") and code_before:
            open_, close = next(p for p in fam["block"] if p[0] == hit["marker"])
            if raw.find(close, hit["index"] + len(open_)) == -1:
                string_closer = close
            end_block()
            continue

        if is_line_comment:
            comment_part = raw[hit["index"]:].strip()
            comment_chars += len(comment_part)
            if code_before:
                # Trailing comment: counts toward the ratio, but does not open or
                # extend a block - one `x = 1 // why` per line is not a wall of prose.
                end_block()
            else:
                start_block(line_no)
                current["lines"] += 1
                current["chars"] += len(comment_part)
            continue

        open_, close = next(p for p in fam["block"] if p[0] == hit["marker"])
        after_open = raw.find(close, hit["index"] + len(open_))
        if after_open == -1:
            comment_part = raw[hit["index"]:].strip()
            comment_chars += len(comment_part)
            closer = close
            if code_before:
                end_block()
            else:
                start_block(line_no)
                current["lines"] += 1
                current["chars"] += len(comment_part)
            continue

        comment_part = raw[hit["index"]: after_open + len(close)].strip()
        rest = raw[after_open + len(close):].strip()
        comment_chars += len(comment_part)
        if code_before or rest:
            end_block()
        else:
            start_block(line_no)
            current["lines"] += 1
            current["chars"] += len(comment_part)

    return {"comment_chars": comment_chars, "total_chars": total_chars, "blocks": blocks}


def summarise(result):
    total = result["total_chars"]
    ratio = result["comment_chars"] / total if total > 0 else 0
    longest_block = max([b["lines"] for b in result["blocks"]], default=0)
    return {"ratio": ratio, "longest_block": longest_block, "block_count": len(result["blocks"])}
