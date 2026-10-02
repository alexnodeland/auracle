// PATCH's guess for the next module (Plan-005 task 7; the engine's side is
// task 9d, `auracle_session::guess`, and `www/reference/src/search/guess.md`).
//
// The guess is the engine's ranking (`guess_rank`, posted by the worker as
// `guess`); these specs read it as the worker posts it and hold the page to
// it: the top guess drawn at its socket with its reason and forecast, taken
// through the edit lane, skipped, an undone take counted as a skip, nothing
// before the warm start, the crew and the floor, and keep as new keeping the
// skips made after it.
const { test, expect } = require("@playwright/test");
const { boot, warmStartAndFit, openPreset, slowWorker, rankedGuess, now, replied, guessAfter, drawnGuess } = require("./patch_page.js");

const SURE = "(a hunch|leaning|fairly sure)";
const LINE = new RegExp(`· \\d+%( over your pool’s average)? · ${SURE}( · it may not help)?$`);

/** The x of every module rail row's name, by kind. */
const railNameX = (page) =>
  page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("#nb-groups .nb-item")].map((b) => [b.dataset.kind, b.querySelector(".ni-name").getBoundingClientRect().left])));

/** Click the drawn guess's body (its × is at the top right). */
const takeDrawn = (page) => page.locator("#rack-svg .guess-plate .gp-body").click({ position: { x: 18, y: 60 } });

test("the model's guess is drawn at its socket with its reason and forecast, and is added, skipped, and skipped by an undo", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(420_000);
  const errors = await boot(page, { warmed: false });
  await warmStartAndFit(page);
  await openPreset(page, "Sub & Sparkle");
  // Before any guess is drawn: where each rail row's name sits.
  const xBefore = await railNameX(page);

  // The newest ranking for this patch, and what PATCH draws from it.
  const first = await drawnGuess(page);
  const top = first.data.guesses[0];
  // On a crew, every candidate is planned and ranked, not the floor's eight.
  expect(first.data.planned).toBe(first.data.total);
  const plate = page.locator("#rack-svg .guess-plate");
  await expect(plate.locator(".gp-word")).toHaveText("guess");
  await expect(plate.locator(".gp-p")).toHaveText(new RegExp(`^\\d+% · ${SURE}$`));
  const read = page.locator("#guess-read");
  await expect(read.locator(".gr-chip")).toHaveText(/^guess · \S/);
  await expect(read.locator(".gr-why")).toHaveText(LINE);

  // The rail marks the guessed kind, left of its name, and no name moves.
  const row = page.locator(`#nb-groups .nb-item[data-kind="${top.kind}"]`);
  if (await row.count()) {
    await expect(row).toHaveClass(/\bguessed\b/);
    expect(await railNameX(page)).toEqual(xBefore);
  }

  // Skip: that family stays away from that socket, and the next guess shows.
  const tSkip = await now(page);
  const shown = await drawnGuess(page);
  const skipped = shown.data.guesses[0];
  await plate.locator(".gp-skip").click();
  const second = await guessAfter(page, await replied(page, "guess_skipped", tSkip));
  const next = second.data.guesses[0];
  expect(next, "a second guess").toBeTruthy();
  expect(next.family === skipped.family && next.socket === skipped.socket, "the skipped family is back at its socket").toBe(false);
  const drawn = (await drawnGuess(page)).data.guesses[0];

  // Add: the same edit as the rail's, through the lane, with the guess on it.
  const tTake = await now(page);
  await takeDrawn(page);
  await expect
    .poll(() => page.evaluate((t) => window.__pwPosted.some((p) => p.type === "edit_structure" && p.t > t && p.guess), tTake))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 30_000 })
    .toMatch(/patched into the wire\.|took the socket\.| → /);
  await replied(page, "bench", tTake, { edited: "structure" });

  // ⌘Z takes it out, and the engine counts that as a skip: the guess it ranks
  // for the patch as it was is not the one undone.
  const tUndo = await now(page);
  await page.locator("#rack-svg").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  const after = await guessAfter(page, await replied(page, "bench", tUndo, { edited: "restore" }));
  const again = after.data.guesses[0];
  expect(again, "a guess after the undo").toBeTruthy();
  expect(again.family === drawn.family && again.socket === drawn.socket, "the undone guess came straight back").toBe(false);

  expect(errors, errors.join("\n")).toEqual([]);
});

test("nothing is guessed before the warm start", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, { warmed: true });
  const t0 = await now(page);
  await openPreset(page, "Reese");
  await expect
    .poll(() => page.evaluate((t) => window.__pwReplies.filter((r) => r.type === "guess" && r.t > t).length, t0), { timeout: 60_000 })
    .toBeGreaterThan(0);
  const reply = await page.evaluate((t) => window.__pwReplies.filter((r) => r.type === "guess" && r.t > t).pop(), t0);
  expect(reply.data).toEqual({ reason: "no_taste" });
  await expect(page.locator("#rack-svg .guess-plate")).toHaveCount(0);
  await expect(page.locator("#guess-read")).toBeHidden();
  await expect(page.locator("#nb-groups .nb-item.guessed")).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("with no render crew, the guess renders the likeliest eight on the engine's thread", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(420_000);
  const errors = await boot(page, { warmed: false, query: "?farm=0" });
  await warmStartAndFit(page);
  const t0 = await now(page);
  await openPreset(page, "Sub & Sparkle");
  const r = await rankedGuess(page, t0);
  expect(r.data.total).toBeGreaterThan(8);
  expect(r.data.planned).toBe(8);
  expect(r.data.rendered).toBeLessThanOrEqual(8);
  await expect(page.locator("#rack-svg .guess-plate")).toHaveAttribute("data-kind", r.data.guesses[0].kind, { timeout: 15_000 });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a guess skipped after keep as new is still skipped when the kept sound is opened again", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(480_000);
  const errors = await boot(page, { warmed: false });
  await warmStartAndFit(page);
  await openPreset(page, "Sub & Sparkle");
  await drawnGuess(page);

  // An edit, kept as new without the comparison (PICK THE EDIT).
  const knob = page.locator("#rack-svg g[data-addr] .knob-hit").first();
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#rack-commit")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#improve-check").check();
  const tKeep = await now(page);
  await page.locator("#rack-commit").click();
  await replied(page, "committed", tKeep);
  const kept = await page.evaluate(() => window.__pwLast.committed.id);
  expect(kept).toBeGreaterThan(0);
  const keptName = (await page.locator("#rack-subject").textContent()).trim();

  // The guess on screen (ranked before the knob turn: a knob is never asked
  // about), skipped after the commit.
  const shown = await drawnGuess(page, { anyTree: true });
  const top = shown.data.guesses[0];
  const tSkip = await now(page);
  await page.locator("#rack-svg .guess-plate .gp-skip").click();
  const g = await guessAfter(page, await replied(page, "guess_skipped", tSkip));
  expect(g.data.guesses[0].family === top.family && g.data.guesses[0].socket === top.socket).toBe(false);

  // Another sound, then the kept one again: the skip is its own.
  await openPreset(page, "Reese");
  await page.locator('.bf[data-f="pool"]').click();
  const tBack = await now(page);
  // By id: the kept sound has its seed's name, and the seed is in the pool too.
  await page.locator(`#bank-list .bank-item[data-id="${kept}"] .bi-name`).click();
  const opened = await replied(page, "bench", tBack, { subject: kept });
  await expect(page.locator("#rack-subject")).toContainText(keptName, { timeout: 60_000 });
  const back = await guessAfter(page, opened);
  const head = back.data.guesses[0];
  expect(head.family === top.family && head.socket === top.socket, "the skip made after keep as new was lost").toBe(false);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a guess added after its socket was filled is refused, and the refusal says why", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(420_000);
  const errors = await boot(page, { warmed: false, slow: true });
  await warmStartAndFit(page);
  await openPreset(page, "Reese");
  // A patch from nothing: its one socket is empty, and the guess is a source
  // for it.
  const t0 = await now(page);
  await page.locator("#patch-new-btn").click();
  await expect(page.locator("#rack-subject")).toHaveText("New patch", { timeout: 30_000 });
  const g = await rankedGuess(page, t0);
  // An empty patch's candidates are the sources for its one socket.
  expect(g.data.guesses[0].op.op).toBe("replace");
  await expect(page.locator("#rack-svg .guess-plate")).toHaveAttribute("data-socket", g.data.guesses[0].socket, { timeout: 15_000 });

  // The socket is filled from the module rail while the guess is on screen
  // (an edit the engine is slow to answer), and the guess is added before
  // that edit lands: it waits its turn in the lane, and reaches the engine
  // after the socket is full.
  await slowWorker(page, { edit_structure: 2500 });
  const kind = g.data.guesses[0].kind === "pluck" ? "noise" : "pluck";
  await page.locator(`#nb-groups .nb-item[data-kind="${kind}"]`).click();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.__pwPosted.filter((p) => p.type === "edit_structure").length), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await takeDrawn(page);
  await expect
    .poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 30_000 })
    .toMatch(/didn’t happen: the patch changed after that guess, so it was not placed/);
  await slowWorker(page, {});
  expect(errors, errors.join("\n")).toEqual([]);
});
