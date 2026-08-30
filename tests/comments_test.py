#!/usr/bin/env python3
"""Scanner assertions. Expected values are hand-checked against the fixtures;
chars are trimmed lengths, so indentation does not move them."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks"))

from comments import detect_lang, extract_comments, is_skipped_ext, summarise  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
failures = 0


def check(name, actual, expected):
    global failures
    if actual == expected:
        print("PASS: {}".format(name))
    else:
        print("FAIL: {}\n  expected {}\n  actual   {}".format(name, expected, actual), file=sys.stderr)
        failures += 1


def scan(file_name):
    path = os.path.join(FIXTURES, file_name)
    lang = detect_lang(path)
    with open(path, encoding="utf-8") as fh:
        r = extract_comments(fh.read(), lang)
    return {
        "lang": lang,
        "comment_chars": r["comment_chars"],
        "total_chars": r["total_chars"],
        "blocks": [[b["start_line"], b["lines"], b["chars"]] for b in r["blocks"]],
    }


# Line block, delimited block, trailing comment, and `//` inside a string.
check("clike.js", scan("clike.js"), {
    "lang": "c", "comment_chars": 113, "total_chars": 230, "blocks": [[1, 2, 46], [7, 2, 51]],
})

# Docstring counts as a block, blank line inside it does not split it.
check("docstring.py", scan("docstring.py"), {
    "lang": "py", "comment_chars": 88, "total_chars": 135, "blocks": [[2, 4, 39], [9, 2, 49]],
})

# A `SQL = """` assignment is a string, not a docstring: only the docstring
# and the trailing comment count.
check("multistring.py", scan("multistring.py"), {
    "lang": "py", "comment_chars": 54, "total_chars": 109, "blocks": [[2, 4, 34]],
})

# `#` lines inside a heredoc are data; only the comment after EOF counts.
check("heredoc.sh", scan("heredoc.sh"), {
    "lang": "hash", "comment_chars": 35, "total_chars": 92, "blocks": [[6, 1, 35]],
})

# SPDX and Copyright lines drop out of both counts.
check("license.go", scan("license.go"), {
    "lang": "c", "comment_chars": 22, "total_chars": 71, "blocks": [[5, 1, 22]],
})

# Near-misses ("pragmatic", "the copyright holder", "deprecated in v2") count;
# the anchored directives beside them do not.
check("markers.js", scan("markers.js"), {
    "lang": "c", "comment_chars": 107, "total_chars": 134, "blocks": [[2, 3, 107]],
})

# eslint directives drop out; the prose comment beside them does not.
check("lint.js", scan("lint.js"), {
    "lang": "c", "comment_chars": 30, "total_chars": 72, "blocks": [[5, 1, 30]],
})

# Shebang excluded, and `$#` is not a comment.
check("trailing.sh", scan("trailing.sh"), {
    "lang": "hash", "comment_chars": 54, "total_chars": 117, "blocks": [[5, 1, 32]],
})

check("markup.html", scan("markup.html"), {
    "lang": "html", "comment_chars": 75, "total_chars": 112, "blocks": [[1, 2, 53]],
})

check("empty input", extract_comments("", "c"), {"comment_chars": 0, "total_chars": 0, "blocks": []})
check("unknown lang", extract_comments("// hi\ncode();", None), {"comment_chars": 0, "total_chars": 0, "blocks": []})

# A blank line ends a block; a code line does too.
check("blank line splits blocks",
      [[b["start_line"], b["lines"]] for b in extract_comments("// a\n// b\n\n// c\nx();\n// d", "c")["blocks"]],
      [[1, 2], [4, 1], [6, 1]])

# A trailing comment counts toward the ratio but never opens a block.
check("trailing comment is not a block", extract_comments("x();  // why\ny();", "c"),
      {"comment_chars": 6, "total_chars": 16, "blocks": []})

check("detect_lang skips prose", [detect_lang("a.md"), detect_lang("a.json"), detect_lang("a.unknownext")],
      [None, None, None])
check("detect_lang by filename", [detect_lang("Dockerfile"), detect_lang("/x/justfile"), detect_lang("Gemfile")],
      ["hash", "hash", "rb"])
check("is_skipped_ext honours extras", [is_skipped_ext("a.md"), is_skipped_ext("a.js"), is_skipped_ext("a.js", ["js"])],
      [True, False, True])

check("summarise", summarise({"comment_chars": 60, "total_chars": 100, "blocks": [{"lines": 3}, {"lines": 7}]}),
      {"ratio": 0.6, "longest_block": 7, "block_count": 2})

if failures > 0:
    print("{} scanner test(s) failed".format(failures), file=sys.stderr)
    sys.exit(1)
print("all scanner tests passed")
