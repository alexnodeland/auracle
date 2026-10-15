// PERFORM's controls stay under the hands.
//
// A Keep (like a new measurement, a Take or a glide) folds the controls'
// turns into the patch and puts them back at 12 o'clock; the sound does not
// move. The dial used to jump there in one frame, which read as "I set Bright
// to 70% and now it says 0", and a background re-check re-centred them too,
// seconds after the player had let go. Now a re-centre glides the pointer home
// over --d-state (180 ms) with a ghost tick fading where it was, and a background
// re-check leaves the controls where they are unless it wired them to
// different knobs.
//
// Blend is the exception for a MIDI pot. When B empties (a pass, a Take),
// Blend comes home and a pot on it is let go: it has to come back down through
// home before it drives Blend again. It used to be re-anchored at home like a
// re-centred control, so a pot left at 0.9 spread the whole blend over its
// last tenth of travel, and the next nudge poured the next offer in.
//
// A MIDI device is stood in for by replacing navigator.requestMIDIAccess
// before the app runs, with one input the spec sends control changes from.
const { test, expect, PERFORM_SEED } = require("./fixtures");

const FAKE_MIDI = `(() => {
  const input = { id: "pw", name: "Test pot", manufacturer: "", state: "connected", onmidimessage: null };
  const access = { inputs: new Map([["pw", input]]), outputs: new Map(), onstatechange: null, sysexEnabled: false };
  Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: () => Promise.resolve(access) });
  window.__cc = (cc, v) => input.onmidimessage && input.onmidimessage({ data: new Uint8Array([0xb0, cc, v]), timeStamp: performance.now() });
})();`;

async function boot(page, app, { midi = false } = {}) {
  if (midi) await page.addInitScript(FAKE_MIDI);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
}

async function drag(page, loc, dy) {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(10, 10);
}

test("a re-centred control glides home with a fading ghost, and a background re-check leaves it where it is", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(100_000); // about 36 to 45 s on CI: two background re-checks
  await boot(page, app);
  await app.openOnPerform("Glass Pad");
  // Two background re-checks are waited for below, each a measurement
  // (about thirty renders) that may wait behind a spare.
  const RECHECK_MS = await app.offerBudget({ waits: 2 });
  const status = page.locator(".pf-status");
  // The shipped wiring's background re-check, done.
  await expect(status).not.toContainText("re-checking", { timeout: RECHECK_MS });
  const bright = page.locator('.pf-knob[data-i="0"]');
  await drag(page, bright, -150);
  expect(Number(await bright.getAttribute("aria-valuenow"))).toBeGreaterThan(0.5);

  // Where the pointer is drawn before the Keep, and every angle it is drawn
  // at from here on.
  const from = await page.evaluate(() => {
    const turn = document.querySelector('.pf-knob[data-i="0"] .pf-k-ptr');
    const m = /rotate\((-?[\d.]+)\)/.exec(turn.getAttribute("transform") || "");
    return m ? Number(m[1]) : NaN;
  });
  await page.evaluate(() => {
    const turn = document.querySelector('.pf-knob[data-i="0"] .pf-k-ptr');
    window.__angles = [];
    new MutationObserver(() => {
      const m = /rotate\((-?[\d.]+)\)/.exec(turn.getAttribute("transform") || "");
      window.__angles.push([performance.now(), m ? Number(m[1]) : NaN]);
    }).observe(turn, { attributes: true, attributeFilter: ["transform"] });
  });
  await page.locator(".pf-moved .pf-keep").click();
  await app.engine((timeout) => expect(page.locator("#toasts")).toContainText("Kept: this is home now.", { timeout }), { ms: 15_000 });
  await expect(bright).toHaveAttribute("aria-valuenow", "0.00");
  // The glide has landed: the pointer is drawn at 12 o'clock.
  await expect.poll(() => page.evaluate(() => (window.__angles.length ? window.__angles[window.__angles.length - 1][1] : NaN))).toBe(0);
  const angles = await page.evaluate(() => window.__angles);
  // A glide, not a jump: the Keep draws the pointer where it was, in its own
  // task (`recentre` paints `from` before its first frame; every paint sets
  // the transform, which the observer records even when it is unchanged),
  // and from there it only ever comes home, ending at 12 o'clock. Which
  // angles it passes through is the frame rate's: a main thread that stalls
  // past --d-state (180 ms) draws the next frame at home, rightly. How long
  // it took is a budget (ADR-022).
  expect(Math.abs(from), "the pointer was turned away from 12 o'clock before the Keep").toBeGreaterThan(0.5);
  expect(Math.abs(angles[0][1] - from), `the Keep drew the pointer where it was (${from.toFixed(1)}°) before it moved: ${angles[0][1]}°`).toBeLessThan(0.5);
  const away = angles.map(([, a]) => Math.abs(a));
  expect(away.every((a, i) => i === 0 || a <= away[i - 1] + 0.5), `the pointer only came home: ${away.map((a) => a.toFixed(1)).join(", ")}`).toBe(true);
  expect(angles[angles.length - 1][1]).toBe(0);
  const between = angles.filter(([, a]) => Math.abs(a) > 0.5 && Math.abs(a) < Math.abs(from) - 0.5).length;
  const took = angles[angles.length - 1][0] - angles[0][0];
  console.log(`re-centre glide: ${angles.length} frames (${between} between) over ${took.toFixed(0)} ms, from ${from.toFixed(1)}°`);
  app.budget("the re-centre glide, first frame → 12 o'clock", took, 600);
  await expect(bright.locator(".pf-k-ghost")).toHaveClass(/\bfade\b/);

  // Turned again after the Keep; the Keep's re-check (the knobs had travelled
  // far) lands in the background and must not take the turn away.
  const caption = await bright.locator(".pf-k-sub").textContent();
  await drag(page, bright, -90);
  const set = await bright.getAttribute("aria-valuenow");
  expect(Number(set)).toBeGreaterThan(0.3);
  await expect(status).not.toContainText("re-checking", { timeout: RECHECK_MS });
  // Watched past the pause a re-check waits for.
  await app.quiet(2_500);
  if ((await bright.locator(".pf-k-sub").textContent()) === caption) {
    await expect(bright, "same knobs: the control stays where the hand left it").toHaveAttribute("aria-valuenow", set);
  }
});

test("a pot on Blend is let go when Blend comes home, and takes it again from home", async ({ page, app }) => {
  await boot(page, app, { midi: true });
  await app.openOnPerform("Glass Pad");
  const OFFER_MS = await app.offerBudget({ waits: 1 });
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  // CC 20 learned onto Blend (the seventh row of the MIDI panel).
  await page.locator("#midi-ind").click();
  await page.locator("#midi-panel .midi-row").nth(6).locator("button", { hasText: "learn" }).click();
  await page.evaluate(() => window.__cc(20, 0));
  await expect(page.locator("#midi-panel .midi-row").nth(6)).toContainText("CC 20");
  await page.locator("#midi-ind").click();
  const blend = page.locator('.pf-blend[data-i="6"] input');
  const at = async () => Number(await blend.getAttribute("aria-valuenow"));
  // The pot picks Blend up at home and turns it most of the way to the offer.
  for (const v of [2, 20, 45, 70, 95, 115]) await page.evaluate((v) => window.__cc(20, v), v);
  expect(await at()).toBeCloseTo(115 / 127, 2);
  // Next passes on B: B empties and Blend comes home.
  await page.locator(".pf-pad", { hasText: "Next" }).click();
  await expect(blend).toHaveAttribute("aria-valuenow", "0.00", { timeout: 2_000 });
  // The pot, still near the top, is let go: nudging it on does nothing.
  const up = [];
  for (const v of [117, 120, 124, 127]) {
    await page.evaluate((v) => window.__cc(20, v), v);
    up.push(await at());
  }
  console.log(`Blend under the pot's last steps after coming home: ${up.join(", ")}`);
  expect(up).toEqual([0, 0, 0, 0]);
  // Brought back down through home, it takes Blend again and follows.
  for (const v of [90, 50, 10]) await page.evaluate((v) => window.__cc(20, v), v);
  expect(await at()).toBe(0);
  await page.evaluate(() => window.__cc(20, 2));
  await page.evaluate(() => window.__cc(20, 40));
  expect(await at()).toBeCloseTo(40 / 127, 2);
});

// A wiring that lands never moves a control under the hand (#304): a control
// or the XY pad held still, however long, through a background re-check or a
// Take's own measurement keeps where it is drawn and writes nothing to the
// voices, and the wiring lands only after the hand lets go (a re-check is
// taken in place; a Take's measurement re-centres, once the hand is off).
// The reply is held from main until the hand is on the control, then let
// through.

/** Where the hand holds, on the control or the pad: where it presses and
 *  where it turns to (`aim`), what it shows, and whether that is home. A
 *  control is the first that turns a knob now, turned the way it turns; the
 *  pad's axes are the first two such, and it is moved the way both turn. */
const KNOB = ".pf-knob[data-i]:not(.search):not(.unwired):not(.guess)";
const middle = (b) => [b.x + b.width / 2, b.y + b.height / 2];
const HANDS = {
  control: {
    async aim(page) {
      const k = page.locator(KNOB).first();
      const i = await k.getAttribute("data-i");
      const down = await k.evaluate((e) => e.classList.contains("half-hi"));
      const [x, y] = middle(await k.boundingBox());
      return { i, from: [x, y], to: [x, y + (down ? 90 : -90)] };
    },
    shown: (page, i) =>
      page.evaluate((i) => {
        const k = document.querySelector(`.pf-knob[data-i="${i}"]`);
        return [k.getAttribute("aria-valuenow"), k.querySelector(".pf-k-ptr")?.getAttribute("transform") || ""].join(" ");
      }, i),
    home: (page, i) => page.evaluate((i) => document.querySelector(`.pf-knob[data-i="${i}"]`).getAttribute("aria-valuenow") === "0.00", i),
  },
  "XY pad": {
    async aim(page) {
      const turning = await page.locator(KNOB).evaluateAll((ks) => ks.map((k) => [k.dataset.i, k.classList.contains("half-hi")]));
      if (turning.length < 2) throw new Error(`two controls turn for the pad's axes, not ${turning.length}`);
      await page.locator(".pf-xy-btn").click();
      await page.getByLabel("XY pad x axis").selectOption(turning[0][0]);
      await page.getByLabel("XY pad y axis").selectOption(turning[1][0]);
      const b = await page.locator(".pf-xy-field").boundingBox();
      const [x, y] = middle(b);
      const right = turning[0][1] ? -1 : 1;
      const up = turning[1][1] ? -1 : 1;
      return { i: null, from: [x, y], to: [x + right * 0.3 * b.width, y - up * 0.3 * b.height] };
    },
    shown: (page) =>
      page.evaluate(() => {
        const dot = document.querySelector(".pf-xy-dot");
        return [document.querySelector(".pf-xy-field").getAttribute("aria-valuetext"), dot.style.left, dot.style.top].join(" ");
      }),
    home: (page) =>
      page.evaluate(() => {
        const dot = document.querySelector(".pf-xy-dot");
        return parseFloat(dot.style.left) === 50 && parseFloat(dot.style.top) === 50;
      }),
  },
};

/** The hand on the control or the pad, turned off home and held there,
 *  still; the control's index. */
async function grab(page, hand) {
  const { i, from, to } = await hand.aim(page);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  await expect.poll(() => hand.home(page, i), { message: "the hand turned it off home" }).toBe(false);
  return i;
}

/** The held reply let through under the still hand: nothing it holds is
 *  drawn anywhere else, nor writes a value, for longer than the 1.5 s a
 *  let-go control waits. Then the hand lets go, and for 1.2 s after nothing
 *  moves either. What it showed, and when it was let go. */
async function holdThrough(page, app, hand, i) {
  const shown = await hand.shown(page, i);
  await app.countLiveWrites();
  expect(await app.release(), "the measurement was held for the hand").toBeGreaterThan(0);
  await app.quiet(2_500);
  expect(await hand.shown(page, i), "nothing moved under the hand").toBe(shown);
  expect(await app.liveWrites(), "and nothing was written to the voices").toEqual([]);
  const released = await app.now();
  await page.mouse.up();
  await page.mouse.move(10, 10);
  await app.quiet(1_200);
  expect(await hand.shown(page, i), "nor in the first moments after the release").toBe(shown);
  return { shown, released };
}

/** Hold the engine's reply to the newest `perform_wire` asked for since
 *  `since` from main, once it is asked for, and wait until it has landed. */
async function holdReply(app, since, ms) {
  const asked = await app.engine(async (timeout) => {
    await expect.poll(async () => (await app.sent({ type: "perform_wire" }, { after: since })).length, { timeout, message: "the measurement was asked for" }).toBeGreaterThan(0);
    return (await app.sent({ type: "perform_wire" }, { after: since })).pop();
  });
  await app.hold({ type: "perform_wired", req: asked.req });
  await app.engine((timeout) => expect.poll(async () => (await app.held()).length, { timeout, message: "the measurement landed" }).toBeGreaterThan(0), { ms });
}

for (const [name, hand] of Object.entries(HANDS)) {
  test(`${name === "control" ? "a" : "an"} ${name} held still through a background re-check is not moved, and the re-check waits for its release`, { tag: "@slow" }, async ({ page, app }) => {
    await boot(page, app);
    const since = await app.now();
    // The shipped wiring plays, and its re-check is held from main.
    await app.openOnPerform("Glass Pad");
    await holdReply(app, since, await app.offerBudget({ waits: 1 }));
    const i = await grab(page, hand);
    const { released } = await holdThrough(page, app, hand, i);
    // Let go, the re-check lands 1.5 s later: nothing is written before.
    await app.quiet(1_000);
    const writes = await app.liveWrites();
    expect(writes.filter((t) => t > released && t < released + 1_400), "nothing written within 1.5 s of the release").toEqual([]);
  });

  test(`${name === "control" ? "a" : "an"} ${name} held still through a Take's measurement is not moved, and re-centres only after its release`, { tag: "@slow" }, async ({ page, app }) => {
    test.setTimeout(150_000);
    await boot(page, app);
    await app.openOnPerform("Glass Pad");
    const OFFER_MS = await app.offerBudget({ waits: 2 });
    await expect(page.locator(".pf-status")).not.toContainText("re-checking", { timeout: OFFER_MS });
    await page.locator(".pf-pad", { hasText: "Offer" }).click();
    await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: OFFER_MS });
    // The taken sound's measurement is held from main; it plays meanwhile
    // on the wiring carried over.
    const takenAt = await app.now();
    await page.locator(".pf-pad", { hasText: "Take" }).click();
    await holdReply(app, takenAt, OFFER_MS);
    const i = await grab(page, hand);
    const { released } = await holdThrough(page, app, hand, i);
    // Let go, the measurement takes the carried wiring's place, and the
    // controls come home on it (the sound does not move): 1.5 s after the
    // release, not before.
    await expect.poll(() => hand.home(page, i), { timeout: 10_000, message: "home on the measured wiring" }).toBe(true);
    expect((await app.now()) - released, "not before 1.5 s after the release").toBeGreaterThanOrEqual(1_500);
  });
}
