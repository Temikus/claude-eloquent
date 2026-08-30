// Expect: 3 and 5 drop out as lint directives, the only counted comment is 7.

/* eslint-disable no-console */
const x = 1;
// eslint-disable-next-line no-unused-vars
const y = 2;
// A real comment that counts.
console.log(x, y);
