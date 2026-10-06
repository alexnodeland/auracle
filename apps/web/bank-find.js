// Find a sound (`#bank-find`): what a sound must hold to stay in the bank
// while words are typed. Pure: main.js keeps what was typed (`bankQuery`,
// outside the list, so the bank's redraws keep it) and hands it in with each
// row's name, family and blurb, so tests/bank-find.test.mjs holds the rule.

/** What is typed, as Find reads it: trimmed and lowercased. "" finds
 *  everything. */
export function findQuery(typed) {
  return String(typed ?? "").trim().toLowerCase();
}

/** Does a sound match `query` (as `findQuery` gives it)? Its name, its
 *  category (a preset's family) or its blurb (a preset's own, or the preset
 *  a pool sound was opened from) holds it, in any case, anywhere in the
 *  words. A field it lacks holds nothing; an empty query matches every
 *  sound. */
export function bankMatches(query, name, category = "", blurb = "") {
  if (!query) return true;
  return [name, category, blurb].some((t) => String(t || "").toLowerCase().includes(query));
}
