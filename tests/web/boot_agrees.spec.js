// Does the browser's engine deal what the native one deals?
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
// It opens no page, so it needs Node and the package `make wasm` writes, and
// no browser. If it fails and the native test passes, the two targets deal
// differently, and the message names the first field that does: a draw's
// digest is the stream itself (a draw whose width depends on the target),
// `kept` or `draws_consumed` a render or a vetting decision, and `spread`
// alone the features in their last digits.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const PKG = path.resolve(__dirname, "../../apps/web/pkg");
const PINNED = path.resolve(__dirname, "../../crates/auracle-wasm/tests/boot_probe.json");
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

test("the shipped seed deals the pinned pool in the built wasm, as it does natively", async () => {
  const wasm = path.join(PKG, "auracle_wasm_bg.wasm");
  expect(fs.existsSync(wasm), `no built engine at ${wasm} — run \`make wasm\` first`).toBe(true);
  const engine = await import(pathToFileURL(path.join(PKG, "auracle_wasm.js")).href);
  engine.initSync({ module: fs.readFileSync(wasm) });
  const pinned = JSON.parse(fs.readFileSync(PINNED, "utf8"));
  const difference = firstDifference(pinned, JSON.parse(engine.boot_probe()), "probe");
  expect(difference, "the wasm engine deals a different pool than the native one").toBe("");
});
