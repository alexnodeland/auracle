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

// A sound playing on a guess whose measurement then fails keeps playing on
// it, and says it was never measured: "couldn't re-check" is for a wiring
// that was. The engine's failure is handed to main (the tap's engine_error,
// as the worker sends one it could not run) while the measurement is still
// out. And a guess is never kept as a measurement: once another sound's
// measurement lands and the kept wirings are written, none is a guess.
test("a sound playing on a guess whose measurement fails keeps playing, says it couldn't measure it, and is not kept", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.level("perform");
  await app.fullPool();
  await app.reached();
  await bankTab(page, "pool");
  const open = async (at) => {
    const row = page.locator("#bank-list .bank-item[data-id]").nth(at);
    const name = (await row.locator(".bi-name").textContent()).trim();
    await row.click();
    await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }));
    const since = await app.now();
    await app.level("perform");
    return since;
  };
  const since = await open(5);
  const status = page.locator(".pf-status");
  // Listening, and naming the controls the gate left out to the measurement.
  await expect(status, "it plays on a guess while it is measured").toHaveText(/controls reach this patch · listening( to [^·]+)?…$/);
  await expect(page.locator(".pf-knob.guess").first(), "drawn as a guess").toBeAttached();
  const asked = (await app.sent({ type: "perform_wire" }, { after: since })).pop();
  await app.inject({ type: "engine_error", request: "perform_wire", id: null, req: asked.req, message: "RuntimeError: injected for the test" });
  await expect(status).toHaveText(/controls reach this patch · couldn’t measure this patch$/);
  await expect(page.locator(".pf-knob.waiting"), "no control still says listening…").toHaveCount(0);
  await expect(page.locator(".pf-knob.guess").first(), "still playing on its guess").toBeAttached();
  // Another sound, measured: its measurement is kept (written 1.5 s after it
  // lands), and the guess that was never measured is not.
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem("auracle-perform-wirings") || "[]"));
  const before = (await kept()).length;
  const next = await open(6);
  const measured = (await app.sent({ type: "perform_wire" }, { after: next })).pop();
  await app.replyTo(measured);
  await expect.poll(async () => (await kept()).length, { message: "its measurement is kept" }).toBeGreaterThan(before);
  expect((await kept()).filter(([, v]) => v && v.guess), "no guess among the kept wirings").toEqual([]);
});

// The prediction plays only the controls its gate passes (the engine's
// `wire_predicted`, `KnobTable::passes`): on a pool sound nobody has played,
// the controls the engine's `first` wired turn at once and say they are not
// measured yet (in the tooltip and to a screen reader), and every other
// control on the panel waits for the measurement, saying listening…. When the
// measurement lands, none is a guess any more. Which controls pass is the
// shipped table's (`shipped_wirings.rs` pins them); this is the page's half.
test("a predicted panel plays the controls the gate passes and listens on the rest", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.level("perform");
  await app.fullPool();
  await app.reached();
  await bankTab(page, "pool");
  const row = page.locator("#bank-list .bank-item[data-id]").nth(5);
  const name = (await row.locator(".bi-name").textContent()).trim();
  const since = await app.now();
  await row.click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }));
  // What the engine said it could play this sound on: the gate's controls.
  const opening = (await app.replies("bench_opening", { after: since })).pop();
  const predicted = opening.first.predicted.wiring.map((w) => w.index).sort((a, b) => a - b);
  // PERFORM shown, and the panel read in the task its wiring is marked in.
  const shown = await page.evaluate(async (name) => {
    const t0 = performance.now();
    document.querySelector('.rail-stop[data-level="perform"]').click();
    const wired = () => performance.getEntriesByName("auracle:perform-wired").find((e) => e.startTime >= t0 && e.detail?.name === name);
    while (!wired()) await new Promise((r) => setTimeout(r, 2));
    return {
      how: wired().detail.how,
      knobs: [...document.querySelectorAll(".pf-knob[data-index]")].map((k) => ({
        index: Number(k.dataset.index),
        guess: k.classList.contains("guess"),
        unwired: k.classList.contains("unwired"),
        waiting: k.querySelector(".pf-k-wait").textContent,
        title: k.title,
        said: k.getAttribute("aria-description"),
      })),
    };
  }, name);
  expect(shown.how).toBe("predicted");
  const turning = shown.knobs.filter((k) => k.guess);
  const listening = shown.knobs.filter((k) => !k.guess);
  expect(turning.map((k) => k.index).sort((a, b) => a - b), "the gate's controls turn, and only they").toEqual(predicted);
  expect(turning.length, "some control plays on the prediction").toBeGreaterThan(0);
  expect(listening.length, "some control waits for the measurement").toBeGreaterThan(0);
  for (const k of turning) {
    expect(k.unwired, `${k.index} turns`).toBe(false);
    expect(k.title, `${k.index}'s tooltip`).toContain("not measured yet");
    expect(k.said, `${k.index} to a screen reader`).toBe("not measured yet");
  }
  for (const k of listening) {
    expect(k.unwired, `${k.index} turns nothing`).toBe(true);
    expect(k.waiting, `${k.index} says it is waiting`).toBe("listening…");
  }
  // The measurement lands: nothing is a guess, and nothing says so.
  const asked = (await app.sent({ type: "perform_wire" }, { after: since })).pop();
  await app.replyTo(asked);
  await expect(page.locator(".pf-knob.guess")).toHaveCount(0);
  await expect(page.locator('.pf-knob[aria-description="not measured yet"]')).toHaveCount(0);
  await expect(page.locator(".pf-knob[data-index]").first()).not.toHaveAttribute("title", /not measured yet/);
});
