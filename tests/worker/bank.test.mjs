// What the worker answers when a patch file is opened: main's
// `loadPatchData` sends `import_patch`, and `patch_imported` says the id the
// patch landed as, or 0 with the bank's sound it already is (`duplicate`),
// which main opens and names (*… is already in the pool. Opening it.*). A 0
// with no `duplicate` is the refusal (*That patch didn't pass the safety
// vet…*).
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor } from "./harness.mjs";

const SEED = 1;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;

// A patch file an older build could write: a quantizer over nothing on the
// filter, a module that does nothing, which the import folds away (#208).
const file = JSON.stringify({
  amp: { attack: 0, decay: 0.45, sustain: 0.7, release: 0.3 },
  root: {
    Filter: {
      kind: "Ladder", cutoff: 0.56, resonance: 0.35, mod_depth: 0,
      input: { Vco: { wave: "Square", octave: -1, detune: 0.5, mod_depth: 0, modulation: "None" } },
      modulation: { Op: { kind: "quantize", p0: 0.5, p1: 0, input: "None" } },
    },
  },
});

test("a patch file opened twice lands once, and the second time is the sound it landed as, though the import folded it", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  const [first] = await w.send({ type: "import_patch", json: file, name: "Shared" });
  assert.equal(first.type, "patch_imported");
  assert.ok(first.id > 0, "the first open landed");
  const [landed] = await w.send({ type: "tree_json", id: first.id });
  assert.equal(JSON.parse(landed.json).root.Filter.modulation, "None", "fixture: the import folded the quantizer");

  const [again] = await w.send({ type: "import_patch", json: file, name: "Shared" });
  assert.equal(again.id, 0, "the second open landed a second copy");
  assert.equal(again.duplicate, first.id, "the second open was called a refusal, not the sound it is");
  await w.close();
});

// Main opens a pool member in the click's own task from the tree and makeup
// it already holds (#306): each member's are sent once, beside the first
// rows that list it (`trees`, worker.js `newTrees`), and a member that joins
// later (a preset loaded) comes with the rows it joins in, alone.
test("each pool member's tree and makeup reach main once, beside the first rows that list it", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  const held = new Map();
  const take = (r) => {
    const v = r.views || r;
    for (const [id, x] of Object.entries(v.trees || {})) held.set(Number(id), x);
    return v;
  };
  for (const r of w.replies) if (r.ranked || (r.views && r.views.ranked)) take(r);
  const [first] = await w.send({ type: "taste_views" });
  const views = take(first);
  const ids = views.ranked.map((r) => r.id);
  assert.ok(ids.length > 0, "the pool is listed");
  for (const id of ids) {
    const x = held.get(id);
    assert.ok(x, `member ${id}'s tree reached main`);
    const [tree] = await w.send({ type: "tree_json", id });
    assert.equal(x.json, tree.json, `member ${id}'s tree is the engine's`);
    assert.ok(Number.isFinite(x.makeup) && x.makeup > 0, `member ${id} has a makeup`);
    // Its `first` is for the panel it was predicted for: the six, named null.
    assert.equal(x.controls, null, `member ${id}'s first says which panel it was predicted for`);
  }
  const bytes = JSON.stringify(Object.fromEntries(held)).length;
  console.log(`${ids.length} members' trees: ${(bytes / 1024).toFixed(1)} KB, ${(bytes / ids.length / 1024).toFixed(1)} KB each`);

  // Sent once: the next rows carry none.
  const [again] = await w.send({ type: "taste_views" });
  assert.equal(again.views.trees, undefined, "a member main holds is not sent again");

  // A member that joins comes with the rows it joins in, alone.
  const loaded = await w.send({ type: "load_preset", index: 0 });
  const r = loaded.find((x) => x.type === "preset_loaded");
  assert.ok(r.id > 0, "the preset joined the pool");
  assert.deepEqual(Object.keys(r.views.trees || {}).map(Number), [r.id], "only the new member's tree is sent");
  await w.close();
});
