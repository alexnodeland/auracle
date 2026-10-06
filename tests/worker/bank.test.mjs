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
