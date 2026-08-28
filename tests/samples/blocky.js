// one
// two
// three
// four
// five
// six
// seven
export function widen(list, factor, offset, limit) {
  return list.map(item => item * factor + offset).slice(0, limit);
}

export function narrow(list, factor, offset, limit) {
  return list.map(item => (item - offset) / factor).slice(0, limit);
}
