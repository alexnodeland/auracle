// What the keys play while an open waits on the engine (#306). A pool sound
// opened from the bank goes under the keys in the click's own task, from the
// tree main holds, and the engine's bench follows. Two ways that went wrong
// while a bench open was still on its way:
//
// - asking again for the sound on the bench (its row clicked again, ← back
//   from an audition) left the keys on the sound being abandoned until that
//   sound's bench reply landed;
// - a second ] stepped from the bench's sound, so it asked for the same next
//   sound again rather than the one after it.
//
// The engine's bench opens are held (`app.holdRequests("edit_begin")`) while
// the gestures are made, so the state between them and the bench is there to
// look at, not a race; then released, and the keys must stay put while the
// replies land.
const { test, expect, goLevel, bankTab } = require("./fixtures");

/** Booted at PERFORM with the pool's rows listed and the sound the app opened
 *  on the bench; the rows in the bank's order, the bench's first. */
async function poolInHand(page, app) {
  await app.boot();
  await goLevel(page, "perform");
  await bankTab(page, "pool");
  await app.engine((timeout) => expect.poll(() => page.locator("#bank-list .bank-item[data-id]").count(), { timeout }).toBeGreaterThanOrEqual(4), { ms: 120_000 });
  await app.answered({ types: ["edit_begin"], lanes: ["bench"] });
  return page.evaluate(() => {
    const subject = window.__tap.replies.filter((r) => r.type === "bench" && r.d.subject != null).pop()?.d.subject;
    const rows = [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((e) => ({ id: Number(e.dataset.id), name: e.querySelector(".bi-name")?.textContent }));
    return { subject, rows };
  });
}

// In the page: watch `#live-label` and `.pf-name` and keep every text they
// show that is not `want` (`window.__strayed`).
const WATCH_KEYS = (want) => `(() => {
  window.__strayed = [];
  const look = () => {
    for (const sel of ["#live-label", ".pf-name"]) {
      const t = document.querySelector(sel)?.textContent;
      if (t && t !== ${JSON.stringify(want)}) window.__strayed.push(sel + ": " + t);
    }
  };
  new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
})()`;

test("asking again for the sound in hand while another opens puts the keys back on it at once, and they stay", async ({ page, app }) => {
  const { subject, rows } = await poolInHand(page, app);
  const here = rows.find((r) => r.id === subject);
  const other = rows.find((r) => r.id !== subject);
  await app.holdRequests("edit_begin");
  const row = (id) => `document.querySelector('#bank-list .bank-item[data-id="${id}"]').click()`;
  const away = await page.evaluate(`(() => { ${row(other.id)}; return document.getElementById("live-label").textContent; })()`);
  expect(away, "the keys take the sound clicked, in its click's task").toBe(other.name);
  // Back to the sound on the bench: read in the click's own task.
  const back = await page.evaluate(`(() => { ${row(subject)}; return [document.getElementById("live-label").textContent, document.querySelector(".pf-name")?.textContent]; })()`);
  expect(back, "the keys and PERFORM are back on the sound in hand, in the click's task").toEqual([here.name, here.name]);
  // The engine catches up: the abandoned open's bench lands first, then the
  // one asked for. The keys never leave the sound in hand.
  await page.evaluate(WATCH_KEYS(here.name));
  await app.releaseRequests();
  await app.answered({ types: ["edit_begin"], lanes: ["bench"] });
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(new RegExp(`^${here.name}`), { timeout }), { ms: 60_000 });
  expect(await page.evaluate(() => window.__strayed), "nothing else named under the keys while the bench caught up").toEqual([]);
  await expect(page.locator("#live-label")).toHaveText(here.name);
});

test("a second ] before the first step's bench lands steps on to the sound after it", async ({ page, app }) => {
  const { subject, rows } = await poolInHand(page, app);
  const at = rows.findIndex((r) => r.id === subject);
  // Two steps on from the sound in hand, in the bank's order.
  expect(at + 2, "two sounds after the one in hand (the seeded pool's order)").toBeLessThan(rows.length);
  const sent0 = await page.evaluate(() => window.__tap.sent.length);
  await app.holdRequests("edit_begin");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  const asked = await page.evaluate((n) => window.__tap.sent.slice(n).filter((x) => x.type === "edit_begin").map((x) => x.m.id), sent0);
  expect(asked, "each ] asks for the next sound on").toEqual([rows[at + 1].id, rows[at + 2].id]);
  await expect(page.locator("#live-label"), "the keys play the second step's sound").toHaveText(rows[at + 2].name);
  await app.releaseRequests();
  await app.answered({ types: ["edit_begin"], lanes: ["bench"] });
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(new RegExp(`^${rows[at + 2].name}`), { timeout }), { ms: 60_000 });
});
