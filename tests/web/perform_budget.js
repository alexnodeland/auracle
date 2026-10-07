// How long a PERFORM spec may wait for the engine to grow an offer or a
// drift, on the machine it runs on. Not a spec: `playwright.config.js` matches
// `*.spec.js` only.
//
// An offer is a walk of about twenty steps, each step a phrase render, and it
// may wait behind a measurement of the patch in hand (sixteen to thirty-odd
// renders) that was asked for first. Measured on a 16-core M3 Max, one step
// is about 0.26 s, a re-check of Glass Pad's shipped wiring 32 steps' worth, a
// taken offer's first measurement 16 and a spare offer 15. On CI's four-core
// runners one step is 1.5 to 2.1 s, and seconds more when the runner is
// loaded, so a fixed wait that holds on a laptop runs out there for the
// machine, not the app. A wait on offer growth is therefore the longer of a
// floor (CI's 240 s, the bound perform_teaches.spec.js has used since the
// first spare took 62 s there; 90 s elsewhere) and STEPS steps measured on
// this machine, now. STEPS is more than twice the longest wait in steps the
// specs have (an offer behind a first measurement, about fifty), so a budget
// that runs out means an offer that is not coming, or one many times slower
// than it was.
//
// What must not wait for an offer is not bounded by this budget, which is only
// for waiting on the engine's growth: a Keep keeps a bound of its own from a
// measured step (perform_offer_latency.spec.js), a pick made while a spare
// grows is answered before the spare's next step (an order, held in
// tests/worker/lanes.test.mjs), and NEXT handing
// over a spare is asserted by order (B holds it by the end of the press's own
// task), its milliseconds a speed budget (fixtures.js `budget`, ADR-022).
//
// A spec reaches it as `app.offerBudget` (fixtures.js). The fixture's tap keeps
// the engine worker (`window.__pbEngine`) and the tree of the last
// `perform_wire` the page asked for, the patch on PERFORM (`window.__pbTree`),
// and `app.boot` applies AURACLE_CPU_THROTTLE and a reference profile
// (`SLOW_ENGINE` below; profile.js).
const { test } = require("@playwright/test");

const FLOOR_MS = process.env.CI ? 240_000 : 90_000;
const STEPS = 120;

// AURACLE_CPU_THROTTLE for the engine. Chrome's CPU throttling is for pages
// only: sent to the engine worker's target it answers "Operation is only
// supported for pages, not workers", and with the page throttled 4x a step
// measured 270 ms against 260 ms unthrottled. So the engine is slowed where
// its time goes, in its wasm calls: prefixed onto worker.js, this wraps every
// function the engine's wasm instance exports so that a call taking d ms
// then spins for (rate - 1) d more. A render, a step and a measurement take
// `rate` times as long; the page's protocol, its lanes and its order are
// untouched. AURACLE_CPU_THROTTLE and `slowEngine` slow the engine worker
// only; a reference profile (profile.js) prefixes it onto farm.js too, where
// the glue instantiates main's shared module and gets an Instance back.
//
// What it did is kept in the worker, so a spec can see that the wasm it timed
// ran through it, at its rate: `self.__slowEngine`, one entry per slowdown
// served ({ rate, instances, calls }: the instances it wrapped and the calls
// it slowed), a second one (a spec's own, after the fixture's) after the
// first. A page that holds the worker asks with `{ type: "__slow_engine" }`
// and is answered `{ type: "__slow_engine", slowed }`; no other message is
// touched (reference_profile.spec.js asks a farm worker it spawned).
const SLOW_ENGINE = (rate) => `(() => {
  const RATE = ${rate};
  const seen = { rate: RATE, instances: 0, calls: 0 };
  const all = (self.__slowEngine = self.__slowEngine || []);
  all.push(seen);
  if (all.length === 1) {
    self.addEventListener("message", (e) => {
      if (!e.data || e.data.type !== "__slow_engine") return;
      e.stopImmediatePropagation();
      self.postMessage({ type: "__slow_engine", slowed: all.map((s) => ({ ...s })) });
    });
  }
  const slow = (fn) => function (...args) {
    seen.calls++;
    const t = performance.now();
    const out = fn.apply(this, args);
    const until = performance.now() + (performance.now() - t) * (RATE - 1);
    while (performance.now() < until) {}
    return out;
  };
  const wrap = (inst) => {
    seen.instances++;
    const ex = {};
    for (const [k, v] of Object.entries(inst.exports)) ex[k] = typeof v === "function" ? slow(v) : v;
    const fake = Object.create(WebAssembly.Instance.prototype);
    Object.defineProperty(fake, "exports", { value: Object.freeze(ex) });
    return fake;
  };
  const wrapResult = (r) => (r instanceof WebAssembly.Instance ? wrap(r) : r && r.instance ? { module: r.module, instance: wrap(r.instance) } : r);
  const instantiate = WebAssembly.instantiate.bind(WebAssembly);
  WebAssembly.instantiate = (...a) => instantiate(...a).then(wrapResult);
  if (WebAssembly.instantiateStreaming) {
    const streaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
    WebAssembly.instantiateStreaming = (...a) => streaming(...a).then(wrapResult);
  }
})();
`;

// The spec-side request ids used here, clear of the page's (a counter from 1)
// and of the ones specs post themselves (9_000_000 and up).
let nextReq = 8_800_000;

/** One step of the engine here, now: the worst of `n` offers of one step
 *  (one render; the home patch is in the memo) from the patch on PERFORM.
 *  The worst, because a step can be answered from the memo in milliseconds.
 *  Asked in the `soon` lane, so background work gives way to it at its next
 *  render, and it waits at most for that. */
async function measureStep(page, n = 2) {
  let step = 0;
  for (let i = 0; i < n; i++) {
    const req = nextReq++;
    const took = await page.evaluate(
      ([r, limit]) =>
        new Promise((resolve) => {
          const w = window.__pbEngine;
          if (!w || !window.__pbTree) return resolve(null);
          const at = performance.now();
          const timer = setTimeout(() => resolve(null), limit);
          const on = (e) => {
            if (!e.data || e.data.type !== "perform_offered" || e.data.req !== r) return;
            w.removeEventListener("message", on);
            clearTimeout(timer);
            resolve(performance.now() - at);
          };
          w.addEventListener("message", on);
          w.postMessage({ type: "perform_offer", req: r, tree: window.__pbTree, overrides: [], locks: [], steps: 1 });
        }),
      [req, FLOOR_MS],
    );
    if (took == null) return null;
    step = Math.max(step, took);
  }
  return step;
}

/** How long to wait for an offer (or a drift) to grow here: the floor, or
 *  STEPS measured steps when that is longer. Call it with a patch on PERFORM
 *  (its controls reached), on a page booted with the fixture's tap. `waits`:
 *  how many such waits the test has left; its timeout grows by a budget for
 *  each. */
async function offerBudget(page, { waits = 0 } = {}) {
  const step = await measureStep(page);
  const ms = Math.round(Math.max(FLOOR_MS, step == null ? 0 : STEPS * step));
  const say = step == null ? "no step measured" : `one step ${step.toFixed(0)} ms`;
  console.log(`${say} here: an offer may take ${(ms / 1000).toFixed(0)} s`);
  if (waits > 0) test.setTimeout(test.info().timeout + waits * ms);
  return ms;
}

module.exports = { measureStep, offerBudget, FLOOR_MS, STEPS, SLOW_ENGINE };
