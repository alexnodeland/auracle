// Unit tests for shipped-faces.js: which shipped face a preset is drawn from,
// and when the page must ask the engine to render it instead.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readPresetFaces, presetFace } from "../shipped-faces.js";
import { decodeFace, FACE_LEN } from "../faces.js";

const FILE = JSON.parse(readFileSync(new URL("../preset-faces.json", import.meta.url), "utf8"));

/** A face's bytes as the file holds them, every byte `level`. */
const b64 = (level) => Buffer.from(new Uint8Array(FACE_LEN).fill(level)).toString("base64");

/** A file of two presets, one with an AUDIO IN, rendered in `ns` with the
 *  reference clip `ref`. */
const twoPresets = {
  ns: "e3:q0.4.0:aaaa",
  clip: "ref",
  presets: [
    { name: "Plain", key: "k1", listens: false, face: b64(10) },
    { name: "Listens", key: "k2", listens: true, face: b64(20) },
  ],
};

test("the app's own file reads whole: every preset's face, filed as the worker files it", () => {
  const shipped = readPresetFaces(FILE, decodeFace);
  assert.equal(shipped.ns, FILE.ns);
  assert.equal(shipped.clip, FILE.clip);
  assert.equal(shipped.rows.size, FILE.presets.length, "a face for every preset in the file");
  for (const p of FILE.presets) {
    const row = shipped.rows.get(p.name);
    assert.equal(row.key, `${FILE.ns}/${p.key}`, `${p.name}: "<ns>/<render key>"`);
    assert.equal(row.face.ltas.length, 40, `${p.name}: a decoded face`);
  }
});

test("a session in the file's namespace draws a preset from it", () => {
  const shipped = readPresetFaces(twoPresets, decodeFace);
  const hit = presetFace(shipped, "Plain", { ns: "e3:q0.4.0:aaaa", clip: "ref" });
  assert.equal(hit.key, "e3:q0.4.0:aaaa/k1");
  // The face is the file's: its first band is level 10, 0.5 dB a step above −60.
  assert.equal(hit.face.ltas[0], -60 + 10 * 0.5);
  assert.deepEqual(hit.face, decodeFace(Buffer.from(twoPresets.presets[0].face, "base64")));
});

test("a session in another namespace has no shipped face, and renders", () => {
  const shipped = readPresetFaces(twoPresets, decodeFace);
  // Another build's featurizer (RENDER_EPOCH), DSP or stimulus.
  assert.equal(presetFace(shipped, "Plain", { ns: "e4:q0.4.0:aaaa", clip: "ref" }), null);
  // An engine too old to say its namespace.
  assert.equal(presetFace(shipped, "Plain", { ns: null, clip: "ref" }), null);
});

test("a preset with an AUDIO IN is drawn from the file only while the session hears the reference clip", () => {
  const shipped = readPresetFaces(twoPresets, decodeFace);
  const ns = "e3:q0.4.0:aaaa";
  assert.equal(presetFace(shipped, "Listens", { ns, clip: "ref" }).key, `${ns}/k2`);
  assert.equal(presetFace(shipped, "Listens", { ns, clip: "captured" }), null, "a captured clip measures its own");
  assert.equal(presetFace(shipped, "Listens", { ns, clip: null }), null, "an unknown clip is not the reference");
  // A preset that doesn't listen sounds the same whatever the clip.
  assert.equal(presetFace(shipped, "Plain", { ns, clip: "captured" }).key, `${ns}/k1`);
});

test("a preset the file does not hold, or a file that is not one, has no shipped face", () => {
  const shipped = readPresetFaces(twoPresets, decodeFace);
  assert.equal(presetFace(shipped, "Unheard Of", { ns: twoPresets.ns, clip: "ref" }), null);
  assert.equal(presetFace(null, "Plain", { ns: twoPresets.ns, clip: "ref" }), null, "no file (a blocked fetch)");
  for (const bad of [null, {}, { ns: "", presets: [] }, { ns: "x", presets: "no" }, "text"]) {
    assert.equal(readPresetFaces(bad, decodeFace), null, JSON.stringify(bad));
  }
});

test("a row that is not a preset's face is left out, and that preset renders", () => {
  const shipped = readPresetFaces({
    ns: "n",
    clip: "ref",
    presets: [
      { name: "Short", key: "k", face: Buffer.from([1, 2, 3]).toString("base64") },
      { name: "Not base64", key: "k", face: "%%%" },
      { name: "No key", face: b64(1) },
      null,
      { name: "Good", key: "k", face: b64(1) },
    ],
  }, decodeFace);
  assert.deepEqual([...shipped.rows.keys()], ["Good"]);
  assert.equal(shipped.clip, "ref");
  assert.equal(readPresetFaces({ ns: "n", presets: [] }, decodeFace).clip, null, "a file that names no clip");
});
