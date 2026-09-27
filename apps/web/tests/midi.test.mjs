// Unit tests for the pure half of midi.js. Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { parse, relativeDelta, detectRelative, Pickup, ClockTempo } from "../midi.js";

test("parse decodes the messages the instrument uses", () => {
  assert.deepEqual(parse([0x91, 60, 127]), { kind: "on", ch: 1, note: 60, vel: 1 });
  assert.deepEqual(parse([0x90, 60, 0]), { kind: "off", ch: 0, note: 60 });
  assert.deepEqual(parse([0xb0, 21, 64]), { kind: "cc", ch: 0, cc: 21, value: 64 });
  assert.equal(parse([0xe0, 0, 64]).value, 0);
  assert.equal(parse([0xe0, 127, 127]).value, 8191);
  assert.equal(parse([0xf8]).kind, "clock");
  assert.equal(parse([0xd0, 127]).value, 1);
});

test("relative deltas decode both common encodings", () => {
  assert.equal(relativeDelta(1, "twos"), 1);
  assert.equal(relativeDelta(127, "twos"), -1);
  assert.equal(relativeDelta(66, "offset"), 2);
  assert.equal(relativeDelta(62, "offset"), -2);
});

test("an encoder is recognised, and a pot swept to its stop is not", () => {
  assert.equal(detectRelative([1, 1, 1, 2, 1, 1, 127, 127]), "twos");
  assert.equal(detectRelative([65, 65, 66, 65, 63, 63, 63]), "offset");
  // A pot swept down to zero sends only small values but never repeats.
  assert.equal(detectRelative([7, 6, 5, 4, 3, 2, 1, 0]), "abs");
  assert.equal(detectRelative([10, 20, 30, 40, 50, 60]), "abs");
  assert.equal(detectRelative([1, 1]), "abs", "too few samples to say");
});

test("pickup ignores a pot until it passes the control's value", () => {
  const p = new Pickup(0.02);
  assert.equal(p.offer(0.5, 0.9), false);
  assert.equal(p.offer(0.5, 0.8), false);
  assert.equal(p.offer(0.5, 0.45), true, "crossed 0.5 on the way down");
  assert.equal(p.offer(0.45, 0.2), true, "and follows from there");
  p.release();
  assert.equal(p.offer(0.7, 0.2), false, "a drifted control has to be picked up again");
});

test("clock tempo is read by least squares and resists a late tick", () => {
  const c = new ClockTempo();
  const ms = 60000 / (120 * 24);
  for (let i = 0; i < 48; i++) c.tick(1000 + i * ms + (i === 30 ? 6 : 0));
  assert.ok(Math.abs(c.bpm - 120) < 0.5, `read ${c.bpm}`);
  const s = new ClockTempo();
  for (let i = 0; i < 10; i++) s.tick(i * ms);
  assert.equal(s.bpm, null, "not before a full beat");
});

test("after Start, every 24th clock tick puts the transport on the room's beat", async () => {
  const { createMidi } = await import("../midi.js");
  const calls = [];
  const host = new Proxy(
    { transportBeats: (b) => calls.push(b), transportStart: () => calls.push("start"), controlNames: () => [] },
    { get: (t, k) => (k in t ? t[k] : () => {}) },
  );
  const midi = createMidi(host);
  for (let i = 0; i < 10; i++) midi.feed([0xf8], i); // no Start: no transport
  assert.deepEqual(calls, []);
  midi.feed([0xfa], 100);
  for (let i = 0; i < 49; i++) midi.feed([0xf8], 101 + i);
  assert.deepEqual(calls, ["start", 0, 1, 2]);
  midi.feed([0xfc], 200);
  for (let i = 0; i < 30; i++) midi.feed([0xf8], 201 + i);
  assert.deepEqual(calls, ["start", 0, 1, 2], "a stopped clock drives nothing");
});

// Just enough DOM for the MIDI panel to render into.
function fakeDocument() {
  const createElement = (tag) => {
    const classes = new Set();
    const el = {
      tag,
      children: [],
      append(...xs) {
        el.children.push(...xs);
      },
      setAttribute() {},
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c), on),
      },
    };
    Object.defineProperty(el, "innerHTML", { set: () => (el.children = []) });
    return el;
  };
  return { createElement, createTextNode: (t) => ({ textContent: t }) };
}

// A page that asks for MIDI at load and again from a click, with every
// request left for the test to answer.
async function askedTwice() {
  const { createMidi } = await import("../midi.js");
  const asks = [];
  navigator.requestMIDIAccess = () => new Promise((resolve, reject) => asks.push({ resolve, reject }));
  const seen = [];
  const host = new Proxy(
    { onDevices: (n, status) => seen.push([n, status]), controlNames: () => [] },
    { get: (t, k) => (k in t ? t[k] : () => {}) },
  );
  const midi = createMidi(host);
  const panel = document.createElement("div");
  panel.classList.add("hidden");
  midi.attachPanel(panel);
  midi.togglePanel(); // opening the panel is a click, and asks again
  return { asks, seen };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const device = () => ({ name: "Keys", onmidimessage: null });

test("two grants of MIDI access wire each device once", async () => {
  const doc = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const { asks, seen } = await askedTwice();
    assert.equal(asks.length, 2, "asked at load, and again from the click");
    const [a, b] = [device(), device()];
    asks[0].resolve({ inputs: new Map([["keys", a]]) });
    asks[1].resolve({ inputs: new Map([["keys", b]]) });
    await settle();
    assert.equal(typeof a.onmidimessage, "function", "the first grant is wired");
    assert.equal(b.onmidimessage, null, "the second is not, or every message would arrive twice");
    assert.deepEqual(seen.at(-1), [1, "ready"]);
  } finally {
    delete navigator.requestMIDIAccess;
    globalThis.document = doc;
  }
});

test("a refusal after a grant does not undo it", async () => {
  const doc = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const { asks, seen } = await askedTwice();
    asks[0].resolve({ inputs: new Map([["keys", device()]]) });
    await settle();
    asks[1].reject(Object.assign(new Error("refused"), { name: "NotAllowedError" }));
    await settle();
    assert.deepEqual(seen.at(-1), [1, "ready"]);
  } finally {
    delete navigator.requestMIDIAccess;
    globalThis.document = doc;
  }
});
