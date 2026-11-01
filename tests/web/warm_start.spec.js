// The warm start run again, from ⌘K's Re-run the three-pick warm start (the
// guide's "any time, to teach it 18 more"): nine new cards, none of them
// picked, TEACH IT reached by picking three of them, and those three taught.
//
// The picks used to outlive their deal (main.js `warmPicked`): on the new
// deal a click could add no card, since three were still held from the last
// one, so the first card clicked read "teach it" with nothing marked, and
// TEACH IT taught the last deal's three again.
//
// The warm start's first run, its 18 preferences and PERFORM's first steps
// after it, are `first_run.spec.js`'s, which is not on the fixture yet (#170).
//
// On a phone (#527), upright and on its side: SKIP and the button under the
// cards stay on the screen while the nine scroll above them, each ▶ keeps
// clear of its card's words, the first ▶ takes the focus with no ring (no key
// has been pressed), and the third pick lights TEACH IT where it can be seen.
// SKIP and the button used to sit under the fold (y 838 on an 844 px screen,
// on a 667 px one too, and off a 375 px tall one on its side with the title
// cut off above), the room kept for a ▶ was a 34 px one's where a finger's is
// 44, and the first ▶ wore the keyboard's ring on open.
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
