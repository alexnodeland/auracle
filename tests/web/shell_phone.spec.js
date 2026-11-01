// A phone, a tablet and a narrow window get the instrument (#134, Plan-008
// §7, Plan-005 task 8). Under 1000 px the app used to show a notice asking
// for a wider window, and on a phone a gate that never started the engine;
// both are gone, and each size has a layout of its own.
//
// What this claims:
//
// - A phone held upright (390 × 844, and a small one, 360 × 640) boots, with
//   no gate and no notice. The levels are the bar along the bottom (PERFORM,
//   PATCH, TASTE, LEARNING, then EVOLVE and KEYS), each stop's name printed
//   whole under its icon, and a tap on one goes there.
//   At every level nothing scrolls the page sideways, the level itself
//   scrolls no wider than the screen, the menu bar cuts nothing, and each of
//   LEARNING's panels holds what it draws (its map ran over the two under it).
// - The bank is a sheet there: BANK opens it (from the keyboard, the focus
//   goes into its list), and the scrim, Esc and a sound chosen in it put it
//   away, the sound chosen being the one in hand. Esc takes the sheet before
//   what is behind it (PERFORM's XY pad stays up). ⌘K's "What are the three
//   banks?" opens the sheet under its walkthrough.
// - The keys are a drawer over the bar: KEYS opens it, one octave across
//   the screen with each white key a finger wide, and KEYS closes it. ⌘K's
//   keybed settings open it under KEYS ⋯.
// - BANK and KEYS show what they open by the next frame (budgets, 100 ms).
// - A tapped module in PATCH opens its sheet, and the tap presses nothing in
//   the sheet it opened (its own click landed on the sheet once, and pressed
//   whatever was under the finger: REMOVE MODULE, a MODE).
// - A tablet held upright (900 × 1180) gets the whole instrument with its
//   keys bar and the cross at the stage's edge, and the bank a sheet from the
//   left behind BANK. It keeps the keybed's letters, which a phone leaves off.
// - A phone on its side (844 × 390): KEYS sits under the cross and opens the
//   keys' drawer, and EVOLVE's PICK is on the screen with no scroll (each
//   level is one screen: phone_fits.spec.js).
const { test, expect, goLevel, landed, runCommand } = require("./fixtures");
const { rackAtRest, walkRightEdge } = require("./patch_page");

const PHONE = { hasTouch: true, isMobile: true };
const LEVELS = ["learning", "taste", "perform", "patch", "evolve"];

/** The colour a keybed key's letter is drawn in (`a` plays C4 at rest):
 *  transparent where none is printed. Each C keeps its octave either way. */
const letterInk = (page) => page.locator("#piano .pkey.mapped .hint").first().evaluate((h) => getComputedStyle(h).color);
const CLEAR = "rgba(0, 0, 0, 0)";

/** Press a button the way the keyboard does (a click with no pointer) in the
 *  page's own task, and time it to the next frame: what it opens is drawn by
 *  then. */
const pressToFrame = (page, id) => page.evaluate((id) => new Promise((done) => {
  const t0 = performance.now();
  document.getElementById(id).click();
  requestAnimationFrame(() => done(performance.now() - t0));
}), id);

/** What runs past the screen at the level shown: the page sideways, the
 *  level wider than itself, the menu bar's row (it clips what does not fit),
 *  and a name in the bar along the bottom cut short. Empty when nothing. */
const PAST_THE_EDGE = () => {
  const out = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth) out.push(`the page scrolls sideways: ${doc.scrollWidth} in ${window.innerWidth}`);
  const view = document.querySelector("section.view.on");
  if (view.scrollWidth > view.clientWidth + 1) out.push(`${view.id} is ${view.scrollWidth} wide in ${view.clientWidth}`);
  const bar = document.querySelector(".menubar");
  if (bar.scrollWidth > bar.clientWidth + 1) out.push(`the menu bar holds ${bar.scrollWidth} in ${bar.clientWidth}`);
  // A panel holds what it draws: LEARNING's map once ran over the two
  // panels under it, its own squeezed to the screen's height.
  for (const panel of view.querySelectorAll(".md-panel")) {
    if (panel.offsetParent && panel.scrollHeight > panel.clientHeight + 1) out.push(`${panel.className} draws ${panel.scrollHeight} in ${panel.clientHeight}`);
  }
  for (const rl of document.querySelectorAll("#rail .rl")) {
    if (rl.offsetParent && rl.scrollWidth > rl.clientWidth + 1) out.push(`"${rl.textContent}" is cut: ${rl.scrollWidth} in ${rl.clientWidth}`);
  }
  return out;
};

for (const [width, height] of [[390, 844], [360, 640]]) {
  test.describe(`a phone held upright, ${width} × ${height}`, () => {
    test.use({ ...PHONE, viewport: { width, height } });

    test(`a phone boots with no gate, the levels are the bar along the bottom, and each level fits ${width} px`, async ({ page, app }) => {
      await app.boot();
      // No gate and no notice: the engine started, and nothing stands over it.
      await expect(page.locator("#handheld, #narrow-gate")).toHaveCount(0);
      const rail = page.locator("#rail");
      const box = await rail.boundingBox();
      expect(box.width, "the bar runs the screen's width").toBe(width);
      expect(box.y + box.height, "the bar sits on the screen's bottom edge").toBe(height);
      // Left to right: PERFORM, PATCH, TASTE, LEARNING, then EVOLVE beside
      // them, then KEYS.
      const order = await page.evaluate(() =>
        [...document.querySelectorAll("#rail .rail-stop, #rail .rail-keys")]
          .map((b) => [b.dataset.level || "keys", b.getBoundingClientRect().left])
          .sort((a, b) => a[1] - b[1])
          .map(([name]) => name));
      expect(order).toEqual(["perform", "patch", "taste", "learning", "evolve", "keys"]);
      for (const level of LEVELS) {
        const stop = page.locator(`.rail-stop[data-level="${level}"]`);
        await expect(stop.locator(".rl")).toBeVisible();
        await goLevel(page, level);
        await expect(page.locator("body")).toHaveAttribute("data-level", level);
        await expect.poll(() => page.evaluate(PAST_THE_EDGE), `what runs past the screen at ${level}`).toEqual([]);
      }
    });
  });
}

test.describe("a phone held upright, the sheet and the drawer", () => {
  test.use({ ...PHONE, viewport: { width: 390, height: 844 } });

  test("the bank is a sheet: BANK opens it, the scrim and Esc put it away, and a sound chosen in it is in hand as it goes", async ({ page, app }) => {
    await app.boot();
    const bank = page.locator("#bank");
    const btn = page.locator("#bank-btn");
    await expect(bank).toBeHidden();
    // From the keyboard: the sheet is up by the next frame, the focus in it.
    app.budget("BANK: the press → the bank's sheet drawn", await pressToFrame(page, "bank-btn"), 100);
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expect(bank).toBeVisible();
    await expect(page.locator("#bank-list")).toBeFocused();
    await expect(bank).toBeInViewport({ ratio: 1 });
    await page.locator("#sheet-scrim").click({ position: { x: 20, y: 20 } });
    await expect(bank).toBeHidden();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    // Esc takes the sheet, not what is behind it: PERFORM's XY pad stays.
    const well = page.locator(".pf-well");
    await page.locator(".pf-xy-btn").click();
    await expect(well).toHaveAttribute("data-mode", "xy");
    await btn.click();
    await expect(bank).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bank).toBeHidden();
    await expect(well).toHaveAttribute("data-mode", "xy");
    // The bank's walkthrough, asked for from ⌘K, opens the sheet under it.
    await runCommand(page, "What are the three banks?");
    await expect(bank).toBeVisible();
    await expect(page.locator("#bank-tour")).toBeVisible();
    await page.locator("#tour-skip").click();
    await expect(page.locator("#bank-tour")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(bank).toBeHidden();
    // A sound chosen: a row that is not the one in hand, by its name.
    await btn.click();
    await expect(bank).toBeVisible();
    const row = page.locator("#bank-list .bank-item[data-id]:not(.live)").first();
    const id = await row.getAttribute("data-id");
    await row.locator(".bi-name").click();
    await expect(bank).toBeHidden();
    await app.engine((timeout) => expect(page.locator(`#bank-list .bank-item[data-id="${id}"]`)).toHaveClass(/\blive\b/, { timeout }), { ms: 30_000 });
  });

  test("the keys are a drawer over the bar: KEYS opens one octave across the screen, a finger wide a key, and closes it", async ({ page, app }) => {
    await app.boot();
    const keys = page.locator("#keybar");
    const toggle = page.locator("#keys-toggle");
    await expect(keys).toBeHidden();
    app.budget("KEYS: the press → the keys' drawer drawn", await pressToFrame(page, "keys-toggle"), 100);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(keys).toBeVisible();
    // The drawer stands over the bar, never under it.
    const k = await keys.boundingBox();
    const r = await page.locator("#rail").boundingBox();
    expect(k.y + k.height).toBeLessThanOrEqual(r.y + 1);
    const whites = page.locator("#piano .pkey");
    await expect(whites).toHaveCount(8);
    const widths = await whites.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    expect(Math.min(...widths), "each white key is a finger wide").toBeGreaterThanOrEqual(40);
    // A phone prints no computer keys on the keybed.
    expect(await letterInk(page), "a key's letter on a phone").toBe(CLEAR);
    await toggle.click();
    await expect(keys).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // A keybed setting asked for from ⌘K opens the drawer under KEYS ⋯.
    await runCommand(page, "How much of the keybed to show: fewer octaves, wider keys");
    await expect(keys).toBeVisible();
    await expect(page.locator("#keys-pop")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("a tapped module opens its sheet, and the tap presses nothing in it", async ({ page, app }) => {
    // Every click that reaches the module sheet (the spec's own observer).
    await page.addInitScript(() => {
      window.__sheetClicks = [];
      document.addEventListener("DOMContentLoaded", () => {
        document.body.addEventListener("click", (e) => {
          if (e.target.closest?.("#module-sheet")) window.__sheetClicks.push(e.target.className || e.target.tagName);
        });
      });
    });
    await app.boot();
    await goLevel(page, "patch");
    // ENV / OUT: every patch has one, in its main chain, at its end, where
    // the well's right edge carries the camera (the fit shows where the
    // patch starts, #519).
    await app.engine((timeout) => rackAtRest(page, { timeout }), { ms: 30_000 });
    await walkRightEdge(app);
    const plate = page.locator('#rack-svg g[data-kind="amp"]:not(.mod-group) .mod-plate');
    await expect(plate).toBeVisible();
    // The plate at rest, across three frames: the camera's fit is a tween.
    await expect.poll(() => plate.evaluate((p) => new Promise((done) => {
      const at = () => JSON.stringify(p.getBoundingClientRect());
      const a = at();
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done(a === at()))));
    })), { timeout: 30_000 }).toBe(true);
    // Bare panel on the plate, clear of its knobs and jacks, and of a
    // finger's reach of its ⋯ (main.js `tapReach`).
    const at = await plate.evaluate((p) => {
      const b = p.getBoundingClientRect();
      const group = document.querySelector('#rack-svg g.mod-group[data-kind="amp"]');
      const ctrls = [...group.querySelectorAll("[data-addr], [data-stop], .jack, .mod-menu-btn, .mod-lock, .lock-dot")].map((e) => e.getBoundingClientRect());
      const pads = [...document.querySelectorAll("#rack-svg .mod-menu-btn > rect, #rack-svg .mod-lock > rect")].map((e) => e.getBoundingClientRect())
        .map((r) => [r.left + r.width / 2, r.top + r.height / 2]);
      let best = null;
      for (let fx = 0.08; fx < 0.95; fx += 0.04) {
        for (let fy = 0.08; fy < 0.95; fy += 0.04) {
          const x = b.left + fx * b.width;
          const y = b.top + fy * b.height;
          if (document.elementFromPoint(x, y) !== p) continue;
          if (pads.some(([px, py]) => Math.hypot(px - x, py - y) < 24)) continue;
          const d = Math.min(...ctrls.map((r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))));
          if (!best || d > best.d) best = { x, y, d };
        }
      }
      return best;
    });
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.locator("#module-sheet")).toHaveClass(/\bon\b/);
    await app.quiet();
    expect(await page.evaluate(() => window.__sheetClicks), "clicks the tap sent into the sheet").toEqual([]);
    // Nothing was edited: the edit bar stays away.
    await expect(page.locator("#pt-editbar")).toBeHidden();
  });
});

test.describe("a tablet held upright, 900 × 1180", () => {
  test.use({ ...PHONE, viewport: { width: 900, height: 1180 } });

  test("a tablet gets the whole instrument: the keys bar, the cross at the stage's edge, and the bank a sheet from the left", async ({ page, app }) => {
    await app.boot();
    await expect(page.locator("#keybar")).toBeVisible();
    // A tablet keeps the keybed's letters: it may have a keyboard.
    expect(await letterInk(page), "a key's letter on a tablet").not.toBe(CLEAR);
    await expect(page.locator("#keys-toggle")).toBeHidden();
    await expect(page.locator(".rail-stop .rl").first()).toBeHidden();
    const bank = page.locator("#bank");
    await expect(bank).toBeHidden();
    await page.locator("#bank-btn").click();
    await expect(bank).toBeVisible();
    // Where it comes to rest (it slides in): at the left edge, less than half
    // the screen wide.
    await expect.poll(async () => (await bank.boundingBox()).x, "the sheet at the left edge").toBe(0);
    expect((await bank.boundingBox()).width).toBeLessThan(900 / 2);
    await expect.poll(() => page.evaluate(PAST_THE_EDGE)).toEqual([]);
  });
});

test.describe("a phone on its side, 844 × 390", () => {
  test.use({ ...PHONE, viewport: { width: 844, height: 390 } });

  test("on its side, KEYS under the cross opens the keys, and EVOLVE's PICK is on the screen", async ({ page, app }) => {
    await app.boot();
    const keys = page.locator("#keybar");
    await expect(keys).toBeHidden();
    await page.locator("#keys-toggle").click();
    await expect(keys).toBeVisible();
    await page.locator("#keys-toggle").click();
    await expect(keys).toBeHidden();
    await goLevel(page, "evolve");
    await landed(page);
    await expect(page.locator("#choose-a")).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#choose-b")).toBeInViewport({ ratio: 1 });
    await expect.poll(() => page.evaluate(PAST_THE_EDGE)).toEqual([]);
  });
});
