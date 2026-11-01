// Unit tests for perform.js's pure arithmetic: what a knob sounds at, the
// bases that keep it there when controls leave the panel, a control's sweep
// by ear, what a measurement waiting on the controls says it waits for, and
// what PEEK and TAKE say with nothing in B; and stage mode's full screen
// (`stageScreen`): which stage the browser's grants and exits belong to,
// against a browser that takes its time.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { soundingOf, foldHidden, rebase, wireKeyOf, relativeOf, predictedOf, graftIntent, reachesNone, sweptTo, SWEEP_MS, waitWords, stageScreen, growingOffer, notOffered } from "../perform.js";

// A wiring that turns `addr` by `g` at a full turn, both halves open.
const wiring = (name, addr, g) => ({ name, knobs: [[addr, g]], search: false, purity: 1, reach: 1, position: 0, up: 1, down: 1 });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("hiding a turned control leaves the knob sounding where it did", () => {
  // Bright at +1 adds 0.30 to the cutoff, Warmth at −1 takes 0.25 off it.
  const wire = [wiring("Bright", "f#cut", 0.3), wiring("Warmth", "f#cut", 0.25)];
  const values = [1, -1];
  const bases = new Map([["f#cut", 0.85]]);
  near(soundingOf(0.85, "f#cut", wire, values), 0.9);
  // Bright leaves the panel; Warmth stays.
  const folded = foldHidden(bases, wire, values, [false, true]);
  const after = soundingOf(folded.get("f#cut"), "f#cut", [wire[1]], [values[1]]);
  near(after, 0.9);
  // A base clamped to the travel first would have sounded at 0.75.
  near(soundingOf(1, "f#cut", [wire[1]], [values[1]]), 0.75);
});

test("a knob no hidden control turns keeps its base", () => {
  const wire = [wiring("Bright", "f#cut", 0.3), wiring("Snap", "env#att", -0.2)];
  const bases = new Map([["f#cut", 0.4], ["env#att", 0.5]]);
  const folded = foldHidden(bases, wire, [0.5, 0.5], [true, false]);
  near(folded.get("f#cut"), 0.4);
  // Snap's half turn folds into the attack it turned.
  near(folded.get("env#att"), 0.4);
  near(soundingOf(folded.get("env#att"), "env#att", [wire[0]], [0.5]), 0.4);
});

test("a control's value is clamped to its open halves, and the sum to the travel", () => {
  const half = { ...wiring("Space", "amp#rel", 0.5), down: 0 }; // only turns up
  near(soundingOf(0.5, "amp#rel", [half], [-1]), 0.5);
  near(soundingOf(0.9, "amp#rel", [half], [1]), 1 - 1e-6);
});

test("a re-check after a hide, with the same knobs and gains, leaves the sound where it was", () => {
  const wire = [wiring("Bright", "f#cut", 0.3), wiring("Warmth", "f#cut", 0.25)];
  const folded = foldHidden(new Map([["f#cut", 0.85]]), wire, [1, -1], [false, true]);
  // The panel now holds Warmth alone, at −1; its re-check measures the same.
  const kept = [wire[1]];
  const again = rebase(folded, kept, [-1], kept.map((w) => ({ ...w })), [-1]);
  near(soundingOf(again.get("f#cut"), "f#cut", kept, [-1]), 0.9);
  // The base stays past the travel: clamped on its own, it would sound 0.75.
  assert.ok(again.get("f#cut") > 1);
});

test("a re-check with new gains moves the bases, not the sound", () => {
  const before = [wiring("Bright", "f#cut", 0.3)];
  const after = [wiring("Bright", "f#cut", 0.2)];
  const bases = new Map([["f#cut", 0.5]]);
  const moved = rebase(bases, before, [0.5], after, [0.5]);
  near(soundingOf(moved.get("f#cut"), "f#cut", after, [0.5]), soundingOf(0.5, "f#cut", before, [0.5]));
});

test("a wiring's key: the patch, then the clip for a sound that listens, then the set", () => {
  const listening = JSON.stringify({ kind: "Vca", uid: 7, input: { kind: "AudioIn", uid: 9 } });
  const base = JSON.stringify({ kind: "Vca", input: { kind: "AudioIn" } }); // uids dropped
  // A custom set, asked in palette order whatever the panel's order.
  assert.equal(wireKeyOf(listening, [16, 0, 1, 2, 3, 4, 5], "c1"), `${base}|clip:c1#controls=0,1,2,3,4,5,16`);
  // The six on a listening tree: the patch and its clip, nothing more.
  assert.equal(wireKeyOf(listening, [0, 1, 2, 3, 4, 5], "c1"), `${base}|clip:c1`);
  assert.equal(wireKeyOf(listening, undefined, "c1"), `${base}|clip:c1`);
  // Every set of one patch starts with its six's key and `#controls=`
  // (what `borrowWiring` looks for), and two sets never share a key.
  const six = wireKeyOf(listening, null, "c1");
  assert.ok(wireKeyOf(listening, [6, 0], "c1").startsWith(`${six}#controls=`));
  assert.notEqual(wireKeyOf(listening, [6], "c1"), wireKeyOf(listening, [7], "c1"));
  // A sound that doesn't listen carries no clip; a key already composed is itself.
  const quiet = JSON.stringify({ kind: "Vco", uid: 1 });
  assert.equal(wireKeyOf(quiet, [16], "c1"), `${JSON.stringify({ kind: "Vco" })}#controls=16`);
  const composed = wireKeyOf(listening, [16], "c1");
  assert.equal(wireKeyOf(composed, undefined, "c1"), composed);
});

// A kept wiring: measured on a tree of shape `shape`, for the panel set `set`
// ("" is the six), turning `addrs` and measured at `values`.
const kept = (shape, set, addrs, values, tag) => ({ shape, set, data: { addrs, values, z: [tag], wiring: [wiring("Bright", addrs[0], 0.5)] } });

test("a patch nobody measured borrows the youngest relative of its shape", () => {
  // This tree: shape s1, its own knob values.
  const first = { shape: "s1", knobs: [["f#cut", 0.7], ["amp#attack", 0.1]] };
  const older = kept("s1", "", ["f#cut", "amp#attack"], [0.2, 0.2], "older");
  const younger = kept("s1", "", ["f#cut", "amp#attack"], [0.4, 0.4], "younger");
  const other = kept("s2", "", ["f#cut", "amp#attack"], [0.5, 0.5], "other");
  const data = relativeOf(first, [older, younger, other], "");
  // The youngest of its shape, centred on this tree's own values: its
  // controls' knobs and gains.
  assert.deepEqual(data.addrs, ["f#cut", "amp#attack"]);
  assert.deepEqual(data.values, [0.7, 0.1]);
  assert.deepEqual(data.wiring.map((w) => [w.name, w.knobs]), [["Bright", [["f#cut", 0.5]]]]);
  // The relative's own data is left as it was.
  assert.deepEqual(younger.data.values, [0.4, 0.4]);
  assert.deepEqual(younger.data.z, ["younger"]);
  assert.equal(younger.data.wiring[0].up, 1);
});

test("a borrowed wiring lends how its controls turn, never what the relative measured of itself", () => {
  // The relative: Bright turns its cutoff with its low half closed, Space
  // could not reach it (a search control), and it sits at its own z.
  const relative = {
    shape: "s1",
    set: "",
    data: {
      addrs: ["f#cut", "amp#release"],
      values: [0.2, 0.2],
      z: ["the relative's"],
      wiring: [
        { ...wiring("Bright", "f#cut", 0.5), index: 0, down: 0.01, up: 1.2, position: 1.5 },
        { name: "Space", index: 5, knobs: [], search: true, purity: 0, reach: 0, position: -2, up: null, down: null },
      ],
    },
  };
  const knobs = [["f#cut", 0.7], ["amp#release", 0.3]];
  // With no prediction of this tree: nothing says where it sits.
  const blank = relativeOf({ shape: "s1", knobs }, [relative], "");
  assert.deepEqual(blank.wiring.map((w) => w.name), ["Bright"], "the relative's search control is not lent");
  assert.deepEqual([blank.wiring[0].up, blank.wiring[0].down], [null, null], "both halves open, unverified");
  assert.equal(blank.wiring[0].position, null);
  assert.deepEqual(blank.z, []);
  // A prediction whose engine measured the sound: its z, and its positions by
  // control, where it placed the control.
  const predicted = { z: [0.1, 0.2], wiring: [{ index: 0, position: 0.4 }, { index: 1, position: -0.3 }] };
  const placed = relativeOf({ shape: "s1", knobs, predicted }, [relative], "");
  assert.deepEqual(placed.z, [0.1, 0.2]);
  assert.equal(placed.wiring[0].position, 0.4);
  // A prediction of a sound the engine had not measured places nothing.
  const unplaced = relativeOf({ shape: "s1", knobs, predicted: { ...predicted, z: [] } }, [relative], "");
  assert.equal(unplaced.wiring[0].position, null);
  // A control the prediction did not wire is not placed either.
  const elsewhere = relativeOf({ shape: "s1", knobs, predicted: { z: [0.1], wiring: [{ index: 1, position: 2 }] } }, [relative], "");
  assert.equal(elsewhere.wiring[0].position, null);
  // The relative itself is untouched.
  assert.equal(relative.data.wiring.length, 2);
  assert.equal(relative.data.wiring[0].down, 0.01);
});

test("a prediction of a sound the engine had not measured says nowhere it sits", () => {
  assert.equal(predictedOf(null), null);
  assert.equal(predictedOf({ shape: "s1" }), null);
  const measured = { z: [0.1], wiring: [{ index: 0, position: 0.4 }] };
  assert.equal(predictedOf({ predicted: measured }), measured, "placed: as the engine sent it");
  const blind = { z: [], wiring: [{ index: 0, position: 0 }] };
  assert.deepEqual(predictedOf({ predicted: blind }).wiring, [{ index: 0, position: null }]);
  assert.equal(blind.wiring[0].position, 0, "the engine's reply is untouched");
});

test("a relative of another shape, another set, or a knob this tree lacks lends nothing", () => {
  const first = { shape: "s1", knobs: [["f#cut", 0.7]] };
  assert.equal(relativeOf(first, [kept("s2", "", ["f#cut"], [0.2], "x")], ""), null);
  assert.equal(relativeOf(first, [kept("s1", "6,7", ["f#cut"], [0.2], "x")], ""), null);
  assert.deepEqual(relativeOf(first, [kept("s1", "6,7", ["f#cut"], [0.2], "x")], "6,7").values, [0.7]);
  // A kept entry from before sets were kept with it is the six's.
  const unset = kept("s1", undefined, ["f#cut"], [0.2], "x");
  assert.deepEqual(relativeOf(first, [unset], "").values, [0.7]);
  assert.equal(relativeOf(first, [kept("s1", "", ["f#cut", "f#res"], [0.2, 0.3], "x")], ""), null);
  // Without the engine's word on this tree, or its shape: nothing.
  assert.equal(relativeOf(null, [kept("s1", "", ["f#cut"], [0.2], "x")], ""), null);
  assert.equal(relativeOf({ knobs: [["f#cut", 0.7]] }, [kept("s1", "", ["f#cut"], [0.2], "x")], ""), null);
  assert.equal(relativeOf({ shape: "s1" }, [kept("s1", "", ["f#cut"], [0.2], "x")], ""), null);
  // A kept entry with no data is passed over.
  assert.deepEqual(relativeOf(first, [kept("s1", "", ["f#cut"], [0.2], "x"), { shape: "s1", set: "" }], "").values, [0.7]);
});

// A graft's turn: Space, turned up, its tree not committed yet.
const turned = { i: 5, dir: 1 };

test("a graft is bound to the tree it committed, not to a time", () => {
  // Asked at the turn, nothing is pending until the engine commits a tree.
  assert.equal(graftIntent.pending(turned, "grafted"), false);
  const committed = graftIntent.committed(turned, "grafted");
  assert.deepEqual(committed, { i: 5, dir: 1, key: "grafted" });
  assert.deepEqual(turned, { i: 5, dir: 1 }, "the turn's intent is left as it was");
  // Pending exactly while its own tree is the one in PERFORM.
  assert.equal(graftIntent.pending(committed, "grafted"), true);
  assert.equal(graftIntent.pending(committed, "another"), false);
  // Its own tree arriving keeps it; any other drops it.
  assert.equal(graftIntent.arrived(committed, "grafted"), committed);
  assert.equal(graftIntent.arrived(committed, "another"), null);
  // A tree arriving before the engine answered drops the turn too.
  assert.equal(graftIntent.arrived(turned, "another"), null);
  // Nothing asked: nothing to commit, nothing pending.
  assert.equal(graftIntent.committed(null, "grafted"), null);
  assert.equal(graftIntent.pending(null, "grafted"), false);
});

test("a refused commit leaves no pending graft, and a refusal of another tree leaves it", () => {
  const committed = graftIntent.committed(turned, "grafted");
  assert.equal(graftIntent.refused(committed, "grafted"), null);
  // A Keep refused while the graft's tree waits behind it in the lane.
  assert.equal(graftIntent.refused(committed, "kept"), committed);
  // A turn not yet committed is not what the bench refused.
  assert.equal(graftIntent.refused(turned, "grafted"), turned);
  assert.equal(graftIntent.refused(null, "grafted"), null);
});

test("no control reaches a sound only when every one was measured and can't", () => {
  const search = (name) => ({ name, knobs: [], search: true });
  const pending = (name) => ({ name, knobs: [], search: false, pending: true });
  const six = ["Bright", "Snap", "Motion", "Body", "Grit", "Space"];
  // Every control amber: the first steps' turn could never be done (#480).
  assert.equal(reachesNone(six.map(search)), true);
  // One control turns a knob: it can.
  assert.equal(reachesNone([wiring("Bright", "f#cut", 0.3), ...six.slice(1).map(search)]), false);
  // One still listening (placed and not measured yet, or left out of a
  // guess) may reach it once it is measured.
  assert.equal(reachesNone([...six.slice(0, 5).map(search), pending("Space")]), false);
  // Nothing measured yet, or no panel, says nothing.
  assert.equal(reachesNone(null), false);
  assert.equal(reachesNone([]), false);
});

test("a sweep by ear goes to both ends and back, and ends where it began", () => {
  assert.equal(SWEEP_MS, 2400);
  const both = [-1, 1];
  // From the centre: down a full turn, up a full turn, home.
  near(sweptTo(0, 0, both), 0);
  near(sweptTo(0, 0.25, both), -1);
  near(sweptTo(0, 0.5, both), 0);
  near(sweptTo(0, 0.75, both), 1);
  near(sweptTo(0, 1, both), 0);
  // From a control already turned, held to its travel, and back to it.
  near(sweptTo(0.4, 0.25, both), -0.6);
  near(sweptTo(0.4, 0.75, both), 1);
  near(sweptTo(0.4, 1, both), 0.4);
  // A control that turns only up never goes below its centre.
  near(sweptTo(0, 0.25, [0, 1]), 0);
  near(sweptTo(0, 0.75, [0, 1]), 1);
});

test("a measurement waiting on the controls asks a hand to let go only when one is held", () => {
  // A control or the XY pad held, however still.
  assert.equal(waitWords(true), "after you let go");
  // None held: a sweep by ear playing, or the 1.5 s after a touch, which
  // end by themselves.
  assert.equal(waitWords(false), "in a moment");
});

// A browser's full screen as Chromium was measured doing it (#575): a request
// or an exit lands when the test says (`land`, in the order they were asked),
// and the fullscreenchange that says so comes at the next frame (`frame`). A
// request made while the document is in full screen, an exit still in flight
// included, is granted at once, with no change to say. `leaveByItself` is the
// browser's own exit (its Esc, its bar).
function slowBrowser() {
  const el = {};
  const doc = { fullscreenElement: null, documentElement: el };
  const todo = []; // what the browser has yet to do, in order
  let changes = 0; // fullscreenchanges waiting for the next frame
  const b = { doc, asked: 0, exits: 0, refuseExits: false, screen: null };
  el.requestFullscreen = () => {
    b.asked++;
    if (doc.fullscreenElement) return Promise.resolve();
    return new Promise((ok) =>
      todo.push(() => {
        doc.fullscreenElement = el;
        changes++;
        ok();
      }),
    );
  };
  doc.exitFullscreen = () => {
    b.exits++;
    if (!doc.fullscreenElement) return Promise.reject(new TypeError("not in full screen"));
    return new Promise((ok, no) =>
      todo.push(() => {
        if (b.refuseExits) return no(new TypeError("refused"));
        doc.fullscreenElement = null;
        changes++;
        ok();
      }),
    );
  };
  const settle = () => new Promise((r) => setImmediate(r));
  b.land = async () => {
    assert.ok(todo.length, "the browser has nothing in flight");
    todo.shift()();
    await settle();
  };
  b.frame = async () => {
    for (; changes > 0; changes--) b.screen.changed();
    await settle();
  };
  b.leaveByItself = async () => {
    doc.fullscreenElement = null;
    changes++;
    await b.frame();
  };
  b.idle = () => todo.length === 0;
  return b;
}
// Stage mode as perform.js runs it: ⇧F opens a stage or closes the one on,
// and `closed` lists the stages the full screen's bookkeeping closed.
function stageOf(b) {
  const st = { on: null, closed: [] };
  b.screen = stageScreen(b.doc, () => {
    st.closed.push(st.on);
    st.close();
  });
  st.open = (name) => {
    st.on = { name, entered: false };
    b.screen.open(st.on);
    return st.on;
  };
  st.close = () => {
    const s = st.on;
    st.on = null;
    b.screen.shut(s);
  };
  return st;
}

test("⇧F to leave and ⇧F straight back, before the screen has left, keeps the new stage on, on the whole screen", async () => {
  const b = slowBrowser();
  const st = stageOf(b);
  const a = st.open("A");
  await b.land();
  await b.frame();
  assert.equal(a.entered, true);
  // ⇧F leaves: the exit is in flight, and the screen is still full.
  st.close();
  assert.equal(b.exits, 1);
  // ⇧F again before it lands: the new stage asks once it has.
  const c = st.open("B");
  assert.equal(b.asked, 1, "a request while the exit is in flight is granted at once, and then lost to it");
  await b.land(); // the exit lands
  await b.frame(); // and says so
  assert.deepEqual(st.closed, [], "the exit of the stage before closed this one");
  assert.equal(st.on, c);
  assert.equal(b.asked, 2);
  await b.land(); // B's own request
  await b.frame();
  assert.equal(c.entered, true);
  assert.equal(b.doc.fullscreenElement, b.doc.documentElement);
  assert.deepEqual(st.closed, []);
});

test("⇧F three times, faster than the screen fills, ends on a stage on the whole screen", async () => {
  const b = slowBrowser();
  const st = stageOf(b);
  st.open("A");
  await b.land(); // A's request is granted; its change waits for the frame
  st.close(); // ⇧F leaves before that frame
  const c = st.open("B"); // and ⇧F comes back
  await b.frame(); // A's change, the screen full
  await b.land(); // A's exit lands
  await b.frame();
  await b.land(); // B's own request
  await b.frame();
  assert.deepEqual(st.closed, []);
  assert.equal(st.on, c);
  assert.equal(c.entered, true);
  assert.equal(b.doc.fullscreenElement, b.doc.documentElement);
});

test("a stage is in full screen by its own request only", async () => {
  const b = slowBrowser();
  const st = stageOf(b);
  const a = st.open("A");
  st.close(); // left before A's request was granted
  const c = st.open("B");
  await b.land(); // A's request, granted late
  assert.equal(a.entered, false);
  assert.equal(c.entered, false, "A's grant marked B");
  await b.land(); // B's own
  assert.equal(c.entered, true);
  await b.frame();
  assert.deepEqual(st.closed, []);
});

test("a grant that comes after its stage has gone leaves the stage on now in full screen", async () => {
  const b = slowBrowser();
  const st = stageOf(b);
  st.open("A");
  st.close(); // left before A's request was granted: nothing to leave yet
  const c = st.open("B"); // and ⇧F straight back
  await b.land(); // A's request, granted late, with B on
  await b.land(); // B's own
  await b.frame();
  // Handing A's grant back would have left B with an exit in flight, and
  // that exit, landing, would have closed it.
  assert.equal(b.exits, 0, "A's late grant handed back the screen B is on");
  assert.ok(b.idle());
  assert.deepEqual(st.closed, []);
  assert.equal(c.entered, true);
  assert.equal(b.doc.fullscreenElement, b.doc.documentElement);
});

test("a stage closed while it waits on the last one's exit never asks for the screen", async () => {
  const b = slowBrowser();
  const st = stageOf(b);
  st.open("A");
  await b.land();
  await b.frame();
  st.close(); // ⇧F leaves: A's exit is in flight
  st.open("B"); // ⇧F: B waits on that exit
  st.close(); // ⇧F: B leaves before it has landed, a second exit
  await b.land(); // A's exit
  await b.land(); // B's
  await b.frame();
  // Asked once both had landed, it would have filled the window with no
  // stage on it, and handed it straight back.
  assert.equal(b.asked, 1, "B asked for the screen after it had closed");
  assert.ok(b.idle());
  assert.equal(b.doc.fullscreenElement, null);
  assert.deepEqual(st.closed, []);
});

test("a stage left before the screen filled leaves no full screen behind", async () => {
  const b = slowBrowser();
  const st = stageOf(b);
  st.open("A");
  st.close(); // nothing to leave yet: the request is still in flight
  assert.equal(b.exits, 0);
  await b.land(); // the request is granted, with no stage on
  assert.equal(b.exits, 1, "the screen was not handed back");
  await b.land();
  await b.frame();
  assert.equal(b.doc.fullscreenElement, null);
  assert.ok(b.idle());
});

test("leaving full screen by the browser's own means leaves stage mode; a stage never in full screen stays", async () => {
  const b = slowBrowser();
  const st = stageOf(b);
  const a = st.open("A");
  await b.land();
  await b.frame();
  await b.leaveByItself(); // the browser's Esc
  assert.deepEqual(st.closed, [a]);
  assert.equal(st.on, null);
  assert.equal(b.exits, 0, "the screen had already left");
  // A stage whose request was refused stays on, over the window.
  const refused = slowBrowser();
  refused.doc.documentElement.requestFullscreen = () => Promise.reject(new TypeError("no gesture"));
  const st2 = stageOf(refused);
  const c = st2.open("B");
  await new Promise((r) => setImmediate(r));
  await refused.leaveByItself();
  assert.equal(c.entered, false);
  assert.deepEqual(st2.closed, []);
  assert.equal(st2.on, c);
});

test("an exit the browser refuses does not keep the next stage from asking", async () => {
  const b = slowBrowser();
  const st = stageOf(b);
  st.open("A");
  await b.land();
  await b.frame();
  b.refuseExits = true;
  st.close();
  const c = st.open("B");
  assert.equal(b.asked, 1);
  await b.land(); // the exit, refused: the screen stays full
  assert.equal(b.asked, 2, "B never asked");
  // Still in full screen, B's request is granted at once.
  assert.equal(c.entered, true);
  await b.frame();
  assert.deepEqual(st.closed, []);
});

test("the offer B shows growing is one out for this sound, not withdrawn and not an unclaimed spare", () => {
  const out = (...entries) => new Map(entries.map((q, i) => [i + 1, q]));
  const offer = (more = {}) => ({ kind: "perform_offer", gen: 3, ...more });
  assert.equal(growingOffer(new Map(), 3), null);
  // A pressed Offer's, or Wander's.
  const pressed = offer();
  assert.equal(growingOffer(out(pressed), 3), pressed);
  // A spare grown ahead is out of sight until Offer claims it.
  assert.equal(growingOffer(out(offer({ spare: { at: new Map() } })), 3), null);
  const claimed = offer({ spare: { at: new Map() }, promote: true });
  assert.equal(growingOffer(out(claimed), 3), claimed);
  // An aimed offer another turn replaced, and one for the sound before.
  assert.equal(growingOffer(out(offer({ superseded: true }), offer({ gen: 2 })), 3), null);
  // Not a measurement or a drift.
  assert.equal(growingOffer(out({ kind: "perform_wire", gen: 3 }, { kind: "perform_drift", gen: 3 }), 3), null);
  // The spare an aimed turn set aside, beside the aimed offer it grows for.
  const aimed = offer({ aim: { k: 0, sign: 1, word: "brighter" } });
  assert.equal(growingOffer(out(offer({ spare: { at: new Map() }, promote: false }), aimed), 3), aimed);
});

test("PEEK and TAKE with nothing in B say an offer is growing while one is, and that none was asked for otherwise", () => {
  assert.equal(notOffered("peek", { kind: "perform_offer" }), "Still growing an offer. Keep holding Peek to hear it as it lands.");
  assert.equal(notOffered("take", { kind: "perform_offer" }), "Still growing an offer. Take it once it’s in B.");
  assert.equal(notOffered("peek", null), "Nothing offered yet. Press Offer first.");
  assert.equal(notOffered("take", null), "Nothing offered yet. Press Offer, or turn Wander up.");
});
