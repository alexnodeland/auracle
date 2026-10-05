// ⚡ evolve from this, and what the bank and the toasts say about its child
// (RFC-006, "Found along the way").
//
// A generation's children go into the bank's New group ("new · generation N", each
// row tagged NEW) as they land. A ⚡ child never did: it was bred, the engine
// stamped it with a generation of its own, and the bank listed it among the
// ranked rows with nothing to say it was new. It joins the group now, as a
// generation's children do. A ⚡ that bred nothing says why in the engine's
// own terms: a refused child's bar is the sound it would replace, never "its
// parent", which the toast used to say.
//
// Seeded (the films' own Math.random), so the session is the same run to run.
const { test, expect, goLevel, bankTab } = require("./fixtures");

test("a ⚡ child joins the bank's New group, as a generation's children do", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ random: 20260928 });

  // Six picks and their refit: a taste to breed toward.
  await app.teach(6);

  // ⚡ from the sound on the bench, until one breeds a child (a walk can
  // come back with nothing; each refusal says why, never "its parent").
  await goLevel(page, "patch");
  let landed = null;
  for (let attempt = 0; attempt < 4 && !landed; attempt++) {
    await app.engine((timeout) => expect(page.locator("#rack-evolve")).toBeEnabled({ timeout }), { ms: 60_000 });
    const t0 = await app.now();
    const mark = await app.toastMark();
    await page.locator("#rack-evolve").click();
    const m = await app.reply("evolved_from", { after: t0, timeout: 300_000 });
    console.log(`⚡ ${attempt + 1}: child ${m.childId}, reason ${m.reason}, generation ${m.status.generation}`);
    if (m.childId > 0) landed = m;
    else {
      const said = await app.toast(/^⚡/, { since: mark });
      console.log(`  said: ${said}`);
      expect(said).not.toMatch(/parent|no accepted move|—/);
    }
  }
  expect(landed, "no ⚡ bred a child in four tries").not.toBeNull();

  // The bank's pool leads with the New group, its heading names the ⚡'s
  // generation, and the child's row is in it, tagged NEW.
  await bankTab(page, "pool"); // pressing the tab shown changes nothing
  const head = page.locator("#bank-list .bank-group.new .bg-label");
  await expect(head).toHaveText(`new · generation ${landed.status.generation}`);
  const row = page.locator(`#bank-list .bank-item[data-id="${landed.childId}"]`);
  await expect(row).toHaveClass(/\bfresh\b/);
  await expect(row.locator(".bi-new")).toHaveText("new");
  // It is the first row under the heading: the group holds it and nothing else.
  const firstId = await page.locator("#bank-list .bank-item[data-id]").first().getAttribute("data-id");
  expect(Number(firstId)).toBe(landed.childId);
  // The next-step chip counts it as that generation's one new sound.
  await expect(page.locator("#nextstep")).toHaveText(
    `Generation ${landed.status.generation} bred a new sound: it’s at the top of the bank ▸`,
  );
  // The toast names the sound it bred, not an id.
  const said = await app.toast(/^⚡ bred .+/, { timeout: 30_000 });
  console.log(`  said: ${said}`);
  expect(said).not.toMatch(/#\d|patch #|—/);
});
