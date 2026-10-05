// A sound you keep as new is safe until it has been in a pick (the engine's
// `Candidate::unjudged`).
//
// Before, keep as new followed by opening a preset on a full pool replaced
// the sound just kept whenever the model rated it lowest: the toast said so,
// but the sound you had just made was gone (patch_guess.spec.js met it on a
// CI runner: the kept sound rated 24%, and opening Reese replaced it). Here
// the kept sound is made to rate lowest of everything a preset could replace,
// a preset is opened, and its row stays; the toast names the sound that was
// replaced in its place, and pointing at EVOLVE POOL never marks the kept
// sound "may be replaced".
//
// The engine's replies are read through the fixture's tap (fixtures.js).
const { test, expect, goLevel, bankTab } = require("./fixtures");

const row = (page, id) => page.locator(`#bank-list .bank-item[data-id="${id}"]`);

/** The pool's members a preset may replace, lowest rated first: the
 *  engine's ratings in its own order, without the saved ones. */
function replaceable(s) {
  const saved = new Set((s.ranked || []).filter((r) => r.pinned).map((r) => r.id));
  return s.ratings.ranked.filter((r) => !saved.has(r.id)).map((r) => r.id).reverse();
}

test("a sound kept as new stays when a preset opens on a full pool, though it rates lowest", { tag: "@slow" }, async ({ page, app }) => {
  // Sessions are seeded (the films' own Math.random), so the pool is the
  // same run to run.
  await app.boot({ warmed: false, random: 20261002 });

  // The warm start's three picks, and the fit they ask for.
  await app.warmStart([1, 4, 7]);
  // A full pool: until then an insert replaces nothing.
  await app.fullPool({ timeout: 300_000 });
  await expect.poll(async () => !!(await app.facts()).ratings).toBe(true);

  // Open the sound the model rates lowest of those it may replace, and save
  // it: the edit kept from it then has nothing beneath it but sounds that
  // rate higher.
  await goLevel(page, "patch");
  await bankTab(page, "pool");
  const lowest = replaceable(await app.facts())[0];
  const tOpen = await app.now();
  await row(page, lowest).locator(".bi-name").click();
  await app.reply("bench", { after: tOpen, where: { subject: lowest }, timeout: 60_000 });
  await row(page, lowest).locator(".bi-save").click();
  await app.engine((timeout) => expect.poll(async () => ((await app.facts()).ranked || []).find((r) => r.id === lowest)?.pinned, { timeout }).toBe(true), { ms: 30_000 });

  // A small edit, kept as new without the comparison: nothing is taught.
  const knob = page.locator("#rack-svg g[data-addr] .knob-hit").first();
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 6, { steps: 3 });
  await page.mouse.up();
  await app.engine((timeout) => expect(page.locator("#rack-commit")).toBeEnabled({ timeout }), { ms: 30_000 });
  const tKeep = await app.now();
  await page.locator("#rack-commit").click();
  // The comparison, when there is one, is skipped.
  const skip = page.locator("#cd-skip");
  await Promise.race([
    skip.waitFor({ state: "visible", timeout: 60_000 }).then(() => skip.click()).catch(() => {}),
    app.reply("committed", { after: tKeep, timeout: 90_000 }).catch(() => {}),
  ]);
  const committed = await app.reply("committed", { after: tKeep, timeout: 90_000 });
  const kept = committed.id;
  expect(kept, "the edit was not kept").toBeGreaterThan(0);
  const keptName = (committed.views.ranked.find((r) => r.id === kept) || {}).name;

  // The precondition, from the engine's own ratings: of everything a preset
  // could replace, the kept sound rates lowest. Without the protection it is
  // the one a preset replaces.
  const before = await app.facts();
  expect(replaceable(before)[0], "the precondition: the kept sound rates lowest").toBe(kept);
  const pool = new Set(before.ranked.map((r) => r.id));
  const names = new Set(before.ranked.map((r) => r.name));

  // Open a preset that is not in the pool yet.
  await bankTab(page, "presets");
  const preset = await page.evaluate((have) => {
    const rows = [...document.querySelectorAll("#bank-list .bank-item")];
    const r = rows.find((e) => {
      const n = e.querySelector(".bi-name");
      return n && !have.includes(n.textContent.trim());
    });
    return r ? r.querySelector(".bi-name").textContent.trim() : null;
  }, [...names]);
  expect(preset, "every preset is already in the pool").not.toBeNull();
  const tPreset = await app.now();
  await page.locator("#bank-list .bank-item", { hasText: preset }).first().click();
  const loaded = await app.reply("preset_loaded", { after: tPreset, timeout: 90_000 });
  const after = new Set(loaded.views.ranked.map((r) => r.id));
  const gone = [...pool].filter((id) => !after.has(id));
  expect(gone.length, "opening a preset on a full pool replaced nothing").toBe(1);
  expect(gone, "the sound kept as new was replaced").not.toContain(kept);

  // The kept row is still in the pool, and the toast names what was replaced.
  await bankTab(page, "pool");
  await expect(row(page, kept), "the kept row left the bank").toHaveCount(1);
  const goneName = before.ranked.find((r) => r.id === gone[0]).name;
  await app.toast(`sound it could: ${goneName}`, { timeout: 30_000 });
  const said = (await app.toasts()).filter((t) => /It replaced/.test(t));
  expect(said.some((t) => keptName && t.includes(`it could: ${keptName}`)), "a toast said the kept sound was replaced").toBe(false);

  // Pointing at EVOLVE POOL marks what may be replaced, never the kept sound.
  await goLevel(page, "evolve");
  await page.locator("#evolve-wrap").hover();
  const may = () => page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item.may-go")].map((e) => Number(e.dataset.id)));
  await expect.poll(async () => (await may()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await may(), "the kept sound is marked \"may be replaced\"").not.toContain(kept);
  await page.mouse.move(5, 5);
});
