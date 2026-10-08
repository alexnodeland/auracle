// The launch film's opening circuits: every preset the app ships, as PATCH
// describes it (the engine's own rack description, `describe_of`: each
// module's kind, title, column, knobs and their values, and the cables), laid
// out the way PATCH lays a patch out, signal flowing left to right into OUT.
// film.js tiles them into the field the opening pulls back to, and the title's
// cloud rises from their knobs.
//
//   node www/video/films/launch/giant_patch.mjs      (after make wasm or make pkg-reuse)
//
// Writes www/video/films/launch/giant_patch.json. Run it again when the
// presets change. Nothing here is invented: the patches are the presets, and
// their knobs sit where the presets set them. They are not joined into one
// patch: a tree that large is over the grammar's ceilings, so the field is
// the library side by side, each circuit wired to its own OUT.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PKG = path.resolve(HERE, "../../../../apps/web/pkg");
const glue = await import(path.join(PKG, "auracle_wasm.js"));
glue.initSync({ module: new WebAssembly.Module(readFileSync(path.join(PKG, "auracle_wasm_bg.wasm"))) });

// A session to describe the presets in: the engine admits a sound to its pool
// once it has a standardizer, so it fills a few and standardizes.
const engine = new glue.WasmEngine(7n, 200);
for (let n = 0; n < 6; ) {
  const k = engine.fill_step(2);
  if (!k) break;
  n += k;
}
engine.standardize_now();

// PATCH's proportions, in the film's world units.
const ROW_H = 190;
const PLATE_H = 140;
const COL_GAP = 70;
const knobW = 82;
const plateW = (n) => Math.max(140, 40 + knobW * n);

function layout(rack) {
  const mods = rack.modules.map((m) => {
    const dials = m.knobs.filter((k) => k.kind.t !== "enum");
    const modes = m.knobs.filter((k) => k.kind.t === "enum");
    const kind = modes.map((k) => k.kind.options[Math.round(k.value * (k.kind.options.length - 1))] ?? "").join(" · ");
    return {
      key: m.key,
      title: m.title,
      kind,
      col: m.column,
      mod: !!m.is_mod,
      // A knob's place on its travel: an octave is an index from -2 to +2.
      knobs: dials.map((k) => [k.label, Math.round((k.kind.t === "octave" ? k.value / 4 : k.value) * 1000) / 1000]),
      // A delay, a phaser or a flanger feeds its output back to its input.
      fb: dials.some((k) => k.label === "feedback"),
    };
  });
  const at = new Map(mods.map((m, i) => [m.key, i]));
  const wires = rack.wires.map((w) => [at.get(w.from), at.get(w.to), w.kind]).filter(([a, b]) => a != null && b != null);
  // Rows: the chain into OUT on row 0; a second input, and each modulator,
  // on a row of its own under it.
  const kids = (i, kind) => wires.filter(([, to, k]) => to === i && (kind === "mod" ? k === "mod" : k !== "mod")).map(([from]) => from);
  let next = 0;
  const rowOf = new Map();
  const visit = (i, row) => {
    rowOf.set(i, row);
    kids(i, "audio").forEach((c, j) => visit(c, j === 0 ? row : ++next));
    kids(i, "mod").forEach((c) => visit(c, ++next));
  };
  const root = mods.findIndex((m) => m.key === "amp");
  visit(root, 0);
  mods.forEach((m, i) => {
    if (!rowOf.has(i)) rowOf.set(i, ++next);
  });
  const maxCol = Math.max(...mods.map((m) => m.col));
  const colW = Array.from({ length: maxCol + 1 }, (_, c) => Math.max(0, ...mods.filter((m) => m.col === c).map((m) => plateW(m.knobs.length))));
  const colX = [];
  let x = 0;
  for (let c = maxCol; c >= 0; c--) {
    colX[c] = x;
    x += colW[c] + COL_GAP;
  }
  for (const [i, m] of mods.entries()) {
    m.w = plateW(m.knobs.length);
    m.x = colX[m.col] + (colW[m.col] - m.w);
    m.y = rowOf.get(i) * ROW_H;
    m.h = PLATE_H;
    delete m.key;
    delete m.col;
  }
  const amp = mods[root];
  const out = { x: amp.x + amp.w + 46, y: amp.y + PLATE_H / 2 };
  const scope = { x: out.x + 40, y: amp.y - 5, w: 230, h: PLATE_H + 10 };
  return { w: scope.x + scope.w, h: (next + 1) * ROW_H - (ROW_H - PLATE_H), modules: mods, wires, out, scope };
}

const racks = [];
for (const r of JSON.parse(engine.preset_list())) {
  const id = engine.load_preset(r.index);
  const d = id ? JSON.parse(engine.describe_of(id)) : null;
  if (!d) throw new Error(`giant_patch: the engine would not describe ${r.name}`);
  racks.push({ name: r.name, category: r.category, ...layout(d) });
}
const knobs = racks.reduce((n, r) => n + r.modules.reduce((m, p) => m + p.knobs.length, 0), 0);
const out = {
  about: "Every preset the app ships, as PATCH describes it (describe_of), laid out as PATCH lays a patch out. Written by giant_patch.mjs; do not edit.",
  racks,
};
writeFileSync(path.join(HERE, "giant_patch.json"), JSON.stringify(out) + "\n");
console.log(`giant_patch.json: ${racks.length} patches, ${racks.reduce((n, r) => n + r.modules.length, 0)} modules, ${knobs} knobs, ${racks.filter((r) => r.modules.some((m) => m.fb)).length} with feedback`);
