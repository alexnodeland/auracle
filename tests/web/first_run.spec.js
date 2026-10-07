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
const { test, expect, goLevel, runCommand } = require("./fixtures");

/** A warm-start card heard before choosing, between its ▶ and its stop: a
 *  listener's pace. */
const HEAR_MS = 1500;
/** A key held long enough to be played. */
const KEY_HELD_MS = 300;

/** A first visit, as at a booth: the warm start and the tours not yet seen,
 *  seeded. */
const firstVisit = (app) => app.boot({ warmed: false, seen: false });

test("warm start: a slow chooser keeps all 18 preferences", async ({ page, app }) => {
  await firstVisit(app);
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });

  // The ▶ is on top of its card.
  const onTop = await page.evaluate(() => {
    const b = document.querySelector(".warm-cell .wi-play");
    const r = b.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
  });
  expect(onTop, "the warm-start ▶ is covered by its card").toBe(true);

  // Hear three (each preview inserts a preset into the pool), then take the
  // time a listener takes while the pool keeps filling behind the modal: the
  // picks land in a full pool, where the inserts used to evict each other.
  const plays = page.locator(".warm-cell .wi-play");
  for (let i = 0; i < 3; i++) {
    await plays.nth(i).click();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- a card heard before choosing, a listener's pace
    await page.waitForTimeout(HEAR_MS);
    await plays.nth(i).click(); // stop
  }
  await app.fullPool();

  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [1, 4, 7]) await cards.nth(i).click();
  await page.locator("#warm-go").click();

  await app.engine((timeout) => expect(page.locator("#duel-count")).toHaveText("18", { timeout }), { ms: 60_000 });
  // Every toast said, not only those still up: one that came and went is
  // in the tap's list.
  expect((await app.toasts()).filter((t) => /is gone/.test(t)), "a pick was refused as gone").toEqual([]);

  // PERFORM names what is playing.
  await goLevel(page, "perform");
  await expect
    .poll(async () => [await page.locator(".pf-name").textContent(), await page.locator("#live-label").textContent()], { timeout: 20_000 })
    .toEqual([await page.locator("#live-label").textContent(), await page.locator("#live-label").textContent()]);
});

// Someone who walks up cold gets the whole loop in three moves, each ticked off
// when it happens, and then the levels' two (shell_zoom, guide_pill); an
// engineer gets the numbers behind the controls on request.
test("PERFORM's first steps tick off as they happen; measurements are one command away", async ({ page, app }) => {
  await firstVisit(app);
  await page.locator("#warm-skip").click();
  // The preset can land after the tab opens: until PERFORM names it, "controls
  // reach" may be the previous patch's, and a turn made then is a turn on a
  // patch still being measured. Opened as a player opens it, and waited for
  // until PERFORM names it and its controls reach (`app.openOnPerform`).
  await app.openOnPerform("Glass Pad");
  await expect(page.locator(".pf-step.now")).toContainText("Play a key");
  await page.keyboard.down("a");
  // eslint-disable-next-line playwright/no-wait-for-timeout -- a key held to be played
  await page.waitForTimeout(KEY_HELD_MS);
  await page.keyboard.up("a");
  // Step 2 names a control that turns on this patch ("Turn BRIGHT: drag up or down").
  await expect(page.locator(".pf-step.now")).toContainText(/Turn [A-Z]+: drag up or down/);
  const box = await page.locator(".pf-knob").nth(0).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 8);
  await page.mouse.up();
  await expect(page.locator(".pf-step.now")).toContainText("Press OFFER");
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await expect(page.locator(".pf-step.now")).toContainText(/zoom out to TASTE/);
  // engineer mode
  await runCommand(page, "Show measurements");
  const t = await page.locator(".pf-knob[data-i='0']").getAttribute("title");
  expect(t).toContain("purity");
});

// While the warm start is open, PERFORM measures its cards in the background
// against this session's model, one at a time, once the pool has filled (so
// the fill is not slowed), without putting any of them into the pool: the
// pick the player lands on is then measured already, not only shipped.
test("the warm start measures its cards in the background while it is open", async ({ page, app }) => {
  // Before and after are counted, not timed: Chrome coarsens its clocks to
  // 100 us, and a post made just after the pool-full mark, in the same
  // handler, could carry a timestamp one tick before the mark's. So the mark
  // records how many requests the tap had seen posted by then.
  await page.addInitScript(() => {
    const mark = performance.mark.bind(performance);
    performance.mark = (name, opts) => {
      if (name === "auracle:pool-full" && window.__fullAt == null) window.__fullAt = window.__tap.sent.length;
      return mark(name, opts);
    };
  });
  await firstVisit(app);
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
  // Nothing is measured before the pool is full…
  await app.engine((timeout) => page.waitForFunction(() => window.__fullAt != null, null, { timeout }), { ms: 200_000 });
  const early = await page.evaluate(() => window.__tap.sent.slice(0, window.__fullAt).filter((s) => s.type === "perform_wire" && s.m.bg).length);
  expect(early, "a card was measured while the pool was still filling").toBe(0);
  // …then the cards are, in the background, while the card is still open:
  // PERFORM's measurements, renders each, one after the other, bounded as
  // PERFORM's growth is on a CI runner (perform_budget.js FLOOR_MS there).
  // Not `app.offerBudget`: its probe walks wait behind these very
  // measurements.
  await app.engine(
    (timeout) => expect.poll(async () => (await app.sent({ type: "perform_wire", bg: true })).length, { timeout }).toBeGreaterThanOrEqual(2),
    { ms: 240_000 },
  );
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/);
  const loads = await app.sentCount("load_preset");
  expect(loads, "measuring a card inserted it into the pool").toBe(0);
});
