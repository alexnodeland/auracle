// PATCH's four engine facts (Plan-008 C2b, round 2's "Engine facts, all
// four"), each drawn from the engine's own reply, at rest:
//
// - Without this module: the selected module's absence, measured. Over the
//   face at OUT, a dashed outline of the face of the patch the structure
//   menu's verb would leave (a processor bypassed, a source's socket empty, a
//   modulator unplugged), rendered by the worker (`face_of_tree`); a patch
//   that would be silent without it says so in the readout instead.
//
// The worker is reached as every PATCH spec reaches it (patch_page.js): the
// faces a page asks for, with their trees, and every face it is handed back.
const { test, expect } = require("@playwright/test");
const { boot, openPreset } = require("./patch_page.js");

/** Select a module on the canvas by its kind, as a press on its plate does. */
async function selectPlate(page, kind, nth = 0) {
  const plate = page.locator(`#rack-svg .rack-plates g[data-kind="${kind}"] .mod-plate`).nth(nth);
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 10, b.y + b.height - 6);
  await page.mouse.move(4, 400);
}

test("the face of the patch without the selected module is drawn at OUT, measured by the worker, and a patch silent without it says so", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, { warmed: true });
  // Hornet: a square VCO into a bandpass filter, a S&H modulating the cutoff.
  await openPreset(page, "Hornet");
  const out = page.locator("#out-without");
  await expect(out).toBeHidden();

  // The filter: bypassed, the VCO goes straight to the amp.
  await selectPlate(page, "filter");
  const key = await page.locator('#rack-svg .rack-plates g[data-kind="filter"]').getAttribute("data-key");
  await expect(out).toBeVisible({ timeout: 90_000 });
  await expect(out).toHaveAttribute("data-of", key);
  const drawn = { ref: await out.getAttribute("data-face"), key: await out.getAttribute("data-key") };
  const got = await page.evaluate(({ ref, key: k }) => {
    const ask = window.__pwPosted.filter((p) => p.type === "faces" && p.trees).flatMap((p) => p.trees).find((t) => t.ref === ref);
    const reply = window.__pwReplies.find((r) => r.type === "face" && r.ref === ref);
    const bench = JSON.parse(window.__pwLast.bench.treeJson);
    // The bypass the structure menu makes: the filter's input in its place.
    const node = k === "node" ? bench.root : null;
    const expected = node ? JSON.stringify({ ...bench, root: node.Filter.input }) : null;
    return { asked: ask ? ask.tree : null, replyKey: reply ? reply.key : null, expected };
  }, { ref: drawn.ref, key });
  expect(got.asked, "the outline's tree was asked of the worker").not.toBeNull();
  expect(got.expected, "Hornet's filter is its root").not.toBeNull();
  expect(got.asked, "…and it is the patch with the filter bypassed").toBe(got.expected);
  expect(got.replyKey, "the worker's own face for that tree is the one drawn").toBe(drawn.key);
  await expect(page.locator("#pt-read .pr-without")).toHaveCount(0);

  // The VCO is the only source: without it the patch is silent, which the
  // readout says, and nothing is drawn.
  await selectPlate(page, "vco");
  await expect(page.locator("#pt-read .pr-without")).toHaveText("silent without it");
  await expect(out).toBeHidden();

  // Nothing selected: nothing at OUT.
  await selectPlate(page, "filter");
  await expect(out).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(out).toBeHidden();
  expect(errors).toEqual([]);
});
