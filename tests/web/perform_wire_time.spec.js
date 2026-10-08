// A pool sound nobody has played, taken into PERFORM, plays its controls at
// once (#290): opened from the pool (which goes to PATCH), and once the rack
// holds it, PERFORM shown, until the app's own `perform-wired` mark for that
// sound, which says how it was wired ("predicted" from the knob table,
// "borrowed" from a measured relative, or "measured"). Every sound the engine
// could predict (its `first` on `bench_opening`) is played on its guess. Then
// the measurement PERFORM asked for, until its reply lands: the time a guess
// stands, by knob count.
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
// `perform-wired` mark for that sound, which says how it was wired. Whether
// the engine could predict it (the `first` its open carried), and whether
// PERFORM had wired it before. What the engine did meanwhile, from the
// `wirestat` posts.
async function take(page, app, at) {
  const row = page.locator("#bank-list .bank-item[data-id]").nth(at);
  const name = (await row.locator(".bi-name").textContent()).trim();
  await row.scrollIntoViewIfNeeded();
  const clicked = await app.now();
  const before = (await app.marks("perform-wired")).some((m) => m.detail?.name === name);
  // Opened at PATCH, then taken into PERFORM: a row opens its sound at the
  // level you're at.
  await app.level("patch");
  await row.click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: LIMIT_MS });
  const opening = (await app.replies("bench_opening", { after: clicked })).pop();
  const predicted = !!(opening && opening.first && opening.first.predicted);
  const since = await app.now();
  const r = await page.evaluate(async ([name, limit]) => {
    const t0 = performance.now();
    const wired = () => performance.getEntriesByName("auracle:perform-wired").find((e) => e.startTime >= t0 && e.detail?.name === name);
    document.querySelector('.rail-stop[data-level="perform"]').click();
    const said = document.querySelector(".pf-status")?.textContent || "";
    while (!wired() && performance.now() - t0 < limit) await new Promise((r) => setTimeout(r, 5));
    const mark = wired();
    return {
      at: t0,
      t0: t0 + performance.timeOrigin,
      tEnd: performance.now() - t0,
      tMark: mark ? mark.startTime - t0 : null,
      how: mark ? mark.detail.how : null,
      said,
    };
  }, [name, LIMIT_MS]);
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
    `${name}: ${knobs} knobs, ${reach} reach · PERFORM shown ("${r.said}") → wired (${r.how}) ${ms(r.tMark)}, measured ${ms(tMeasured)}\n  engine calls until measured: ${calls}`,
  );
  // What the page shows at the end of the window, and what passed between
  // the page and the engine meanwhile (WIRE_DEBUG=1).
  if (process.env.WIRE_DEBUG) {
    const log = (await app.log({ after: since })).filter((e) => e.type !== "wirestat");
    console.log(log.slice(0, 60).map((e) => `${Math.round(e.at - since)} ${e.type}${e.req != null ? ` req ${e.req}` : ""}${e.bg ? " bg" : ""}`).join("\n"));
  }
  if (r.tMark != null) app.budget(`${name} (${knobs} knobs, ×${SLOW || 1}): PERFORM shown → its controls play`, r.tMark, 100);
  await app.level("perform");
  return { name, knobs, reach, ms: r.tMark, how: r.how, predicted, before };
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
  expect(out.filter((t) => !t.how).map((t) => t.name), "PERFORM wired every sound taken").toEqual([]);
  // A sound PERFORM had not wired before, which the engine could predict, is
  // played on its guess, not on its measurement.
  const fresh = out.filter((t) => t.predicted && !t.before);
  expect(fresh.length, "a sound the engine could predict was taken").toBeGreaterThan(0);
  expect(fresh.filter((t) => !["predicted", "borrowed"].includes(t.how)).map((t) => `${t.name}: ${t.how}`)).toEqual([]);
});

// A sound playing on a guess whose measurement then fails keeps playing on
// it, and says it was never measured: "couldn't re-check" is for a wiring
// that was. The measurement is failed as the worker fails one it could not
// run (the tap's `fail`, set before PERFORM asks for it). And a guess is
// never kept as a measurement: once another sound's measurement lands and the
// kept wirings are written, none is a guess.
test("a sound playing on a guess whose measurement fails keeps playing, says it couldn't measure it, and is not kept", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.level("perform");
  await app.fullPool();
  await app.reached();
  await bankTab(page, "pool");
  // A pool row opened, and once the rack holds it, `prepare`, then PERFORM.
  const open = async (at, prepare = async () => {}) => {
    const row = page.locator("#bank-list .bank-item[data-id]").nth(at);
    const name = (await row.locator(".bi-name").textContent()).trim();
    // Opened at PATCH, then taken into PERFORM: a row opens its sound at the
    // level you're at.
    await app.level("patch");
    await row.click();
    await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }));
    const since = await app.now();
    await prepare();
    await app.level("perform");
    return since;
  };
  const since = await open(5, () => app.fail("perform_wire", { once: true }));
  const status = page.locator(".pf-status");
  // The measurement was asked for, and failed: no count, as a measured
  // wiring's would be, and nothing still listening.
  await expect.poll(async () => (await app.sent({ type: "perform_wire" }, { after: since })).length, { message: "the measurement was asked for" }).toBeGreaterThan(0);
  await expect(status).toHaveText("couldn’t measure this patch");
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
  // Opened at PATCH, then taken into PERFORM: a row opens its sound at the
  // level you're at.
  await app.level("patch");
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
    // Wired from the guess in the show's own task, as a rule; bounded, so a
    // sound that is never wired fails here and not at the test's timeout.
    while (!wired() && performance.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 2));
    return {
      how: wired()?.detail.how ?? "never wired",
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
  expect(shown.how, "PERFORM wired the sound from its prediction").toBe("predicted");
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

// A graft is judged on the grafted patch's measurement, never on a guess
// (#290's review): turned past the point of asking, a search control gives
// its patch the module it lacks (`perform_graft`), and the grafted tree is
// measured before PERFORM says whether the control now turns. A guess would
// answer first: a Space graft changes only the release, so the tree would
// borrow the wiring that could not reach Space, and every Space and Body
// graft said it didn't reach and grew an offer. On First Bass, Space then
// turns; on Acid Line, Body still cannot, and an offer grows. Each says so
// in its toast, and nothing is wired from a guess between the turn and it.
// A preset opened onto PERFORM, its re-check landed, and its search control
// `index` turned up past the point of asking: a graft. The toast mark and the
// page's clock at the turn.
async function turnPast(page, app, preset, index) {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform(preset);
  // Its shipped wiring re-checked: the panel is the preset's own measurement.
  await app.engine((timeout) => expect(page.locator(".pf-status")).not.toContainText("re-checking", { timeout }));
  const control = page.locator(`.pf-knob[data-index="${index}"]`);
  await expect(control, "a search control here").toHaveClass(/\bsearch\b/);
  const mark = await app.toastMark();
  const before = await app.now();
  const b = await control.boundingBox();
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 80, { steps: 10 });
  await page.mouse.up();
  return { mark, before };
}

// What a graft says: its toast, how each tree after the turn was wired, the
// offers and grafts asked for.
async function graftTurn(page, app, preset, index) {
  const { mark, before } = await turnPast(page, app, preset, index);
  const said = await app.engine((ms) => app.toast(VERDICT, { since: mark, timeout: ms }));
  const how = (await app.marks("perform-wired", { after: before })).map((m) => m.detail?.how);
  const offers = await app.sent({ type: "perform_offer", bg: false }, { after: before });
  const grafts = await app.sent({ type: "perform_graft" }, { after: before });
  return { said, how, offers: offers.length, grafts: grafts.length };
}

// A graft's verdict, as its toast says it.
const VERDICT = /now turns|didn.t reach it here|nothing to add here/;

test("a Space graft on First Bass is judged on its measurement: Space now turns", { tag: "@slow" }, async ({ page, app }) => {
  const r = await graftTurn(page, app, "First Bass", 5);
  expect(r.grafts, "the turn asked for a module").toBe(1);
  expect(r.said).toMatch(/^Space now turns /);
  expect(r.offers, "no offer grows in its place").toBe(0);
  expect(r.how, "the grafted tree was measured, and played on no guess").toEqual(["measured"]);
});

test("a Body graft on Acid Line is judged on its measurement: it still can't, and an offer grows", { tag: "@slow" }, async ({ page, app }) => {
  const r = await graftTurn(page, app, "Acid Line", 3);
  expect(r.grafts, "the turn asked for a module").toBe(1);
  expect(r.said).toMatch(/^Body: the .* didn.t reach it here/);
  expect(r.offers, "an offer grows instead").toBe(1);
  expect(r.how, "the grafted tree was measured, and played on no guess").toEqual(["measured"]);
});

// A hand on a control is never moved by the switch from a guess to the
// measurement (#290's Done when). A control of a predicted sound is turned
// and held still while the sound's measurement lands: nothing it shows moves
// while it is held, however long, and the measured wiring takes over only
// 1.5 s after it is let go. Read on the app's clock: the moment the
// pointer is released and the moment the control stops being a guess.
test("a control held still while its sound's measurement lands is not moved, and the switch waits for its release", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.level("perform");
  await app.fullPool();
  await app.reached();
  await bankTab(page, "pool");
  const row = page.locator("#bank-list .bank-item[data-id]").nth(5);
  const name = (await row.locator(".bi-name").textContent()).trim();
  // Opened at PATCH, then taken into PERFORM: a row opens its sound at the
  // level you're at.
  await app.level("patch");
  await row.click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }));
  const since = await app.now();
  await app.level("perform");
  const control = page.locator(".pf-knob.guess").first();
  await expect(control, "a control plays on the prediction").toBeAttached();
  const index = await control.getAttribute("data-index");
  const held = page.locator(`.pf-knob[data-index="${index}"]`);
  // On the page: when it stops being a guess, and the pointer's release.
  await held.evaluate((k) => {
    window.__switch = { settled: null, released: null, valueAtRelease: null };
    new MutationObserver(() => {
      if (window.__switch.settled == null && !k.classList.contains("guess")) window.__switch.settled = performance.now();
    }).observe(k, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("pointerup", () => {
      window.__switch.released = performance.now();
      window.__switch.valueAtRelease = k.getAttribute("aria-valuenow");
    }, { capture: true, once: true });
  });
  const asked = (await app.sent({ type: "perform_wire" }, { after: since })).pop();
  const b = await held.boundingBox();
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 30, { steps: 5 });
  const turned = await held.getAttribute("aria-valuenow");
  expect(Number(turned), "the hand turned it").not.toBe(0);
  // Held still while the measurement lands, and for longer than the 1.5 s a
  // let-go control waits.
  await app.replyTo(asked);
  await app.quiet();
  await expect(held, "still a guess under the hand").toHaveClass(/\bguess\b/);
  await expect(held).toHaveAttribute("aria-valuenow", turned);
  await page.mouse.up();
  await expect(page.locator(".pf-knob.guess"), "the measurement takes over once the hand is off").toHaveCount(0);
  const at = await page.evaluate(() => window.__switch);
  expect(at.valueAtRelease, "nothing moved under the hand").toBe(turned);
  expect(at.settled, "it settled after the release").toBeGreaterThan(at.released);
  expect(at.settled - at.released, "1.5 s after the release, not after the last move").toBeGreaterThanOrEqual(1500);
});

// A Take of an offer grown from a sound playing on a guess carries the guess
// over as a guess (#290's review): the controls keep turning the knobs the
// taken sound still has, and they say they are not measured yet, with no
// count on the status line, until the taken sound's own measurement lands.
// Both measurements are kept from the engine (the tap's `stall`), so the
// carried state stands while it is read.
test("a Take from a sound on a guess carries the guess over as a guess", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(240_000);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.level("perform");
  await app.fullPool();
  await app.reached();
  await bankTab(page, "pool");
  const row = page.locator("#bank-list .bank-item[data-id]").nth(5);
  const name = (await row.locator(".bi-name").textContent()).trim();
  // Opened at PATCH, then taken into PERFORM: a row opens its sound at the
  // level you're at.
  await app.level("patch");
  await row.click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }));
  // The guess's measurement never reaches the engine: the sound stays on it.
  await app.stall("perform_wire");
  await app.level("perform");
  await app.stalled();
  await expect(page.locator(".pf-knob.guess").first(), "it plays on its guess").toBeAttached();
  await page.locator(".pf-pad", { hasText: /^(Offer|Next)$/ }).click();
  await app.engine((timeout) => expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout }));
  // The taken sound's measurement is kept too.
  await app.stall("perform_wire");
  const takenAt = await app.now();
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  await app.engine((timeout) => expect.poll(async () => (await app.sent({ type: "perform_wire" }, { after: takenAt })).length, { timeout, message: "the taken sound's measurement was asked for" }).toBeGreaterThan(0));
  await expect(page.locator(".pf-knob.guess").first(), "carried over as a guess").toBeAttached();
  await expect(page.locator(".pf-knob.guess").first()).toHaveAttribute("aria-description", "not measured yet");
  await expect(page.locator(".pf-status"), "no count before the measurement").toHaveText(/^listening( to [^·]+)?…$/);
});

// A graft is bound to its own tree (#366): another sound opened while a graft
// waits to be judged plays its guess at once, and the graft is not judged on
// it. Bound to a time instead (30 s from the turn), the other sound skipped
// its guess and waited for its whole measurement, and the graft was judged on
// it: "Space now turns …" on a sound nobody grafted, its Space set to half a
// turn with no hand on it. First Bass's Space is turned past asking; once the
// grafted tree is in PERFORM, its measurement asked for, a pool sound is
// opened and shown. Its wiring is a guess, no verdict is said, no offer
// grows, and none comes when that sound's measurement lands either.
test("a sound opened while a graft waits plays its guess, and the graft is not judged on it", { tag: "@slow" }, async ({ page, app }) => {
  const { mark, before } = await turnPast(page, app, "First Bass", 5);
  await app.engine((timeout) => expect.poll(async () => (await app.sent({ type: "perform_wire" }, { after: before })).length, { timeout, message: "the grafted tree's measurement was asked for" }).toBeGreaterThan(0));
  await bankTab(page, "pool");
  const row = page.locator("#bank-list .bank-item[data-id]").nth(5);
  const name = (await row.locator(".bi-name").textContent()).trim();
  // Opened at PATCH, then taken into PERFORM: a row opens its sound at the
  // level you're at.
  await app.level("patch");
  await row.click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }));
  const shown = await app.now();
  await app.level("perform");
  // Wired: an engine wait, so a sound that waits for its measurement reaches
  // the assertions below and says how it was wired.
  const wiredMark = () => app.marks("perform-wired", { after: shown }).then((ms) => ms.find((m) => m.detail?.name === name));
  await app.engine((timeout) => expect.poll(wiredMark, { timeout, message: `${name} is wired` }).toBeTruthy());
  const how = (await wiredMark()).detail.how;
  // Its measurement lands, and still no verdict: the graft is not judged on it.
  const asked = (await app.sent({ type: "perform_wire" }, { after: shown })).pop();
  await app.replyTo(asked);
  await app.quiet();
  expect((await app.toasts(mark)).filter((t) => VERDICT.test(t)), "no verdict on a sound nobody grafted").toEqual([]);
  expect(["predicted", "borrowed"], `${name} plays its guess, wired ${how}`).toContain(how);
  expect(await app.sent({ type: "perform_offer", bg: false }, { after: before }), "no offer grows").toEqual([]);
});
