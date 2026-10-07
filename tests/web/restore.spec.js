// A returning visit's restore with no farm (#285; docs/architecture/
// web-runtime.md "The farm on demand"). With no farm worker ready (`?farm=0`,
// a small machine, or none ready in the handshake's window) the engine worker
// restores the bank itself, one sound at a time: each read from the render
// store when it holds the sound's row (the farm's store and key), rendered
// otherwise, and "recalling n of m sounds…" posted before the next.
// It used to be one call that re-rendered every sound with nothing posted
// until it returned: 13.6 s on "restoring your bank & taste…" for 40 sounds in
// Firefox on an M-series laptop, and over two minutes on an Intel MacBook Air.
//
// What the worker posts and in what order, that it answers between sounds,
// and that the bank is `import_state`'s, are tests/worker/restore.test.mjs's.
// This holds the page's half: the line and the bar move on the veil, sound by
// sound, before it lifts. The engine is slowed fourfold (`slowEngine`), about
// an older laptop; the seconds are budgets (ADR-022), on the page's clock.
// Their limits are what a 16-core M3 Max measured, busy with other work (load
// average 115 to 170), with room for a slower CI runner: from the store, 0.5 s
// to the veil and 11 ms a step; with nothing stored, 47 s and 3.6 s a step,
// one render. The one call this replaced would be the whole restore in one
// step, and every render again where the store has them.
const { test, expect } = require("./fixtures");

const SLOW = 4;
const RECALLING = /^recalling (\d+) of (\d+) sounds…/;

/** The first visit, left as a player leaves it: the bank full, and the
 *  session saved on leaving (main's `saveOnLeave`, on `pagehide`) and on
 *  disk before the next visit begins. From here on every visit keeps what its
 *  boot veil showed until it lifted (`window.__veil`), in the order the page
 *  changed it: one observer over #boot, set before main.js runs, so its
 *  records come in the order of the changes (the line, the bar, the veil's
 *  `done`). */
async function firstVisit(page, app, query = "") {
  await page.addInitScript(() => {
    const seen = (window.__veil = []);
    const watch = () => {
      const boot = document.getElementById("boot");
      const status = document.getElementById("boot-status");
      const fill = document.getElementById("boot-fill");
      if (!boot || !status || !fill) return;
      new MutationObserver((records) => {
        const at = performance.now();
        for (const r of records) {
          if (seen.some((e) => e.down)) return;
          if (r.target === boot) {
            if (r.attributeName === "class" && boot.classList.contains("done")) seen.push({ down: true, at });
          } else if (r.target === fill) {
            seen.push({ bar: parseFloat(fill.style.width) || 0, at });
          } else if (r.target === status || status.contains(r.target)) {
            seen.push({ said: status.textContent, at });
          }
        }
      }).observe(boot, { subtree: true, attributes: true, attributeFilter: ["class", "style"], childList: true, characterData: true });
    };
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") watch();
    });
  });
  await app.boot({ query });
  await app.filled();
  const t = await app.now();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const { json } = await app.reply("saved", { after: t });
  // On disk: the save the pool was full for, not one made while it filled.
  await app.engine((timeout) => expect.poll(() => storedSession(page), { timeout, message: "the full bank was never saved" }).toBe(json), { ms: 30_000 });
}

/** The session this browser has saved (IndexedDB auracle › kv › state), as
 *  the next visit restores it, or null. */
function storedSession(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("auracle");
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.close();
        resolve(null);
        return;
      }
      const get = db.transaction("kv", "readonly").objectStore("kv").get("state");
      get.onsuccess = () => { db.close(); resolve((get.result && get.result.session) || null); };
      get.onerror = () => { db.close(); resolve(null); };
    };
  }));
}

/** The next visit, with no farm and the engine slowed: what the veil showed
 *  until it lifted, the restore's own line from the engine, and its times on
 *  the page's clock. */
async function returningVisit(page, app) {
  await app.boot({ query: "?farm=0", slowEngine: SLOW });
  const playable = await app.reply("playable");
  const shown = await page.evaluate(() => window.__veil);
  const [cache] = await app.replies("log", { where: { kind: "render_cache", here: true } });
  const [start] = await app.marks("boot-start");
  const [down] = await app.marks("veil-down");
  const progress = await app.replies("fill_progress");
  const recalls = progress.filter((r) => RECALLING.test(r.label || ""));
  const gaps = recalls.slice(1).map((r, i) => r._at - recalls[i]._at);
  return {
    restored: playable.restored,
    lifted: shown.some((e) => e.down),
    // Each count the line said while the veil was up, in order.
    said: shown.filter((e) => RECALLING.test(e.said || "")).map((e) => Number(RECALLING.exec(e.said)[1])),
    // The bar's width as each of those lines was said: main moves the bar,
    // then says the line, so a step that moved it has its width just before.
    bar: shown.flatMap((e, i) => (RECALLING.test(e.said || "") && i > 0 && shown[i - 1].bar != null ? [shown[i - 1].bar] : [])),
    cache: cache || null,
    tookMs: down.t - start.t,
    longestStepMs: Math.max(...gaps),
  };
}

const counting = (n) => Array.from({ length: n }, (_, i) => i + 1);
const rising = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

test("a returning visit with no farm says each sound on the veil as it comes back, reading what the farm measured from the render store", async ({ page, app }) => {
  // The first visit fills the pool on the farm, which keeps each render in
  // the store.
  await firstVisit(page, app);
  const visit = await returningVisit(page, app);

  expect(visit.lifted, "the veil never lifted").toBe(true);
  expect(visit.restored).toBe(40);
  // Sound by sound on the veil, before it lifted, the bar moving with each.
  expect(visit.said, "the veil did not say each sound as it came back").toEqual(counting(visit.restored));
  expect(visit.bar, "the bar did not move with each sound").toHaveLength(visit.restored);
  expect(rising(visit.bar), `the bar did not rise with each sound: ${visit.bar.join(", ")}`).toBe(true);
  // The farm's renders were read, not made again: the first eight too, which
  // it rendered with their audio (farm.js `onJob` keeps every render's row).
  expect(visit.cache, "the restore said nothing of the render store").not.toBeNull();
  expect([visit.cache.served, visit.cache.rendered], "sounds the farm had measured were rendered again").toEqual([visit.restored, 0]);

  app.budget(`a restore of ${visit.restored} sounds with no farm, the engine ${SLOW}× slower, from the render store: boot → veil down`, visit.tookMs, 3_000);
  app.budget(`the longest step between two sounds of that restore, ${SLOW}× slower`, visit.longestStepMs, 500);
});

test("a returning visit with no farm and nothing in the render store renders each sound, saying each on the veil as it comes back", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(180_000);
  // The first visit fills the pool here too, in the engine worker, which
  // keeps nothing in the store: every sound of the restore is rendered.
  await firstVisit(page, app, "?farm=0");
  const visit = await returningVisit(page, app);

  expect(visit.lifted, "the veil never lifted").toBe(true);
  expect(visit.restored).toBe(40);
  expect(visit.said, "the veil did not say each sound as it came back").toEqual(counting(visit.restored));
  expect(visit.bar, "the bar did not move with each sound").toHaveLength(visit.restored);
  expect(rising(visit.bar), `the bar did not rise with each sound: ${visit.bar.join(", ")}`).toBe(true);
  expect(visit.cache, "the restore said nothing of the render store").not.toBeNull();
  expect([visit.cache.served, visit.cache.rendered]).toEqual([0, visit.restored]);

  app.budget(`a restore of ${visit.restored} sounds with no farm, the engine ${SLOW}× slower, every sound rendered: boot → veil down`, visit.tookMs, 90_000);
  app.budget(`the longest step between two sounds of that restore, one render ${SLOW}× slower`, visit.longestStepMs, 5_000);
});
