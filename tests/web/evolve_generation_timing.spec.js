// How long a generation takes at each farm width, and that every width breeds
// the same generation (plan-001, task 6). A measurement harness, not a gate:
// skipped unless AURACLE_MEASURE=1, because it breeds one generation per
// width and its numbers belong to the machine it ran on.
//
//   cd tests/web && AURACLE_MEASURE=1 AURACLE_TEST_PORT=8694 \
//     ../../www/video/tools/one_browser.sh npx playwright test \
//     evolve_generation_timing.spec.js --reporter=line
//
// AURACLE_WIDTHS picks the widths (default "0,1,2,4"); `?farm=0` is the serial
// path, every walk in the engine worker as before RFC-001.
//
// Every width starts from one saved session. A fresh profile is taught once
// (six picks and their refit) and its save is read back; each width then gets
// a fresh profile holding that very save, boots from it (the restore refits the
// same log under the same seed) and presses EVOLVE POOL. Teaching each width
// afresh would not do: the first pair is dealt while the bank is still filling,
// the one deal in the app that depends on timing, so the picks, the model and
// the generation would differ for reasons of their own.
//
// It logs the time from the press to the generation's receipt, when the first
// child landed, and the bank the generation left, and requires that bank —
// ids, names and the model's guesses — to be the same at every width.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

const WIDTHS = (process.env.AURACLE_WIDTHS || "0,1,2,4").split(",").map(Number);

const SEED = `(() => { let s = 20260928 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = `(() => {
  const Orig = window.Worker;
  const last = (window.__pwLast = {});
  const log = (window.__pwLog = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (d && typeof d.type === "string") {
        last[d.type] = d;
        log.push({ type: d.type, at: performance.now(), child: d.child, index: d.index });
      }
    });
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

// The app's own store (`idbGet`/`idbPut` in main.js).
async function idb(page, op, key, value) {
  return page.evaluate(
    async ({ op, key, value }) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("auracle", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      try {
        const tx = db.transaction("kv", op === "put" ? "readwrite" : "readonly");
        const st = tx.objectStore("kv");
        const req = op === "get" ? st.get(key) : st.put(value, key);
        return await new Promise((res, rej) => {
          tx.oncomplete = () => res(op === "put" ? true : req.result === undefined ? null : req.result);
          tx.onerror = () => rej(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { op, key, value },
  );
}

test.skip(!process.env.AURACLE_MEASURE, "a measurement harness: AURACLE_MEASURE=1 runs it");

test("a generation's time at each farm width, and the same generation at every width", async ({ browser }) => {
  test.setTimeout((WIDTHS.length + 1) * 900_000);
  const use = test.info().project.use;
  const fresh = async () => {
    const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(SEED);
    await page.addInitScript(init);
    return { context, page, errors };
  };

  // Teach once, and keep the save.
  let saved;
  {
    const { context, page, errors } = await fresh();
    await page.goto("/");
    await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 300_000 });
    await page.waitForFunction(() => window.__pwLast.filled, null, { timeout: 300_000 });
    await goLevel(page, "evolve");
    for (let i = 1; i <= 6; i++) {
      const side = i % 2 ? "#choose-a" : "#choose-b";
      await expect(page.locator(side)).toBeEnabled({ timeout: 30_000 });
      await page.locator(side).click();
    }
    await page.waitForFunction(() => window.__pwLast.fitted, null, { timeout: 180_000 });
    await expect.poll(async () => {
      const s = await idb(page, "get", "state");
      const obs = s && s.session && JSON.parse(s.session).profile?.log?.observations;
      return obs ? obs.length : 0;
    }, { timeout: 60_000 }).toBeGreaterThanOrEqual(6);
    saved = await idb(page, "get", "state");
    expect(errors).toEqual([]);
    await context.close();
  }

  const runs = [];
  for (const width of WIDTHS) {
    const { context, page, errors } = await fresh();
    // The same origin first, to put the save where the app will read it.
    await page.goto("/pkg/build.json");
    await idb(page, "put", "state", saved);
    await page.goto(`/?farm=${width}`);
    await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 300_000 });
    await page.waitForFunction(() => window.__pwLast.filled && window.__pwLast.fitted, null, { timeout: 300_000 });
    await expect(page.locator("#wm-lamp")).not.toHaveClass(/\bthinking\b/, { timeout: 60_000 });
    await goLevel(page, "evolve");
    const t0 = await page.evaluate(() => performance.now());
    await page.locator("#evolve-btn").click();
    await page.waitForFunction(() => window.__pwLast.refined, null, { timeout: 900_000 });
    const r = await page.evaluate((start) => {
      const log = window.__pwLog;
      const kids = log.filter((e) => e.type === "refine_child" && e.at >= start);
      const done = log.find((e) => e.type === "refined" && e.at >= start);
      const refined = window.__pwLast.refined;
      return {
        seconds: Math.round((done.at - start) / 100) / 10,
        first: kids.length ? Math.round((kids[0].at - start) / 100) / 10 : null,
        absorbed: kids.map((e) => Math.round((e.at - start) / 100) / 10),
        born: refined.born,
        retired: refined.retired,
        bank: refined.views.ranked.map((row) => `${row.id} ${row.name} ${row.mean.toFixed(6)}`),
      };
    }, t0);
    runs.push({ width, ...r, errors });
    console.log(`farm=${width}: generation ${r.seconds} s, first child ${r.first} s, absorbed at ${JSON.stringify(r.absorbed)}, born ${JSON.stringify(r.born)}, retired ${JSON.stringify(r.retired)}`);
    await context.close();
  }
  console.log(`summary: ${JSON.stringify(runs.map((r) => ({ width: r.width, seconds: r.seconds, first: r.first })))}`);
  for (const r of runs) expect(r.errors, `farm=${r.width} raised page errors`).toEqual([]);
  // The same starting state breeds the same generation however many workers
  // walked it.
  for (const r of runs.slice(1)) {
    expect(r.born, `farm=${r.width} bred different children from farm=${runs[0].width}`).toEqual(runs[0].born);
    expect(r.retired, `farm=${r.width} retired different patches`).toEqual(runs[0].retired);
    expect(r.bank, `farm=${r.width} left a different bank`).toEqual(runs[0].bank);
  }
});
