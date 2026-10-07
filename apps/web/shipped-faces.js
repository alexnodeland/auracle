// The presets' faces the app ships (`preset-faces.json`, rendered natively by
// `make preset-faces`: crates/auracle-wasm/src/shipped/faces.rs). A preset's
// sound is fixed, so its face is too, and the page draws it from the file at
// once instead of asking the engine for a render that waits behind
// everything else the engine does. Pure, so it is unit-tested
// (tests/shipped-faces.test.mjs); main.js fetches the file and draws.
//
// A face is a picture of a render, and a shipped one is the session's only
// where its render is: in the same render namespace (the stimulus, the
// featurizer's RENDER_EPOCH, the quiver version: `cache_namespace`, which
// the engine says in its `ready`) and, for a preset with an AUDIO IN, with
// the same clip (the reference, until the player captures one). Anywhere
// else `presetFace` has none, and the page asks the engine to render it, as
// it did before the file existed. A shipped face is filed under the key the
// worker files a face under (`"<ns>/<render key>"`), so the preset's row and
// the same preset in the pool are one face.

/** The bytes of a base64 string, or null if it is not one. */
function bytesOf(text) {
  try {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch (_) {
    return null;
  }
}

/** The file, read: each preset's face decoded (`decode`: faces.js
 *  `decodeFace`) once, by the preset's name, and filed under its key. Null
 *  for anything that is not the file; a row that is not a preset's face is
 *  left out, and that preset is rendered. */
export function readPresetFaces(file, decode) {
  if (!file || typeof file.ns !== "string" || !file.ns || !Array.isArray(file.presets)) return null;
  const rows = new Map();
  for (const p of file.presets) {
    if (!p || typeof p.name !== "string" || typeof p.key !== "string" || typeof p.face !== "string") continue;
    const face = decode(bytesOf(p.face));
    if (!face) continue;
    rows.set(p.name, { key: `${file.ns}/${p.key}`, listens: p.listens === true, face });
  }
  return { ns: file.ns, clip: typeof file.clip === "string" ? file.clip : null, rows };
}

/** Preset `name`'s shipped face for a session that renders in `ns` and
 *  whose AUDIO IN hears the clip `clip` (its id): `{key, face}`, or null
 *  where the session would render it otherwise (another namespace, another
 *  clip for a preset that listens, a preset the file does not hold). */
export function presetFace(shipped, name, { ns, clip }) {
  if (!shipped || !ns || shipped.ns !== ns) return null;
  const row = shipped.rows.get(name);
  if (!row) return null;
  if (row.listens && clip !== shipped.clip) return null;
  return { key: row.key, face: row.face };
}
