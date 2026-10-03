// Find a sound (`#bank-find`, Plan-008 PR B): what is typed narrows the bank
// as it goes, on a sound's name, its family and its blurb, across the pool
// and the presets; Esc clears it and stays in the field. The words live in
// the page's own state, outside the list, so the bank's many redraws (a
// rating, a cut, the rename guard's deferred one) keep both the words and the
// filter. It is a text field: typing in it plays no note.
const { test, expect } = require("@playwright/test");
const { bankTab } = require("./shell");

const INIT = `(() => {
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  await expect.poll(() => names(page), { timeout: 120_000 }).toHaveLength(40);
  return errors;
}
const names = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item .bi-name")].map((e) => e.textContent.trim()));
const presets = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#bank-list .preset-item")].map((r) => ({
    name: r.querySelector(".bi-name").textContent.trim(),
    blurb: r.querySelector(".bi-name").title,
    family: (() => { let g = r.previousElementSibling; while (g && !g.classList.contains("bank-group")) g = g.previousElementSibling; return g ? g.querySelector(".bg-label").textContent.trim() : ""; })(),
  })));

test("Find a sound narrows the pool and the presets by name, family and blurb, and Esc clears it", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  const find = page.locator("#bank-find");
  await expect(find).toHaveAttribute("placeholder", "Find a sound");
  // The pool, by a name it holds.
  const all = await names(page);
  const word = all[5].split(/\s+/)[0].toLowerCase();
  await find.fill(word);
  await expect.poll(async () => (await names(page)).length).toBeLessThan(all.length);
  for (const n of await names(page)) expect(n.toLowerCase()).toContain(word);
  expect(await names(page)).toContain(all[5]);

  // The presets: the words carry over, and a family's name finds its sounds.
  await find.fill("");
  await bankTab(page, "presets");
  await expect(page.locator("#bank-list .preset-item").first()).toBeVisible({ timeout: 30_000 });
  const library = await presets(page);
  expect(library.length).toBeGreaterThan(20);
  const family = library[0].family.toLowerCase();
  await find.fill(family);
  await expect.poll(async () => (await presets(page)).length).toBeLessThan(library.length);
  const byFamily = await presets(page);
  for (const p of byFamily) {
    expect(`${p.name} ${p.family} ${p.blurb}`.toLowerCase(), `${p.name} matches "${family}"`).toContain(family);
  }
  expect(byFamily.filter((p) => p.family.toLowerCase() === family).length).toBe(library.filter((p) => p.family.toLowerCase() === family).length);
  // …and a word only its blurb has.
  const target = library.find((p) => p.blurb.split(/\s+/).some((w) => w.length > 4 && !library.some((q) => q.name.toLowerCase().includes(w.toLowerCase()))));
  const blurbWord = target.blurb.split(/\s+/).find((w) => w.length > 4 && !library.some((q) => q.name.toLowerCase().includes(w.toLowerCase()))).replace(/[^\p{L}]/gu, "").toLowerCase();
  await find.fill(blurbWord);
  await expect.poll(async () => (await presets(page)).map((p) => p.name)).toContain(target.name);
  // A word nothing has: said, and Esc clears it, in the field.
  await find.fill("zzqx");
  await expect(page.locator("#bank-list .bench-empty")).toHaveText(/No sound matches/);
  await page.keyboard.press("Escape");
  await expect(find).toHaveValue("");
  await expect(find).toBeFocused();
  await expect.poll(async () => (await presets(page)).length).toBe(library.length);
  expect(errors).toEqual([]);
});

test("Find a sound survives the bank redrawing under it: a rating, a cut and a rename", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  const find = page.locator("#bank-find");
  const all = await names(page);
  const word = all[3].split(/\s+/)[0].toLowerCase();
  await find.fill(word);
  const shown = async () => (await names(page)).every((n) => n.toLowerCase().includes(word));
  await expect.poll(shown).toBe(true);
  const narrowed = (await names(page)).length;
  expect(narrowed).toBeLessThan(all.length);
  // A rating redraws the bank (`rateRow` → `renderBank`).
  const row = page.locator("#bank-list .bank-item[data-id]").first();
  await row.hover();
  await row.locator(".bi-star").click();
  await row.locator('.star[data-s="3"]').click();
  await expect(page.locator("#toasts .toast").last()).toContainText(/Rated .+ 3★\./, { timeout: 10_000 });
  await expect(find).toHaveValue(word);
  expect(await shown()).toBe(true);
  // A rename holds the list until it ends, then the deferred redraw runs:
  // the words and the filter are still there after it.
  const name = row.locator(".bi-name");
  await name.dblclick({ position: { x: 4, y: 6 } }); // its start: the actions sit over its end
  const input = page.locator("#bank-list input.bi-rename");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(find).toHaveValue(word);
  expect(await shown()).toBe(true);
  // A cut takes its row and keeps the rest of the matches.
  const before = (await names(page)).length;
  const cut = page.locator("#bank-list .bank-item[data-id]:not(.saved)").first();
  await cut.hover();
  await cut.locator(".bi-kill").click();
  await expect.poll(async () => (await names(page)).length).toBe(before - 1);
  await expect(find).toHaveValue(word);
  expect(await shown()).toBe(true);
  expect(errors).toEqual([]);
});

test("typing in Find a sound plays no note, and the same key outside it does", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await page.waitForFunction(() => window.__aur && window.__aur.getLive && window.__aur.getLive(), null, { timeout: 60_000 });
  const down = () => page.evaluate(() => document.querySelectorAll(".pkey.down, .bkey.down").length);
  await page.locator("#bank-find").focus();
  for (const k of ["a", "s", "d"]) {
    await page.keyboard.down(k);
    await page.waitForTimeout(150);
    expect(await down(), `${k} played a note from Find a sound`).toBe(0);
    await page.keyboard.up(k);
  }
  await expect(page.locator("#bank-find")).toHaveValue("asd");
  await page.locator("#bank-find").blur();
  await page.keyboard.down("a");
  await expect.poll(down).toBe(1);
  await page.keyboard.up("a");
  expect(errors).toEqual([]);
});
