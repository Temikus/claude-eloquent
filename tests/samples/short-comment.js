// Retries here are capped at three because the upstream API rate-limits
// aggressively and a fourth attempt is always rejected with a 429.
const alpha = "one two three four five six seven";
const beta = "eight nine ten eleven twelve";
const gamma = 1;
