"""Shared wording for the PreToolUse denial and the SessionStart nudge, so the
two cannot drift apart."""

# What survives a rewrite, and what does not. Reused verbatim in both strings.
KEEP = (
    "Keep only what a reader of this code cannot infer from the code itself: "
    "non-obvious intent, invariants, dangers, quirks of an external API, and why "
    "an unusual choice was made."
)
DROP = (
    'Remove narration of what the code does, implementation history, references to '
    'old behaviour, "previously"/"now"/"the win here" phrasing, and anything that '
    "restates the identifier names."
)


def deny_reason(file, percent, blocks, longest_block, allow_retry=True):
    """The closing sentence depends on allow_on_retry: promising a resubmit that
    the hook then denies again sends the model into a loop it cannot exit."""
    ending = (
        "If every remaining comment is genuinely needed, resubmit the same edit "
        "unchanged and it will be accepted."
        if allow_retry
        else "This check denies every time; reduce the comments."
    )
    return (
        "claude-eloquent: this edit to {} is {}% comment ({} comment {}, longest {} {}). "
        "Rewrite the comments before resubmitting. {} {} {}".format(
            file,
            percent,
            blocks,
            "block" if blocks == 1 else "blocks",
            longest_block,
            "line" if longest_block == 1 else "lines",
            KEEP,
            DROP,
            ending,
        )
    )


# Kept under 400 chars: it is prepended to every session, so it pays rent on
# every turn. Same rule as deny_reason, compressed.
SESSION_CONTEXT = (
    "Comment style: keep only what a reader cannot infer from the code itself - "
    "non-obvious intent, invariants, dangers, external-API quirks, and why an unusual "
    "choice was made. Drop narration of what the code does, implementation history, "
    "references to old behaviour, and anything restating identifier names. A "
    "mostly-comment edit is bounced once; resubmit it unchanged to accept it."
)
