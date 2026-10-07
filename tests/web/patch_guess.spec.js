// PATCH's guess for the next module (Plan-005 task 7; the engine's side is
// task 9d, `auracle_session::guess`, and `www/reference/src/search/guess.md`).
//
// The guess is the engine's ranking (`guess_rank`, posted by the worker as
// `guess`); these specs read it as the worker posts it and hold the page to
// it: the top guess drawn at its socket with its reason and forecast, taken
// through the edit lane, skipped, an undone take counted as a skip, nothing
// before the warm start, the crew, and keep as new keeping the skips made
// after it. With no crew the guess ranks the floor's eight: the worker's
// rule, held in tests/worker/lanes.test.mjs.
const { test, expect, bankTab, openCatalog } = require("./fixtures");
const { openPreset, rankedGuess, guessAfter, drawnGuess } = require("./patch_page.js");
const { SLOW_ENGINE } = require("./perform_budget.js");

const SURE = "(a hunch|leaning|fairly sure)";
const LINE = new RegExp(`· \\d+%( over your pool’s average)? · ${SURE}( · it may not help)?$`);

/** The x of every module rail row's name, by kind. */
const railNameX = (page) =>
  page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("#nb-groups .nb-item")].map((b) => [b.dataset.kind, b.querySelector(".ni-name").getBoundingClientRect().left])));

/** Click the drawn guess's body (its × is at the top right). */
const takeDrawn = (page) => page.locator("#rack-svg .guess-plate .gp-body").click({ position: { x: 18, y: 60 } });

test("the model's guess is drawn at its socket with its reason and forecast, and is added, skipped, and skipped by an undo", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ warmed: false });
  await app.warmStart();
  await openPreset(app, "Sub & Sparkle");
  // Before any guess is drawn: where each catalog row's name sits.
  await openCatalog(page);
  const xBefore = await railNameX(page);

  // The newest ranking for this patch, and what PATCH draws from it.
  const first = await drawnGuess(app);
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
  const tSkip = await app.now();
  const shown = await drawnGuess(app);
  const skipped = shown.data.guesses[0];
  await plate.locator(".gp-skip").click();
  const second = await guessAfter(app, (await app.reply("guess_skipped", { after: tSkip }))._at);
  const next = second.data.guesses[0];
  expect(next, "a second guess").toBeTruthy();
  expect(next.family === skipped.family && next.socket === skipped.socket, "the skipped family is back at its socket").toBe(false);
  const drawn = (await drawnGuess(app)).data.guesses[0];

  // Add: the same edit as the rail's, through the lane, with the guess on it.
  const tTake = await app.now();
  await takeDrawn(page);
  await expect.poll(async () => (await app.sent({ type: "edit_structure", guess: true }, { after: tTake })).length).toBeGreaterThan(0);
  await app.engine((timeout) => app.toast(/patched into the wire\.|took the socket\.| → /, { timeout }), { ms: 30_000 });
  await app.reply("bench", { where: { edited: "structure" }, after: tTake });

  // ⌘Z takes it out, and the engine counts that as a skip: the guess it ranks
  // for the patch as it was is not the one undone.
  const tUndo = await app.now();
  await page.locator("#rack-svg").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  const after = await guessAfter(app, (await app.reply("bench", { where: { edited: "restore" }, after: tUndo }))._at);
  const again = after.data.guesses[0];
  expect(again, "a guess after the undo").toBeTruthy();
  expect(again.family === drawn.family && again.socket === drawn.socket, "the undone guess came straight back").toBe(false);
});

test("beside the guess, the patch's face and its face with the guess, each as rendered, gone after a knob turns, and only the guess's on a patch from nothing", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(120_000); // about 49 s on CI: two rankings on a crew, and their faces
  await app.boot({ warmed: false });
  await app.warmStart();
  await openPreset(app, "Sub & Sparkle");
  const top = (await drawnGuess(app)).data.guesses[0];
  // The candidate's face is the memo row the guess rendered for it (its
  // `key`), not an estimate; the patch's is the bench's own render.
  expect(top.key, "the ranking names the candidate's render").toMatch(/^[0-9a-f]{32}$/);
  const faces = page.locator("#rack-svg .rack-guess image.gp-face");
  await app.engine((timeout) => expect(faces).toHaveCount(2, { timeout }), { ms: 60_000 });
  await expect(page.locator("#rack-svg .rack-guess .gp-face-word")).toHaveText(["as it is", "with it"]);
  // Each word sits under its own face, and the two words don't touch.
  const boxes = await page.locator("#rack-svg .rack-guess .gp-face-word").evaluateAll((ts) =>
    ts.map((t) => { const r = t.getBoundingClientRect(); return { l: r.left, r: r.right }; }));
  expect(boxes[0].r, "the words stand apart").toBeLessThan(boxes[1].l);
  expect(await faces.nth(1).getAttribute("data-face")).toBe(`g${top.key}`);
  // Both drawn pictures. Not compared: a module at its defaults can move
  // no band by the face's half-decibel step, and the two are then the same.
  for (const f of [faces.nth(0), faces.nth(1)]) expect(await f.getAttribute("href")).toMatch(/^data:image\/png;base64,/);

  // A knob turned: a knob is not ranked again, so the guess stays, but its
  // faces describe the tree it was ranked on, which the bench has left. They
  // go, and stay gone after the edit has settled.
  const plates = page.locator("#rack-svg .guess-plate");
  const knob = page.locator("#rack-svg g[data-addr] .knob-hit").first();
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 4);
  await page.mouse.up();
  await app.engine((timeout) => expect(faces).toHaveCount(0, { timeout }), { ms: 15_000 });
  await app.quiet();
  await expect(faces).toHaveCount(0);
  await expect(plates).toHaveCount(1);

  // A patch from nothing has no sound, so no face as it is: only the guess's.
  const t0 = await app.now();
  await page.locator("#patch-new-btn").click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText("New patch", { timeout }), { ms: 30_000 });
  const empty = (await rankedGuess(app, { after: t0 })).data.guesses[0];
  await app.engine((timeout) => expect(faces).toHaveCount(1, { timeout }), { ms: 60_000 });
  await expect(page.locator("#rack-svg .rack-guess .gp-face-word")).toHaveText(["with it"]);
  expect(await faces.first().getAttribute("data-face")).toBe(`g${empty.key}`);
});

test("nothing is guessed before the warm start", async ({ page, app }) => {
  await app.boot();
  const t0 = await app.now();
  await openPreset(app, "Reese");
  await app.reply("guess", { after: t0, timeout: 60_000 });
  const reply = (await app.replies("guess", { after: t0 })).pop();
  expect(reply.data).toEqual({ reason: "no_taste" });
  await expect(page.locator("#rack-svg .guess-plate")).toHaveCount(0);
  await expect(page.locator("#guess-read")).toBeHidden();
  await expect(page.locator("#nb-groups .nb-item.guessed")).toHaveCount(0);
  // …and nothing was rendered for it: no render crew was raised to be told no.
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("farm_want")).toBe(0);
});

test("a new patch's skips are its own: the sound it was started from does not inherit them", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(120_000); // about 64 s on CI: a ranking after every skip
  await app.boot({ warmed: false });
  await app.warmStart();
  await openPreset(app, "Reese");
  const reese = await page.evaluate(() => window.__aur.wb.subjectId);
  await drawnGuess(app);

  // A new patch that sounds, so its guesses are at the output, as Reese's are.
  await page.locator("#patch-new-btn").click();
  await app.engine((timeout) => expect(page.locator('#rack-svg g.mod-group[data-kind="silence"]')).toHaveCount(1, { timeout }), { ms: 30_000 });
  await openCatalog(page);
  await page.locator('#nb-groups .nb-item[data-kind="vco"]').click();
  await page.keyboard.press("Enter");
  await app.engine((timeout) => expect(page.locator('#rack-svg g.mod-group[data-kind="vco"]')).toHaveCount(1, { timeout }), { ms: 30_000 });
  // Skip until a skip is at the output, the socket Reese has too (a skip at
  // the vco's own slot names a module Reese has not got).
  let top = (await drawnGuess(app)).data.guesses[0];
  let skippedOut = false;
  for (let i = 0; i < 8 && !skippedOut; i++) {
    const at = top.socket;
    const tSkip = await app.now();
    await page.locator("#rack-svg .guess-plate .gp-skip").click();
    const next = await guessAfter(app, (await app.reply("guess_skipped", { after: tSkip }))._at);
    skippedOut = at === "out";
    if (skippedOut) break;
    top = next.data.guesses[0];
    await app.engine((timeout) => expect(page.locator("#rack-svg .guess-plate")).toHaveAttribute("data-socket", top.socket, { timeout }), { ms: 15_000 });
  }

  expect(skippedOut, "no guess at the output to skip").toBe(true);

  // BACK TO Reese: it has skipped nothing.
  const tBack = await app.now();
  await page.locator("#patch-back").click();
  const back = await guessAfter(app, (await app.reply("bench", { where: { subject: reese }, after: tBack }))._at);
  expect(back.data.skipped, "Reese took the new patch's skip").toBe(0);
});

// While boot's own crew is still filling the pool no walk crew can be raised,
// and a guess started then ranked only the floor's eight. It used to start
// late enough by accident, behind PERFORM's background measurements; once
// those went last (`idleOnly` in worker.js) a guess asked straight after the
// warm start's fit started with the bank still arriving (pool 27 of 40 on a
// CI runner) and ranked eight. It waits for boot's crew now, as a generation
// does. Here boot's crew is made slow (its wasm calls 12 times as long, as
// perform_budget.js slows the engine), so the bank is still arriving when
// the guess is asked; the walk crew raised afterwards is not slowed. The
// slowdown is the boot's `farmPrefix`, which the fixture serves after a
// profile's own (a route of the spec's own would lose to the profile's).
/** farm.js's prefix (`app.boot`'s `farmPrefix`, asked each time farm.js is
 *  served): boot's crew, the farm workers served within five seconds of the
 *  first as the page loads, slowed 12 times; a walk crew, much later, not.
 *  Timed from the first, not from the boot's call, which on a profile may
 *  first spend seconds calibrating. */
function bootCrewSlowed() {
  let first = null;
  return () => {
    const now = Date.now();
    if (first === null) first = now;
    return now - first < 5_000 ? SLOW_ENGINE(12) : "";
  };
}

test("a guess asked while the bank is still arriving waits for it, then ranks every candidate on a crew", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(300_000); // about 168 s on CI, most of it the bank arriving on boot's slowed crew
  await app.boot({ warmed: false, farmPrefix: bootCrewSlowed() });
  await app.warmStart();
  await openPreset(app, "Sub & Sparkle");
  await app.engine((timeout) => expect.poll(() => app.sentCount("guess"), { timeout }).toBeGreaterThan(0), { ms: 60_000 });
  const [asked] = await app.sent("guess");
  const filledFirst = (await app.replies("filled")).filter((f) => f._at < asked._at);
  expect(filledFirst, "the bank had finished arriving before the guess was asked").toEqual([]);
  const r = await rankedGuess(app, { timeout: 300_000 });
  expect(r.data.planned, "ranked on the floor's eight, not on a crew").toBe(r.data.total);
  expect(r.data.total).toBeGreaterThan(8);
  expect(await app.count("filled")).toBeGreaterThan(0);
});

test("a guess skipped after keep as new is still skipped when the kept sound is opened again", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ warmed: false });
  await app.warmStart();
  await openPreset(app, "Sub & Sparkle");
  await drawnGuess(app);

  // An edit, kept as new without the comparison (PICK THE EDIT).
  const knob = page.locator("#rack-svg g[data-addr] .knob-hit").first();
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 4 });
  await page.mouse.up();
  await app.engine((timeout) => expect(page.locator("#rack-commit")).toBeEnabled({ timeout }), { ms: 30_000 });
  await page.locator("#improve-check").check();
  const tKeep = await app.now();
  await page.locator("#rack-commit").click();
  const kept = (await app.reply("committed", { after: tKeep })).id;
  expect(kept).toBeGreaterThan(0);
  const keptName = (await page.locator("#rack-subject").textContent()).trim();

  // The guess on screen (ranked before the knob turn: a knob is never asked
  // about), skipped after the commit.
  const shown = await drawnGuess(app, { anyTree: true });
  const top = shown.data.guesses[0];
  const tSkip = await app.now();
  await page.locator("#rack-svg .guess-plate .gp-skip").click();
  const g = await guessAfter(app, (await app.reply("guess_skipped", { after: tSkip }))._at);
  expect(g.data.guesses[0].family === top.family && g.data.guesses[0].socket === top.socket).toBe(false);

  // Another sound, then the kept one again: the skip is its own. The other
  // sound comes from the pool, not the presets: opening a preset puts it in
  // the pool, and a full pool (40) makes room by replacing the sound it rates
  // lowest. A sound just kept as new often was that sound: on a CI runner the
  // kept sound rated 24%, opening Reese replaced it, and its row was never
  // there to click. A sound kept as new is now safe until it has been in a
  // pick (bank_kept.spec.js), but this test is about the skip, not that.
  await bankTab(page, "pool");
  const other = await page.locator(`#bank-list .bank-item:not([data-id="${kept}"])`).first().getAttribute("data-id");
  const tOther = await app.now();
  await page.locator(`#bank-list .bank-item[data-id="${other}"] .bi-name`).click();
  await app.reply("bench", { where: { subject: Number(other) }, after: tOther });
  const tBack = await app.now();
  // By id: rows can share a name.
  const keptRow = page.locator(`#bank-list .bank-item[data-id="${kept}"]`);
  await expect(keptRow, "the kept sound is still in the pool").toHaveCount(1, { timeout: 10_000 });
  await keptRow.locator(".bi-name").click();
  const opened = (await app.reply("bench", { where: { subject: kept }, after: tBack }))._at;
  await expect(page.locator("#rack-subject")).toContainText(keptName);
  const back = await guessAfter(app, opened);
  const head = back.data.guesses[0];
  expect(head.family === top.family && head.socket === top.socket, "the skip made after keep as new was lost").toBe(false);
});

test("a guess added after its socket was filled is refused, and the refusal says why", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ warmed: false, busy: true });
  await app.warmStart();
  await openPreset(app, "Reese");
  // A patch from nothing: its one socket is empty, and the guess is a source
  // for it.
  const t0 = await app.now();
  await page.locator("#patch-new-btn").click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText("New patch", { timeout }), { ms: 30_000 });
  const g = await rankedGuess(app, { after: t0 });
  // An empty patch's candidates are the sources for its one socket.
  expect(g.data.guesses[0].op.op).toBe("replace");
  await app.engine((timeout) => expect(page.locator("#rack-svg .guess-plate")).toHaveAttribute("data-socket", g.data.guesses[0].socket, { timeout }), { ms: 15_000 });

  // The socket is filled from the module rail while the guess is on screen
  // (an edit the engine is slow to answer), and the guess is added before
  // that edit lands: it waits its turn in the lane, and reaches the engine
  // after the socket is full.
  await app.busy({ edit_structure: 2500 });
  const kind = g.data.guesses[0].kind === "pluck" ? "noise" : "pluck";
  await openCatalog(page);
  await page.locator(`#nb-groups .nb-item[data-kind="${kind}"]`).click();
  await page.keyboard.press("Enter");
  await expect.poll(() => app.sentCount("edit_structure"), { timeout: 15_000 }).toBeGreaterThan(0);
  await takeDrawn(page);
  await app.engine((timeout) => app.toast(/didn’t happen: the patch changed after that guess, so it was not placed/, { timeout }), { ms: 30_000 });
  await app.busy({});
});
