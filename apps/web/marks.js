// What a generation does: its seeds, and what it may replace. Pointing at
// (or focusing) EVOLVE POOL marks, in the bank, the sounds a generation
// breeds from and the ones it may replace, so a save can come first. Pure:
// main.js hands in what it holds (the running generation, ⚡'s walk, the
// ratings, the status) and paints the rows; tests/marks.test.mjs holds the
// rules. Every mark is the engine's own list (ADR-012), never worked out
// here:
// - at rest, a generation opened now: `ratings.seeds` (`Engine::next_seeds`,
//   the rule `refine_jobs` takes its parents by) and `ratings.may_replace`
//   (`Engine::may_replace`: nothing outside it can leave at its end), said
//   "may be replaced";
// - while one runs, that generation: the seeds it opened with
//   (`breeding.seeds`, posted with its progress: `refine_jobs`' parents), and
//   what its end would replace if it ended now (`refine_child`'s `retiring`,
//   `Engine::retiring`), said "will be replaced": stopped now or run out, its
//   end replaces them. That list grows by one with each child admitted
//   (`admit_refined` defers the eviction) and loses none, so it is empty until
//   the first child lands, and a child still to come can add a sound not on
//   it: it is not the whole of what may go (words.js `markWord`). A save made
//   while it runs takes its sound off the list (`eviction_order` passes over
//   saved sounds), and the reply says so (`retiringAfter`);
// - while ⚡ walks, the one sound it walks from (`refine_from_job`'s seed),
//   and what its child would replace if the pool takes it. With no
//   generation open `absorb_from` evicts at once (`evict_to_size`, the seed
//   protected) the lowest of `eviction_order`, which passes over the seed in
//   flight (`evolving`); `may_replace` ranks the same way, so its first
//   `pool + 1 − pool_target` (one at size, none while the pool fills) are
//   those.
// The rail carries the mark (amber, the model's choice: solid for a seed,
// dashed for what may go) and the word sits on the row's second line, over
// the stars, so the name never moves.

/** Nothing marked: EVOLVE POOL is not pointed at. */
export const NO_MARKS = Object.freeze({ seeds: [], may: [], kind: "may" });

/** The engine's lists the marks are read from, by what is running: `seeds`
 *  and `may` are ids, `kind` the word the dashed rows carry ("may" or
 *  "will", words.js `markWord`). `breeding` is the running generation
 *  (`{seeds, retiring, …}`) or null, `evolvingFrom` ⚡'s walk (`{id, …}`) or
 *  null, `ratings` the pool's ratings (`{seeds, may_replace}`) and `status`
 *  the engine's (`{pool, pool_target}`). */
export function evolveMarks({ breeding = null, evolvingFrom = null, ratings = null, status = null } = {}) {
  const r = ratings;
  if (breeding) return { seeds: breeding.seeds || [], may: breeding.retiring || [], kind: "will" };
  if (evolvingFrom) {
    const owed = status ? Math.max(0, (status.pool || 0) + 1 - (status.pool_target || Infinity)) : 0;
    const may = ((r && r.may_replace) || []).filter((id) => id !== evolvingFrom.id).slice(0, owed);
    return { seeds: [evolvingFrom.id], may, kind: "may" };
  }
  return { seeds: (r && r.seeds) || [], may: (r && r.may_replace) || [], kind: "may" };
}

/** The bank's marks from those lists, as sets: a seed is marked a seed, and
 *  never also as one that may go. */
export function bankMarks({ seeds, may, kind }) {
  const seedSet = new Set(seeds);
  return { seeds: seedSet, may: new Set(may.filter((id) => !seedSet.has(id))), kind };
}

/** What the running generation's end will replace, after a reply that can
 *  move it: a save, a preset or a kept edit (`eviction_order` passes over
 *  saved sounds, and a new member moves the lowest) carries `retiring` while
 *  one is open, and its list replaces the one held whole; a reply without
 *  one leaves it as it was. Only `refine_child` (whose list main.js takes as
 *  it lands) used to carry it, so a sound saved mid-run kept "will be
 *  replaced" while the one that would go instead was unmarked. Null with no
 *  generation open. */
export function retiringAfter(breeding, reply) {
  if (!breeding) return null;
  return Array.isArray(reply && reply.retiring) ? reply.retiring : breeding.retiring;
}
