// Does the browser's engine deal what the native one deals, and draw what the
// native one drew?
//
// A seed is a promise that the same session deals the same pool, and the page
// runs the engine as wasm while the tests, the diagnostics and the shipped
// PERFORM wirings run it natively. They parted once: rand draws a `usize`
// from the stream through `next_u32` on wasm32 and `next_u64` on a 64-bit
// machine, so the prior's module picks dealt another tree from the same seed,
// and the page's pool, standardizer and wirings were not the ones the shipped
// file was measured under.
//
// This is the wasm half of the check. `boot_probe` (crates/auracle-wasm/src/
// shipped.rs) digests the first 400 draws of the fill stream and fills a small
// pool from the shipped seed; the native half (crates/auracle-wasm/tests/
// boot_agrees.rs) pins its output to tests/boot_probe.json, and here the built
// wasm must produce the same one: the same trees and vet decisions exactly,
// the standardizer's spreads to within the tolerance the shipped wirings use.
//
// The presets' faces are the same kind of promise. The page draws a preset's
// face from apps/web/preset-faces.json, rendered natively (`make preset-faces`,
// held to today's native render by crates/auracle-wasm/tests/
// shipped_faces.rs), in place of the face the page's own engine would render.
// A face is quantized to half a decibel, so a last-digit difference between
// the two targets (a maths function in one module) can move a band by a step
// for one preset and not another. So here every preset is rendered in the
// built wasm, as the worker renders a preset's face (`preset_tree_json`,
// `face_of_tree` on an engine of its own), and must be the file's byte for
// byte, under the key the worker files it by (`farm_key`). One test per
// family, a few seconds of renders each.
//
// It opens no page, so it needs Node and the package `make wasm` writes, and
// no browser. If the probe fails and the native test passes, the two targets
// deal differently, and the message names the first field that does: a
// draw's digest is the stream itself (a draw whose width depends on the
// target), `kept` or `draws_consumed` a render or a vetting decision, and
// `spread` alone the features in their last digits. If a family's faces fail
// and shipped_faces.rs passes, the wasm renders those presets otherwise than
// the native build, and the page draws them from a face its engine does not
// make.
//
// The one spec off the fixture (./fixtures): its automatic `pageErrors`
// watches the test's browser context, so a test taking `test` from there
// launches a browser even when it opens no page, and this one opens none.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const PKG = path.resolve(__dirname, "../../apps/web/pkg");
const PINNED = path.resolve(__dirname, "../../crates/auracle-wasm/tests/boot_probe.json");
const SHIPPED = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../apps/web/preset-faces.json"), "utf8"));
// The engine the native generator renders each preset's face on
// (`shipped::SEED`, `shipped::POOL`).
const SEED = 20260928n;
const POOL = 40;
// The library's families (`preset_list`'s `category`), a test each.
const FAMILIES = ["bass", "lead", "keys", "pad", "texture", "perc", "weird"];
// How far a number may sit from the pinned one, relative to its size (absolute
// below 1): `shipped::TOLERANCE`, which the native half uses.
const TOLERANCE = 1e-6;

// Where `now` first differs from `was`, as a path and both values: numbers
// within TOLERANCE, everything else exactly. "" if they agree. The native
// half does the same in Rust (`shipped::boot_probe_difference`); it is not in
// the page's wasm, so the comparison is made here.
function firstDifference(was, now, at) {
  const differs = () => `${at}: pinned ${JSON.stringify(was)}, now ${JSON.stringify(now)}`;
  if (typeof was === "number" && typeof now === "number") {
    const scale = Math.max(Math.abs(was), Math.abs(now), 1);
    return Math.abs(was - now) > TOLERANCE * scale ? differs() : "";
  }
  if (Array.isArray(was) && Array.isArray(now)) {
    if (was.length !== now.length) return `${at}: ${was.length} entries pinned, ${now.length} now`;
    for (let i = 0; i < was.length; i++) {
      const d = firstDifference(was[i], now[i], `${at}[${i}]`);
      if (d) return d;
    }
    return "";
  }
  if (was && now && typeof was === "object" && typeof now === "object" && !Array.isArray(was) && !Array.isArray(now)) {
    const [a, b] = [Object.keys(was).sort(), Object.keys(now).sort()];
    if (a.join() !== b.join()) return `${at}: keys pinned [${a}], now [${b}]`;
    for (const k of a) {
      const d = firstDifference(was[k], now[k], `${at}.${k}`);
      if (d) return d;
    }
    return "";
  }
  return was === now ? "" : differs();
}

/** The built engine's glue, initialized: loaded once in a worker, and said
 *  to be missing before anything is asked of it. */
async function load() {
  const wasm = path.join(PKG, "auracle_wasm_bg.wasm");
  expect(fs.existsSync(wasm), `no built engine at ${wasm} — run \`make wasm\` first`).toBe(true);
  const engine = await import(pathToFileURL(path.join(PKG, "auracle_wasm.js")).href);
  engine.initSync({ module: fs.readFileSync(wasm) });
  return engine;
}
let loaded = null;
const builtEngine = () => (loaded ||= load());

/** The library, as the built engine lists it: `{index, name, category}`. */
function presets(engine) {
  const e = new engine.WasmEngine(SEED, POOL);
  const list = JSON.parse(e.preset_list());
  e.free();
  return list;
}

test("the shipped seed deals the pinned pool in the built wasm, as it does natively", async () => {
  const engine = await builtEngine();
  const pinned = JSON.parse(fs.readFileSync(PINNED, "utf8"));
  const difference = firstDifference(pinned, JSON.parse(engine.boot_probe()), "probe");
  expect(difference, "the wasm engine deals a different pool than the native one").toBe("");
});

test("the presets' shipped faces are the built wasm's library, in its order, each preset in a family rendered below", async () => {
  const list = presets(await builtEngine());
  expect(SHIPPED.presets.map((p) => p.name), "the file's presets, in the library's order").toEqual(list.map((p) => p.name));
  expect([...new Set(list.map((p) => p.category))].sort(), "the library's families").toEqual([...FAMILIES].sort());
});

for (const family of FAMILIES) {
  test(`the ${family} presets' shipped faces are the faces the built wasm renders, under the keys the worker files them by`, async () => {
    const engine = await builtEngine();
    const rendered = presets(engine)
      .filter((p) => p.category === family)
      .map((p) => {
        // An engine of its own, its memo empty: the face is a render.
        const e = new engine.WasmEngine(SEED, POOL);
        const tree = e.preset_tree_json(p.index);
        const row = { name: p.name, key: engine.farm_key(tree, e.phrase_json()), face: Buffer.from(e.face_of_tree(tree, true)) };
        e.free();
        return { ...row, shipped: SHIPPED.presets[p.index] };
      });
    expect(rendered.length, `the ${family} family has presets`).toBeGreaterThan(0);
    expect(rendered.map((r) => r.shipped.name), "the file's rows, by the library's index").toEqual(rendered.map((r) => r.name));
    expect(rendered.map((r) => r.key), "each filed under the key the worker files its face by").toEqual(rendered.map((r) => `${SHIPPED.ns}/${r.shipped.key}`));
    const differ = rendered.filter((r) => !r.face.equals(Buffer.from(r.shipped.face, "base64"))).map((r) => r.name);
    expect(differ, "presets whose face the built wasm renders otherwise than the file (the native build)").toEqual([]);
  });
}
