// PATCH's model view (Plan-008 C2b, round 2's "⌥ in PATCH: all of it"):
// hold ⌥, or tap MODEL, and PATCH shows what the model believes about the
// patch; let go and the canvas is as it was. Nothing of it exists at rest.
//
// - Each plate's family lean as its edge: amber toward, red away, drawn only
//   for a settled coefficient (`beliefEdge`); a guess gets none.
// - Worth per kind: one chip per family the patch holds, never one per
//   module or socket (θ/scale, `socketPrice`), "shared by 2" where two
//   plates share the family; a guess is called one.
// - The belief line in place of the subtitle, in the model's voice.
// - The guess's runners-up (`guess_rank`'s ranks 2 and 3) as fainter chips,
//   each with its lower bound; the top guess stays as it is.
// - Letting go rebuilds nothing: the plates on screen are the same elements.
// - "the model view", never "lens", in what it shows.
//
// The fit is pinned (patch_page.js `pinPulls`, handed to main.js as the
// worker would post it, every later fit's styles rewritten to it): the filter
// family settled, the VCO family a guess, so which plates get an edge is
// known whatever the warm start taught.
const { test, expect, modelView } = require("./fixtures");
const { openPreset, drawnGuess, pinPulls } = require("./patch_page.js");

const SURE = "(a hunch|leaning|fairly sure)";

/** None of the model view's marks, anywhere in PATCH. */
async function atRest(page) {
  await expect(page.locator("body")).not.toHaveClass(/\bmodel-view\b/);
  await expect(page.locator("#belief")).toBeHidden();
  await expect(page.locator("#rack-meta .pt-made")).toBeVisible();
  await expect(page.locator("#rack-svg .belief-edge")).toHaveCount(0);
  await expect(page.locator("#pt-worth .pt-worth-chip")).toHaveCount(0);
  await expect(page.locator("#pt-worth")).toBeHidden();
  await expect(page.locator("#rack-svg .guess-runner")).toHaveCount(0);
  await expect(page.locator("#pt-read .pr-model, #pt-read .pr-belief")).toHaveCount(0);
  // The top guess is drawn at rest, as C2a drew it.
  await expect(page.locator("#rack-svg .guess-plate")).toHaveCount(1);
}

/** Every mark of the model view, for the ranking `ranked`. */
async function modelMarks(page, ranked) {
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
  // The belief line stands in for the subtitle's counts; its states stay.
  await expect(page.locator("#rack-meta .pt-made")).toBeHidden();
  await expect(page.locator("#rack-meta")).toContainText(/\d+ locked/);
  await expect(page.locator("#rack-meta")).toBeVisible();
  await expect(page.locator("#belief")).toBeVisible();
  await expect(page.locator("#belief")).toHaveText(new RegExp(`^it’d like this \\d+% · ${SURE}`));
  // A settled family has its edge, so no note says nothing is settled.
  await expect(page.locator("#pt-worth .pt-worth-none")).toHaveCount(0);
  // The filter's family is settled: its plate has an edge, toward. The VCOs'
  // is a guess: neither of their plates has one.
  await expect(page.locator('#rack-svg .rack-plates g[data-kind="filter"] .belief-edge.pos')).toHaveCount(1);
  await expect(page.locator('#rack-svg .rack-plates g[data-kind="vco"] .belief-edge')).toHaveCount(0);
  // One worth chip per family, not per plate: two VCO plates, one VCO chip.
  const vcos = await page.locator('#rack-svg .rack-plates g[data-kind="vco"]').count();
  expect(vcos).toBe(2);
  const chips = await page.locator("#pt-worth .pt-worth-chip").evaluateAll((els) => els.map((e) => ({ phi: e.dataset.phi, n: Number(e.dataset.n), text: e.textContent })));
  expect(new Set(chips.map((c) => c.phi)).size, "one chip per family").toBe(chips.length);
  const filter = chips.find((c) => c.phi === "n_filter");
  expect(filter, "the filter family has its chip").toBeTruthy();
  expect(filter.text).toMatch(/^filtering [+−]\d\.\d\d$/);
  const vco = chips.find((c) => c.phi === "n_vco");
  expect(vco, "the VCO family has one chip").toBeTruthy();
  expect(vco.n).toBe(2);
  expect(vco.text).toMatch(/^VCOs [+−]\d\.\d\d ± \d\.\d\d a guess · shared by 2$/);
  // The runners-up: ranks 2 and 3 of the ranking, each with its lower bound.
  const runners = ranked.data.guesses.slice(1, 3);
  const drawn = page.locator("#rack-svg .guess-runner");
  await expect(drawn).toHaveCount(runners.length);
  for (const [i, g] of runners.entries()) {
    const r = page.locator(`#rack-svg .guess-runner[data-rank="${i + 2}"]`);
    await expect(r).toHaveAttribute("data-kind", g.kind);
    const lb = `lower bound ${g.lcb >= 0 ? "+" : "−"}${Math.abs(g.lcb).toFixed(2)}`;
    await expect(r.locator(".gr-lcb")).toHaveText(lb);
  }
  // The top guess is the one it was.
  await expect(page.locator("#rack-svg .guess-plate")).toHaveAttribute("data-kind", ranked.data.guesses[0].kind);
  // With nothing selected the readout says what adds up to the belief line.
  await expect(page.locator("#pt-read .pr-name")).toHaveText("the patch");
  await expect(page.locator("#pt-read .pr-belief")).toContainText(/utility -?\d+\.\d\d ± \d+\.\d\d/);
  // The model view, never "lens".
  const copy = await page.evaluate(() => {
    const root = document.getElementById("view-patch");
    const attrs = [...root.querySelectorAll("[title], [aria-label]")].map((e) => `${e.getAttribute("title") || ""} ${e.getAttribute("aria-label") || ""}`);
    return `${root.innerText} ${attrs.join(" ")} ${document.getElementById("model-tag")?.innerText || ""}`;
  });
  expect(copy).not.toMatch(/\blens\b/i);
}

test("the model view in PATCH: nothing of it at rest; held ⌥ or a tapped MODEL shows the leans, a worth chip per family, the belief line and the guess's runners-up; letting go restores the canvas", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ warmed: false });
  await app.warmStart();
  await pinPulls(app, "n_filter", "n_vco");
  await openPreset(app, "Sub & Sparkle");
  // The ranking on screen, with two runners-up in it.
  const ranked = await drawnGuess(app, { timeout: 120_000 });
  expect(ranked.data.guesses.length).toBeGreaterThanOrEqual(3);
  // A state the subtitle carries (a module locked), which the view keeps.
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="mix"]').focus();
  await page.keyboard.press("l");
  await expect(page.locator("#rack-meta")).toContainText(/\d+ locked/);
  await page.keyboard.press("Escape"); // out of the module: nothing selected
  await app.engine((timeout) => expect(page.locator("#rack-svg .guess-plate")).toHaveCount(1, { timeout }), { ms: 60_000 });
  await atRest(page);

  // The plates as built, to tell a rebuild from a repaint.
  await page.evaluate(() => { window.__pwPlates = [...document.querySelectorAll("#rack-svg .mod-plate")]; });
  const same = () => page.evaluate(() => window.__pwPlates.length > 0 && window.__pwPlates.every((p) => p.isConnected) &&
    document.querySelectorAll("#rack-svg .mod-plate").length === window.__pwPlates.length);

  // Held ⌥: up while held (after its 220 ms), gone when let go.
  await page.mouse.move(4, 400);
  await page.keyboard.down("Alt");
  await modelMarks(page, ranked);
  await page.keyboard.up("Alt");
  await atRest(page);
  expect(await same(), "letting go of ⌥ rebuilt nothing").toBe(true);

  // A tap on MODEL keeps it up, and a tap takes it down.
  await modelView(page, true);
  await modelMarks(page, ranked);
  // A module selected: what the model makes of its family, over the readout.
  const plate = page.locator('#rack-svg .rack-plates g[data-kind="filter"] .mod-plate').first();
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 10, b.y + b.height - 6);
  await page.mouse.move(4, 400);
  await expect(page.locator("#pt-read .pr-model")).toBeVisible();
  await expect(page.locator("#pt-read .pr-model .sp-belief")).toHaveText(/^In .+ \(100% of your pool\), you lean toward it \(θ \+0\.50 ± 0\.10\)\.$/);
  await modelView(page, false);
  await expect(page.locator("#pt-read .pr-model")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await atRest(page);
  expect(await same(), "the tapped view rebuilt nothing either").toBe(true);
});

// Under the model view the belief line stands in for the subtitle's counts,
// and what is happening to the patch follows it after a "·" (#153). A new
// patch's subtitle, and sound A's while TEACH plays it, were each written as
// one bare line, with no counts to hide and no "·": both showed in full
// beside the belief line, run together.
test("under the model view a new patch's subtitle, and sound A's in TEACH, follow the belief line after a ·", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Reese");
  const meta = page.locator("#rack-meta");
  // A new patch: its counts give way to the belief line, its state stays.
  await page.locator("#patch-new-btn").click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText("New patch", { timeout }), { ms: 30_000 });
  await expect(meta).toHaveText(/^0 modules · nothing to hear yet$/, { useInnerText: true });
  await modelView(page, true);
  await expect(page.locator("#belief")).toHaveText("nothing to rate: no source reaches the output");
  await expect(meta.locator(".pt-made")).toBeHidden();
  await expect(meta).toHaveText(/^· nothing to hear yet$/, { useInnerText: true });
  await modelView(page, false);
  // Sound A from TEACH: the way back is a state, after the belief line.
  await app.engine((timeout) => expect(page.locator("#pt-teach")).toBeVisible({ timeout }), { ms: 90_000 });
  await page.locator("#pt-teach").click();
  await page.locator("#pd-a").click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText("sound A", { timeout }), { ms: 30_000 });
  // Its "·" is drawn before the first state (style.css), not written.
  const lead = () => meta.locator(".pm").first().evaluate((e) => getComputedStyle(e, "::before").content);
  await expect(meta).toHaveText(/^← back returns to \S/, { useInnerText: true });
  await expect.poll(lead).toBe("none");
  await modelView(page, true);
  await expect(page.locator("#belief")).toBeVisible();
  await expect(meta).toHaveText(/^← back returns to \S/, { useInnerText: true });
  await expect.poll(lead).toBe('"· "');
});

