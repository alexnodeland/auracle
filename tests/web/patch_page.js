// Shared by the PATCH specs of Plan-005 task 7 (patch_guess, patch_cables,
// patch_from_nothing, patch_sheet): boot the instrument with the engine
// worker wrapped, as every spec here reaches it, and the two ways in (with and
// without the warm start's fit). Not a spec: `playwright.config.js` matches
// `*.spec.js` only.
const { expect } = require("@playwright/test");

// The worker wrapped before main.js runs: the last reply of each type, a count
// of each, every request posted, and every toast said. `__pw_slow` makes chosen
// requests busy-wait in the worker, so a race the player can lose on a slow
// machine is lost every time (patch_editing.spec.js's method).
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
        if (m && typeof m.type === "string") posted.push({ type: m.type, t: performance.now(), op: m.op || null, guess: m.guess || null, token: m.token ?? null });
        return post(m, t);
      };
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d.type !== "string") return;
        last[d.type] = d;
        counts[d.type] = (counts[d.type] || 0) + 1;
        if (["guess", "guess_skipped", "cable_levels", "edit_rejected", "bench", "committed"].includes(d.type)) {
          replies.push({ type: d.type, t: performance.now(), data: d.data || null, error: d.error || null, tree: d.tree || d.treeJson || null, token: d.token ?? null, edited: d.edited ?? null, subject: d.subject ?? null });
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

/** PATCH, with a preset open on it and its rack drawn. */
async function openPreset(page, name) {
  await page.locator('.viewtab[data-view="play"]').click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await expect(page.locator("#rack-subject")).toContainText(name, { timeout: 60_000 });
  await expect(page.locator("#rack-svg g.mod-group").first()).toBeVisible();
}

const slowWorker = (page, map) =>
  page.evaluate((m) => window.__pwEngine().postMessage({ type: "__pw_slow", slow: m }), map);

/** The newest `guess` reply with a ranking in it for the tree on the bench,
 *  once one lands after `after` (an earlier request can answer for a sound
 *  the page has since left, and the page drops it). */
async function rankedGuess(page, after = 0, timeout = 60_000) {
  const pick = (t) => {
    const bench = window.__pwLast.bench && window.__pwLast.bench.treeJson;
    return window.__pwReplies.filter((r) => r.type === "guess" && r.t > t && r.data && r.data.guesses && r.tree === bench).pop() || null;
  };
  await expect.poll(() => page.evaluate(pick, after), { timeout }).not.toBeNull();
  return page.evaluate(pick, after);
}

const now = (page) => page.evaluate(() => performance.now());

/** When the first reply of `type` after `after` landed (matching `match`, a
 *  partial reply), once it has. */
async function replied(page, type, after, match = {}, timeout = 60_000) {
  const find = ([ty, t, mt]) => {
    const r = window.__pwReplies.find((x) => x.type === ty && x.t > t && Object.entries(mt).every(([k, v]) => x[k] === v));
    return r ? r.t : null;
  };
  await expect.poll(() => page.evaluate(find, [type, after, match]), { timeout }).not.toBeNull();
  return page.evaluate(find, [type, after, match]);
}

/** The ranking for the first guess the page asked for after `after` (a
 *  skip's answer, an undo's reply): an answer computed before it may still
 *  land in between, and is not this one. */
async function guessAfter(page, after, timeout = 90_000) {
  const find = (t) => {
    const ask = window.__pwPosted.find((p) => p.type === "guess" && p.t > t);
    if (!ask) return null;
    return window.__pwReplies.find((r) => r.type === "guess" && r.token === ask.token && r.data) || null;
  };
  await expect.poll(() => page.evaluate(find, after), { timeout }).not.toBeNull();
  return page.evaluate(find, after);
}

/** The guess PATCH draws, once it is the top of the newest ranking for the
 *  tree on the bench (a refit can rank it again while the page waits), and
 *  that ranking. `anyTree`: the newest ranking whatever its knob values (a
 *  knob turned since is not asked about again). */
async function drawnGuess(page, { timeout = 90_000, anyTree = false } = {}) {
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

module.exports = { boot, warmStartAndFit, openPreset, slowWorker, rankedGuess, now, replied, guessAfter, drawnGuess };
