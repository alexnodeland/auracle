// PERFORM's offers do not hold the engine: a Keep is answered while a spare
// offer grows, even on a slow machine.
//
// An offer is a walk of twenty-odd phrase renders, and it was one call the
// engine worker could not be interrupted in. A spare offer grown in the
// background (nobody had asked for it) therefore stood in front of everything
// the player did next: on a CI runner the first spare took 62 s, and a pick
// (`perform_record`) and a Keep waited behind it for the whole of it, which is
// what made the PERFORM specs time out there. The engine now begins an offer
// as a job the worker advances one render at a time, answering the player
// between renders (docs/architecture/web-runtime.md), so what a player does
// waits for at most the render in progress.
//
// What the worker does with one request while a spare grows is the worker's
// own: a pick posted during a step is answered before the next, and leaving
// the patch (`retire`) drops the spare at that breath
// (tests/worker/lanes.test.mjs), and an Offer asked for while the guess waits
// for its crew starts at once (tests/worker/background.test.mjs). This holds
// the page's half: a Keep on the real panel, which is several trips to the
// worker, each of which can wait for a step. It holds a very long spare (400
// steps: minutes on any machine) in the background, and the Keep must be said
// with the spare still growing, in time measured against a step of this
// machine's engine: a couple of seconds or six steps, whichever is longer (a
// step is a render: 0.3 s on a laptop and seconds on a loaded CI runner).
// Chrome's CPU throttling (4x) is applied to the page, and it slows the main
// thread; it does not necessarily reach the dedicated engine worker, which is
// a target of its own, so the throttle is not what makes the engine slow, and
// the bound does not rest on it.
//
// The spare must be the only work in the engine's `later` lane, or it waits
// for work it is not about. Opening Glass Pad from its shipped wiring asks for
// a background re-check of it (a measurement, about thirty renders), and once
// that lands the page grows a spare of its own. Both are `later` work asked
// for before the spec's spare, and the re-check keeps its place at the front
// of the lane while `soon` work goes between its renders. On a CI runner the
// re-check alone is about 50 s, and the spec's spare, posted behind it, did
// not begin within the 30 s the spec gave it. So the spec first waits until
// the page's own PERFORM requests are answered, its spare included, then
// measures a step on a quiet engine, and only then asks for its spare. Those
// waits are engine growth, bounded by `app.offerBudget` (perform_budget.js);
// the Keep's bound stays on the measured step.
//
// The spec reaches the worker through the fixture's tap: it posts as the page
// does (`app.post`), and reads what was asked and answered, and when.
const { test, expect, PERFORM_SEED } = require("./fixtures");

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

/** Send `m` to the engine worker; the page clock at the send. */
async function post(app, m) {
  await app.post(m);
  const sent = await app.sent({ type: m.type, req: m.req });
  return sent[sent.length - 1]._at;
}

/** Every PERFORM request the page itself has made (ids under the spec's) is
 *  answered, and one of them was a spare (an offer asked as `bg`): after its
 *  spare the page asks the engine for nothing more until the patch or the
 *  knobs move. */
async function pageQuiet(app) {
  const reply = { perform_wire: "perform_wired", perform_offer: "perform_offered", perform_drift: "perform_drifted" };
  const asked = (await app.sent({ type: Object.keys(reply) })).filter((s) => s.req < 8_000_000);
  const answered = new Set();
  for (const type of Object.values(reply)) for (const r of await app.replies(type)) answered.add(`${type}:${r.req}`);
  return asked.every((s) => answered.has(`${reply[s.type]}:${s.req}`)) && asked.some((s) => s.type === "perform_offer" && s.bg);
}

/** The worker's reply of `type` to request `req`, once it lands (`_at`). */
const reply = (app, type, req, timeout) => app.reply(type, { where: { req }, timeout });

test("a Keep is answered while a spare offer grows", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(130_000); // the page's own work done first, and the steps measured
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("Glass Pad");
  const [{ tree }] = await app.sent({ type: "perform_wire", tree: true });
  // How long engine growth may take here. One wait on it is the spec's own
  // (the page's work done, below); the others are replies, whose time
  // `app.reply` adds to the test's.
  const OFFER_MS = await app.offerBudget({ waits: 1 });

  // The page's own `later` work, ahead of any spare the spec asks for: the
  // re-check of the shipped wiring, then the page's spare.
  const quietAt = Date.now();
  await expect.poll(() => pageQuiet(app), { timeout: OFFER_MS }).toBe(true);
  console.log(`the page's re-check and spare were done ${Date.now() - quietAt} ms after PERFORM was reached`);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // What a step costs here, now, on a quiet engine: an offer of one step is
  // the home patch (in the memo) and one proposal, so one render. The worst
  // of three (a proposal already in the memo is answered in milliseconds).
  let step = 0;
  for (let i = 0; i < 3; i++) {
    const req = 9_000_010 + i;
    const at = await post(app, { type: "perform_offer", req, tree, overrides: [], locks: [], steps: 1 });
    step = Math.max(step, (await reply(app, "perform_offered", req, OFFER_MS))._at - at);
  }
  // A Keep is several trips (apply, commit, the new patch's check), each of
  // which can wait for a step.
  const KEEP_MS = Math.max(4_000, 6 * step);
  console.log(`one step ${step.toFixed(0)} ms here: Keep within ${KEEP_MS.toFixed(0)} ms`);

  // The spare: far longer than the Keep, asked as the page asks for one
  // nobody has claimed (`bg`).
  const SPARE = 9_000_002;
  const spareAt = await post(app, { type: "perform_offer", req: SPARE, tree, overrides: [], locks: [], steps: 400, bg: true });
  // Begun: the worker announces a walk as long work (`busy`). Nothing of the
  // page's is ahead of it now, but a face render or the guess may be, so the
  // bound is the budget's, not a step's.
  const begun = (await app.reply("busy", { after: spareAt, timeout: OFFER_MS }))._at;
  console.log(`the spare began ${(begun - spareAt).toFixed(0)} ms after it was asked for`);
  const spareDone = async () => (await app.replies("perform_offered", { where: { req: SPARE } })).length > 0;
  await app.quiet();
  expect(await spareDone(), "the spare is still growing").toBe(false);

  // A Keep on the panel: turned away from home, kept, and said so.
  const bright = page.locator('.pf-knob[data-i="0"]');
  await drag(page, bright, -150);
  expect(Number(await bright.getAttribute("aria-valuenow"))).toBeGreaterThan(0.5);
  const keepAt = Date.now();
  await page.locator(".pf-moved .pf-keep").click();
  await expect(page.locator("#toasts")).toContainText("Kept: this is home now.", { timeout: KEEP_MS });
  console.log(`Keep said so in ${Date.now() - keepAt} ms with the spare growing`);
  expect(await spareDone(), "the Keep came after the spare finished, so it proved nothing").toBe(false);
});
