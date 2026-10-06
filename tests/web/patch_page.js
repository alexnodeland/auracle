// PATCH's own helpers for the patch_* specs: the rack, the bench lane and the
// model's guess, read through the fixture's tap (fixtures.js). Each takes the
// test's `app`, but `rackAtRest`, which reads only the page. Not a spec:
// `playwright.config.js` matches `*.spec.js` only.
//
// The rest is the fixture's: the seeded boot (`app.boot`, with `busy` for a
// worker made slow on demand by `app.busy`), the warm start (`app.warmStart`),
// a reply (`app.reply`), what was sent (`app.sent`), a toast (`app.toast`),
// "nothing happens" (`app.quiet`), and a crew's ports held back from the
// engine (`app.holdRequests("farm_ports")`, `app.releaseRequests()`).
const { expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");

/** PATCH, with the preset `name` opened from PRESETS and its rack drawn and
 *  at rest (`rackAtRest`): the camera travels from the last sound's fit to
 *  this one's, and the seeded boot's sound has fourteen modules, so a press
 *  aimed at a plate, or a size read, mid-way is aimed or read at a zoom
 *  between the two. The open is a render behind whatever the engine is
 *  doing: an engine wait. */
async function openPreset(app, name) {
  const { page } = app;
  await goLevel(page, "patch");
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: name }).first().click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: 60_000 });
  await expect(page.locator("#rack-svg g.mod-group").first()).toBeVisible();
  await rackAtRest(page);
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

// The bench lane's requests: a knob write, an op, a whole tree (fixtures.js
// `LANES.bench`).
const EDITS = ["edit_param", "edit_structure", "edit_set_tree"];

/** The bench lane's edits so far, [sent, answered]: an answer is the last
 *  reply to an edit (the `bench`, or `edit_rejected`), found by the request
 *  it names (`re`). */
const laneCounts = (app) => app.page.evaluate((edits) => {
  const T = window.__tap;
  const sent = T.sent.filter((s) => edits.includes(s.type) && s.m.rid != null);
  return [sent.length, sent.filter((s) => s.m.rid in T.finals).length];
}, EDITS);

/** The bench lane has settled: every edit the page has sent has had its last
 *  reply (`app.unanswered`, by the request each names), and still has two
 *  frames later, so the rack is drawn from it. An edit the lane held back
 *  goes out in the task of the reply ahead of it, and so is seen waiting
 *  here, never missed between the two. A state, not a quiet window: an
 *  engine wait. */
async function settled(app, { timeout = 90_000 } = {}) {
  let left = [];
  const waiting = async () => (left = await app.unanswered({ lanes: ["bench"] })).length;
  const frames = () => app.page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  try {
    await app.engine((ms) => expect.poll(async () => {
      if (await waiting()) return false;
      await frames();
      return (await waiting()) === 0;
    }, { timeout: ms, message: "the bench lane settled" }).toBe(true), { ms: timeout });
  } catch (err) {
    // Say which edits were still waiting for their last reply, as
    // `app.answered` does.
    throw new Error(`the bench lane never settled: still waiting for ${left.map((r) => `${r.type} #${r.rid}`).join(", ") || "none at the last look"}\n${err.message}`);
  }
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

module.exports = {
  openPreset, rackAtRest, benchTree, laneCounts, settled, rankedGuess, guessAfter, drawnGuess, pinPulls,
};
