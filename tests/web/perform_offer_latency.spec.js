// PERFORM's offers do not hold the engine: a pick and a Keep are answered
// while a spare offer grows, even on a slow machine.
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
// This holds a very long spare (400 steps: minutes on any machine) in the
// background, and asks for a pick over the worker's own protocol and a Keep on
// the real panel. Both must land with the spare still growing, in time
// measured against a step of this machine's engine: a request waits for the
// step in progress, so the bound is a couple of seconds or twice a step,
// whichever is longer (a step is a render: 0.3 s on a laptop and seconds on a
// loaded CI runner). Chrome's CPU throttling (4x) is applied to the page, and
// it slows the main thread; it does not necessarily reach the dedicated engine
// worker, which is a target of its own, so the throttle is not what makes the
// engine slow, and the bound does not rest on it. Then the page leaves the
// patch (`retire`), and the walk that was running is dropped at its next step
// instead of finishing for nothing.
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
// the pick and Keep bounds stay on the measured step.
//
// The spec reaches the worker through the fixture's tap: it posts as the page
// does (`app.post`), and reads what was asked and answered, and when.
const { test, expect, PERFORM_SEED, bankTab } = require("./fixtures");

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

test("a pick and a Keep are answered while a spare offer grows", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("Glass Pad");
  const [{ tree }] = await app.sent({ type: "perform_wire", tree: true });
  // How long engine growth may take here. One wait on it is the spec's own
  // (the page's work done, below); the others are replies, whose time
  // `app.reply` adds to the test's.
  const OFFER_MS = await app.offerBudget({ waits: 1 });

  // An offer to answer, grown before the spare (a short walk).
  const OFFER = 9_000_001;
  const SPARE = 9_000_002;
  const PICK = 9_000_003;
  await post(app, { type: "perform_offer", req: OFFER, tree, overrides: [], locks: [], steps: 6 });
  const grown = await reply(app, "perform_offered", OFFER, OFFER_MS);
  expect(grown.offer && grown.offer.tree, "an offer to answer grew").toBeTruthy();

  // The page's own `later` work, ahead of any spare the spec asks for: the
  // re-check of the shipped wiring, then the page's spare.
  const quietAt = Date.now();
  await expect.poll(() => pageQuiet(app), { timeout: OFFER_MS }).toBe(true);
  console.log(`the page's re-check and spare were done ${Date.now() - quietAt} ms after the offer grew`);

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
  // A request waits for the step in progress; a pick is one trip to the worker.
  const PICK_MS = Math.max(2_000, 2 * step);
  // A Keep is several trips (apply, commit, the new patch's check), each of
  // which can wait for a step.
  const KEEP_MS = Math.max(4_000, 6 * step);
  console.log(`one step ${step.toFixed(0)} ms here: pick within ${PICK_MS.toFixed(0)} ms, Keep within ${KEEP_MS.toFixed(0)} ms`);

  // The spare: far longer than the checks below, asked as the page asks for
  // one nobody has claimed (`bg`).
  const spareAt = await post(app, { type: "perform_offer", req: SPARE, tree, overrides: [], locks: [], steps: 400, bg: true });
  // Begun: the worker announces a walk as long work (`busy`). Nothing of the
  // page's is ahead of it now, but a face render or the guess may be, so the
  // bound is the budget's, not a step's.
  const begun = (await app.reply("busy", { after: spareAt, timeout: OFFER_MS }))._at;
  console.log(`the spare began ${(begun - spareAt).toFixed(0)} ms after it was asked for`);
  const spareDone = async () => (await app.replies("perform_offered", { where: { req: SPARE } })).length > 0;
  await app.quiet();
  expect(await spareDone(), "the spare is still growing").toBe(false);

  // A pick, as PERFORM records a heard answer: it must not wait for the spare.
  const pickAt = await post(app, { type: "perform_record", req: PICK, tree, overrides: [], offer: JSON.stringify(grown.offer.tree), took: false });
  const recorded = await reply(app, "perform_recorded", PICK, 20_000);
  const pickMs = recorded._at - pickAt;
  console.log(`pick answered in ${pickMs.toFixed(0)} ms with the spare growing`);
  expect(recorded.recorded, "the pick was recorded").toBe(true);
  expect(pickMs, "the pick waited on the spare").toBeLessThan(PICK_MS);
  expect(await spareDone(), "the pick came after the spare finished, so it proved nothing").toBe(false);

  // A Keep on the panel: turned away from home, kept, and said so.
  const bright = page.locator('.pf-knob[data-i="0"]');
  await drag(page, bright, -150);
  expect(Number(await bright.getAttribute("aria-valuenow"))).toBeGreaterThan(0.5);
  const keepAt = Date.now();
  await page.locator(".pf-moved .pf-keep").click();
  await expect(page.locator("#toasts")).toContainText("Kept: this is home now.", { timeout: KEEP_MS });
  console.log(`Keep said so in ${Date.now() - keepAt} ms with the spare growing`);

  // Leaving the patch stops the walk at its next step: answered retired, and
  // within a step or two.
  await app.post({ type: "retire", reqs: [SPARE] });
  const retired = await reply(app, "perform_offered", SPARE, Math.max(10_000, 4 * step));
  expect(retired.error).toBe("retired");
});

/** PATCH, with a preset open on it and its rack drawn. */
async function openInPatch(page, app, name) {
  await app.level("patch");
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: name }).first().click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: 60_000 });
  await expect(page.locator("#rack-svg g.mod-group").first()).toBeVisible();
}

/** The guess PATCH draws, once it is the top of the newest ranking for the
 *  tree on the bench (a refit can rank it again while the page waits). */
function drawnGuess(page, app) {
  const agree = () => {
    const T = window.__tap;
    const bench = T.last.bench && T.last.bench.treeJson;
    const r = T.replies.filter((x) => x.type === "guess" && !x.injected && x.d.data && x.d.data.guesses && (x.d.tree || x.d.treeJson) === bench).pop();
    const g = document.querySelector("#rack-svg .guess-plate");
    if (!r || !g || !r.d.data.guesses.length) return false;
    const top = r.d.data.guesses[0];
    return g.getAttribute("data-kind") === top.kind && g.getAttribute("data-socket") === top.socket;
  };
  return app.engine((timeout) => expect.poll(() => page.evaluate(agree), { timeout }).toBe(true), { ms: 90_000 });
}

// PATCH's guess asks a render crew to render every candidate, and waiting for
// that crew (its spawn, its replies: seconds) used to hold the floor though
// nothing ran on the engine thread, so a pressed Offer, EVOLVE's `refine` and
// the measurement of the sound in hand waited for it. A guess's crew phase is
// now detached; this opens a patch the guess has not ranked, and presses an
// Offer (over the worker's protocol, a step long) while the crew is out. The
// Offer must be answered before the guess is, within a measured step's bound.
test("an Offer pressed while the guess is on its crew starts at once", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED, warmed: false });
  await app.warmStart();
  const offer = async (req) => {
    const bench = (await app.replies("bench")).pop();
    const at = await post(app, { type: "perform_offer", req, tree: bench.treeJson, overrides: [], locks: [], steps: 1 });
    const got = await reply(app, "perform_offered", req, 120_000);
    const what = got.offer && got.offer.tree ? "an offer" : (got.offer && got.offer.reason) || got.error || "nothing";
    console.log(`offer ${req}: ${what} after ${(got._at - at).toFixed(0)} ms`);
    return { at, took: got._at - at };
  };

  // The first patch opened after the warm start: the crew is cold, so the
  // guess waits seconds for it to spawn. The page asks once the bench
  // settles. An Offer pressed before the guess has started would be served
  // first whatever the floor does (`soon` goes before `later`), so wait until
  // the guess is on its crew: the worker asks main for the crew's ports
  // (`farm_want`).
  //
  // And keep it there until the Offer is answered. On a CI runner the crew
  // came up and the guess was done before the Offer was answered, so the
  // test proved nothing and said so. The crew's ports are held back from the
  // engine worker (`app.holdRequests("farm_ports")`) until the Offer's reply
  // has landed: the guess is then on its crew for the whole of the Offer,
  // every run. The worker waits 10 s for a crew before giving up on it,
  // longer than the bound below. With a guess that held the floor through its
  // crew phase, the Offer would wait those 10 s.
  const t0 = await app.now();
  const wants = await app.count("farm_want");
  await app.holdRequests("farm_ports");
  await openInPatch(page, app, "Reese");
  await app.engine((timeout) => expect.poll(() => app.count("farm_want"), { timeout }).toBeGreaterThan(wants), { ms: 30_000 });
  const wantedAt = await app.now();
  const { at, took } = await offer(9_100_002);
  const answeredAt = at + took;
  const guessed = (await app.replies("guess", { after: t0 })).find((r) => r.data && r.data.guesses);
  const held = await app.releaseRequests();
  console.log(`crew asked for; the Offer answered ${(answeredAt - wantedAt).toFixed(0)} ms later, ${held} crew's ports held until then`);
  // The cost of a step here, idle, once the guess has landed.
  await drawnGuess(page, app);
  const step = (await offer(9_100_001)).took;
  console.log(`idle step ${step.toFixed(0)} ms; an Offer pressed with the guess on its crew answered in ${took.toFixed(0)} ms; guess ${guessed ? "answered " + (guessed._at - answeredAt).toFixed(0) + " ms after" : "not yet answered"}`);
  expect(took, "the Offer waited for the guess's crew").toBeLessThan(Math.max(2_000, 3 * step));
  // The test proves something only if the guess was still out when the Offer
  // was answered: its crew was held until then, and the worker had not given
  // up waiting for it (10 s after asking).
  expect(answeredAt - wantedAt, "the worker gave up on the crew before the Offer was answered, so nothing was proved").toBeLessThan(10_000);
  expect(guessed === undefined || guessed._at > answeredAt, "the guess was done before the Offer was answered, so nothing was proved").toBe(true);
});
