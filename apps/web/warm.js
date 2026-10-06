// The warm start's nine cards, drawn one per family, however big the library
// gets. Pure: the random function is handed in (main.js hands it
// Math.random), so tests/warm.test.mjs fixes it and holds the rule.
//
// This screen used to render a card for *every* preset and `warm-go` loaded
// every one of them — which was survivable at nine and is not at twenty-eight:
// a first-run screen you have to scroll, and 58% of a 48-slot pool spent
// before the user has expressed a single preference. Library size and grid
// size are now independent.
//
// Stratified rather than uniform on purpose. An unstratified sample of nine
// from a library that is deliberately unevenly weighted (five basses, three
// perc) keeps landing in the same corner, and a cold start taught from one
// corner is the exact bias this screen exists to remove. One per family first,
// then fill from what is left, so the first thirty seconds *span* the space.

/** How many cards the warm start shows. */
export const WARM_CARDS = 9;

/** Nine of the library's rows (`{index, category, …}`, in library order):
 *  one per family, in the order the families first appear, then filled from
 *  the rest, and back in library order. `random` is a draw in [0, 1), called
 *  once per family and then by the shuffle of the rest, in that order. */
export function warmSample(rows, random = Math.random) {
  const byCat = new Map();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category).push(r);
  }
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const chosen = [];
  const taken = new Set();
  for (const [, xs] of byCat) {
    const r = pick(xs);
    chosen.push(r);
    taken.add(r.index);
  }
  const rest = rows.filter((r) => !taken.has(r.index)).sort(() => random() - 0.5);
  while (chosen.length < WARM_CARDS && rest.length) chosen.push(rest.pop());
  // Back into library order so the grid reads as a shelf, not a shuffle.
  return chosen.slice(0, WARM_CARDS).sort((a, b) => a.index - b.index);
}
