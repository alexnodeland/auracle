// How many sounds in the pool carry each module, and each φ coordinate: the
// numbers PATCH's catalog states under the model view ("In 12 of 40 sounds",
// "In 3 of 40 sounds: too few for the model to lean yet"), and the support a lean
// needs before the catalog, the price and the plate's edge will draw it
// (main.js `NB_SUPPORT_MIN`). Read off the s-expression each ranked row
// already carries (`WasmEngine::ranked`'s `sexpr`), so it costs no engine
// call and is current from the first fill. Pure, and unit-tested
// (tests/support.test.mjs) against the grammar's own table
// (tests/fixtures/sexpr-heads.json, written by auracle-grammar's
// term::tests::the_sexpr_heads_fixture_is_current).

/** The kinds whose term the grammar's compact s-expression opens with a
 *  token other than the kind's own name (`AudioNode::to_sexpr` in
 *  auracle-grammar's term.rs). Searched for by its kind, a distortion would
 *  never be found ("the model has never seen a distortion" over a pool full
 *  of them), and an AUDIO IN never was (#202). */
const HEAD_IS_NOT_KIND = { distortion: "dist", audio_in: "audioin" };

/** The token a module's term opens with in an s-expression, by the kind the
 *  catalog keys it by (`MODULES`' `kind`, the name the wire knows it by). */
export function sexprHead(kind) {
  return Object.hasOwn(HEAD_IS_NOT_KIND, kind) ? HEAD_IS_NOT_KIND[kind] : kind;
}

/** Every token that opens a term in `sexpr`, once each: `(voice … (filter …
 *  (audioin …)))` is `voice`, `filter` and `audioin`. */
export function sexprHeads(sexpr) {
  const heads = new Set();
  for (const m of String(sexpr || "").matchAll(/\(([^\s()]+)/g)) heads.add(m[1]);
  return heads;
}

/** How many of the pool's `rows` (`{id, sexpr}`, cut ones aside) carry each
 *  of `modules` (`{kind, phi}`), and each coordinate they share.
 *
 *  - `counts[kind]`: the sounds with at least one of that module.
 *  - `byPhi[phi]`: the sounds with at least one module counted in that
 *    coordinate. Several modules share one (`n_drive` is the wavefolder,
 *    distortion, bitcrush and ring mod), and the coefficient's evidence is
 *    every sound using any of them, each sound once: a sound with a
 *    wavefolder and a distortion is one sound, not two. A module with no
 *    `phi` has a count and no coordinate.
 *  - `total`: the sounds, cut ones aside, whether or not their row carried an
 *    s-expression. */
export function poolSupport(rows, modules, cut = new Set()) {
  const counts = {};
  const byPhi = {};
  for (const m of modules) {
    counts[m.kind] = 0;
    if (m.phi) byPhi[m.phi] = 0;
  }
  const kept = (rows || []).filter((r) => !cut.has(r.id));
  for (const r of kept) {
    if (!r.sexpr) continue;
    const heads = sexprHeads(r.sexpr);
    const phis = new Set();
    for (const m of modules) {
      if (!heads.has(sexprHead(m.kind))) continue;
      counts[m.kind] += 1;
      if (m.phi) phis.add(m.phi);
    }
    for (const phi of phis) byPhi[phi] += 1;
  }
  return { counts, byPhi, total: kept.length };
}
