// TASTE says how sure it is, and counts what is left.
//
// - A guess looks like a guess. DIRECTIONS drew every coefficient as the same
//   glowing bar under "Longer bar = stronger pull", when at 58 picks 35 of 36
//   intervals crossed zero; STYLES drew them with no interval at all; PATCH's
//   node bank called the same number "no lean" and drew a dot. LEARNING's
//   weights and the node bank now draw one mark (taste-geom `pullMark`):
//   settled, a solid bar; a guess, a hollow outline with its whisker at full
//   strength and a "?" in the slot left of its label.
// - Every early state counts from where the player is. MAP said "Start 6
//   quick picks →" at five picks of six; TASTE and LEARNING now say how many
//   picks are left before it fits, and LEARNING says what it has none of yet.
// - The map's footer is in words.
//
// The engine's replies are read through the fixture's tap (fixtures.js). A
// weight's look is checked twice: in the weights' own description (their
// aria-label, which counts the guesses), and in the bars, on a fit whose two
// coefficients the spec chooses — one settled, one a guess — delivered as the
// worker would.
const { test, expect, goLevel, openCatalog, modelView } = require("./fixtures");

async function openView(page, view) {
  await goLevel(page, view);
  await expect(page.locator(`#view-${view}`)).toBeVisible();
}

// A player's pace between picks.
const PICK_PACE_MS = 400;

/** Hand main.js a fit whose leading style has exactly two coefficients: a
 *  settled one on `sure` and a guess on `unsure`. Every other style is idle.
 *  The styles stay pinned: a real refit or generation that lands later (a
 *  slow runner finishes the warm start's background work after this) has
 *  its styles rewritten to these before main reads it, instead of replacing
 *  the injected pulls. */
async function injectTwoPulls(app, sure, unsure) {
  const { views, status } = await app.facts();
  views.styles = views.styles.map((s, k) =>
    k === 0
      ? { ...s, share: 1, theta: [{ name: sure, mean: 0.5, std: 0.1 }, { name: unsure, mean: 0.4, std: 0.6 }] }
      : { ...s, share: 0 },
  );
  await app.amend({ views: true }, { "views.styles": views.styles });
  await app.inject({ type: "fitted", views, status });
}

test("a guess is drawn hollow with a ?, in LEARNING's weights and the module rail, and the guess above the rack is a percentage and a word", async ({ page, app }) => {
  await app.boot({ warmed: false, random: 20260928 });
  await app.warmStart([1, 4, 7]);

  // The belief line (PATCH's subtitle under the model view) is a percentage
  // and a word, never MODEL'S GUESS and a bare decimal (words.js
  // `guessLabel`).
  await openView(page, "patch");
  await modelView(page, true);
  await app.engine((timeout) => expect(page.locator("#belief .bl-u")).toHaveText(/^\d+%$/, { timeout }), { ms: 30_000 });
  await expect(page.locator("#belief .bl-sure")).toHaveText(/^· (a hunch|leaning|fairly sure)$/);
  await expect(page.locator("#belief")).not.toContainText(/model's guess/i);
  await modelView(page, false);

  // A real early fit: eighteen picks, and LEARNING says how few of its
  // weights it is sure of.
  await openView(page, "learning");
  const label = await page.locator("#md-bars").getAttribute("aria-label");
  const m = /^.+: (\d+) settled, (\d+) still a guess$/.exec(label || "");
  expect(m, `the weights say what they draw: ${label}`).not.toBeNull();
  const [settled, guesses] = [Number(m[1]), Number(m[2])];
  expect(guesses, "an eighteen-pick fit is mostly guesses").toBeGreaterThan(0);
  await expect(page.locator("#md-bars .md-row")).toHaveCount(settled + guesses);
  await expect(page.locator("#md-bars .md-row.guess")).toHaveCount(guesses);
  await expect(page.locator("#md-bars .md-row.guess .md-mark").first()).toHaveText("?");
  await expect(page.locator("#md-bars .md-row.guess .md-bar.hollow")).toHaveCount(guesses);

  // Two weights chosen here: filter's family settled (0.5 ± 0.1), the vco's
  // a guess (0.4 ± 0.6, an interval across zero). The settled one is filled,
  // the guess hollow, with its whisker across the zero line.
  await injectTwoPulls(app, "n_filter", "n_vco");
  await expect(page.locator("#md-bars")).toHaveAttribute("aria-label", /: 1 settled, 1 still a guess$/);
  const bars = await page.evaluate(() => [...document.querySelectorAll("#md-bars .md-row")].map((r) => {
    const b = r.querySelector(".md-bar");
    const w = r.querySelector(".md-whisker");
    return {
      word: r.querySelector(".md-word").textContent,
      mark: r.querySelector(".md-mark").textContent,
      fill: getComputedStyle(b).backgroundColor,
      lo: parseFloat(w.style.left),
      hi: parseFloat(w.style.left) + parseFloat(w.style.width),
    };
  }));
  expect(bars.map((b) => b.mark)).toEqual(["", "?"]);
  expect(bars[0].fill, "the settled weight is a filled bar").not.toBe("rgba(0, 0, 0, 0)");
  expect(bars[1].fill, "the guess is not filled").toBe("rgba(0, 0, 0, 0)");
  expect(bars[1].lo, "a guess's whisker starts left of zero").toBeLessThan(50);
  expect(bars[1].hi, "…and ends right of it").toBeGreaterThan(50);
  expect(bars[0].lo, "a settled whisker sits clear of zero").toBeGreaterThan(50);

  // PATCH's node bank draws the same two marks: the vco a hollow bar whose
  // whisker crosses the zero rule, the filter a solid one clear of it.
  await goLevel(page, "patch");
  await openCatalog(page);
  await modelView(page, true); // θ shows under the model view (⌥)
  const cell = (kind) => page.locator(`#nb-groups .nb-item[data-kind="${kind}"] .ni-theta`);
  await app.engine((timeout) => expect(cell("vco")).toHaveClass(/\bguess\b/, { timeout }), { ms: 15_000 });
  await expect(cell("filter")).not.toHaveClass(/\bguess\b|\bthin\b/);
  const geo = await page.evaluate(() => {
    const read = (kind) => {
      const c = document.querySelector(`#nb-groups .nb-item[data-kind="${kind}"] .ni-theta`);
      const w = c.querySelector(".tb-whisk");
      const b = c.querySelector(".tb-bar");
      return {
        lo: parseFloat(w.style.left),
        hi: parseFloat(w.style.left) + parseFloat(w.style.width),
        fill: getComputedStyle(b).backgroundColor,
        title: c.title,
      };
    };
    return { vco: read("vco"), filter: read("filter") };
  });
  expect(geo.vco.lo, "a guess's whisker starts left of zero").toBeLessThan(17);
  expect(geo.vco.hi, "…and ends right of it").toBeGreaterThan(17);
  expect(geo.vco.fill).toBe("rgba(0, 0, 0, 0)");
  expect(geo.vco.title).toMatch(/^Still a guess/);
  expect(geo.filter.lo, "a settled whisker sits clear of zero").toBeGreaterThan(17);
  expect(geo.filter.fill).not.toBe("rgba(0, 0, 0, 0)");

  // The filter's spec card says the settled lean in sentences: the count,
  // then the lean, capitalized and ending in a period. It ran on in
  // lowercase after the count's period.
  await page.locator('#nb-groups .nb-item[data-kind="filter"]').hover();
  await expect(page.locator("#pt-read .sp-dim").first()).toHaveText(/^In \d+ of \d+ sounds\.$/);
  await expect(page.locator("#pt-read .sp-belief")).toHaveText(
    /^In .+ \(100% of your pool\), you lean toward it \(θ \+0\.50 ± 0\.10\)\.$/);
});

test("TASTE's and LEARNING's early states count what is left, and the map says what it shows", async ({ page, app }) => {
  await app.boot({ random: 20260928 });
  await app.reply("duel", { where: { pair: true }, timeout: 60_000 });

  // No fit yet: both count the picks to the first one, and LEARNING says
  // what it has none of yet.
  await openView(page, "taste");
  await app.engine((timeout) => expect(page.locator("#taste-sub")).toHaveText("6 more picks and it fits your taste.", { timeout }), { ms: 30_000 });
  await expect(page.locator("#taste-legend .tl-words")).toHaveText("still a guess");
  // As in the prototype: before a fit SOUND shows no glow at all, and TASTE
  // shows each as a guess (a dashed ring, and the legend saying so).
  await expect(page.locator("#taste-legend")).not.toHaveClass(/\bon\b/);
  await page.locator("#taste-tog").click();
  await expect(page.locator("#taste-legend")).toHaveClass(/\bon\b/);
  await page.locator("#taste-tog").click();
  await openView(page, "learning");
  await expect(page.locator("#md-sub")).toHaveText("6 more picks and it fits your taste.");
  await expect(page.locator("#md-weights-none")).toHaveText("none yet: it weighs nothing until it first fits");
  await expect(page.locator("#md-fc .md-fcnote")).toHaveText("none yet: it starts guessing when it first fits");

  // Five picks in, the count has moved with them.
  await goLevel(page, "evolve");
  for (let i = 0; i < 5; i++) {
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
    await page.locator("#choose-a").click();
    await page.waitForTimeout(PICK_PACE_MS);
  }
  await openView(page, "taste");
  await expect(page.locator("#taste-sub")).toHaveText("1 more pick and it fits your taste.");

  // The sixth fits it: the halos light, and the map says what it shows.
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
  await page.locator("#choose-a").click();
  await app.reply("fitted");
  await openView(page, "taste");
  await expect(page.locator("#taste-sub")).toHaveText("From 6 picks.");
  await expect(page.locator("#taste-legend .tl-words")).toHaveText("it likes more");
  await expect(page.locator("#taste-foot")).toHaveText(/^A flat view of \d+ sounds: close dots usually sound alike \(it shows \d+% of how they differ\)\.$/);
  await openView(page, "learning");
  await expect(page.locator("#md-fc .md-fcnote")).toHaveText(/^(none yet: it guesses before each pick from here|expected \d+% · was \d+%)$/);
});
