// PERFORM's offer, as motion that shows what the engine does (ADR-012,
// Plan-005 task 5):
//
// - An offer is a short walk from the sound under your hands
//   (`Engine::offer`, through `perform_offer` with that sound's tree), so B
//   grows out of the sound's name into its place.
// - Taken, B fills with green and goes into the name: the bench takes its
//   tree, and it is the sound you play.
// - Passed, B folds back into the name it grew from: it is dropped, and the
//   sound you had is the sound you play.
// - The heard rule, unchanged: an offer can be taken heard or not, and only a
//   heard one (a second of PEEK, or of BLEND past half, while a note sounds)
//   is recorded as a pick.
//
// The motion is read where it is made: every `Element.animate` call is
// recorded (by wrapping it before main.js runs), and each moment's keyframes
// are checked against where the sound's name and B are on the page. Reduced
// motion is not tested here; each moment is also B's `data-moment`, which is
// what the assertions on state read.
const { test, expect } = require("@playwright/test");

const INIT = `(() => {
  const animate = Element.prototype.animate;
  const seen = (window.__anims = []);
  // What the page asks the engine to record (a pick from an offer).
  const records = (window.__records = []);
  const Orig = window.Worker;
  function Wrapped(url, o) {
    const w = new Orig(url, o);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && m.type === "perform_record") records.push({ took: !!m.took });
        return post(m, t);
      };
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  Element.prototype.animate = function (frames, opts) {
    const cls = String(this.className || "");
    if (/pf-(offer|ghost)/.test(cls)) {
      const r = this.getBoundingClientRect();
      seen.push({ cls, moment: this.dataset ? this.dataset.moment || "" : "", frames: JSON.parse(JSON.stringify(frames)), at: { left: r.left, top: r.top, width: r.width, height: r.height } });
    }
    return animate.call(this, frames, opts);
  };
})();`;

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  return errs;
}

async function openOnPerform(page, name) {
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30_000 });
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
}

async function grow(page) {
  await page.locator(".pf-pad", { hasText: /^(Offer|Next)$/ }).click();
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: 150_000 });
}

async function peek(page, ms) {
  const b = await page.locator(".pf-pad", { hasText: "Peek" }).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.mouse.move(10, 10);
}

// The box a "translate(x, y) scale(sx, sy)" puts `at` in (origin top left).
function boxOf(transform, at) {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+), ([-\d.]+)\)/.exec(transform);
  if (!m) return null;
  const [dx, dy, sx, sy] = m.slice(1).map(Number);
  return { left: at.left + dx, top: at.top + dy, width: at.width * sx, height: at.height * sy };
}
const near = (a, b, px = 2) => ["left", "top", "width", "height"].every((k) => Math.abs(a[k] - b[k]) <= px);
const nameBox = (page) => page.locator(".pf-name").evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
const anims = (page) => page.evaluate(() => window.__anims.slice());

test("an offer grows from the sound in hand, fills when taken, and folds back when passed", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(420_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  await page.keyboard.down("a");

  // Grown: B's first frame is the sound's name, its last is B's own place.
  let n0 = (await anims(page)).length;
  const name0 = await nameBox(page);
  await grow(page);
  await expect(page.locator(".pf-offer")).toHaveAttribute("data-moment", "grown");
  let grown = (await anims(page)).slice(n0).find((a) => !/ghost/.test(a.cls));
  expect(grown, "B grows").toBeTruthy();
  expect(near(boxOf(grown.frames[0].transform, grown.at), name0), "from the sound's name").toBe(true);
  expect(grown.frames[grown.frames.length - 1].transform).toBe("none");

  // Passed (heard): a copy of B folds back into the name; B empties.
  await peek(page, 1800);
  n0 = (await anims(page)).length;
  await page.locator(".pf-pad", { hasText: "Next" }).click();
  await expect(page.locator("#toasts")).toContainText("Passed on B.", { timeout: 10_000 });
  const folded = (await anims(page)).slice(n0).find((a) => /ghost/.test(a.cls) && a.moment === "folded");
  expect(folded, "B folds back").toBeTruthy();
  expect(folded.frames[0].transform).toBe("none");
  expect(near(boxOf(folded.frames[folded.frames.length - 1].transform, folded.at), await nameBox(page)), "into the sound's name").toBe(true);

  // Taken (heard): a copy of B fills green from its base, then goes into the
  // name, and the name is the offer's.
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: 150_000 });
  await peek(page, 1800);
  n0 = (await anims(page)).length;
  const before = await page.locator(".pf-name").textContent();
  const nameAtTake = await nameBox(page);
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  await expect(page.locator(".pf-offer")).toHaveAttribute("data-moment", "taken");
  const after = (await anims(page)).slice(n0);
  const fill = after.find((a) => /pf-ghost-fill/.test(a.cls));
  expect(fill, "B fills").toBeTruthy();
  expect(fill.frames.map((f) => f.transform)).toEqual(["scaleY(0)", "scaleY(1)"]);
  const taken = after.find((a) => /ghost/.test(a.cls) && a.moment === "taken");
  expect(near(boxOf(taken.frames[taken.frames.length - 1].transform, taken.at), nameAtTake), "into the sound's name").toBe(true);
  await expect(page.locator(".pf-name")).not.toHaveText(before, { timeout: 60_000 });
  await expect(page.locator(".pf-offer")).not.toHaveClass(/\bready\b/);
  await page.keyboard.up("a");
  expect(errs).toEqual([]);
});

test("an offer taken unheard becomes the sound but records no pick; heard, it records one", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(360_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const records = () => page.evaluate(() => window.__records.length);
  const picks = async () => Number(await page.locator("#duel-count").textContent());
  const p0 = await picks();
  // Unheard (no note sounding, no PEEK): TAKE is there, and takes it.
  await grow(page);
  const take = page.locator(".pf-pad", { hasText: "Take" });
  await expect(take).toBeEnabled();
  const name = await page.locator(".pf-name").textContent();
  await take.click();
  await expect(page.locator(".pf-name")).not.toHaveText(name, { timeout: 60_000 });
  await expect(page.locator(".pf-offer")).not.toHaveClass(/\bready\b/);
  // Past a take's eight-second window: nothing was sent to be recorded
  // (`perform_record`, the engine's `record_tree_duel`), and no pick counted.
  await page.waitForTimeout(10_000);
  expect(await records(), "an unheard take records no pick").toBe(0);
  expect(await picks()).toBe(p0);
  // Heard (a second of PEEK with a note sounding): the same TAKE records one.
  await page.keyboard.down("a");
  await grow(page);
  await peek(page, 1600);
  await take.click();
  await expect.poll(records, { timeout: 30_000 }).toBe(1);
  await expect.poll(picks, { timeout: 30_000 }).toBe(p0 + 1);
  await page.keyboard.up("a");
  expect(errs).toEqual([]);
});
