// PATCH's four engine facts (Plan-008 C2b, round 2's "Engine facts, all
// four"), each drawn from the engine's own reply, at rest:
//
// - Without this module: the selected module's absence, measured. Over the
//   face at OUT, a dashed outline of the face of the patch the structure
//   menu's verb would leave (a processor bypassed, a source's socket empty, a
//   modulator unplugged), rendered by the worker (`face_of_tree`); a patch
//   that would be silent without it says so in the readout instead.
//
// - What goes here?: the selection's ⋯ (or Q on a module) asks the model's
//   guess for that module's place (`guess`'s `at`, which the page never sent
//   before); its ghost is drawn there with where it goes and its reason on
//   the well's top line, Enter takes it, Esc goes back to the output's.
//
// The worker is reached as every PATCH spec reaches it (patch_page.js): the
// faces a page asks for, with their trees, and every face it is handed back.
const { test, expect } = require("@playwright/test");
const { boot, openPreset, warmStartAndFit, now, replied } = require("./patch_page.js");

/** Select a module on the canvas by its kind, as a press on its plate does. */
async function selectPlate(page, kind, nth = 0) {
  const plate = page.locator(`#rack-svg .rack-plates g[data-kind="${kind}"] .mod-plate`).nth(nth);
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 10, b.y + b.height - 6);
  await page.mouse.move(4, 400);
}

test("the face of the patch without the selected module is drawn at OUT, measured by the worker, and a patch silent without it says so", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, { warmed: true });
  // Hornet: a square VCO into a bandpass filter, a S&H modulating the cutoff.
  await openPreset(page, "Hornet");
  const out = page.locator("#out-without");
  await expect(out).toBeHidden();

  // The filter: bypassed, the VCO goes straight to the amp.
  await selectPlate(page, "filter");
  const key = await page.locator('#rack-svg .rack-plates g[data-kind="filter"]').getAttribute("data-key");
  await expect(out).toBeVisible({ timeout: 90_000 });
  await expect(out).toHaveAttribute("data-of", key);
  const drawn = { ref: await out.getAttribute("data-face"), key: await out.getAttribute("data-key") };
  const got = await page.evaluate(({ ref, key: k }) => {
    const ask = window.__pwPosted.filter((p) => p.type === "faces" && p.trees).flatMap((p) => p.trees).find((t) => t.ref === ref);
    const reply = window.__pwReplies.find((r) => r.type === "face" && r.ref === ref);
    const bench = JSON.parse(window.__pwLast.bench.treeJson);
    // The bypass the structure menu makes: the filter's input in its place.
    const node = k === "node" ? bench.root : null;
    const expected = node ? JSON.stringify({ ...bench, root: node.Filter.input }) : null;
    return { asked: ask ? ask.tree : null, replyKey: reply ? reply.key : null, expected };
  }, { ref: drawn.ref, key });
  expect(got.asked, "the outline's tree was asked of the worker").not.toBeNull();
  expect(got.expected, "Hornet's filter is its root").not.toBeNull();
  expect(got.asked, "…and it is the patch with the filter bypassed").toBe(got.expected);
  expect(got.replyKey, "the worker's own face for that tree is the one drawn").toBe(drawn.key);
  await expect(page.locator("#pt-read .pr-without")).toHaveCount(0);

  // The VCO is the only source: without it the patch is silent, which the
  // readout says, and nothing is drawn.
  await selectPlate(page, "vco");
  await expect(page.locator("#pt-read .pr-without")).toHaveText("silent without it");
  await expect(out).toBeHidden();

  // Nothing selected: nothing at OUT.
  await selectPlate(page, "filter");
  await expect(out).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(out).toBeHidden();
  expect(errors).toEqual([]);
});

/** The newest ranking with a guess in it for a guess the page asked at `at`
 *  after `after` (an empty one, its time spent, is asked again). */
async function hereRanked(page, at, after, timeout = 120_000) {
  const find = ([a, t]) => {
    const tokens = new Set(window.__pwPosted.filter((p) => p.type === "guess" && p.at === a && p.t >= t).map((p) => p.token));
    return window.__pwReplies.filter((r) => r.type === "guess" && tokens.has(r.token) && r.data && r.data.guesses && r.data.guesses.length).pop() || null;
  };
  await expect.poll(() => page.evaluate(find, [at, after]), { timeout }).not.toBeNull();
  return page.evaluate(find, [at, after]);
}

test("What goes here? asks the model's guess for a module's place, draws it there with where it goes, and Enter takes it", async ({ page }) => {
  test.setTimeout(420_000);
  const errors = await boot(page, { warmed: false });
  await warmStartAndFit(page);
  // Reese: two VCOs into a mix, a filter, the amp; the mix is mid-chain.
  await openPreset(page, "Reese");
  const keyOf = (kind) => page.locator(`#rack-svg .rack-plates g[data-kind="${kind}"]`).first().getAttribute("data-key");
  const mixKey = await keyOf("mix");

  // The pointer: the mix's ⋯ › what goes here?
  await selectPlate(page, "mix");
  const t0 = await now(page);
  await page.locator('#rack-svg .rack-controls g[data-kind="mix"] .mod-menu-btn').first().click();
  await page.locator("#ctx-menu .cm-item", { hasText: /^what goes here/ }).click();
  const asked = await page.evaluate((t) => window.__pwPosted.find((p) => p.type === "guess" && p.t >= t), t0);
  expect(asked && asked.at, "the guess is asked for the mix's place").toBe(mixKey);
  // While it is ranked, the top line says what it is doing (or, on a fast
  // machine, the ranking is in already).
  await expect(page.locator("#guess-read")).toHaveText(/hearing the modules that fit at the mix…|^guess · /);
  const atMix = await hereRanked(page, mixKey, t0);
  const top = atMix.data.guesses[0];
  // Every guess it ranked is for that place: after the mix, or its slot.
  for (const g of atMix.data.guesses) expect(g.op.key, `${g.kind} ${g.op.op}`).toBe(mixKey);
  const ghost = page.locator("#rack-svg .guess-plate");
  await expect(ghost).toHaveAttribute("data-at", mixKey, { timeout: 30_000 });
  await expect(ghost).toHaveAttribute("data-kind", top.kind);
  await expect(ghost).toHaveAttribute("data-socket", top.socket);
  await expect(page.locator("#guess-read .gr-chip")).toHaveText(/^guess · \S/);
  await expect(page.locator("#guess-read .gr-at")).toHaveText(top.op.op === "set_mod" ? /^on the mix’s / : /^after the mix$/);
  // Esc on the ghost goes back to the output's guess.
  await ghost.focus();
  const t1 = await now(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#guess-read .gr-at")).toHaveCount(0);
  await expect.poll(() => page.evaluate((t) => window.__pwPosted.some((p) => p.type === "guess" && p.t >= t && p.at == null), t1), { timeout: 30_000 }).toBe(true);

  // The keyboard: Q on the filter asks for its place; the ghost takes the
  // focus when it lands, and Enter adds it, through the edit lane.
  const filterKey = await keyOf("filter");
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').focus();
  const t2 = await now(page);
  await page.keyboard.press("q");
  const atFilter = await hereRanked(page, filterKey, t2);
  const g = atFilter.data.guesses[0];
  await expect(ghost).toHaveAttribute("data-at", filterKey, { timeout: 30_000 });
  await expect(ghost).toHaveAttribute("data-kind", g.kind);
  await expect(ghost).toBeFocused();
  const t3 = await now(page);
  await page.keyboard.press("Enter");
  const landed = await replied(page, "bench", t3, { edited: "structure" }, 60_000);
  const took = await page.evaluate((t) => window.__pwPosted.find((p) => p.type === "edit_structure" && p.t >= t), t3);
  expect(took.op).toEqual(g.op);
  expect(took.guess && took.guess.socket).toBe(g.socket);
  expect(landed).toBeGreaterThan(t3);
  await expect(page.locator(`#rack-svg .rack-plates g[data-kind="${g.kind}"]`).first()).toBeVisible();
  // The structure changed: the guess is the output's again.
  await expect(page.locator("#guess-read .gr-at")).toHaveCount(0);
  expect(errors).toEqual([]);
});
