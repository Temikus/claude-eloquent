// Expect: blocks 3-4 and 9-10, trailing comment 11, "//" in string 12 ignored.

// First block line one
// First block line two
function add(a, b) {
  return a + b;
}

/* Second block, delimited.
   Still the same block. */
const url = "https://example.com"; // trailing note
const path = "a // b";
export { add, url, path };
