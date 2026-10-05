// PATCH's own helpers for the patch_* specs: the rack, the bench lane and the
// model's guess, read through the fixture's tap (fixtures.js). Each takes the
// test's `app`. Not a spec: `playwright.config.js` matches `*.spec.js` only.
//
// The rest is the fixture's: the seeded boot (`app.boot`, with `busy` for a
// worker made slow on demand by `app.busy`), the warm start (`app.warmStart`),
// a reply (`app.reply`), what was sent (`app.sent`), a toast (`app.toast`),
// "nothing happens" (`app.quiet`), and a crew's ports held back from the
// engine (`app.holdRequests("farm_ports")`, `app.releaseRequests()`).
const { expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");

/** Whether `x` is the fixture's `app`, not a bare page (see the end). */
const isApp = (x) => !!x && typeof x.engine === "function" && !!x.page;

/** PATCH, with the preset `name` opened from PRESETS and its rack drawn and
 *  at rest (`rackAtRest`): the camera travels from the last sound's fit to
 *  this one's, and the seeded boot's sound has fifteen modules, so a press
 *  aimed at a plate, or a size read, mid-way is aimed or read at a zoom
 *  between the two. The open is a render behind whatever the engine is
 *  doing: an engine wait. */
async function openPreset(app, name) {
  const page = isApp(app) ? app.page : app;
  const engine = isApp(app) ? (fn) => app.engine(fn, { ms: 60_000 }) : (fn) => fn(60_000);
  await goLevel(page, "patch");
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: name }).first().click();
  await engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }));
  await expect(page.locator("#rack-svg g.mod-group").first()).toBeVisible();
  if (isApp(app)) await rackAtRest(page);
}

/** The rack at rest: whatever an open or an edit set moving has stopped.
 *  The camera's fit and the plates' moves are tweens drawn a frame at a time,
 *  so the view box and every plate are where they were three frames ago; a
 *  departing patch's plates and cables (`.rack-exit`) are gone; and no
 *  animation that ends (an arrival's fade) is still running. */
async function rackAtRest(page) {
  await expect.poll(() => page.evaluate(() => new Promise((done) => {
    const svg = document.getElementById("rack-svg");
    const look = () => `${svg.getAttribute("viewBox")}|${[...svg.querySelectorAll(".rack-plates g[data-key]")].map((g) => `${g.getAttribute("transform")};${g.style.transform}`).join(",")}`;
    const a = look();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      const ending = svg.getAnimations({ subtree: true }).filter((x) => x.playState === "running" && x.effect && x.effect.getComputedTiming().endTime !== Infinity);
      done(a === look() && !svg.querySelector(".rack-exit") && ending.length === 0);
    })));
  })), { message: "the rack came to rest" }).toBe(true);
}

/** The tree on the bench, as the engine last described it (its `bench`). */
const benchTree = (app) => app.page.evaluate(() => (window.__tap.last.bench ? window.__tap.last.bench.treeJson : null));

// The bench lane's requests, counted out: a knob write, an op, a whole tree.
const EDITS = ["edit_param", "edit_structure", "edit_set_tree"];
/** How long the lane's counts must stay agreed before it has settled: long
 *  enough for whatever the test's last gesture set going to have reached
 *  the lane. */
const LANE_QUIET_MS = 700;

/** The bench lane's edits so far, [sent, answered]: an answer is a `bench`
 *  reply to an edit, or `edit_rejected`. */
const laneCounts = (app) => app.page.evaluate((edits) => {
  const T = window.__tap;
  const out = T.sent.filter((s) => edits.includes(s.type)).length;
  const back = T.replies.filter((r) => !r.injected && ((r.type === "bench" && r.d.edited !== undefined) || r.type === "edit_rejected")).length;
  return [out, back];
}, EDITS);

/** Every edit the page has sent is answered, and stays that way for
 *  LANE_QUIET_MS: the lane has nothing at the engine and nothing it is about
 *  to send. An engine wait. */
async function settled(app, { timeout = 90_000 } = {}) {
  const counts = () => laneCounts(app);
  await app.engine((ms) => expect.poll(async () => {
    const a = await counts();
    if (a[0] !== a[1]) return false;
    await app.page.waitForTimeout(LANE_QUIET_MS);
    const b = await counts();
    return a[0] === b[0] && a[1] === b[1];
  }, { timeout: ms, intervals: [250], message: "the bench lane settled" }).toBe(true), { ms: timeout });
}

/** The newest `guess` reply with a ranking in it for the tree on the bench,
 *  once one has landed after `after` (the page's clock): an earlier request
 *  can answer for a sound the page has since left, and the page drops it; an
 *  empty ranking (its time ran out before any candidate was heard) is asked
 *  again, and a refusal is said. An engine wait. */
async function rankedGuess(app, { after = -Infinity, timeout = 60_000 } = {}) {
  const pick = (t) => {
    const T = window.__tap;
    const bench = T.last.bench && T.last.bench.treeJson;
    const r = T.replies.filter((x) => x.type === "guess" && !x.injected && x.at > t && x.d.data && x.d.data.guesses && x.d.data.guesses.length && x.d.tree === bench).pop();
    return r ? { ...r.d, _at: r.at } : null;
  };
  const t = after === -Infinity ? -1e15 : after;
  let found = null;
  try {
    await app.engine((ms) => expect.poll(async () => (found = await app.page.evaluate(pick, t)) != null, { timeout: ms }).toBe(true), { ms: timeout });
  } catch (err) {
    const seen = await app.page.evaluate((s) => window.__tap.replies
      .filter((r) => r.type === "guess" && r.at > s)
      .map((r) => r.d.error || (r.d.data && (r.d.data.reason || `${(r.d.data.guesses || []).length} of ${r.d.data.rendered}/${r.d.data.planned}/${r.d.data.total}`))), t);
    throw new Error(`no ranking with a guess in it: ${JSON.stringify(seen)}\n${err.message}`);
  }
  return found;
}

/** The ranking for the first guess the page asked for at or after `after` (a
 *  skip's answer, an undo's reply): an answer computed before it may still
 *  land in between, and is not this one. An empty ranking is asked again by
 *  the page: the answer is then the next one with a guess in it. An engine
 *  wait. */
async function guessAfter(app, after, { timeout = 90_000 } = {}) {
  const find = (t) => {
    const T = window.__tap;
    const ask = T.sent.find((s) => s.type === "guess" && s.at >= t);
    if (!ask) return null;
    const r = T.replies.find((x) => x.type === "guess" && !x.injected && x.d.token === ask.m.token && x.d.data);
    if (!r) return null;
    const d = r.d.data;
    if (d.guesses && !d.guesses.length && d.rendered < d.planned) {
      const later = T.replies.find((x) => x.type === "guess" && !x.injected && x.at > r.at && x.d.data && x.d.data.guesses && x.d.data.guesses.length);
      return later ? { ...later.d, _at: later.at } : null;
    }
    return { ...r.d, _at: r.at };
  };
  let found = null;
  try {
    await app.engine((ms) => expect.poll(async () => (found = await app.page.evaluate(find, after)) != null, { timeout: ms }).toBe(true), { ms: timeout });
  } catch (err) {
    // Say what the page asked for and heard since, which is the whole story.
    const seen = await app.page.evaluate((t) => ({
      asked: window.__tap.sent.filter((s) => s.at > t - 2000 && /guess/.test(s.type)).map((s) => `${Math.round(s.at)} ${s.type} ${s.m.token}`),
      heard: window.__tap.replies.filter((r) => r.at > t - 2000 && /guess/.test(r.type)).map((r) => `${Math.round(r.at)} ${r.type} ${r.d.token} ${r.d.error || (r.d.data ? r.d.data.reason || (r.d.data.guesses || []).length : "")}`),
      patch: window.__aur.patch().guess,
    }), after);
    throw new Error(`no guess asked after ${Math.round(after)} was answered: ${JSON.stringify(seen)}\n${err.message}`);
  }
  return found;
}

/** The guess PATCH draws, once it is the top of the newest ranking for the
 *  tree on the bench (a refit can rank it again while the page waits), and
 *  that ranking. `anyTree`: the newest ranking whatever its knob values (a
 *  knob turned since is not asked about again). An engine wait. */
async function drawnGuess(app, { timeout = 90_000, anyTree = false } = {}) {
  if (!isApp(app)) return drawnGuessOnPage(app, { timeout, anyTree });
  const agree = (any) => {
    const T = window.__tap;
    const bench = T.last.bench && T.last.bench.treeJson;
    const r = T.replies.filter((x) => x.type === "guess" && !x.injected && x.d.data && x.d.data.guesses && (any || x.d.tree === bench)).pop();
    const g = document.querySelector("#rack-svg .guess-plate");
    if (!r || !g || !r.d.data.guesses.length) return null;
    const top = r.d.data.guesses[0];
    return g.getAttribute("data-kind") === top.kind && g.getAttribute("data-socket") === top.socket ? { ...r.d, _at: r.at } : null;
  };
  let found = null;
  await app.engine((ms) => expect.poll(async () => (found = await app.page.evaluate(agree, anyTree)) != null, {
    timeout: ms, message: "the guess drawn is the top of the newest ranking",
  }).toBe(true), { ms: timeout });
  return found;
}

/** Hand main.js a fit whose every style carries exactly two coefficients, a
 *  settled one on `sure` (0.5 ± 0.1) and a guess on `unsure` (0.4 ± 0.6, an
 *  interval across zero), as the worker would post it (`fitted`), with the
 *  first style holding the whole pool. Pinned: every engine reply carrying
 *  views has its styles rewritten to these before main reads it (`app.amend`),
 *  so a real refit that lands later keeps them (taste_marks.spec.js's
 *  method). */
async function pinPulls(app, sure, unsure) {
  const f = await app.page.evaluate(() => {
    const fit = window.__tap.last.fitted;
    return { views: fit.views, status: fit.status };
  });
  const theta = [{ name: sure, mean: 0.5, std: 0.1 }, { name: unsure, mean: 0.4, std: 0.6 }];
  const styles = f.views.styles.map((s, k) => ({ ...s, share: k === 0 ? 1 : 0, theta }));
  await app.amend({ views: true }, { "views.styles": styles });
  await app.inject({ type: "fitted", views: { ...f.views, styles }, status: f.status });
}

// ---------------------------------------------------------------------------
// Until perform_offer_latency.spec.js is on the fixture (#135), it boots
// through this file's old tap and reads its globals (`__pwEngine`, `__pwLast`,
// `__pwCounts`, `__pwReplies`), with `boot`, `warmStartAndFit`, `now`,
// `holdCrew` and `releaseCrew`, and `openPreset` and `drawnGuess` handed a
// page. Kept as they were, for it alone: no PATCH spec uses them, and they go
// when it moves.

// The worker wrapped before main.js runs: the last reply of each type, a count
// of each, every request posted, and every toast said. `__pw_slow` makes chosen
// requests busy-wait in the worker.
const init = ({ warmed }) => `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const last = (window.__pwLast = {});
  const counts = (window.__pwCounts = {});
  const posted = (window.__pwPosted = []);
  const replies = (window.__pwReplies = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    if (/worker\\.js/.test(w.__pwUrl)) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && typeof m.type === "string") posted.push({ type: m.type, t: performance.now(), op: m.op || null, guess: m.guess || null, token: m.token ?? null, at: m.at ?? null, trees: m.type === "faces" ? (m.trees || []).map((x) => ({ ref: x.ref, tree: x.tree || null, seen: !!x.seen })) : null, req: m.req ?? null, ptree: m.type === "perform_wire" ? m.tree || null : null });
        // A crew's ports held back while __pwHoldCrew is set (holdCrew).
        if (m && m.type === "farm_ports" && window.__pwHoldCrew) {
          window.__pwHeld.push([m, t, performance.now()]);
          return;
        }
        return post(m, t);
      };
      window.__pwHeld = [];
      window.__pwReleaseCrew = () => {
        window.__pwHoldCrew = false;
        for (const [m, t] of window.__pwHeld.splice(0)) post(m, t);
      };
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d.type !== "string") return;
        // A pinned fit (pinPulls) outlives the real refits behind it: every
        // listener sees this same data object, and this one runs first.
        if (d.views && window.__pwPinStyles) d.views.styles = JSON.parse(JSON.stringify(window.__pwPinStyles));
        last[d.type] = d;
        counts[d.type] = (counts[d.type] || 0) + 1;
        if (["guess", "guess_skipped", "cable_levels", "edit_rejected", "bench", "committed"].includes(d.type)) {
          replies.push({ type: d.type, t: performance.now(), data: d.data || null, error: d.error || null, tree: d.tree || d.treeJson || null, token: d.token ?? null, edited: d.edited ?? null, subject: d.subject ?? null });
        }
        // PERFORM's measurements, by the request they answer.
        if (d.type === "perform_wired" && d.data) replies.push({ type: "perform_wired", t: performance.now(), req: d.req ?? null, data: d.data });
        // Every face the worker hands back, by the ref it was asked under.
        if (d.type === "faces") {
          for (const it of d.items || []) if (it.ref) replies.push({ type: "face", t: performance.now(), ref: it.ref, key: it.key });
          for (const f of d.failed || []) if (f.ref) replies.push({ type: "face_failed", t: performance.now(), ref: f.ref });
        }
      });
    }
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
    }).observe(lane, { childList: true, subtree: true });
  });
  try {
    const seen = ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"];
    if (${warmed}) seen.push("auracle-warmed");
    for (const k of seen) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

const SLOW = `let __pwSlow = {};
self.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "__pw_slow") { __pwSlow = d.slow || {}; e.stopImmediatePropagation(); return; }
  const ms = d && __pwSlow[d.type];
  if (ms) { const until = performance.now() + ms; while (performance.now() < until) {} }
});
`;

/** Boot, and return the page's uncaught errors as they come. `warmed` skips
 *  the warm start (and so the fit); `query` is the page's (`?farm=0`). */
async function boot(page, { warmed = true, query = "", slow = false } = {}) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(init({ warmed }));
  if (slow) {
    await page.route(/\/worker\.js(\?|$)/, async (route) => {
      const resp = await route.fetch();
      const body = await resp.text();
      await route.fulfill({ response: resp, body: SLOW + body, contentType: "text/javascript" });
    });
  }
  // AURACLE_CPU_THROTTLE=4 runs the page's main thread four times slower
  // (CDP), so the races a slower CI runner loses show up on a fast machine.
  const rate = Number(process.env.AURACLE_CPU_THROTTLE || 0);
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  await page.goto(`/${query}`);
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return errors;
}

/** The warm start's three picks, then the fit it asks for. */
async function warmStartAndFit(page) {
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [1, 4, 7]) await cards.nth(i).click();
  await page.locator("#warm-go").click();
  await expect.poll(() => page.evaluate(() => window.__pwCounts.fitted || 0), { timeout: 120_000 }).toBeGreaterThan(0);
}

const now = (page) => page.evaluate(() => performance.now());

/** Hold every crew main raises from here on: its ports (`farm_ports`) are
 *  kept from the engine worker until `releaseCrew`, so whatever waits for a
 *  crew (a guess's crew phase) is still waiting. The worker gives up on a
 *  crew `CREW_SPAWN_MS` (10 s) after asking for it. */
const holdCrew = (page) => page.evaluate(() => { window.__pwHoldCrew = true; });
/** Hand the held ports over; how many crews were held. */
const releaseCrew = (page) => page.evaluate(() => { const n = window.__pwHeld.length; window.__pwReleaseCrew(); return n; });

/** `drawnGuess` on a page booted with `boot`. */
async function drawnGuessOnPage(page, { timeout = 90_000, anyTree = false } = {}) {
  const agree = (any) => {
    const bench = window.__pwLast.bench && window.__pwLast.bench.treeJson;
    const r = window.__pwReplies.filter((x) => x.type === "guess" && x.data && x.data.guesses && (any || x.tree === bench)).pop();
    const g = document.querySelector("#rack-svg .guess-plate");
    if (!r || !g || !r.data.guesses.length) return null;
    const top = r.data.guesses[0];
    return g.getAttribute("data-kind") === top.kind && g.getAttribute("data-socket") === top.socket ? r : null;
  };
  await expect.poll(() => page.evaluate(agree, anyTree), { timeout }).not.toBeNull();
  return page.evaluate(agree, anyTree);
}

module.exports = {
  openPreset, rackAtRest, benchTree, laneCounts, settled, rankedGuess, guessAfter, drawnGuess, pinPulls,
  // perform_offer_latency.spec.js's, until it is on the fixture (#135).
  boot, warmStartAndFit, now, holdCrew, releaseCrew,
};
