// PERFORM says what is true, and a gesture on a control does what its look
// says it will.
//
// Pinned in a real browser against the real engine, on Glass Pad, whose
// measured wiring is deterministic: Bright turns both ways, some controls turn
// only one way (half-closed) and some are search controls.
//
// - A half-closed control's ring is drawn on the side it turns toward (it was
//   drawn on the closed side), with a stop at 12 o'clock, and its caption says
//   what the player can do ("turns toward far only"), not where the app
//   guessed the sound sits.
// - A control not measured yet is "listening…": never the search look (its
//   ring stays neutral; only its waiting sign is amber, while a measurement is
//   out), no strike-through on the XY pad, and a turn of it springs back
//   without grafting a module or growing an offer.
// - Choosing an XY axis gives the note keys back.
// - A search control springs back whenever it is let go, and says while it is
//   turned what letting go would do.
// - After a pass, Blend comes home.
// - A stalled fetch of the shipped wirings does not hold a patch on
//   "listening…": after a few seconds it is measured as any other patch is.
// - A drift is not a new patch: the status never says "listening", and the
//   re-measure after it waits in the engine's background lane.
// - A measurement the engine never answers (it threw before it could, or it
//   is down: `engine_error`, naming the request by `req`) is let go: the
//   status stops saying "re-checking" or "listening…" and says it couldn't,
//   and the engine's own error is still its toast or its alarm. After a
//   crash PERFORM asks the engine nothing more: no spare grows by itself,
//   and an Offer says the engine crashed. A turn whose module the engine
//   failed to add says so, and grows no offer in its place (it said there
//   was "nothing to add here"). An offer whose own walk crashed the engine
//   says the engine crashed, even when its failure was answered before the
//   crash was. The errors are injected through the fixture's tap
//   (`app.inject`, `app.fail`), dispatched on the worker as the worker posts
//   them, because the shipped engine answers every measurement it runs and
//   cannot be made to trap.
//
// What PERFORM asks the engine for is read through the tap too.
const { test, expect, PERFORM_SEED } = require("./fixtures");

// PERFORM's requests to the engine (worker.js's perform_* types): what a
// poisoned engine answers with a fatal `engine_error`, never running them.
const PERFORM_REQUESTS = ["perform_wire", "perform_offer", "perform_drift", "perform_graft", "perform_record", "perform_apply"];

// `shipped: false` blocks the presets' shipped wirings, so a preset is
// measured as a patch never seen before is: the only way to watch a
// measurement in progress on a known patch.
// `stalled: true` holds the file's fetch open for good, as a stuck connection
// does. `slow`: the engine worker's wasm calls slowed that many times
// (`app.boot`'s `slowEngine`), so a measurement is still out when the test
// acts on it (AURACLE_CPU_THROTTLE takes over when it is larger). `seen`:
// the first-visit tours (the keybed coach among them) marked seen.
async function boot(page, app, { shipped = true, stalled = false, slow = 0, seen = true } = {}) {
  if (!shipped) await page.route("**/perform-wirings.json*", (r) => r.abort());
  if (stalled) await page.route("**/perform-wirings.json*", () => {});
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED, slowEngine: slow, seen });
}

/** Drag a knob vertically by `dy` px (negative is up), and let go. */
async function drag(page, loc, dy, { hold } = {}) {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 10 });
  if (hold) await hold();
  await page.mouse.up();
}

test("a half-closed control draws its ring on the side it turns toward, and says so", async ({ page, app }) => {
  await boot(page, app);
  await app.openOnPerform("Glass Pad", { wired: true });

  const halves = await page.evaluate(() =>
    [...document.querySelectorAll(".pf-knob.half-lo, .pf-knob.half-hi")].map((k) => {
      const ends = (p) => {
        const n = (p.getAttribute("d") || "").match(/-?\d+(\.\d+)?/g).map(Number);
        return [[n[0], n[1]], [n[n.length - 2], n[n.length - 1]]];
      };
      const lo = k.querySelector(".pf-k-lo");
      const hi = k.querySelector(".pf-k-hi");
      const up = k.classList.contains("half-lo"); // the low half is closed: it turns up
      const open = up ? hi : lo;
      const closed = up ? lo : hi;
      return {
        name: k.querySelector(".pf-k-name").textContent,
        up,
        words: k.querySelector(".pf-k-ends").textContent.split(" · "),
        sub: k.querySelector(".pf-k-sub").textContent,
        openCls: open.getAttribute("class"),
        closedCls: closed.getAttribute("class"),
        openEnds: ends(open),
        openDash: getComputedStyle(open).strokeDasharray,
        openWidth: parseFloat(getComputedStyle(open).strokeWidth),
        closedDash: getComputedStyle(closed).strokeDasharray,
        closedWidth: parseFloat(getComputedStyle(closed).strokeWidth),
        stop: getComputedStyle(k.querySelector(".pf-k-stop")).display,
        dot: k.querySelector(".pf-k-where title")?.textContent || "",
        valuetext: k.getAttribute("aria-valuetext"),
      };
    }),
  );
  expect(halves.length, "Glass Pad has a half-closed control").toBeGreaterThan(0);
  for (const h of halves) {
    // The open half runs from 12 o'clock (0, -44) toward the side it turns.
    expect(h.openCls, h.name).toContain("open");
    expect(h.closedCls, h.name).toContain("closed");
    const xs = h.openEnds.map(([x]) => x);
    if (h.up) expect(Math.min(...xs), `${h.name}: open ring on the right`).toBeGreaterThan(-0.5);
    else expect(Math.max(...xs), `${h.name}: open ring on the left`).toBeLessThan(0.5);
    expect(h.openEnds.some(([x, y]) => Math.abs(x) < 0.5 && y < -40), `${h.name}: open half starts at the stop`).toBe(true);
    // Solid and wide on the open side, a dotted hairline on the closed one.
    expect(h.openDash, h.name).toBe("none");
    expect(h.closedDash, h.name).not.toBe("none");
    expect(h.openWidth).toBeGreaterThan(h.closedWidth);
    expect(h.stop, `${h.name}: a stop at 12 o'clock`).not.toBe("none");
    // The caption says what the player can do, in the open end's word.
    expect(h.sub, h.name).toBe(`turns toward ${h.up ? h.words[1] : h.words[0]} only`);
    expect(h.dot, `${h.name}: the amber dot says what it is`).toMatch(/where this sound measures on/);
    expect(h.valuetext).toBe("center");
  }

  // Driven into its stop, the pointer bumps (and the dial stays at centre).
  const half = page.locator(".pf-knob.half-lo, .pf-knob.half-hi").first();
  const up = halves[0].up;
  await page.evaluate(() => {
    window.__bumps = 0;
    const k = document.querySelector(".pf-knob.half-lo, .pf-knob.half-hi");
    new MutationObserver(() => {
      if (/\bbump-(lo|hi)\b/.test(k.className)) window.__bumps += 1;
    }).observe(k, { attributes: true, attributeFilter: ["class"] });
  });
  await drag(page, half, up ? 90 : -90);
  expect(await half.getAttribute("aria-valuenow")).toBe("0.00");
  expect(await page.evaluate(() => window.__bumps), "the stop was felt").toBeGreaterThan(0);
});

test("a control still being listened to does nothing, and never looks or acts like a search control", async ({ page, app }) => {
  await boot(page, app, { shipped: false });
  await app.openOnPerform("Glass Pad", { reach: false });
  // A fresh profile has no wiring cached: the first measurement takes seconds.
  await app.engine((timeout) => expect(page.locator(".pf-status")).toContainText("listening to this sound", { timeout }), { ms: 30_000 });
  expect(await page.locator(".pf-status").textContent()).not.toMatch(/measuring/);

  const look = await page.evaluate(() => {
    const ks = [0, 1, 2, 3, 4, 5].map((i) => document.querySelector(`.pf-knob[data-i="${i}"]`));
    const field = document.querySelector(".pf-xy-field");
    return {
      subs: ks.map((k) => k.querySelector(".pf-k-sub").textContent),
      pending: ks.every((k) => k.classList.contains("pending")),
      search: ks.some((k) => k.classList.contains("search")),
      dead: /\bdead-[xy]\b/.test(field.className),
      struck: [...field.querySelectorAll(".pf-xy-l, .pf-xy-r, .pf-xy-t, .pf-xy-b")].some((e) => getComputedStyle(e).textDecorationLine.includes("line-through")),
      note: field.querySelector(".pf-xy-note").textContent,
    };
  });
  expect(look.subs).toEqual(Array(6).fill("listening…"));
  expect(look.pending).toBe(true);
  expect(look.search, "no amber search look while listening").toBe(false);
  expect(look.dead, "no dead XY axis while listening").toBe(false);
  expect(look.struck, "no struck-through XY words while listening").toBe(false);
  expect(look.note).toBe("listening to this sound…");

  // Turn Grit hard (a search control on Glass Pad, once measured) and let go.
  const grit = page.locator('.pf-knob[data-i="4"]');
  const before = await app.now();
  await drag(page, grit, -120);
  expect(await page.locator(".pf-status").textContent(), "still listening when it was turned").toContain("listening to this sound");
  await expect(grit).toHaveAttribute("aria-valuenow", "0.00");
  await app.quiet();
  const asked = [...(await app.sent({ type: "perform_graft" }, { after: before })), ...(await app.sent({ type: "perform_offer", bg: false }, { after: before }))];
  expect(asked, "a turn while listening grafts nothing and grows no offer").toEqual([]);
  expect(await page.locator("#toasts").textContent()).not.toMatch(/growing an offer|giving it a/);
});

test("first steps name a control that turns on this patch, and speak alone", async ({ page, app }) => {
  // A newcomer: the keybed coach not yet retired by a first note.
  await boot(page, app, { seen: false });
  // A newcomer, at PERFORM, where the app opens: step 1 says what the keybed
  // coach would, so the coach keeps quiet. In PATCH it is up until the first
  // note.
  await expect(page.locator("#guide .pf-steps")).toBeVisible();
  await expect(page.locator(".coach")).toBeHidden();
  await app.level("patch");
  await expect(page.locator(".coach")).toBeVisible();
  await app.openOnPerform("Glass Pad", { reach: false });
  await expect(page.locator("#guide .pf-steps")).toBeVisible();
  // One voice per lesson: step 1 says what the coach says.
  await expect(page.locator(".coach")).toBeHidden();
  await app.reached({ wired: true });
  // Back in PATCH the coach speaks again (until the first note).
  await app.level("patch");
  await expect(page.locator(".coach")).toBeVisible();
  await app.level("perform");
  // The pill shows one step at a time: a note played, step 2 is next (and
  // the note retires the coach for good).
  await expect(page.locator("#guide .pf-step.now")).toContainText("Play a key");
  await page.keyboard.press("a");
  await expect(page.locator("#guide .pf-step.now")).toContainText(/^Turn /);
  const step2 = (await page.locator("#guide .pf-step.now").textContent()).trim();
  const m = step2.match(/Turn ([A-Z]+): drag (up or down|up|down)$/);
  expect(m, step2).not.toBeNull();
  const k = page.locator(".pf-knob", { has: page.locator(".pf-k-name", { hasText: new RegExp(`^${m[1]}$`, "i") }) });
  await expect(k).toHaveCount(1);
  const cls = await k.getAttribute("class");
  expect(cls, `${m[1]} turns on this patch`).not.toMatch(/\b(search|pending|unwired)\b/);
  if (m[2] === "up or down") expect(cls).not.toMatch(/\bhalf-(lo|hi)\b/);
});

test("choosing an XY axis gives the note keys back", async ({ page, app }) => {
  await boot(page, app);
  await app.openOnPerform("Glass Pad", { reach: false });
  await page.locator(".pf-xy-btn").click();
  const ysel = page.locator(".pf-xy-head select").nth(1);
  // As a click does: the select has focus when the choice is made.
  await ysel.focus();
  await ysel.selectOption("5");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("SELECT");
  // `a` plays middle C and lights its key; `s` is a note too, and must not
  // type-ahead the axis to Snap or Space.
  await page.keyboard.down("a");
  await expect(page.locator('.pkey[data-note="60"]')).toHaveClass(/\bdown\b/);
  await page.keyboard.up("a");
  await page.keyboard.press("s");
  expect(await ysel.inputValue()).toBe("5");
});

test("a search control springs back when let go, and says what letting go will do", async ({ page, app }) => {
  await boot(page, app);
  await app.openOnPerform("Glass Pad", { wired: true });
  const grit = page.locator('.pf-knob[data-i="4"]');
  await expect(grit, "Grit is a search control on Glass Pad").toHaveClass(/\bsearch\b/);
  const sub = grit.locator(".pf-k-sub");
  const notch = grit.locator(".pf-k-notch");

  // A nudge: short of the notch, it asks nothing and springs back.
  let during = "";
  let notchShown = "";
  await drag(page, grit, -25, {
    hold: async () => {
      during = await sub.textContent();
      notchShown = await notch.evaluate((e) => getComputedStyle(e).display);
    },
  });
  expect(during).toBe("turn further to ask");
  expect(notchShown).not.toBe("none");
  await expect(grit).toHaveAttribute("aria-valuenow", "0.00");
  await expect(sub).toHaveText("turn to ask for it");
  expect(await page.locator("#toasts").textContent()).not.toMatch(/growing an offer/);

  // Past it: the caption says what letting go asks for, and letting go asks.
  await drag(page, grit, -90, { hold: async () => { during = await sub.textContent(); } });
  expect(during).toBe("let go to ask for rough");
  await expect(grit).toHaveAttribute("aria-valuenow", "0.00");
  // A refusal answering the turn: it takes the lane at once, ahead of the
  // preset's own arrival toasts still queued.
  await expect(page.locator("#toasts")).toContainText("growing a grittier offer instead", { timeout: 5_000 });
});

test("after a pass, Blend comes home", async ({ page, app }) => {
  await boot(page, app);
  await app.openOnPerform("Glass Pad", { wired: true });
  const OFFER_MS = await app.offerBudget({ waits: 1 });
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  // Blend, the slider under the two faces, toward B.
  const blend = page.locator('.pf-blend[data-i="6"] input');
  await blend.focus();
  await page.keyboard.press("End");
  expect(Number(await blend.getAttribute("aria-valuenow"))).toBeGreaterThan(0.5);
  // NEXT (Offer, while B holds one) is a pass: B empties, and Blend glides
  // home.
  await expect(page.locator(".pf-pad.primary")).toHaveText("Next");
  await page.locator(".pf-pad", { hasText: "Next" }).click();
  await expect(blend).toHaveAttribute("aria-valuenow", "0.00", { timeout: 2_000 });
  await expect(page.locator('.pf-blend[data-i="6"] .pf-blend-v')).toHaveText(/^(no offer yet|0% offer)$/);
});

test("a drift is not a new patch: the status never says listening, and its re-check waits in the background", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(100_000); // about 38 to 45 s on CI: a drift behind the shipped wiring's re-check
  await boot(page, app);
  await app.openOnPerform("Glass Pad", { wired: true });
  // A drift waits behind the shipped wiring's background re-check, then
  // walks twelve renders: engine growth, bounded by the budget.
  const DRIFT_MS = await app.offerBudget({ waits: 1 });
  // Every status line from here on.
  await page.evaluate(() => {
    const s = document.querySelector(".pf-status");
    window.__statuses = [s.textContent];
    new MutationObserver(() => window.__statuses.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true });
    // Wander says what it is doing under its own name.
    const w = document.querySelector('.pf-knob[data-i="7"] .pf-k-sub');
    window.__wander = [w.textContent];
    new MutationObserver(() => window.__wander.push(w.textContent)).observe(w, { childList: true, characterData: true, subtree: true });
  });
  const from = await app.now();
  // Wander all the way to roam, from the keyboard.
  const wander = page.locator('.pf-knob[data-i="7"]');
  await wander.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowUp");
  await expect(wander.locator(".pf-k-sub")).toHaveText(/^roam/);
  await page.evaluate(() => document.activeElement?.blur()); // off the dial, hands off
  // A drift arrives and glides.
  await page.waitForFunction(() => window.__wander.some((t) => /gliding/.test(t)), null, { timeout: DRIFT_MS });
  // …and finishes: the glide (3 s at most in roam) lands, and what follows
  // it (the re-check, the status) has its window.
  await expect(wander.locator(".pf-k-sub")).not.toHaveText(/gliding/);
  await app.quiet();
  const seen = await page.evaluate(() => window.__statuses);
  expect(seen.filter((t) => /listening|measuring/.test(t)), "the dials never went back to waiting").toEqual([]);
  expect(await page.locator(".pf-name").textContent(), "the drift did not arrive as a new patch").toBe("Glass Pad");
  const wires = (await app.sent({ type: "perform_wire" }, { after: from })).map((m) => ({ bg: !!m.bg }));
  for (const w of wires) expect(w.bg, "a re-check after a drift is background work").toBe(true);
  if (wires.length) expect(seen.some((t) => /re-checking/.test(t)), "a re-check says so").toBe(true);
  // Keep: the sound did not move, so there is nothing to measure in front of
  // the player's next request.
  const k0 = await app.now();
  await wander.focus();
  await page.keyboard.press("Home"); // Wander still
  await page.locator(".pf-moved .pf-keep").click();
  await expect(page.locator("#toasts")).toContainText("Kept: this is home now. Back returns here.", { timeout: 10_000 });
  await app.quiet();
  const afterKeep = await app.sent({ type: "perform_wire", bg: false }, { after: k0 });
  expect(afterKeep, "Keep never re-measures in front of the player").toEqual([]);
});

test("a shipped-wirings fetch that never answers does not hold a patch on listening", async ({ page, app }) => {
  await boot(page, app, { stalled: true });
  const t0 = Date.now();
  await app.openOnPerform("Glass Pad", { wired: true });
  console.log(`Glass Pad wired with the file stalled: ${((Date.now() - t0) / 1000).toFixed(1)} s after its click`);
  const how = await page.evaluate(() => window.__aur.marks().filter((m) => m.name === "perform-wired").map((m) => m.detail && m.detail.how));
  expect(how).toContain("measured");
  expect(await app.sentCount("perform_wire")).toBeGreaterThan(0);
});

// Every toast that enters the lane (the tap keeps them): it shows one at a
// time, and a refusal pre-empts the one showing, so its text alone can miss
// one.
const sawToast = (app, text) => app.toast(text, { timeout: 5_000 });

// What the worker posts for a request it could not run (`engineError`).
const failMeasurement = (app, req, { fatal = false } = {}) =>
  app.inject({ type: "engine_error", request: "perform_wire", id: null, req, message: "RuntimeError: injected for the test", fatal });
// The last measurement asked for, in the background (`bg`) or not.
const lastWire = async (app, bg) => {
  const w = await app.sent({ type: "perform_wire", bg });
  return w.length ? w[w.length - 1].req : null;
};

test("a re-check the engine never answers is let go: the status leaves re-checking and says it couldn't", async ({ page, app }) => {
  // Slowed, so Glass Pad's re-check of its shipped wiring is still out.
  await boot(page, app, { slow: 4 });
  await app.openOnPerform("Glass Pad", { reach: false });
  const status = page.locator(".pf-status");
  await app.engine((timeout) => expect(status).toContainText("re-checking", { timeout }), { ms: 30_000 });
  const req = await lastWire(app, true);
  expect(req, "the re-check was asked for").not.toBeNull();
  await failMeasurement(app, req);
  await sawToast(app, "The engine couldn’t finish");
  await expect(status).not.toContainText("re-checking", { timeout: 5_000 });
  // The shipped wiring still plays; it just wasn't re-checked.
  await expect(status).toContainText("controls reach this patch · couldn’t re-check this patch");
});

test("a first measurement a crashed engine never answers is let go: the status stops listening and says it couldn't", async ({ page, app }) => {
  // No shipped wiring: Glass Pad is measured from nothing, slowed so it is
  // still running.
  await boot(page, app, { shipped: false, slow: 4 });
  await app.openOnPerform("Glass Pad", { reach: false });
  const status = page.locator(".pf-status");
  await app.engine((timeout) => expect(status).toContainText("listening to this sound", { timeout }), { ms: 30_000 });
  const req = await lastWire(app, false);
  expect(req, "the measurement was asked for").not.toBeNull();
  // The engine is down (a poisoned engine answers each request so).
  await failMeasurement(app, req, { fatal: true });
  await expect(page.locator("#alarm")).toContainText(/engine crashed/i, { timeout: 5_000 });
  await expect(status).toHaveText("couldn’t measure this patch", { timeout: 5_000 });
  expect(await page.locator(".pf-knob.waiting").count(), "no control still says listening…").toBe(0);
});

// A crashed engine is asked nothing more. Each request sent to it came back
// as another crash, and a spare (or Wander) asked again a second later, for
// as long as the page was open.
test("after the engine crashes, PERFORM asks it nothing more: no spare grows, and an Offer says the engine crashed", async ({ page, app }) => {
  await boot(page, app);
  await app.openOnPerform("Glass Pad", { reach: false });
  const openedAt = await app.now();
  const status = page.locator(".pf-status");
  await app.engine((timeout) => expect(status).toContainText("controls reach", { timeout }), { ms: 30_000 });
  // The crash, during Glass Pad's re-check, and the engine poisoned from then
  // on: every PERFORM request answered as a poisoned worker answers it, with
  // a fatal engine_error, and never run (`app.fail`).
  const req = await lastWire(app, true);
  await app.fail({ type: PERFORM_REQUESTS }, { message: "the engine is down (RuntimeError: unreachable)", fatal: true });
  await app.inject({ type: "engine_error", request: "perform_wire", id: null, req, message: "RuntimeError: unreachable", fatal: true });
  const crashAt = await app.now();
  await expect(page.locator("#alarm")).toContainText(/engine crashed/i, { timeout: 5_000 });
  const walks = async () => (await app.sent({ type: ["perform_offer", "perform_drift"] }, { after: crashAt })).length;
  // Hands off for as long as a spare waits before it grows (`growSpare`: six
  // seconds after the patch arrived, three after it played, two of hands
  // off), and a second more for its timer: nothing is asked.
  const quietUntil = Math.max(openedAt + 9_000, crashAt + 3_000);
  await app.quiet(Math.max(0, quietUntil - (await app.now())));
  expect(await walks(), "a spare asked of the crashed engine").toBe(0);
  // Asked for, an offer is not sent either, and B says why.
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await expect(page.locator(".pf-offer")).toContainText("the engine crashed: reload to continue", { timeout: 5_000 });
  expect(await walks(), "an offer sent to the crashed engine").toBe(0);
});

test("a module the engine fails to add is said to have failed, and no offer grows in its place", async ({ page, app }) => {
  await boot(page, app);
  await app.openOnPerform("Glass Pad", { wired: true });
  const body = page.locator('.pf-knob[data-i="3"]');
  await expect(body, "Body is a search control on Glass Pad, with a module to give").toHaveClass(/\bsearch\b/);
  // The next graft throws in the worker instead (a non-fatal engine_error).
  await app.fail("perform_graft", { message: "Error: injected for the test", once: true });
  const turnedAt = await app.now();
  // Past the notch and let go: Body asks for a module to turn.
  await drag(page, body, -90);
  await sawToast(app, "Body: the engine couldn’t add the tone EQ, so nothing changed.");
  expect((await app.sent({ type: "perform_graft" }, { after: turnedAt })).length, "the turn asked for a module").toBeGreaterThan(0);
  expect((await app.toasts()).join("\n")).not.toMatch(/nothing to add here/);
  // An offer in its place was asked for in the same breath as its toast.
  expect((await app.sent({ type: "perform_offer" }, { after: turnedAt })).length, "an offer grown in its place").toBe(0);
});

// A walk that traps answers with the crash alone now (worker.js, unit-tested
// in apps/web/tests/worker-perform-replies.test.mjs). A worker from before
// answered the walk first, empty with the error, and the crash second, by
// then about a request no longer pending: B said "try again" under the
// alarm. Both replies are dispatched here, in that order.
test("an offer whose walk crashed the engine says the engine crashed, even answered before the crash", async ({ page, app }) => {
  // Slowed, so the offer is still growing when its replies are dispatched.
  await boot(page, app, { slow: 4 });
  await app.openOnPerform("Glass Pad", { wired: true });
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  // The offer growing for B: this press's, or a spare it claimed.
  const offers = await app.sent({ type: "perform_offer" });
  const req = offers.length ? offers[offers.length - 1].req : null;
  expect(req, "an offer is growing").not.toBeNull();
  // Both replies in one breath, in the old worker's order (the tap's own
  // inject, in the page).
  await page.evaluate((r) => {
    window.__tap.inject({ type: "perform_offered", req: r, offer: null, error: "RuntimeError: unreachable" });
    window.__tap.inject({ type: "engine_error", request: "perform_offer", id: null, req: r, message: "RuntimeError: unreachable", fatal: true });
  }, req);
  await expect(page.locator("#alarm")).toContainText(/engine crashed/i, { timeout: 5_000 });
  const b = page.locator(".pf-offer");
  await expect(b).toContainText("the engine crashed: reload to continue", { timeout: 5_000 });
  await expect(b).not.toContainText("try again");
});
