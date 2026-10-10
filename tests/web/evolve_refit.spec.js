// No gesture waits for a refit, and a restore needs none (#300;
// docs/architecture/web-runtime.md "The refit runs on the farm").
//
// The refit is one MCMC call of seconds on a slow laptop. It ran on the
// engine worker, so every request behind it waited: the next pair's sounds,
// ▶, a save, a bank open. And a restore fitted inside boot, with the table's
// sounds asked for behind it. Now a crew worker fits it while the engine
// answers, and a saved session keeps its fitted draws, so a restore fits
// nothing.
//
// What the worker answers while a fit is out, and in what order, is
// tests/worker/fit.test.mjs's. This holds the page's half, on the reference
// profile (`profile: "air"`, tests/web/AGENTS.md): a mature session (60
// picks, saved with its fit) restored, nothing fitted at boot, the first ▶
// and a bank open; then picks through three refits, each pick putting the
// next pair up and its ▶ sounding, with no request the player made held
// behind a fit. The order is asserted; the times are budgets (ADR-022),
// taken on the page's clock in the gesture's own task.
const { test, expect, goLevel, bankTab, modelView } = require("./fixtures");

/** A mature session: the picks a player has made by then. */
const MATURE = 60;
/** A player listens before choosing. */
const LISTEN_MS = 600;
/** The picks made after the restore: three refits' worth. */
const PICKS = 19;

// In the page: resolve with ms from now until `cond()` holds (Infinity past
// `limit`).
const until = (cond, limit = 60_000) => `(async () => {
  const t0 = performance.now();
  for (;;) {
    if ((${cond})()) return performance.now() - t0;
    if (performance.now() - t0 > ${limit}) return Infinity;
    await new Promise((r) => setTimeout(r, 2));
  }
})()`;

/** The session this browser has saved (IndexedDB auracle › kv › state), or
 *  null. */
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

// The requests the worker serves in `soon` or `later` (worker.js `laneOf`):
// long work, which a fit may go before. Every other request is `now`.
const LONG = new Set(["refine", "refine_from", "own_sound_set", "own_sound", "own_sound_clear", "perform_wire", "perform_offer", "explain", "explain_lesson", "perform_drift", "fit", "styles", "cable_levels", "guess", "face_lookup", "face_render"]);

/** Over `log` (`app.log`): each refit request never answered, each `busy`
 *  the engine said while a refit was out, and each `now` request sent before
 *  a refit was sent and answered only after it landed. */
function heldBehindAFit(log) {
  const answeredAt = new Map();
  for (const e of log) if (!e.type.startsWith("sent:") && e.re != null && !e.more) answeredAt.set(e.re, e.at);
  const out = { unanswered: [], busy: [], held: [] };
  for (const f of log.filter((e) => e.type === "sent:fit")) {
    const landed = answeredAt.get(f.rid);
    if (landed == null) {
      out.unanswered.push(f.rid);
      continue;
    }
    out.busy.push(...log.filter((e) => e.type === "busy" && e.at > f.at && e.at < landed).map((e) => e.at));
    for (const r of log) {
      const type = r.type.startsWith("sent:") ? r.type.slice(5) : null;
      if (!type || r.at >= f.at || r.rid == null || LONG.has(type) || (type === "load_preset" && r.prewarm)) continue;
      const at = answeredAt.get(r.rid);
      if (at != null && at > landed) out.held.push(`${type} #${r.rid}`);
    }
  }
  return out;
}

/** How many draws a saved fit's packed posterior holds: one weight each. */
function drawsIn(posterior) {
  const b64 = posterior.weights;
  const bytes = (b64.length / 4) * 3 - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
  return bytes / 8;
}

/** Each save's time over `log`: from `save` sent to its `saved`. */
function saveTimes(log) {
  const asked = new Map(log.filter((e) => e.type === "sent:save").map((e) => [e.rid, e.at]));
  return log.filter((e) => e.type === "saved" && asked.has(e.re)).map((e) => e.at - asked.get(e.re));
}

/** A first visit at this machine's speed taught `MATURE` picks and fitted,
 *  then left as a player leaves (`pagehide` saves): the session the next
 *  visit restores. The picks are posted to the engine: the setup, not the
 *  claim. Returns the save. */
async function matureSession(page, app) {
  await app.boot();
  await app.filled();
  const ids = (await app.facts()).ranked.map((r) => r.id);
  for (let i = 0; i < MATURE; i++) {
    const a = ids[i % ids.length];
    const b = ids[(i * 7 + 3) % ids.length];
    await app.post({ type: "record_duel", a, b: b === a ? ids[(i + 1) % ids.length] : b, choseA: (i * 5) % 3 !== 0 });
  }
  await app.engine((timeout) => expect.poll(async () => (await app.facts()).status.observations, { timeout }).toBeGreaterThanOrEqual(MATURE));
  const t0 = await app.now();
  await app.post({ type: "fit" });
  await app.reply("fitted", { after: t0 });
  const t = await app.now();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const { json } = await app.reply("saved", { after: t });
  await app.engine((timeout) => expect.poll(() => storedSession(page), { timeout, message: "the session was never saved" }).toBe(json), { ms: 30_000 });
  return JSON.parse(json);
}

test("a mature session restored on the reference profile fits nothing at boot: its first ▶ sounds and a bank open is under the keys at once", async ({ page, app }) => {
  test.setTimeout(300_000);
  const saved = await matureSession(page, app);
  expect(saved.fit, "the save holds no fitted draws").toBeTruthy();
  // At most 500 draws: one weight each, as packed bytes (8 a weight).
  expect(drawsIn(saved.fit.posterior)).toBeLessThanOrEqual(500);
  expect(drawsIn(saved.fit.posterior)).toBeGreaterThan(0);

  await app.boot({ profile: "air" });
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#play-a")).toBeEnabled({ timeout }), { ms: 120_000 });
  // The model came back with the bank: the bank's guesses are there, and no
  // refit was asked for or made.
  expect(await app.sentCount("fit"), "the restore asked for a refit").toBe(0);
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("fitted"), "the restore fitted").toBe(0);
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("busy"), "the engine held a long call at boot").toBe(0);
  // eslint-disable-next-line playwright/no-wait-for-timeout -- a player reaches for ▶
  await page.waitForTimeout(LISTEN_MS);
  const play = await page.evaluate(async (js) => {
    const b = document.getElementById("play-a");
    window.__cond = () => b.classList.contains("playing");
    b.click();
    return await eval(js);
  }, until("window.__cond"));
  await page.locator("#play-a").click(); // stop

  // A pool row opened from the bank: its name under the keys, not pending.
  await bankTab(page, "pool");
  const row = page.locator("#bank-list .bank-item[data-id]").nth(3);
  const name = (await row.locator(".bi-name").textContent()).trim();
  const open = await page.evaluate(async ([want, js]) => {
    window.__cond = () => {
      const n = document.querySelector(".pf-name");
      return !!n && n.textContent === want && !n.classList.contains("pending");
    };
    document.querySelectorAll("#bank-list .bank-item[data-id]")[3].click();
    return await eval(js);
  }, [name, until("window.__cond")]);
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("fitted"), "something fitted after the restore").toBe(0);
  console.log(`restored: ▶ → sounding ${play.toFixed(0)} ms; bank open → under the keys ${open.toFixed(0)} ms`);
  app.budget("a mature session restored: the first ▶ → sounding", play, 100);
  app.budget("a mature session restored: a bank open → its name under the keys", open, 100);
});

test("on the reference profile a mature session's picks put the next pair up and its ▶ sounds at once while the refit runs on the farm", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(600_000);
  await matureSession(page, app);
  await app.boot({ profile: "air" });
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 120_000 });
  const t0 = await app.now();
  const deals = [];
  const plays = [];
  for (let i = 1; i <= PICKS; i++) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- a player listens before choosing
    await page.waitForTimeout(LISTEN_MS);
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
    // The pick: from the click to the next pair up, live.
    const d = await page.evaluate(async ([side, js]) => {
      const ids = () => ["a", "b"].map((s) => document.querySelector(`#name-${s} .dn-id`)?.textContent).join();
      const before = ids();
      window.__cond = () => ids() !== before && !document.getElementById("choose-a").disabled;
      document.getElementById(`choose-${side}`).click();
      return await eval(js);
    }, [i % 2 ? "b" : "a", until("window.__cond")]);
    deals.push(d);
    // ▶ on the pair just put up: from the press to sounding.
    const p = await page.evaluate(async (js) => {
      const b = document.getElementById("play-a");
      window.__cond = () => b.classList.contains("playing");
      b.click();
      return await eval(js);
    }, until("window.__cond"));
    plays.push(p);
    await page.locator("#play-a").click(); // stop
  }
  // The three refits went out (the sixth, twelfth and eighteenth picks, each
  // sent as the next pick committed it) and landed, each fitted on the farm.
  await app.engine((timeout) => expect.poll(async () => (await app.replies("fitted", { after: t0 })).length, { timeout }).toBe(3), { ms: 120_000 });
  const fits = await app.replies("fitted", { after: t0 });
  expect(fits.map((f) => f.farm), "a refit ran on the engine's thread").toEqual([true, true, true]);
  // No request the player made was held behind a fit: none sent before a fit
  // was sent is answered after it landed, and the engine never went busy
  // (a long call on its thread) while one was out.
  const behind = heldBehindAFit(await app.log({ after: t0 }));
  expect(behind.unanswered, "a refit was never answered").toEqual([]);
  expect(behind.busy, "the engine went busy while a refit was out").toEqual([]);
  expect(behind.held, "requests answered only after a refit sent after them landed").toEqual([]);
  console.log(`pick → next pair (ms): ${deals.map((x) => x.toFixed(0)).join(", ")}; ▶ → sounding (ms): ${plays.map((x) => x.toFixed(0)).join(", ")}; refits: ${fits.map((f) => `${Math.round(f.took.fit)} ms on the farm, ${Math.round(f.took.install)} + ${Math.round(f.took.views)} ms to install and answer, ${Math.round(f.took.out)} ms in all`).join("; ")}`);
  for (const k of [6, 12, 18]) {
    app.budget(`a mature session on the reference profile: pick ${k} → the next pair on the table`, deals[k - 1], 100);
    app.budget(`a mature session on the reference profile: ▶ after pick ${k} → sounding`, plays[k - 1], 100);
    // The pick after it commits it and sends the refit.
    app.budget(`a mature session on the reference profile: pick ${k + 1} (its refit sent) → the next pair on the table`, deals[k], 100);
    app.budget(`a mature session on the reference profile: ▶ after pick ${k + 1} → sounding`, plays[k], 100);
  }
  // The engine's thread held by the refit, at most one render's length: its
  // install and the views its reply carries.
  for (const f of fits) app.budget("a refit's install and views on the engine's thread, on the reference profile", f.took.install + f.took.views, 1_000);
  // A save carries the fitted draws now: from the request to the session's
  // text back, on the reference profile.
  console.log(`saves (ms): ${saveTimes(await app.log({ after: t0 })).map((x) => x.toFixed(0)).join(", ")}`);
});

test("a refit that lands while the pointer is over the bank waits for it to leave", async ({ page, app }) => {
  await app.boot();
  await app.filled();
  await app.teach(6);
  await goLevel(page, "evolve");
  await bankTab(page, "pool");
  await modelView(page, true);
  const order = () => page.locator("#bank-list .bank-item[data-id]").evaluateAll((rows) => rows.map((r) => r.dataset.id).join());
  const before = await order();
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  const f = await app.last("fitted");
  const reversed = { ...f.views, ranked: [...f.views.ranked].reverse() };
  // The pointer over the bank: the refit's views wait. Read in the task that
  // hands the refit to main (the tap dispatches it there and then), so no
  // rest of the pointer, on any runner's clock, can have released them yet.
  const box = await page.locator("#bank-list").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  const held = await page.evaluate((d) => {
    window.__tap.inject(d);
    return [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((r) => r.dataset.id).join();
  }, { type: "fitted", views: reversed, status: f.status });
  expect(held, "the bank re-sorted under the pointer").toBe(before);
  // It leaves: the views land.
  await page.mouse.move(box.x - 200, box.y + 40);
  await expect.poll(order).not.toBe(before);
  await modelView(page, false);
});
