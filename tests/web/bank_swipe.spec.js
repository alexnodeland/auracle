// A bank row on a phone is a list's row, as a phone's own lists' are
// (#134): at rest it shows its name and its ▶; swiped left it slides out its
// other actions (★, save, cut), and they answer a tap; swiped back, or the
// list scrolled, they go. The swipe opens nothing (no row is opened by its
// lift), and the row keeps its actions out when the bank redraws. At rest
// they are a pixel, not gone: a screen reader, a keyboard and a mouse still
// reach them.
//
// The finger is made in the page (TouchEvents on the row, as
// touch_gestures.spec.js's WebKit finger is), in Chromium and in WebKit:
// it proves the app's handling, not the browser's own scroll.
const { test, expect } = require("./fixtures");

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** A finger on `row` moved sideways by `dx` px in steps, then lifted. */
const swipe = (row, dx) => row.evaluate((el, dx) => {
  const r = el.querySelector(".bi-name").getBoundingClientRect();
  const x0 = r.left + 10;
  const y = r.top + r.height / 2;
  const at = (x) => {
    try {
      return [new Touch({ identifier: 3, target: el, clientX: x, clientY: y })];
    } catch {
      return [{ identifier: 3, target: el, clientX: x, clientY: y }];
    }
  };
  // WebKit makes no Touch from script: an Event carrying the lists stands in.
  const fire = (type, x, list) => {
    let e;
    try {
      e = new TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: at(x) });
    } catch {
      e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "touches", { value: list });
      Object.defineProperty(e, "changedTouches", { value: at(x) });
    }
    el.dispatchEvent(e);
  };
  fire("touchstart", x0, at(x0));
  for (let i = 1; i <= 6; i++) fire("touchmove", x0 + (dx * i) / 6, at(x0 + (dx * i) / 6));
  fire("touchend", x0 + dx, []);
}, dx);

test("a bank row swiped left shows its actions, which answer a tap; swiped back they go", async ({ page, app }) => {
  await app.boot({ reuseRenders: true });
  await app.poolRows(40);
  await page.locator("#bank-btn").tap();
  await expect(page.locator("body")).toHaveClass(/\bbank-open\b/);
  const row = page.locator("#bank-list .bank-item[data-id]:not(.live)").first();
  const id = await row.getAttribute("data-id");
  const at = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  // At rest: the name and ▶, not ★, save or cut.
  await expect(at.locator(".bi-hear")).toBeVisible();
  // Away from the eye, still in the page for a screen reader: a pixel.
  const away = (b) => at.locator(b).evaluate((e) => e.getBoundingClientRect().width <= 1);
  for (const b of [".bi-star", ".bi-save", ".bi-kill"]) await expect.poll(() => away(b), `${b} at rest`).toBe(true);
  await swipe(at, -120);
  await expect(at).toHaveClass(/\bacts-open\b/);
  for (const b of [".bi-hear", ".bi-star", ".bi-save", ".bi-kill"]) await expect(at.locator(b)).toBeVisible();
  // The swipe opened nothing.
  await app.quiet();
  await expect(at).not.toHaveClass(/\blive\b/);
  // Save answers a tap, and the row keeps its actions out through the redraw.
  await at.locator(".bi-save").tap();
  await expect(at.locator(".bi-save")).toHaveAttribute("aria-pressed", "true");
  await expect(at).toHaveClass(/\bacts-open\b/);
  // Swiped back, they go.
  // The bank redraws as the save lands, and a finger on a row being
  // replaced lands on nothing: the swipe is made again on the row as it is.
  await expect(async () => {
    await swipe(at, 120);
    await expect(at).not.toHaveClass(/\bacts-open\b/, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  // Focus in the row would hold them out too, as it should: the tap's
  // focus is let go first.
  await page.evaluate(() => document.activeElement?.blur());
  await expect.poll(() => away(".bi-star"), "★ after the swipe back").toBe(true);
});
