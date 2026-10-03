// Stage mode (Plan-005 task 5): ⇧F puts the sound under your hands on the
// whole screen, its face and what you hear over it, for a gig or a stream.
//
// What this claims:
// - ⇧F enters it from PERFORM, and ⇧F or Esc leaves it, putting focus back.
// - Space still plays the sound in it (ADR-016). As the mock draws it, the
//   sound's face stands on the stage whether or not anything sounds (the
//   still layer, `.st-canvas`), and what sounds is drawn over it (the
//   trail, `.st-trail`): empty while nothing sounds, lit while the phrase
//   plays.
// - F alone still plays its note: only Shift and F is stage mode, and only in
//   PERFORM; in PATCH ⇧F plays the accented F it always did.
// - Tab stays inside stage mode (what is behind it is inert), and focus comes
//   back to where it was when it leaves.
// - A refusal said while it is on is in sight, over the stage and in its own
//   line.
//
// It reads the output level through an analyser on everything the app
// connects to the destination, as space_after_a_click.spec.js does.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");

const INIT = `(() => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode) {
      let a = this.context.__pwTap;
      if (!a) {
        a = this.context.createAnalyser();
        a.fftSize = 2048;
        this.context.__pwTap = a;
        window.__pwTap = a;
      }
      connect.call(this, a);
    }
    return r;
  };
  window.__pwPeakDb = () => {
    const a = window.__pwTap;
    if (!a) return -Infinity;
    const b = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(b);
    let peak = 0;
    for (const x of b) peak = Math.max(peak, Math.abs(x));
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  };
  // How much of one of the stage's layers is lit (any pixel with alpha):
  // the face (still) or the trail (what sounds).
  window.__stageLit = (sel = ".st-trail") => {
    const c = document.querySelector(sel);
    if (!c || !c.width) return 0;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++;
    return n;
  };
  try {
    for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"])
      localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await expect(page.locator("#rack-subject")).toContainText("Glass Pad", { timeout: 90_000 });
  return errs;
}
async function toPerform(page) {
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 30_000 });
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
}
const quiet = (page) => expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeLessThan(-60);

test("stage mode enters with ⇧F, leaves with ⇧F or Esc, and Space still plays in it", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await toPerform(page);

  const stage = page.locator(".st-stage");
  await page.keyboard.press("Shift+F");
  await expect(stage).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/\bst-on\b/);
  await expect(stage.locator(".st-name")).toHaveText("Glass Pad");
  expect(await page.evaluate(() => document.activeElement === document.querySelector(".st-stage"))).toBe(true);

  // Quiet: the sound's face stands, and nothing is drawn over it.
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeLessThan(-60);
  await expect.poll(() => page.evaluate(() => window.__stageLit(".st-canvas:not(.st-trail)")), { timeout: 60_000 }).toBeGreaterThan(50);
  await expect.poll(() => page.evaluate(() => window.__stageLit()), { timeout: 10_000 }).toBe(0);
  // Space plays the sound, and the stage draws it over the face.
  await page.keyboard.press(" ");
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeGreaterThan(-40);
  await expect.poll(() => page.evaluate(() => window.__stageLit()), { timeout: 10_000 }).toBeGreaterThan(50);
  await expect(stage).toBeVisible();
  await page.keyboard.press(" ");
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeLessThan(-60);

  // ⇧F leaves, and focus goes back where it was.
  await page.keyboard.press("Shift+F");
  await expect(stage).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/\bst-on\b/);
  // Esc leaves too.
  await page.keyboard.press("Shift+F");
  await expect(stage).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(stage).toHaveCount(0);

  // F alone is a note, as it always was.
  await page.keyboard.down("f");
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeGreaterThan(-40);
  await page.keyboard.up("f");
  await expect(stage).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("⇧F is stage mode in PERFORM only; in PATCH it is the accented F", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  // PATCH: ⇧F plays F, harder, and no stage opens.
  await goLevel(page, "patch");
  await expect(page.locator('.rail-stop[data-level="patch"]')).toHaveAttribute("aria-current", "location");
  await quiet(page);
  await page.keyboard.down("Shift");
  await page.keyboard.down("F");
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeGreaterThan(-40);
  await page.keyboard.up("F");
  await page.keyboard.up("Shift");
  await expect(page.locator(".st-stage")).toHaveCount(0);
  // PERFORM: ⇧F opens the stage, and plays nothing.
  await toPerform(page);
  await quiet(page);
  await page.keyboard.press("Shift+F");
  await expect(page.locator(".st-stage")).toBeVisible();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__pwPeakDb())).toBeLessThan(-60);
  await page.keyboard.press("Escape");
  await expect(page.locator(".st-stage")).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("Tab stays inside stage mode, and focus comes back where it was", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await toPerform(page);
  const bright = page.locator('.pf-knob[data-i="0"]');
  await bright.focus();
  await page.keyboard.press("Shift+F");
  await expect(page.locator(".st-stage")).toBeVisible();
  const inside = () => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest(".st-stage"));
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await inside(), `Tab ${i + 1} stays on the stage`).toBe(true);
  }
  // What is behind it can't be reached at all.
  expect(await page.evaluate(() => document.querySelector(".app").inert)).toBe(true);
  // Space on the stage plays, rather than pressing anything behind it.
  await page.locator(".st-stage").focus();
  await quiet(page);
  await page.keyboard.press(" ");
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeGreaterThan(-40);
  await page.keyboard.press(" ");
  await quiet(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".st-stage")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.querySelector('.pf-knob[data-i="0"]'))).toBe(true);
  expect(await page.evaluate(() => document.querySelector(".app").inert)).toBe(false);
  expect(errs).toEqual([]);
});

test("a refusal said in stage mode is in sight", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await toPerform(page);
  await page.keyboard.press("Shift+F");
  const stage = page.locator(".st-stage");
  await expect(stage).toBeVisible();
  // ⌘Z with nothing to take back, outside PATCH, refuses and says why.
  await page.keyboard.press("ControlOrMeta+z");
  const toast = page.locator(".toast.urgent", { hasText: "Nothing to undo here" });
  await expect(toast).toBeVisible({ timeout: 5_000 });
  // It is on top of the stage where it stands, not under it.
  const onTop = await toast.evaluate((t) => {
    const r = t.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && t.contains(hit);
  });
  expect(onTop, "the toast is over the stage").toBe(true);
  // …and the stage's own line says it too.
  await expect(stage.locator(".st-hint")).toContainText("Nothing to undo here");
  expect(errs).toEqual([]);
});
