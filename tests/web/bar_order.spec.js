// The bar along the bottom of a phone held upright (#134) reads from the
// most zoomed-in view outward: PERFORM, PATCH, TASTE, LEARNING, then EVOLVE
// beside them, then KEYS. A desktop's cross is not this bar and keeps its
// own order (its stops' order in the page, out to in from the top).
//
// What this claims: on a 390 × 844 phone the stops' left edges run in that
// order, each a tap that goes there; at 1440 × 900 the cross stands as it
// did, LEARNING above TASTE above PERFORM above PATCH.
const { test, expect, goLevel } = require("./fixtures");

const ORDER = ["perform", "patch", "taste", "learning", "evolve"];
const lefts = (page) => page.evaluate((order) => [
  ...order.map((l) => document.querySelector(`.rail-stop[data-level="${l}"]`).getBoundingClientRect().left),
  document.querySelector("#keys-toggle").getBoundingClientRect().left,
], ORDER);

test.describe("a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the bar along the bottom runs PERFORM, PATCH, TASTE, LEARNING, EVOLVE, KEYS", async ({ page, app }) => {
    await app.boot();
    const xs = await lefts(page);
    expect(xs, "the stops left to right").toEqual([...xs].sort((a, b) => a - b));
    for (const level of ORDER) await goLevel(page, level);
  });
});

test("a desktop's cross keeps its order, out to in from the top", async ({ page, app }) => {
  await app.boot();
  const tops = await page.evaluate(() => ["learning", "taste", "perform", "patch"].map((l) => document.querySelector(`.rail-stop[data-level="${l}"]`).getBoundingClientRect().top));
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
});
