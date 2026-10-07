// The fixture's reused renders (fixtures.js `reuseRenders`, tests/web/AGENTS.md
// § Writing a spec): a boot that asks starts with the render cache
// (`auracle-renders`) as a boot of the same seed left it once its pool was
// whole, written before the app's first script, so the fill after the veil is
// served from it rather than rendered; and the pool it fills is a cold boot's,
// sound for sound. A boot that does not ask starts with none.
//
// How much of a wave the cache served, and how much was rendered, is the
// engine's own tally (worker.js `runFarm`, its `render_cache` log line); the
// boot's fill is one wave. What the store holds as a page starts is read by an
// init script of this spec's, before the app's first script.
const { test, expect, openApp, forgetRenders } = require("./fixtures");

// A seed no other spec boots, so what this keeps reaches no one else's boot.
const SEED_HERE = 20261007;

// The rows in the render store as the page's first script runs: 0 when there
// is no store yet (the open upgrades from nothing, and is aborted, so it
// creates none) or it has no rows; `{ error }` when it could not be read,
// which `atStart` fails on rather than taking for an empty store.
const AT_START = `(() => {
  window.__rendersAtStart = new Promise((resolve) => {
    const failed = (what, e) => resolve({ error: what + ": " + String((e && (e.name || e.message)) || e) });
    let open;
    try {
      open = indexedDB.open("auracle-renders");
    } catch (e) {
      return failed("indexedDB.open threw", e);
    }
    let absent = false;
    open.onupgradeneeded = () => {
      absent = true;
      open.transaction.abort();
    };
    open.onerror = () => (absent ? resolve(0) : failed("the store would not open", open.error));
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("rows")) {
        db.close();
        return resolve(0);
      }
      let count;
      try {
        count = db.transaction("rows").objectStore("rows").count();
      } catch (e) {
        db.close();
        return failed("the rows could not be counted", e);
      }
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => { db.close(); failed("the rows could not be counted", count.error); };
    };
  });
})();`;

/** The rows in the render store as the page started, read once it has. */
async function atStart(page) {
  const n = await page.evaluate(() => window.__rendersAtStart);
  expect(typeof n, `the render store as the page started was read (${JSON.stringify(n)})`).toBe("number");
  return n;
}

/** The pool once whole: each sound's id, its name and its patch. */
async function poolOf(app) {
  await app.filled();
  const { ranked } = await app.facts();
  return [...ranked].sort((a, b) => a.id - b.id).map((r) => `${r.id} ${r.name} ${r.sexpr}`);
}

/** The engine's tally of the boot's fill: draws served from the cache, and
 *  rendered. Only the farm keeps one (worker.js `runFarm`), and only the farm
 *  reads the cache: a boot whose farm did not come up in time fills serially,
 *  serving nothing and saying nothing, so that is checked first, by the
 *  renderers its fill's progress counted (asked once the pool is whole). */
async function tally(app) {
  const farmed = await app.replies("fill_progress", { where: { workers: true } });
  expect(farmed.length, "the farm came up for the fill (a fill_progress counting its renderers): without it the fill is serial, and serves nothing from the cache").toBeGreaterThan(0);
  return app.reply("log", { where: { kind: "render_cache" } });
}

test("a boot that reuses renders starts with what a boot of its seed kept, serves its fill from it and fills the same pool; one that does not ask starts with none", async ({ page, app, newContext }) => {
  forgetRenders({ seed: SEED_HERE });

  // Nothing kept: a cold boot, every draw rendered, its rows kept once the
  // pool is whole.
  await page.addInitScript(AT_START);
  await app.boot({ seed: SEED_HERE, random: SEED_HERE, reuseRenders: true });
  expect(await atStart(page), "nothing was kept, so the store starts empty").toBe(0);
  const cold = await poolOf(app);
  expect(cold).toHaveLength(40);
  expect((await tally(app)).served, "nothing was kept, so nothing is served").toBe(0);

  // A first visit in another context, but for the rows kept: they are in the
  // store before the app's first script, the fill is served from them, and
  // the pool is the cold boot's.
  const context = await newContext();
  const next = await context.newPage();
  await next.addInitScript(AT_START);
  const warm = await openApp(next);
  await warm.boot({ seed: SEED_HERE, random: SEED_HERE, reuseRenders: true });
  expect(await atStart(next), "the kept rows are in the store before the app's first script").toBeGreaterThan(0);
  const reused = await poolOf(warm);
  const served = await tally(warm);
  expect(served.served, `the fill after the veil is served from the kept rows (${served.served} served, ${served.rendered} rendered)`).toBeGreaterThan(0);
  expect(reused, "the same pool, sound for sound").toEqual(cold);

  // The same seed, not asking: no rows, however many are kept. The engine is
  // never started (its `init` is held back), so nothing of its own is
  // written either.
  const other = await (await newContext()).newPage();
  await other.addInitScript(AT_START);
  const plain = await openApp(other);
  await plain.stall("init");
  await plain.boot({ seed: SEED_HERE, random: SEED_HERE, wait: false });
  await plain.stalled();
  expect(await atStart(other), "a boot that does not ask starts with no rows").toBe(0);
});
