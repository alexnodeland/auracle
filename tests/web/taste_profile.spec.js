// The taste profile's three menu items say what they do, and Reset keeps what
// is yours.
//
// - Reset asked "Every pick, star and generation is forgotten", kept no copy,
//   and deleted the whole saved record — the saved patches (MY PATCHES) with
//   it, which the guide says a reset leaves alone. It now asks with the
//   counts, downloads the profile first (as Load does), and keeps the saved
//   patches.
// - Save taste profile downloaded a file and said nothing in the app.
//
// Downloads are Playwright's `download` event; the file is read back to check
// it holds the picks the question counted. The engine's replies are read
// through the fixture's tap (fixtures.js).
const { test, expect, goLevel, bankTab } = require("./fixtures");
const fs = require("fs");

// The first-run marks are set once per tab, not on every load: after a reset
// the warm start is owed again, and a spec that re-set them would hide it.
const FIRST_RUN = `(() => {
  try {
    if (!sessionStorage.getItem("pw-first-run-set")) {
      sessionStorage.setItem("pw-first-run-set", "1");
      for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"])
        localStorage.setItem(k, "1");
    }
  } catch (_) {}
})();`;

async function boot(page, app) {
  await page.addInitScript(FIRST_RUN);
  await app.boot({ warmed: false, seen: false, random: 20260928 });
}

// A player's pace between picks.
const PICK_PACE_MS = 400;

async function pick(page, app, n) {
  await goLevel(page, "evolve");
  for (let i = 0; i < n; i++) {
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
    await page.locator("#choose-a").click();
    await page.waitForTimeout(PICK_PACE_MS);
  }
}

async function menu(page, id) {
  await page.locator("#ovf-btn").click();
  await page.locator(`#${id}`).click();
}

const readJson = async (download) => JSON.parse(fs.readFileSync(await download.path(), "utf8"));

test("Reset asks with the counts, downloads the profile first, and keeps the saved patches", async ({ page, app }) => {
  await boot(page, app);
  await app.reply("duel", { where: { pair: true }, timeout: 60_000 });
  await pick(page, app, 2);
  await expect(page.locator("#duel-count")).toHaveText("2");

  // Save one patch from the pool.
  await bankTab(page, "pool");
  const row = page.locator("#bank-list .bank-item").first();
  // By id: the name of a patch nobody has named is drawn from the pool
  // around it, and the pool is new after a reset.
  const id = await row.getAttribute("data-id");
  await row.hover();
  await row.locator(".bi-save").click();
  await app.engine((timeout) => expect(page.locator('.btab .bt-n[data-n="saved"]')).toHaveText("1", { timeout }), { ms: 20_000 });

  // The question names what goes and what stays, with the counts, and
  // "keep it" keeps it. Its sentence for any counts is words.js's
  // (`resetQuestion`, apps/web/tests/words.test.mjs); here, that this
  // session's counts reach it.
  await menu(page, "taste-reset-btn");
  const alarm = page.locator("#alarm");
  const question = await page.evaluate(async () =>
    (await import("/words.js")).resetQuestion({ picks: 2, stars: 0, cuts: 0, generations: 0, saved: 1 }));
  await expect(alarm).toContainText("Reset your taste?");
  await expect(alarm).toContainText(question);
  await expect(alarm.locator("button", { hasText: "download & reset" })).toBeVisible();
  await alarm.locator("button", { hasText: "keep it" }).click();
  await expect(alarm).toHaveClass(/\bhidden\b/);
  await expect(page.locator("#duel-count")).toHaveText("2");

  // "download & reset": the copy first, holding the two picks, then the reload.
  await menu(page, "taste-reset-btn");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    alarm.locator("button", { hasText: "download & reset" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("auracle-profile-before-reset.json");
  const copy = await readJson(download);
  expect(copy.log.observations.length).toBe(2);

  // A fresh taste on the reload: no picks, the warm start again, and the
  // saved patch still saved.
  await page.waitForEvent("load", { timeout: 60_000 });
  await app.booted();
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
  await page.locator("#warm-skip").click();
  await expect(page.locator("#duel-count")).toHaveText("0");
  await app.engine((timeout) => expect(page.locator('.btab .bt-n[data-n="saved"]')).toHaveText("1", { timeout }), { ms: 60_000 });
  await bankTab(page, "saved");
  await expect(page.locator("#bank-list .bank-item[data-id]")).toHaveCount(1);
  await expect(page.locator("#bank-list .bank-item[data-id]")).toHaveAttribute("data-id", id);
});

test("Save taste profile says what it downloaded", async ({ page, app }) => {
  await boot(page, app);
  await app.reply("duel", { where: { pair: true }, timeout: 60_000 });
  await pick(page, app, 1);
  // The pick's undo window closes and it joins the log the file is made from.
  await app.reply("status", { where: { status: { observations: 1 } }, timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), menu(page, "export-btn")]);
  expect(download.suggestedFilename()).toBe("auracle-profile.json");
  expect((await readJson(download)).log.observations.length).toBe(1);
  await expect(page.locator("#toasts .toast-msg", { hasText: "Downloaded your taste" })).toHaveText(
    "Downloaded your taste (auracle-profile.json): 1 pick, 0 stars, and 0 cuts.",
    { timeout: 15_000 },
  );
});

// A reset is a fresh start: `?seed=` dealt the session being reset, so the
// reload leaves it off the address (main.js `reloadAfresh`) and deals a new
// pool, while the rest of the address stays as it was.
test("Reset takes ?seed off the address and keeps the rest of it", async ({ page, app }) => {
  await page.addInitScript(FIRST_RUN);
  await app.boot({ warmed: false, seen: false, seed: 4242, query: "?farm=2" });
  expect(new URL(page.url()).searchParams.get("seed")).toBe("4242");
  await menu(page, "taste-reset-btn");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.locator("#alarm button", { hasText: "download & reset" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("auracle-profile-before-reset.json");
  await page.waitForEvent("load", { timeout: 60_000 });
  await app.booted();
  const address = new URL(page.url());
  expect(address.searchParams.has("seed"), `the reset kept ${address.search}`).toBe(false);
  expect(address.searchParams.get("farm"), "the rest of the address went too").toBe("2");
});
