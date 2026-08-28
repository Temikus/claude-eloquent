// Shared wording for the PreToolUse denial and the SessionStart nudge, so the
// two cannot drift apart.

// What survives a rewrite, and what does not. Reused verbatim in both strings.
const KEEP = 'Keep only what a reader of this code cannot infer from the code itself: non-obvious intent, invariants, dangers, quirks of an external API, and why an unusual choice was made.';
const DROP = 'Remove narration of what the code does, implementation history, references to old behaviour, "previously"/"now"/"the win here" phrasing, and anything that restates the identifier names.';

export function denyReason({ file, percent, blocks, longestBlock }) {
  return `claude-eloquent: this edit to ${file} is ${percent}% comment (${blocks} comment ${blocks === 1 ? 'block' : 'blocks'}, longest ${longestBlock} ${longestBlock === 1 ? 'line' : 'lines'}). Rewrite the comments before resubmitting. ${KEEP} ${DROP} If every remaining comment is genuinely needed, resubmit the same edit unchanged and it will be accepted.`;
}

// Kept under 400 chars: it is prepended to every session, so it pays rent on
// every turn. Same rule as denyReason, compressed.
export const sessionContext = 'Comment style: keep only what a reader cannot infer from the code itself - non-obvious intent, invariants, dangers, external-API quirks, and why an unusual choice was made. Drop narration of what the code does, implementation history, references to old behaviour, and anything restating identifier names. A mostly-comment edit is bounced once; resubmit it unchanged to accept it.';
