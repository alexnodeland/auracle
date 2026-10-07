// A pool sound nobody has played, taken into PERFORM, plays its controls at
// once (#290): opened from the pool (which goes to PATCH), and once the rack
// holds it, PERFORM shown, until the app's own `perform-wired` mark for that
// sound, which says how it was wired ("predicted" from the knob table,
// "borrowed" from a measured relative, or "measured"), and the page showing
// it ("controls reach", none of the six unwired). Then the measurement PERFORM
// asked for, until its reply lands: the time a guess stands, by knob count.
//
// PERFORM shown → its controls play is a budget, 100 ms (ADR-022): before
// #290 it was the whole first measurement, 3 to 53 s at this machine's own
// speed on these three sounds (a 16-core M3 Max under load) and 11 to 188 s
// with the engine slowed four times. WIRE_SLOW slows the engine's wasm that
// many times (the fixture's `slowEngine`; AURACLE_CPU_THROTTLE does it too),
// WIRE_TAKES how many pool sounds, WIRE_LIMIT_MS the longest wait for one,
// WIRE_DEBUG=1 prints what passed between the page and the engine.
//
// The engine worker is instrumented ahead of worker.js (`workerPrefix`):
// every call into the wasm that takes over 5 ms is posted to main as a
// `wirestat` message (its export, when it started and how long it took), so
// the run says what the worker did until the measurement landed.
const { test, expect, PERFORM_SEED, bankTab } = require("./fixtures");

const SLOW = Number(process.env.WIRE_SLOW || 0);
const TAKES = Number(process.env.WIRE_TAKES || 3);
const LIMIT_MS = Number(process.env.WIRE_LIMIT_MS || 300_000);

const STATS = `(() => {
  const keep = (name, fn) => function (...args) {
    const t = performance.now();
    const out = fn.apply(this, args);
    const ms = performance.now() - t;
    if (ms > 5) self.postMessage({ type: "wirestat", fn: name.replace(/^wasmengine_/, ""), at: t + performance.timeOrigin, ms });
    return out;
  };
  const wrap = (inst) => {
    const ex = {};
    for (const [k, v] of Object.entries(inst.exports)) ex[k] = typeof v === "function" ? keep(k, v) : v;
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

// One take: the pool row at `at` opened (which goes to PATCH), and once the
// rack holds it, PERFORM shown, until its controls play: the app's own
// `perform-wired` mark for that sound, which says how it was wired, and the
// page showing it ("controls reach", none of the six unwired). What the
// engine did meanwhile, from the `wirestat` posts.
async function take(page, app, at) {
  const row = page.locator("#bank-list .bank-item[data-id]").nth(at);
  const name = (await row.locator(".bi-name").textContent()).trim();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: LIMIT_MS });
  const since = await app.now();
  const r = await app.engine(
    () =>
      page.evaluate(async ([name, limit]) => {
        const live = () =>
          document.querySelector(".pf-name")?.textContent === name &&
          /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
          ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired"));
        const t0 = performance.now();
        const wired = () => performance.getEntriesByName("auracle:perform-wired").find((e) => e.startTime >= t0 && e.detail?.name === name);
        document.querySelector('.rail-stop[data-level="perform"]').click();
        const said = document.querySelector(".pf-status")?.textContent || "";
        let tLive = null;
        while (performance.now() - t0 < limit && !(wired() && tLive != null)) {
          if (tLive == null && live()) tLive = performance.now() - t0;
          await new Promise((r) => setTimeout(r, 5));
        }
        const mark = wired();
        return {
          at: t0,
          t0: t0 + performance.timeOrigin,
          tEnd: performance.now() - t0,
          tMark: mark ? mark.startTime - t0 : null,
          how: mark ? mark.detail.how : null,
          tLive,
          said,
        };
      }, [name, LIMIT_MS]),
    { ms: LIMIT_MS + 60_000 },
  );
  // The measurement PERFORM asked for, and when its reply landed: at once
  // for a sound measured before, in the background behind a guess.
  const asked = (await app.sent({ type: "perform_wire" }, { after: since })).pop();
  const wired = asked ? await app.replyTo(asked, { timeout: LIMIT_MS }) : null;
  const tMeasured = wired ? wired._at - r.at : null;
  const end = r.t0 + Math.max(r.tEnd, tMeasured ?? 0);
  const stats = (await app.replies("wirestat", { after: since })).filter((s) => s.at >= r.t0 && s.at <= end);
  const by = {};
  for (const s of stats) {
    by[s.fn] = by[s.fn] || { n: 0, ms: 0 };
    by[s.fn].n += 1;
    by[s.fn].ms += s.ms;
  }
  const knobs = wired && wired.data ? wired.data.addrs.length : null;
  const reach = wired && wired.data ? wired.data.wiring.filter((w) => !w.search).length : null;
  const calls = Object.entries(by)
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([f, v]) => `${f} ${v.n}× ${Math.round(v.ms)} ms`)
    .join(", ");
  const ms = (t) => (t == null ? "never" : `${Math.round(t)} ms`);
  console.log(
    `${name}: ${knobs} knobs, ${reach} reach · PERFORM shown ("${r.said}") → wired (${r.how}) ${ms(r.tMark)}, controls live ${ms(r.tLive)}, measured ${ms(tMeasured)}\n  engine calls until measured: ${calls}`,
  );
  // What the page shows at the end of the window, and what passed between
  // the page and the engine meanwhile (WIRE_DEBUG=1).
  if (process.env.WIRE_DEBUG) {
    const log = (await app.log({ after: since })).filter((e) => e.type !== "wirestat");
    console.log(log.slice(0, 60).map((e) => `${Math.round(e.at - since)} ${e.type}${e.req != null ? ` req ${e.req}` : ""}${e.bg ? " bg" : ""}`).join("\n"));
  }
  if (r.tMark != null) app.budget(`${name} (${knobs} knobs, ×${SLOW || 1}): PERFORM shown → its controls play`, r.tMark, 100);
  await app.level("perform");
  return { name, knobs, reach, ms: r.tMark, how: r.how };
}

test("a pool sound's controls play soon after it is taken into PERFORM", { tag: "@slow" }, async ({ page, app }) => {
  // Three sounds measured behind their guesses: up to a minute each at this
  // machine's speed, longer slowed.
  test.setTimeout(900_000);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED, slowEngine: SLOW, workerPrefix: STATS });
  await app.level("perform");
  await app.fullPool();
  await app.reached();
  await bankTab(page, "pool");
  const n = await page.locator("#bank-list .bank-item[data-id]").count();
  const picks = [...new Set(Array.from({ length: TAKES }, (_, i) => Math.round(((i + 0.5) * n) / TAKES)))];
  const out = [];
  for (const at of picks) out.push(await take(page, app, at));
  expect(out.filter((t) => t.how).length).toBeGreaterThan(0);
});
