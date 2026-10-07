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
//
// The engine worker, the toasts that entered the lane, a request held at the
// worker's door and a reply dispatched as the worker would post it are the
// fixture's tap (`app`), installed before main.js runs; the first-run
// overlays (warm start, coach, tours) are marked seen by its boot, so nothing
// sits over the controls the tests click. AU-S2 says `console.error` on
// purpose (both threads log the deliberate error), so console errors are not
// counted here: an uncaught exception still fails any test.
const { test, expect, goLevel, runCommand } = require("./fixtures");
const fs = require("fs");
const path = require("path");

const PKG = path.resolve(__dirname, "../../apps/web/pkg/auracle_wasm_bg.wasm");

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

/** The toast lane has shown (or is showing) a toast containing `text`. */
const sawToast = (app, text, timeout = 15_000) => app.toast(text, { timeout });
/** The id of the first bank row on the surface. */
async function firstBankId(page) {
  const id = Number(await page.locator("#bank-list .bank-item[data-id]").first().getAttribute("data-id"));
  expect(id).toBeGreaterThan(0);
  return id;
}
/** Rate the bank's first row from the keyboard, as the list takes it: the
 *  list focused, ↓ to its first row, then the digit. */
async function rateFirstRow(page, stars) {
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press(String(stars));
}

/** Boot seeded, the overlays seen (the fixture's `app.boot`), after `seed`
 *  (a saved record) is written where the app reads its save. */
async function boot(page, app, { seed } = {}) {
  expect(fs.existsSync(PKG), `no built engine at ${PKG} — run \`make wasm\` first`).toBe(true);
  if (seed) {
    // Same origin, no scripts: a place to write IndexedDB before the app's
    // first read of it, with no race against `idbGet("state")` at boot.
    await page.route("**/__seed", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>seed</title>" }),
    );
    await page.goto("/__seed");
    await idb(page, "put", "state", seed);
  }
  await app.boot({ wait: false });
  await app.engine((timeout) => page.waitForFunction(
    () => window.__aur && typeof window.__aur.getLive === "function" && window.__aur.getLive() != null,
    null,
    { timeout },
  ), { ms: 60_000 });
  await app.booted();
}

const alarmOf = (page) => page.locator("#alarm[role=alert]");

test("AU-S1: a save this build cannot parse is quarantined, not overwritten, until 'start fresh'", async ({ page, app }) => {
  // `SessionState` requires `profile`, `bank`, `lineage`, `generation`; a
  // string where an object should be is what a record from a newer build, or
  // one corrupt tree, looks like to serde.
  const seed = {
    v: 2,
    session: JSON.stringify({ profile: "written by a build this one is older than", bank: 3 }),
    ui: { stars: [], cut: [], probe: "seeded-by-test" },
  };
  await boot(page, app, { seed });
  // Boot puts a patch on the bench; its `bench` reply used to wipe the strip.
  await expect.poll(() => app.count("bench")).toBeGreaterThan(0);

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
  // Then outwait the 2.5 s debounce: nothing may land.
  await rateFirstRow(page, 3);
  await app.inject({ type: "saved", json: JSON.stringify({ probe: "must-not-land" }) });
  await app.quiet(4_000);
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
});

test("AU-S2: a request that throws is released and reported; a fatal error pins the alarm and stops saves (fatal half injected)", async ({ page, app }) => {
  await boot(page, app);

  // Real: `import` without `json` makes wasm-bindgen throw inside `dispatch`.
  // The worker's catch answers `engine_error`, non-fatal; main toasts and the
  // engine stays alive.
  await app.post({ type: "import" });
  await sawToast(app, "The engine couldn’t finish “import”");
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  const err = await app.last("engine_error");
  expect(err.request).toBe("import");
  expect(err.fatal).toBe(false);
  await expect(alarmOf(page)).toHaveClass(/\bhidden\b/);
  const calBefore = await app.count("calibration");
  await app.post({ type: "calibration" });
  await expect.poll(() => app.count("calibration")).toBeGreaterThan(calBefore);

  // Injected: what the worker posts after a wasm trap inside `refine`. The
  // evolve button is held by the real request and must be released by this
  // reply, synchronously, before the real `refined` could ever arrive: in
  // the click's own task, through the tap's own inject.
  const evolve = await page.evaluate(() => {
    const btn = document.getElementById("evolve-btn");
    btn.click(); // sends a real `refine`; the button is now held by it
    const held = btn.disabled;
    window.__tap.inject({ type: "engine_error", request: "refine", id: null, message: "RuntimeError: unreachable", fatal: true });
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

  // Saves are blocked: the engine's `saved` reply — the one write path — lands
  // nothing, over a window that outlasts the 2.5 s debounce.
  const stateAtCrash = await idb(page, "get", "state");
  await app.inject({ type: "saved", json: JSON.stringify({ probe: "must-not-land" }) });
  await app.quiet(3_500);
  expect(await idb(page, "get", "state")).toEqual(stateAtCrash);

  // The strip survives the next `bench` reply (a real one: the worker is only
  // crashed in main's eyes). Its handler used to `alarm(null)` on every clean
  // vet, which wiped whatever condition was pinned.
  const benches = await app.count("bench");
  await app.post({ type: "edit_begin", id: await firstBankId(page) });
  await expect.poll(() => app.count("bench")).toBeGreaterThan(benches);
  await expect(alarm).toContainText(/engine crashed/i);
  expect(await alarm.getAttribute("data-tag")).toBe("crash");

  // The other two routes into `engineCrashed` reach the same strip, once.
  await page.evaluate(() => window.__tap.engine.dispatchEvent(new ErrorEvent("error", { message: "boom" })));
  await page.evaluate(() => window.__tap.engine.dispatchEvent(new MessageEvent("messageerror")));
  expect(await alarm.locator(".al-msg").count()).toBe(1);
  await expect(alarm).toContainText(/engine crashed/i);

  // The deliberate error is console.error'd by both threads (not counted:
  // `consoleErrors` is off); an uncaught exception on the page would be a
  // different finding, and fails the test by itself.
});

test("AU-S4: a vote the engine did not take is reported and rolled back (duel real, star reply injected)", async ({ page, app }) => {
  await boot(page, app);
  // A pair the engine dealt: two sounds in the pool.
  const { pair } = await app.reply("duel", { where: { pair: true } });
  await goLevel(page, "evolve");
  const chooseA = page.locator("#choose-a");
  await expect(chooseA).toBeEnabled();

  const pips = page.locator("#teach-pips");
  const duelCount = page.locator("#duel-count");
  const pipsBefore = await pips.innerHTML();
  const observationsBefore = Number(await duelCount.textContent());

  // A real pick: counted toward the next refit at once, sent to the engine
  // after the 7 s undo window. Its vote is held at the worker's door until the
  // refusal below has landed, so the log has not seen it, however slow the
  // machine (the refusal used to have to land inside the window, timed):
  // every `record_duel` main sends (numbered), not the one posted here.
  await app.holdRequests({ type: "record_duel", rid: true });
  const picked = await app.now();
  await chooseA.click();
  expect(await pips.innerHTML()).not.toBe(pipsBefore);

  // The refusal, from the real engine and the real worker: a duel whose side
  // has left the pool. Main must undo what `choose()` did and say so. Posted
  // right behind the pick's own `duel_pred`/`duel`, so it is answered inside
  // the undo window on any machine but the slowest; how long it took is a
  // budget (ADR-022).
  await app.post({ type: "record_duel", a: pair[0], b: 4_000_000_000, choseA: true });
  // `recorded` false, not absent: a status that says nothing of a vote is not this one.
  const dropped = await app.reply("status", { where: (r) => r.recorded === false, after: picked });
  app.budget("a pick → the engine's refusal of another vote", dropped._at - picked, 6_000);
  expect(dropped.pred).toBeNull(); // a forecast for an untaken vote is not scored
  expect(dropped.ratings).toBeNull(); // and the ratings it did not move are not posted
  expect(dropped.vote).toEqual({ kind: "duel", a: pair[0], b: 4_000_000_000 });
  expect(dropped.status.observations).toBe(observationsBefore); // the log never saw it
  expect(await pips.innerHTML()).toBe(pipsBefore);
  await sawToast(app, "was replaced, so the", 2_000); // urgent: shown at once
  await sawToast(app, "the pick wasn’t recorded", 2_000);
  await sawToast(app, "Picked "); // the pick's own toast carries the undo, so it is never trimmed
  // The real vote goes on to the engine, as it would have.
  await app.releaseRequests();

  // Stars: a real optimistic rating on a bank row, then the reply the worker
  // posts when `record_stars` answers false, carrying `prev`. The lit star must
  // go back to what the bank showed before.
  const id = await firstBankId(page);
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  // The row's ★ says whether it is rated; 3 rates it from the keyboard.
  const star = () => row.locator(".bi-star");
  expect(await star().getAttribute("aria-pressed")).toBe("false");
  await rateFirstRow(page, 3);
  await expect(star()).toHaveAttribute("aria-pressed", "true");
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  const { status } = await app.last("status");
  await app.inject({
    type: "status",
    status,
    recorded: false,
    vote: { kind: "stars", id, rating: 3, prev: 0 },
  });
  await sawToast(app, "the rating wasn’t recorded", 2_000);
  expect(await star().getAttribute("aria-pressed")).toBe("false");
  expect(await row.locator(".star.lit").count()).toBe(0);
});

test("AU-S9: importing a profile over an existing log asks first, and exports the current one before replacing it", async ({ page, app }) => {
  await boot(page, app);
  // A pair the engine dealt: two sounds in the pool.
  const { pair } = await app.reply("duel", { where: { pair: true } });
  const duelCount = page.locator("#duel-count");

  // One real observation, then a profile exported at that point.
  await app.post({ type: "record_duel", a: pair[0], b: pair[1], choseA: true });
  await expect(duelCount).toHaveText("1");
  const [export1] = await Promise.all([
    page.waitForEvent("download"),
    runCommand(page, "Download your taste"),
  ]);
  expect(export1.suggestedFilename()).toBe("auracle-profile.json");
  const profileAtOne = fs.readFileSync(await export1.path(), "utf8");
  expect(JSON.parse(profileAtOne).log.observations).toHaveLength(1);

  // A second observation: the log on the machine is now ahead of the file.
  await app.post({ type: "record_duel", a: pair[0], b: pair[1], choseA: false });
  await expect(duelCount).toHaveText("2");

  const file = { name: "someone-elses-profile.json", mimeType: "application/json", buffer: Buffer.from(profileAtOne) };
  const alarm = alarmOf(page);

  // "keep mine": nothing is sent, nothing is exported, the log stands.
  await page.locator("#import-input").setInputFiles(file);
  await expect(alarm).not.toHaveClass(/\bhidden\b/);
  await expect(alarm).toContainText("Replace your taste with someone-elses-profile.json?");
  await expect(alarm).toContainText("Your 2 picks");
  await alarm.getByRole("button", { name: "keep mine" }).click();
  await expect(alarm).toHaveClass(/\bhidden\b/);
  await app.quiet();
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("imported")).toBe(0);
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("exported")).toBe(1);
  await expect(duelCount).toHaveText("2");

  // "replace it": the current profile downloads first, under the name that
  // says what it is and holding the two observations; then the file's one
  // observation is the log.
  await page.locator("#import-input").setInputFiles(file);
  await expect(alarm).toContainText("Replace your taste");
  const [safetyCopy] = await Promise.all([
    page.waitForEvent("download"),
    alarm.getByRole("button", { name: "replace it" }).click(),
  ]);
  expect(safetyCopy.suggestedFilename()).toBe("auracle-profile-before-import.json");
  const before = JSON.parse(fs.readFileSync(await safetyCopy.path(), "utf8"));
  expect(before.log.observations).toHaveLength(2);
  await expect(alarm).toHaveClass(/\bhidden\b/);
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  await expect.poll(async () => (await app.last("imported"))?.ok).toBe(true);
  await expect(duelCount).toHaveText("1");
});
