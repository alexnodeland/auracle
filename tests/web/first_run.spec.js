// The first minute, as a visitor at a booth would spend it.
//
// A booth critique found the first-run elicitation losing most of what it was
// told: a user who listened to the nine presets before choosing (≈25 s) got 3
// of 18 preferences recorded and fifteen "that patch is gone" toasts, because
// the nine inserts went into a full pool one message at a time and the six
// unpicked presets evicted each other before their duels were logged. This
// walks that slow path — hear three, wait, pick three — and requires all 18.
//
// It also checks the two stacking bugs the same pass found on this screen and
// the next: the ▶ on a warm-start card has to be the element under the
// pointer (a card lifted over it turned "hear this" into "pick this"), and
// PERFORM has to name the patch that is playing, not the one before it.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");

test("warm start: a slow chooser keeps all 18 preferences", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });

  // The ▶ is on top of its card.
  const onTop = await page.evaluate(() => {
    const b = document.querySelector(".warm-cell .wi-play");
    const r = b.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
  });
  expect(onTop, "the warm-start ▶ is covered by its card").toBe(true);

  // Hear three (each preview inserts a preset into the pool), then take the
  // time a listener takes while the pool keeps filling behind the modal.
  const plays = page.locator(".warm-cell .wi-play");
  for (let i = 0; i < 3; i++) {
    await plays.nth(i).click();
    await page.waitForTimeout(1500);
    await plays.nth(i).click(); // stop
  }
  await page.waitForTimeout(20_000);

  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [1, 4, 7]) await cards.nth(i).click();
  await page.locator("#warm-go").click();

  await expect(page.locator("#duel-count")).toHaveText("18", { timeout: 60_000 });
  await expect(page.locator(".toast", { hasText: "is gone" })).toHaveCount(0);

  // PERFORM names what is playing.
  await goLevel(page, "perform");
  await expect
    .poll(async () => [await page.locator(".pf-name").textContent(), await page.locator("#live-label").textContent()], { timeout: 20_000 })
    .toEqual([await page.locator("#live-label").textContent(), await page.locator("#live-label").textContent()]);

  expect(errors).toEqual([]);
});

// Someone who walks up cold gets the whole loop in three moves, each ticked off
// when it happens; an engineer gets the numbers behind the controls on request.
test("PERFORM's first steps tick off as they happen; measurements are one menu item away", async ({ page }) => {
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await page.waitForTimeout(800);
  await goLevel(page, "perform");
  // The preset can land after the tab opens: until PERFORM names it, "controls
  // reach" may be the previous patch's, and a turn made then is a turn on a
  // patch still being measured.
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 30000 });
  await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), null, { timeout: 90000 });
  await expect(page.locator(".pf-step.now")).toContainText("Play a key");
  await page.keyboard.down("a"); await page.waitForTimeout(300); await page.keyboard.up("a");
  // Step 2 names a control that turns on this patch ("Turn BRIGHT: drag up or down").
  await expect(page.locator(".pf-step.now")).toContainText(/Turn [A-Z]+: drag up or down/);
  const box = await page.locator(".pf-knob").nth(0).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 8);
  await page.mouse.up();
  await expect(page.locator(".pf-step.now")).toContainText("Press OFFER");
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await expect(page.locator(".pf-step.all")).toContainText("That is the loop");
  // engineer mode
  await page.locator("#ovf-btn").click();
  await page.locator("#engineer-btn").click();
  const t = await page.locator(".pf-knob[data-i='0']").getAttribute("title");
  expect(t).toContain("purity");
  expect(errs).toEqual([]);
});

// While the warm start is open, PERFORM measures its cards in the background
// against this session's model, one at a time, once the pool has filled (so
// the fill is not slowed), without putting any of them into the pool: the
// pick the player lands on is then measured already, not only shipped.
test("the warm start measures its cards in the background while it is open", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(`(() => {
    const Orig = window.Worker;
    const posts = (window.__posts = []);
    // Before and after are counted, not timed: Chrome coarsens its clocks to
    // 100 us, and a post made just after the pool-full mark, in the same
    // handler, could carry a timestamp one tick before the mark's.
    let seq = 0;
    const mark = performance.mark.bind(performance);
    performance.mark = (name, opts) => {
      if (name === "auracle:pool-full" && window.__fullSeq == null) window.__fullSeq = ++seq;
      return mark(name, opts);
    };
    function Wrapped(url, opts) {
      const w = new Orig(url, opts);
      if (/worker\\.js/.test(String(url))) {
        const post = w.postMessage.bind(w);
        w.postMessage = (m, t) => {
          if (m && m.type) posts.push({ type: m.type, bg: !!m.bg, seq: ++seq });
          return post(m, t);
        };
      }
      return w;
    }
    Wrapped.prototype = Orig.prototype;
    window.Worker = Wrapped;
  })();`);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
  // Nothing is measured before the pool is full…
  await page.waitForFunction(() => window.__fullSeq != null, null, { timeout: 200_000 });
  const early = await page.evaluate(() => window.__posts.filter((p) => p.type === "perform_wire" && p.bg && p.seq < window.__fullSeq).length);
  expect(early, "a card was measured while the pool was still filling").toBe(0);
  // …then the cards are, in the background, while the card is still open.
  await page.waitForFunction(() => window.__posts.filter((p) => p.type === "perform_wire" && p.bg).length >= 2, null, { timeout: 120_000 });
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/);
  const loads = await page.evaluate(() => window.__posts.filter((p) => p.type === "load_preset").length);
  expect(loads, "measuring a card inserted it into the pool").toBe(0);
  expect(errs).toEqual([]);
});
