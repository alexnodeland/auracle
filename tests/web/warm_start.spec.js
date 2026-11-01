// The warm start run again, from ⌘K's Re-run the three-pick warm start (the
// guide's "any time, to teach it 18 more"): nine new cards, none of them
// picked, TEACH IT reached by picking three of them, and those three taught.
//
// The picks used to outlive their deal (main.js `warmPicked`): on the new
// deal a click could add no card, since three were still held from the last
// one, so the first card clicked read "teach it" with nothing marked, and
// TEACH IT taught the last deal's three again.
//
// TEACH IT points PERFORM's well and the menu bar's chip at the first
// pick's face in the press's own task, from the presets' faces the app
// ships (the ones the cards were drawn with), and each shows it once its
// picture is decoded, the face it had in place until then: they were empty
// for 0.6 to 1.5 s, until the engine had rendered the pick (#522). Neither
// is empty after, frame by frame, until the pick is on the bench and its
// tree text follows.
//
// The warm start's first run, its 18 preferences and PERFORM's first steps
// after it, are `first_run.spec.js`'s, which is not on the fixture yet (#170).
//
// On a phone (#527), upright and on its side: SKIP and the button under the
// cards stay on the screen while the nine scroll above them, each ▶ keeps
// clear of its card's words, the first ▶ takes the focus with no ring (no key
// has been pressed), Tab brings each card and ▶ into sight above the foot,
// ring and all, Shift+Tab back up with its ring whole at the top, and the
// third pick lights TEACH IT where it can be seen.
// SKIP and the button used to sit under the fold (y 838 on an 844 px screen,
// on a 667 px one too, and off a 375 px tall one on its side with the title
// cut off above), the room kept for a ▶ was a 34 px one's where a finger's is
// 44, and the first ▶ wore the keyboard's ring on open. With the foot kept
// on the screen, a stop Tab moved to below the fold scrolled to the window's
// foot, under it: the last card's ▶ hidden whole on a 390 × 844 phone, and
// every third-row ▶ on a 667 × 375 one, where Shift+Tab back up also cut the
// top of the ring off a card it scrolled to the window's top.
const fs = require("fs");
const path = require("path");
const { test, expect, runCommand } = require("./fixtures");

/** What the warm start shows wrong on the screen it is on: SKIP or the button
 *  outside the window or under something, a ▶ over its card's words, the last
 *  card unable to come out from under the foot. Empty when nothing. */
const WARM_ON_SCREEN = () => {
  const out = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const id of ["warm-skip", "warm-go"]) {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.left < 0 || r.bottom > vh + 0.5 || r.right > vw + 0.5) {
      out.push(`#${id} at ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)} of ${vw} × ${vh}`);
      continue;
    }
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    if (!el.contains(hit)) out.push(`#${id} under ${hit ? hit.className || hit.tagName : "nothing"}`);
  }
  for (const cell of document.querySelectorAll("#warm-grid .warm-cell")) {
    const name = cell.querySelector(".wi-name").textContent;
    const p = cell.querySelector(".wi-play").getBoundingClientRect();
    for (const t of cell.querySelectorAll(".wi-name, .wi-sig")) {
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const line of range.getClientRects()) {
        const x = Math.min(line.right, p.right) - Math.max(line.left, p.left);
        const y = Math.min(line.bottom, p.bottom) - Math.max(line.top, p.top);
        if (x > 0.5 && y > 0.5) out.push(`${name}: its ▶ over "${t.textContent}" by ${x.toFixed(1)} × ${y.toFixed(1)}`);
      }
    }
  }
  return out;
};

/** What hides the control that has the focus: the window's edge, the foot
 *  (and the fade over its top) over its box or its ring, 2 px out and 2 px
 *  wide, or something else under its centre, where a press would land.
 *  Empty when all of it is in sight. */
const FOCUS_IN_SIGHT = () => {
  const out = [];
  const el = document.activeElement;
  const name = el.getAttribute("aria-label") || el.querySelector(".wi-name")?.textContent || el.id || el.tagName;
  const r = el.getBoundingClientRect();
  const ring = 4;
  if (r.top - ring < -0.5 || r.bottom + ring > window.innerHeight + 0.5) out.push(`${name} at ${Math.round(r.top)}–${Math.round(r.bottom)}, past the window's ${window.innerHeight}`);
  const foot = document.querySelector("#warmstart .warm-foot");
  if (!foot.contains(el)) {
    const fade = parseFloat(getComputedStyle(foot, "::before").height) || 0;
    const under = r.bottom + ring - (foot.getBoundingClientRect().top - fade);
    if (under > 1) out.push(`${name}: ${under.toFixed(1)} px of its ${Math.round(r.height) + 2 * ring} (ring and all) under the foot`);
  }
  const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  if (!el.contains(hit)) out.push(`${name} under ${hit ? hit.className || hit.tagName : "nothing"} at its centre`);
  return out;
};

for (const [width, height] of [[390, 844], [375, 667], [667, 375]]) {
  test.describe(`a ${width} × ${height} phone`, () => {
    // Firefox has no mobile mode (Playwright refuses it there); a touch
    // screen is enough for its `pointer: coarse`.
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: async ({ browserName }, use) => use(browserName !== "firefox") });

    test(`at ${width} × ${height} the warm start keeps SKIP and TEACH IT in sight, each ▶ clear of its words, and the third pick lights TEACH IT`, async ({ page, app }) => {
      await app.boot({ warmed: false });
      await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 60_000 });
      const items = page.locator("#warm-grid .warm-item");
      const go = page.locator("#warm-go");
      await expect(items).toHaveCount(9);

      // Open: the nine run past the screen, and the foot is on it.
      await expect.poll(() => page.evaluate(() => { const w = document.getElementById("warmstart"); return w.scrollHeight - w.clientHeight; })).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(WARM_ON_SCREEN)).toEqual([]);
      // The focus is in the card, on the first ▶, with no ring: no key has
      // been pressed.
      await expect(page.locator("#warm-grid .wi-play").first()).toBeFocused();
      expect(await page.evaluate(() => document.activeElement.matches(":focus-visible")), "a ring on the first ▶ on open").toBe(false);

      // Tab from the first ▶ to the last, each card and then its ▶: every
      // stop scrolls into sight above the foot, ring and all, and is what a
      // press at its centre reaches.
      const cells = page.locator("#warm-grid .warm-cell");
      for (let i = 1; i < 9; i++) {
        for (const part of [".warm-item", ".wi-play"]) {
          await page.keyboard.press("Tab");
          await expect(cells.nth(i).locator(part)).toBeFocused();
          await expect.poll(() => page.evaluate(FOCUS_IN_SIGHT), `card ${i + 1}'s ${part} after Tab`).toEqual([]);
        }
      }
      expect(await page.evaluate(() => document.activeElement.matches(":focus-visible")), "the ring on the last ▶ after Tab").toBe(true);
      // …and Shift+Tab back to the first ▶: a stop above the top comes down
      // far enough to show its ring.
      for (let i = 8; i >= 1; i--) {
        for (const [at, part] of [[i, ".warm-item"], [i - 1, ".wi-play"]]) {
          await page.keyboard.press("Shift+Tab");
          await expect(cells.nth(at).locator(part)).toBeFocused();
          await expect.poll(() => page.evaluate(FOCUS_IN_SIGHT), `card ${at + 1}'s ${part} after Shift+Tab`).toEqual([]);
        }
      }

      // Scrolled to the end, the last card comes out from under the foot,
      // which is still on the screen.
      await page.evaluate(() => { const w = document.getElementById("warmstart"); w.scrollTop = w.scrollHeight; });
      await expect.poll(() => page.evaluate(() => {
        const cells = document.querySelectorAll("#warm-grid .warm-cell");
        return Math.round(document.querySelector("#warmstart .warm-foot").getBoundingClientRect().top - cells[cells.length - 1].getBoundingClientRect().bottom);
      }), "the foot's top less the last card's bottom").toBeGreaterThanOrEqual(0);
      await expect.poll(() => page.evaluate(WARM_ON_SCREEN)).toEqual([]);

      // Two picks: one more to go, and TEACH IT not lit.
      await items.nth(0).tap();
      await items.nth(4).tap();
      await expect(go).toHaveText("1 more");
      await expect(go).toBeDisabled();
      await expect(go).not.toHaveClass(/\blit\b/);
      // The third lights it, on the screen.
      await items.nth(8).tap();
      await expect(go).toHaveText("teach it");
      await expect(go).toBeEnabled();
      await expect(go).toHaveClass(/\blit\b/);
      await expect.poll(() => page.evaluate(WARM_ON_SCREEN)).toEqual([]);
    });
  });
}

const SHIPPED = JSON.parse(fs.readFileSync(path.join(__dirname, "../../apps/web/preset-faces.json"), "utf8"));
/** The key the worker files a preset's face under, by the preset's name. */
const SHIPPED_KEY = new Map(SHIPPED.presets.map((p) => [p.name, `${SHIPPED.ns}/${p.key}`]));

// In the page: press TEACH IT and read, in the press's own task, the face
// PERFORM's well and the menu bar's chip are pointed at (the render key of
// the picture each slot is to show, its `data-drawn`, set as the slot is
// pointed, before the picture is decoded and shown; null with no picture)
// and the name in the menu bar, and before it, with the picture each slot
// showed (its `src`). Then every animation frame, until
// `window.__teachWatch.stop()`, count the frames either slot shows no
// picture whole (none, or one not decoded yet), and say the first: its
// frame, which slot was bare and whether it held a picture at all.
const PRESS_TEACH = `(() => {
  const slots = [document.querySelector("#view-perform .pf-faces > .pf-face"), document.getElementById("inhand-face")];
  const pic = (el) => el.querySelector(":scope > img.face");
  const key = (el) => (pic(el) ? (el.dataset.drawn || "").split("|")[0] || null : null);
  const W = (window.__teachWatch = { frames: 0, empty: 0, which: null, on: true });
  const step = () => {
    if (!W.on) return;
    W.frames += 1;
    const bare = slots.map((el) => {
      const img = pic(el);
      return !img || !img.complete || !img.naturalWidth;
    });
    if (bare.some(Boolean)) {
      W.empty += 1;
      W.which = W.which || { frame: W.frames, bare, held: slots.map((el) => !!pic(el)) };
    }
    requestAnimationFrame(step);
  };
  W.stop = () => { W.on = false; return { frames: W.frames, empty: W.empty, which: W.which }; };
  const before = { well: key(slots[0]), chip: key(slots[1]), src: slots.map((el) => pic(el)?.src ?? null) };
  document.getElementById("warm-go").click();
  const seen = { before, well: key(slots[0]), chip: key(slots[1]), name: document.getElementById("live-label").textContent };
  requestAnimationFrame(step);
  return seen;
})()`;

test("the warm start run again starts with no card picked and teaches the three picked on it", async ({ page, app }) => {
  await app.boot({ warmed: false });
  // On a desktop the focus lands on the first ▶, as the keyboard hears first.
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }));
  await expect(page.locator("#warm-grid .wi-play").first()).toBeFocused();
  await app.warmStart([1, 4, 7]);
  await expect(page.locator("#duel-count")).toHaveText("18");

  await runCommand(page, "Re-run the three-pick warm start");
  // The deal waits on the engine's `presets` reply.
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }));
  const items = page.locator("#warm-grid .warm-item");
  const picked = page.locator("#warm-grid .warm-item.picked");
  const go = page.locator("#warm-go");
  await expect(items).toHaveCount(9);
  await expect(picked).toHaveCount(0);
  await expect(go).toHaveText("pick any three");
  await expect(go).toBeDisabled();
  // The last deal's three lit TEACH IT; this deal's has none.
  await expect(go).not.toHaveClass(/\blit\b/);

  // One card is one of three…
  await items.nth(0).click();
  await expect(items.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(go).toHaveText("2 more");
  await expect(go).toBeDisabled();
  // …and three reach TEACH IT.
  await items.nth(2).click();
  await items.nth(5).click();
  await expect(picked).toHaveCount(3);
  await expect(go).toHaveText("teach it");
  await expect(go).toBeEnabled();
  await expect(go).toHaveClass(/\blit\b/);

  // TEACH IT teaches these three, not the last deal's: 18 more picks.
  const names = await picked.locator(".wi-name").allTextContents();
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  const { rows } = await app.last("presets");
  const want = names.map((n) => rows.find((r) => r.name === n).index).sort((a, b) => a - b);
  const t0 = await app.now();
  await go.click();
  let sent = null;
  await expect.poll(async () => (sent = (await app.sent("warm_start", { after: t0 }))[0] || null)).not.toBeNull();
  expect([...sent.picked].sort((a, b) => a - b)).toEqual(want);
  await app.replyTo(sent);
  await expect(page.locator("#duel-count")).toHaveText("36");
});

test("TEACH IT points the well and the menu bar's chip at the first pick's face in the press's own task, shows it once decoded, and neither is empty after", async ({ page, app }) => {
  await app.boot({ warmed: false });
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }));
  const cards = page.locator(".warm-cell .warm-item");
  await expect(cards.nth(1).locator(".face-slot > img.face")).toBeVisible();
  for (const i of [1, 4, 7]) await cards.nth(i).click();
  const first = (await cards.nth(1).locator(".wi-name").textContent()).trim();
  const pressed = await page.evaluate(PRESS_TEACH);
  expect(pressed.name, "the first pick in hand").toBe(first);
  expect(pressed.before.well, "the well drew another sound before the press").not.toBe(SHIPPED_KEY.get(first));
  expect([pressed.well, pressed.chip], "the slots pointed at the first pick's shipped face, in the press's own task").toEqual([SHIPPED_KEY.get(first), SHIPPED_KEY.get(first)]);
  // Each shows it: a picture in place of the one before, decoded.
  await expect.poll(() => page.evaluate((was) => [document.querySelector("#view-perform .pf-faces > .pf-face"), document.getElementById("inhand-face")].map((el, i) => {
    const img = el.querySelector(":scope > img.face");
    return !!img && img.complete && img.naturalWidth > 0 && img.src !== was[i];
  }), pressed.before.src), "the well and the chip show a new picture, whole").toEqual([true, true]);
  // Until the first pick is on the bench, and the result is said.
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(new RegExp(`^${first}`), { timeout }), { ms: 60_000 });
  await app.answered({ types: ["warm_start", "edit_begin"], lanes: ["bench"] });
  const watched = await page.evaluate(() => window.__teachWatch.stop());
  expect(watched.empty, `frames with the well or the chip empty, of ${watched.frames} (the first: ${JSON.stringify(watched.which)})`).toBe(0);
  await expect(page.locator("#view-perform .pf-faces > .pf-face > img.face")).toHaveCount(1);
});
