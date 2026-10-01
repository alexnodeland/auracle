// The four failure flows the September 2026 audit fixed but never watched.
//
// Each was implemented against the protocol in apps/web/README.md and gated
// natively where it had a Rust half (`import_session_checked`, `record_*`
// returning `bool`), and each was then shipped without anyone provoking it in
// a browser. These tests do that. Where a failure can be provoked for real it
// is; where it cannot be without a fixture the shipped code does not have, the
// message the worker *would* post is dispatched on the real `Worker` object and
// the test says so in its name. Nothing in apps/web is reached for except
// through the page: the tests get at the engine worker by wrapping `Worker`
// before main.js runs, which is the only way to a handle main.js keeps in a
// module-scoped const.
//
// What is real and what is injected, flow by flow:
//
// - AU-S1 (quarantine): real end to end. IndexedDB is seeded, before any page
//   script runs, with a `{v: 2, session, ui}` record whose session the current
//   `SessionState` cannot deserialise; the engine answers `unparseable`, the
//   worker posts `restore_failed`, main quarantines. The first run of this
//   test found the alert gone by the time boot settled: the `bench` reply for
//   the first patch on the bench called `alarm(null)` on a clean vet and wiped
//   the strip. Fixed in main.js; this test pins it from the quarantine side and
//   AU-S2 from the crash side.
// - AU-S2 (crash): the non-fatal half is real — an `import` with no `json`
//   makes wasm-bindgen throw inside `dispatch`, so the worker's own catch posts
//   `engine_error`. The fatal half is injected: making the shipped binary trap
//   needs a stack-overflow tree that `import_patch` now refuses (AU-S3), so a
//   fatal `engine_error` is dispatched on the worker object exactly as the
//   worker would post it after a `WebAssembly.RuntimeError`.
// - AU-S4 (dropped vote): the duel refusal comes from the real engine — a
//   `record_duel` naming an id the pool does not hold, which is what an evicted
//   side looks like to it — and main rolls back the pick it had counted. The
//   star rollback is injected (`record_stars` has no undo window to race).
// - AU-S9 (profile import): real end to end, through the file input and the
//   download the "replace it" branch takes first.
//
// Toasts are asserted through a log of everything that *entered* the lane, not
// through the lane's text: it shows one toast at a time, drops a remark that
// waited more than 9 s, and trims the queue to three, so a plain remark can be
// spent without ever reaching the DOM. Refusals (`urgent`) pre-empt and are
// shown at once; a toast carrying an undo is never trimmed.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const PKG = path.resolve(__dirname, "../../apps/web/pkg/auracle_wasm_bg.wasm");

// Runs before any page script (`addInitScript`). Three jobs: wrap `Worker` so
// the test can reach the engine worker and see every message it posts, log
// every toast that enters the lane, and mark the first-run overlays (warm
// start, coach, tours) as seen so nothing sits over the controls the tests
// click.
const INIT = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const last = (window.__pwLast = {});
  const counts = (window.__pwCounts = {});
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    // Alongside main's \`onmessage\`, not instead of it — both fire.
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (d && typeof d.type === "string") {
        last[d.type] = d;
        counts[d.type] = (counts[d.type] || 0) + 1;
      }
    });
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;
  const toasts = (window.__pwToasts = []);
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (!lane) return;
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          const msg = n.querySelector && n.querySelector(".toast-msg");
          if (msg) toasts.push(msg.textContent);
        }
    }).observe(lane, { childList: true });
  });
  try {
    for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"])
      localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

// The app's own store: database "auracle" v1, object store "kv", key "state".
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
        const req = op === "get" ? st.get(key) : op === "keys" ? st.getAllKeys() : st.put(value, key);
        return await new Promise((res, rej) => {
          tx.oncomplete = () => res(op === "put" ? true : req.result === undefined ? null : req.result);
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { op, key, value },
  );
}

/** A request to the real engine worker, as main's `send` would post it. */
const post = (page, data) => page.evaluate((d) => window.__pwEngine().postMessage(d), data);
/** A reply main will see as if the worker had posted it. */
const inject = (page, data) =>
  page.evaluate((d) => window.__pwEngine().dispatchEvent(new MessageEvent("message", { data: d })), data);
/** The toast lane has shown (or is showing) a toast containing `text`. */
const sawToast = (page, text, timeout = 15_000) =>
  expect
    .poll(() => page.evaluate(() => window.__pwToasts), { timeout })
    .toEqual(expect.arrayContaining([expect.stringContaining(text)]));
const count = (page, type) => page.evaluate((t) => window.__pwCounts[t] || 0, type);
/** The id of the first bank row on the surface. */
async function firstBankId(page) {
  const id = Number((await page.locator("#bank-list .bank-item .bi-id").first().textContent()).replace("#", ""));
  expect(id).toBeGreaterThan(0);
  return id;
}

async function boot(page, { seed } = {}) {
  expect(fs.existsSync(PKG), `no built engine at ${PKG} — run \`make wasm\` first`).toBe(true);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(INIT);
  if (seed) {
    // Same origin, no scripts: a place to write IndexedDB before the app's
    // first read of it, with no race against `idbGet("state")` at boot.
    await page.route("**/__seed", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>seed</title>" }),
    );
    await page.goto("/__seed");
    await idb(page, "put", "state", seed);
  }
  await page.goto("/");
  await page.waitForFunction(
    () => window.__aur && typeof window.__aur.getLive === "function" && window.__aur.getLive() != null,
    null,
    { timeout: 60_000 },
  );
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  return pageErrors;
}

const alarmOf = (page) => page.locator("#alarm[role=alert]");

test("AU-S1: a save this build cannot parse is quarantined, not overwritten, until 'start fresh'", async ({ page }) => {
  // `SessionState` requires `profile`, `bank`, `lineage`, `generation`; a
  // string where an object should be is what a record from a newer build, or
  // one corrupt tree, looks like to serde.
  const seed = {
    v: 2,
    session: JSON.stringify({ profile: "written by a build this one is older than", bank: 3 }),
    ui: { stars: [], cut: [], probe: "seeded-by-test" },
  };
  const pageErrors = await boot(page, { seed });
  // Boot puts a patch on the bench; its `bench` reply used to wipe the strip.
  await expect.poll(() => count(page, "bench")).toBeGreaterThan(0);

  // The pinned condition, tagged so a later save cannot wipe it.
  const alarm = alarmOf(page);
  await expect(alarm).not.toHaveClass(/\bhidden\b/);
  await expect(alarm).toContainText("couldn’t read your saved session");
  await expect(alarm).toContainText("state-quarantine-");
  expect(await alarm.getAttribute("data-tag")).toBe("quarantine");

  // The copy exists, holds the record byte for byte, and `state` is untouched.
  const quarantineKeys = (await idb(page, "keys")).filter((k) => String(k).startsWith("state-quarantine-"));
  expect(quarantineKeys).toHaveLength(1);
  expect(await idb(page, "get", quarantineKeys[0])).toEqual(seed);
  expect(await idb(page, "get", "state")).toEqual(seed);

  // Give autosave every reason to fire: a real vote, which schedules one, and
  // the engine's `saved` reply itself, which is the only thing that writes.
  // Then outwait the 2.5 s debounce.
  await page.locator('#bank-list .star[data-s="3"]').first().evaluate((el) => el.click());
  await inject(page, { type: "saved", json: JSON.stringify({ probe: "must-not-land" }) });
  await page.waitForTimeout(4_000);
  expect(await idb(page, "get", "state")).toEqual(seed);
  expect(await idb(page, "get", "state-prev")).toBeNull();
  await expect(alarm).not.toHaveClass(/\bhidden\b/);

  // "start fresh" re-enables saving; the next save writes a fresh v2 record,
  // keeps the boot record as `state-prev`, and leaves the quarantine where it is.
  await alarm.getByRole("button", { name: "start fresh" }).click();
  await expect(alarm).toHaveClass(/\bhidden\b/);
  await expect
    .poll(async () => {
      const s = await idb(page, "get", "state");
      return s && s.ui && s.ui.probe !== "seeded-by-test" ? s.v : null;
    }, { timeout: 15_000 })
    .toBe(2);
  const fresh = await idb(page, "get", "state");
  expect(typeof fresh.session).toBe("string");
  expect(Array.isArray(JSON.parse(fresh.session).bank)).toBe(true);
  expect(await idb(page, "get", "state-prev")).toEqual(seed);
  expect(await idb(page, "get", quarantineKeys[0])).toEqual(seed);

  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("AU-S2: a request that throws is released and reported; a fatal error pins the alarm and stops saves (fatal half injected)", async ({ page }) => {
  const pageErrors = await boot(page);

  // Real: `import` without `json` makes wasm-bindgen throw inside `dispatch`.
  // The worker's catch answers `engine_error`, non-fatal; main toasts and the
  // engine stays alive.
  await post(page, { type: "import" });
  await sawToast(page, "The engine couldn’t finish “import”");
  const err = await page.evaluate(() => window.__pwLast.engine_error);
  expect(err.request).toBe("import");
  expect(err.fatal).toBe(false);
  await expect(alarmOf(page)).toHaveClass(/\bhidden\b/);
  const calBefore = await count(page, "calibration");
  await post(page, { type: "calibration" });
  await expect.poll(() => count(page, "calibration")).toBeGreaterThan(calBefore);

  // Injected: what the worker posts after a wasm trap inside `refine`. The
  // evolve button is held by the real request and must be released by this
  // reply, synchronously, before the real `refined` could ever arrive.
  const evolve = await page.evaluate(() => {
    const btn = document.getElementById("evolve-btn");
    btn.click(); // sends a real `refine`; the button is now held by it
    const held = btn.disabled;
    window.__pwEngine().dispatchEvent(
      new MessageEvent("message", {
        data: { type: "engine_error", request: "refine", id: null, message: "RuntimeError: unreachable", fatal: true },
      }),
    );
    return { held, releasedNow: !btn.disabled, label: btn.textContent };
  });
  expect(evolve.held).toBe(true);
  expect(evolve.releasedNow).toBe(true);
  expect(evolve.label).toBe("evolve pool");

  const alarm = alarmOf(page);
  await expect(alarm).not.toHaveClass(/\bhidden\b/);
  await expect(alarm).toContainText(/engine crashed/i);
  await expect(alarm).toContainText(/reload/i);
  expect(await alarm.getAttribute("data-tag")).toBe("crash");
  await expect(alarm.getByRole("button", { name: "reload" })).toBeVisible();

  // Saves are blocked: the engine's `saved` reply — the one write path — lands nothing.
  const stateAtCrash = await idb(page, "get", "state");
  await inject(page, { type: "saved", json: JSON.stringify({ probe: "must-not-land" }) });
  await page.waitForTimeout(3_500);
  expect(await idb(page, "get", "state")).toEqual(stateAtCrash);

  // The strip survives the next `bench` reply (a real one: the worker is only
  // crashed in main's eyes). Its handler used to `alarm(null)` on every clean
  // vet, which wiped whatever condition was pinned.
  const benches = await count(page, "bench");
  await post(page, { type: "edit_begin", id: await firstBankId(page) });
  await expect.poll(() => count(page, "bench")).toBeGreaterThan(benches);
  await expect(alarm).toContainText(/engine crashed/i);
  expect(await alarm.getAttribute("data-tag")).toBe("crash");

  // The other two routes into `engineCrashed` reach the same strip, once.
  await page.evaluate(() => window.__pwEngine().dispatchEvent(new ErrorEvent("error", { message: "boom" })));
  await page.evaluate(() => window.__pwEngine().dispatchEvent(new MessageEvent("messageerror")));
  expect(await alarm.locator(".al-msg").count()).toBe(1);
  await expect(alarm).toContainText(/engine crashed/i);

  // The deliberate error is console.error'd by both threads; an uncaught
  // exception on the page would be a different finding.
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("AU-S4: a vote the engine did not take is reported and rolled back (duel real, star reply injected)", async ({ page }) => {
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair);
  await page.locator('.viewtab[data-view="evolve"]').click();
  const chooseA = page.locator("#choose-a");
  await expect(chooseA).toBeEnabled();

  const pips = page.locator("#teach-pips");
  const duelCount = page.locator("#duel-count");
  const pipsBefore = await pips.innerHTML();
  const observationsBefore = Number(await duelCount.textContent());
  const pair = await page.evaluate(() => window.__pwLast.duel.pair);

  // A real pick: counted toward the next refit at once, sent to the engine
  // after the 7 s undo window.
  const picked = Date.now();
  await chooseA.click();
  expect(await pips.innerHTML()).not.toBe(pipsBefore);

  // The refusal, from the real engine and the real worker: a duel whose side
  // has left the pool. Main must undo what `choose()` did and say so. Posted
  // right behind the pick's own `duel_pred`/`duel`, so it is answered well
  // inside the undo window, before the real vote could reach the log.
  await post(page, { type: "record_duel", a: pair[0], b: 4_000_000_000, choseA: true });
  await page.waitForFunction(() => window.__pwLast.status && window.__pwLast.status.recorded === false);
  expect(Date.now() - picked, "the refusal must land inside the 7 s undo window for this to mean anything").toBeLessThan(6_000);
  const dropped = await page.evaluate(() => window.__pwLast.status);
  expect(dropped.pred).toBeNull(); // a forecast for an untaken vote is not scored
  expect(dropped.belief).toBeNull(); // and the belief it did not move is not posted
  expect(dropped.vote).toEqual({ kind: "duel", a: pair[0], b: 4_000_000_000 });
  expect(dropped.status.observations).toBe(observationsBefore); // the log never saw it
  expect(await pips.innerHTML()).toBe(pipsBefore);
  await sawToast(page, "was replaced, so the", 2_000); // urgent: shown at once
  await sawToast(page, "the pick wasn’t recorded", 2_000);
  await sawToast(page, "Picked "); // the pick's own toast carries the undo, so it is never trimmed

  // Stars: a real optimistic rating on a bank row, then the reply the worker
  // posts when `record_stars` answers false, carrying `prev`. The lit star must
  // go back to what the bank showed before.
  const id = await firstBankId(page);
  const row = page.locator(`#bank-list .bank-item:has(.bi-id:text-is("#${id}"))`);
  const star3 = () => row.locator('.star[data-s="3"]');
  expect(await star3().getAttribute("aria-pressed")).toBe("false");
  await star3().evaluate((el) => el.click());
  expect(await star3().getAttribute("aria-pressed")).toBe("true");
  const status = await page.evaluate(() => window.__pwLast.status.status);
  await inject(page, {
    type: "status",
    status,
    recorded: false,
    vote: { kind: "stars", id, rating: 3, prev: 0 },
  });
  await sawToast(page, "the rating wasn’t recorded", 2_000);
  expect(await star3().getAttribute("aria-pressed")).toBe("false");
  expect(await row.locator(".star.lit").count()).toBe(0);

  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("AU-S9: importing a profile over an existing log asks first, and exports the current one before replacing it", async ({ page }) => {
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair);
  const pair = await page.evaluate(() => window.__pwLast.duel.pair);
  const duelCount = page.locator("#duel-count");

  // One real observation, then a profile exported at that point.
  await post(page, { type: "record_duel", a: pair[0], b: pair[1], choseA: true });
  await expect(duelCount).toHaveText("1");
  const [export1] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(() => document.getElementById("export-btn").click()),
  ]);
  expect(export1.suggestedFilename()).toBe("auracle-profile.json");
  const profileAtOne = fs.readFileSync(await export1.path(), "utf8");
  expect(JSON.parse(profileAtOne).log.observations).toHaveLength(1);

  // A second observation: the log on the machine is now ahead of the file.
  await post(page, { type: "record_duel", a: pair[0], b: pair[1], choseA: false });
  await expect(duelCount).toHaveText("2");

  const file = { name: "someone-elses-profile.json", mimeType: "application/json", buffer: Buffer.from(profileAtOne) };
  const alarm = alarmOf(page);

  // "keep mine": nothing is sent, nothing is exported, the log stands.
  await page.setInputFiles("#import-input", file);
  await expect(alarm).not.toHaveClass(/\bhidden\b/);
  await expect(alarm).toContainText("Replace your taste with someone-elses-profile.json?");
  await expect(alarm).toContainText("Your 2 picks");
  await alarm.getByRole("button", { name: "keep mine" }).click();
  await expect(alarm).toHaveClass(/\bhidden\b/);
  await page.waitForTimeout(500);
  expect(await count(page, "imported")).toBe(0);
  expect(await count(page, "exported")).toBe(1);
  await expect(duelCount).toHaveText("2");

  // "replace it": the current profile downloads first, under the name that
  // says what it is and holding the two observations; then the file's one
  // observation is the log.
  await page.setInputFiles("#import-input", file);
  await expect(alarm).toContainText("Replace your taste");
  const [safetyCopy] = await Promise.all([
    page.waitForEvent("download"),
    alarm.getByRole("button", { name: "replace it" }).click(),
  ]);
  expect(safetyCopy.suggestedFilename()).toBe("auracle-profile-before-import.json");
  const before = JSON.parse(fs.readFileSync(await safetyCopy.path(), "utf8"));
  expect(before.log.observations).toHaveLength(2);
  await expect(alarm).toHaveClass(/\bhidden\b/);
  await expect.poll(() => page.evaluate(() => window.__pwLast.imported && window.__pwLast.imported.ok)).toBe(true);
  await expect(duelCount).toHaveText("1");

  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
