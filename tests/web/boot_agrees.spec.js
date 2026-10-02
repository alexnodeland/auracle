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

test("the shipped seed deals the pinned pool in the built wasm, as it does natively", async () => {
  const wasm = path.join(PKG, "auracle_wasm_bg.wasm");
  expect(fs.existsSync(wasm), `no built engine at ${wasm} — run \`make wasm\` first`).toBe(true);
  const engine = await import(pathToFileURL(path.join(PKG, "auracle_wasm.js")).href);
  engine.initSync({ module: fs.readFileSync(wasm) });
  const difference = engine.boot_probe_difference(fs.readFileSync(PINNED, "utf8"));
  expect(difference, "the wasm engine deals a different pool than the native one").toBe("");
});
