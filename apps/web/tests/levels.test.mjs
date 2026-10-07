// Unit tests for levels.js: how the levels sit, how a key, a hash or a
// saved name moves between them, and the rules of the move itself (the
// morph, the flight, the wheel and the pinch), and what ⌘K's list finds
// for a query and in what order.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVELS, ASIDE, HOME, BY_DIGIT, WHERE, ALL,
  isLevel, digitKey, dirOf, step, railPath, savedLevel, hashLevel, startLevel, levelForKey,
  MORPH, MORPH_GONE, MORPH_SHOWN, WHERE_SLIDE, flightEnds, easeInOut, flightAt,
  WHEEL_STEP, WHEEL_IDLE_MS, WHEEL_LOCK_MS, wheelStep, wheelOwner, PINCH_IN, PINCH_OUT, pinchStep,
  rank, fuzzy, hitMarks, cmdkList, SOUNDS_SHOWN,
} from "../levels.js";

test("the axis runs out to in, with EVOLVE beside PERFORM", () => {
  assert.deepEqual(LEVELS, ["learning", "taste", "perform", "patch"]);
  assert.equal(ASIDE, "evolve");
  assert.equal(HOME, "perform");
  assert.deepEqual(ALL.slice().sort(), ["evolve", "learning", "patch", "perform", "taste"]);
  for (const l of ALL) assert.equal(WHERE[l].length, 2, `${l} has a name and a line`);
});

test("⌥1 to ⌥5 go to perform, patch, evolve, taste, learning", () => {
  assert.deepEqual(BY_DIGIT, ["perform", "patch", "evolve", "taste", "learning"]);
  assert.equal(digitKey("perform"), "⌥1");
  assert.equal(digitKey("learning"), "⌥5");
  assert.equal(digitKey("play"), "");
  for (let i = 1; i <= 5; i++) assert.equal(levelForKey("taste", "x", `Digit${i}`), BY_DIGIT[i - 1]);
  assert.equal(levelForKey("taste", "x", "Digit6"), null);
});

test("a move has a direction: in, out, or aside", () => {
  assert.equal(dirOf("perform", "patch"), "in");
  assert.equal(dirOf("perform", "taste"), "out");
  assert.equal(dirOf("learning", "patch"), "in");
  assert.equal(dirOf("patch", "evolve"), "left");
  assert.equal(dirOf("evolve", "taste"), "right");
  assert.equal(dirOf("taste", "taste"), null);
  assert.equal(dirOf("taste", "nowhere"), null);
});

test("a step stops at the ends, and from EVOLVE is measured from PERFORM", () => {
  assert.equal(step("perform", "in"), "patch");
  assert.equal(step("perform", "out"), "taste");
  assert.equal(step("taste", "out"), "learning");
  assert.equal(step("learning", "out"), null);
  assert.equal(step("patch", "in"), null);
  assert.equal(step("evolve", "out"), "taste");
  assert.equal(step("evolve", "in"), "patch");
  assert.equal(step("perform", "sideways"), null);
});

test("⌥ and an arrow: up zooms out, down zooms in, left to EVOLVE, right back", () => {
  assert.equal(levelForKey("perform", "ArrowUp"), "taste");
  assert.equal(levelForKey("perform", "ArrowDown"), "patch");
  assert.equal(levelForKey("patch", "ArrowLeft"), "evolve");
  assert.equal(levelForKey("evolve", "ArrowLeft"), null);
  assert.equal(levelForKey("evolve", "ArrowRight"), "perform");
  assert.equal(levelForKey("taste", "ArrowRight"), null);
  assert.equal(levelForKey("learning", "ArrowUp"), null);
  assert.equal(levelForKey("perform", "a", "KeyA"), null);
});

test("the rail turns the corner at PERFORM on the way to or from EVOLVE", () => {
  assert.deepEqual(railPath("taste", "evolve"), ["taste", "perform", "evolve"]);
  assert.deepEqual(railPath("evolve", "patch"), ["evolve", "perform", "patch"]);
  assert.deepEqual(railPath("perform", "evolve"), ["perform", "evolve"]);
  assert.deepEqual(railPath("taste", "patch"), ["taste", "patch"]);
  assert.deepEqual(railPath("taste", "taste"), ["taste"]);
});

test("a saved 'play' opens PATCH, and junk opens nothing", () => {
  assert.equal(savedLevel("play"), "patch");
  assert.equal(savedLevel("patch"), "patch");
  assert.equal(savedLevel("evolve"), "evolve");
  assert.equal(savedLevel("rack"), null);
  assert.equal(savedLevel(null), null);
  assert.equal(isLevel("play"), false);
});

test("the start level: the hash, else the saved level, else PERFORM", () => {
  assert.equal(hashLevel("#taste"), "taste");
  assert.equal(hashLevel("#TASTE"), "taste");
  assert.equal(hashLevel("#film-tour"), null);
  assert.equal(hashLevel(""), null);
  assert.equal(startLevel("#learning", "patch"), "learning");
  assert.equal(startLevel("", "patch"), "patch");
  assert.equal(startLevel("", "play"), "patch");
  assert.equal(startLevel("#nope", "nope"), "perform");
  assert.equal(startLevel("", null), "perform");
});

test("every direction moves both sections, the arriving one from the other side", () => {
  for (const d of ["in", "out", "left", "right"]) {
    const [leave, arrive] = MORPH[d];
    assert.equal(leave.length, 2);
    assert.equal(arrive.length, 2);
    // Each ends where it rests, or starts from it: nothing is left scaled.
    assert.match(leave[0], /^(scale\(1\)|translateX\(0\))$/, d);
    assert.match(arrive[1], /^(scale\(1\)|translateX\(0\))$/, d);
  }
  // In: what you leave grows past you, what you reach comes from small.
  assert.deepEqual(MORPH.in, [["scale(1)", "scale(1.12)"], ["scale(0.86)", "scale(1)"]]);
  // Out is in reversed; left and right mirror each other.
  assert.deepEqual(MORPH.out, [["scale(1)", "scale(0.86)"], ["scale(1.12)", "scale(1)"]]);
  assert.equal(MORPH.left[0][1], "translateX(14%)");
  assert.equal(MORPH.right[0][1], "translateX(-14%)");
  // The old one is gone before the new one is most of the way in.
  assert.ok(MORPH_SHOWN < MORPH_GONE && MORPH_GONE < 1);
  // The name: in rises from below, out drops from above, aside slides.
  assert.deepEqual(WHERE_SLIDE.in, [0, 10]);
  assert.deepEqual(WHERE_SLIDE.out, [0, -10]);
  assert.ok(WHERE_SLIDE.left[0] < 0 && WHERE_SLIDE.right[0] > 0);
});

test("the face flies between the two places a level draws it, and makes up none", () => {
  const a = { x: 100, y: 200, w: 60, h: 100 };
  const b = { x: 700, y: 120, w: 30, h: 50 };
  // Both ends: from one to the other, drawn whole.
  assert.deepEqual(flightEnds(a, b, "in"), { from: a, to: b, fade: null });
  // No place where it lands: it fades out, drifting the way you went, and
  // smaller, centred on where it was.
  const off = flightEnds(a, null, "left");
  assert.equal(off.fade, "out");
  assert.ok(off.to.x > a.x);
  assert.equal(off.to.w, a.w * 0.8);
  assert.equal(flightEnds(a, null, "right").to.x < a.x, true);
  const stay = flightEnds(a, null, "out");
  assert.equal(stay.to.x + stay.to.w / 2, a.x + a.w / 2);
  assert.equal(stay.to.y + stay.to.h / 2, a.y + a.h / 2);
  // No place it came from: it fades in where it lands, from nowhere made up.
  assert.deepEqual(flightEnds(null, b, "out"), { from: b, to: b, fade: "in" });
  // Neither, or a box with no size: nothing flies.
  assert.equal(flightEnds(null, null, "in"), null);
  assert.equal(flightEnds({ x: 0, y: 0, w: 0, h: 10 }, null, "in"), null);
  assert.equal(flightEnds({ x: NaN, y: 0, w: 4, h: 10 }, undefined, "in"), null);
});

test("a flight starts at its start and lands exactly on its end", () => {
  const f = flightEnds({ x: 0, y: 0, w: 10, h: 20 }, { x: 100, y: 50, w: 30, h: 60 }, "in");
  assert.deepEqual(flightAt(f, 0), { box: { x: 0, y: 0, w: 10, h: 20 }, alpha: 1 });
  assert.deepEqual(flightAt(f, 1), { box: { x: 100, y: 50, w: 30, h: 60 }, alpha: 1 });
  assert.deepEqual(flightAt(f, 7), flightAt(f, 1)); // past the end it stays there
  const mid = flightAt(f, 0.5).box;
  assert.equal(mid.x, 50);
  assert.equal(mid.h, 40);
  // The curve: slow at both ends, symmetric.
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.ok(easeInOut(0.1) < 0.1 && easeInOut(0.9) > 0.9);
  assert.ok(Math.abs(easeInOut(0.3) + easeInOut(0.7) - 1) < 1e-12);
  // Fading in, it grows from nothing to whole; fading out, the reverse.
  const fin = flightEnds(null, { x: 1, y: 2, w: 3, h: 4 }, "in");
  assert.equal(flightAt(fin, 0).alpha, 0);
  assert.equal(flightAt(fin, 1).alpha, 1);
  const fout = flightEnds({ x: 1, y: 2, w: 3, h: 4 }, null, "in");
  assert.equal(flightAt(fout, 0).alpha, 1);
  assert.equal(flightAt(fout, 1).alpha, 0);
});

test("the wheel moves a level once it has turned past the step, then rests for the rest of the turn", () => {
  let st = {};
  let r;
  // A trackpad's small deltas add up; up is in.
  for (let i = 0; i < 5; i++) {
    r = wheelStep(st, -12, 1000 + i * 16);
    st = r.st;
    assert.equal(r.dir, null, `at ${-12 * (i + 1)}`);
  }
  r = wheelStep(st, -12, 1100);
  assert.equal(r.dir, "in");
  st = r.st;
  // The turn's momentum after it moves nothing, however far, until the lock is over.
  for (const t of [1110, 1300, 1100 + WHEEL_LOCK_MS - 1]) {
    r = wheelStep(st, -400, t);
    st = r.st;
    assert.equal(r.dir, null, `at ${t}`);
  }
  // Then a turn down past the step is out.
  r = wheelStep(st, 80, 1100 + WHEEL_LOCK_MS + 1);
  assert.equal(r.dir, "out");
  // A mouse wheel's notch (100 px) is one level.
  assert.equal(wheelStep({}, -100, 0).dir, "in");
  assert.equal(wheelStep({}, WHEEL_STEP, 0).dir, null);
  // A pause starts the count again: two halves far apart are nothing.
  st = wheelStep({}, -40, 0).st;
  assert.equal(wheelStep(st, -40, WHEEL_IDLE_MS + 1).dir, null);
  assert.equal(wheelStep(st, -40, WHEEL_IDLE_MS - 1).dir, "in");
  // Back and forth cancels.
  st = wheelStep({}, -60, 0).st;
  assert.equal(wheelStep(st, 60, 10).st.acc, 0);
  // A junk delta counts as nothing.
  assert.equal(wheelStep({}, NaN, 0).st.acc, 0);
});

test("a turn of ⌥ and the wheel that starts over something that can scroll is the scroller's to its end", () => {
  // Over a list that can scroll that way: the list's, the whole turn, even
  // once it reaches its end (its momentum is not a move).
  let t = wheelOwner(null, 0, true);
  assert.equal(t.to, "scroll");
  t = wheelOwner(t, 100, false);
  assert.equal(t.to, "scroll");
  t = wheelOwner(t, 100 + WHEEL_IDLE_MS, false);
  assert.equal(t.to, "scroll");
  // A pause ends the turn: the next is asked again, and at the list's end
  // it is the levels'.
  t = wheelOwner(t, 100 + 2 * WHEEL_IDLE_MS + 1, false);
  assert.equal(t.to, "levels");
  // A turn that started on the levels stays theirs over a list.
  assert.equal(wheelOwner(t, 100 + 2 * WHEEL_IDLE_MS + 10, true).to, "levels");
  // Nothing under the pointer that scrolls: the levels'.
  assert.equal(wheelOwner(null, 0, false).to, "levels");
});

test("a pinch spread past 1.3 goes in, closed under 0.77 goes out, and leans on the way", () => {
  assert.equal(pinchStep(PINCH_IN + 0.01).dir, "in");
  assert.equal(pinchStep(PINCH_OUT - 0.01).dir, "out");
  assert.equal(pinchStep(1).dir, null);
  assert.deepEqual(pinchStep(1).lean, { dir: "in", t: 0 });
  const half = pinchStep(1.15);
  assert.equal(half.dir, null);
  assert.equal(half.lean.dir, "in");
  assert.ok(Math.abs(half.lean.t - 0.5) < 1e-9);
  const closing = pinchStep(0.885);
  assert.equal(closing.lean.dir, "out");
  assert.ok(Math.abs(closing.lean.t - 0.5) < 1e-9);
  assert.equal(pinchStep(PINCH_IN).lean.t, 1);
  assert.deepEqual(pinchStep(0), { dir: null, lean: null });
  assert.deepEqual(pinchStep(NaN), { dir: null, lean: null });
});

// ---------- ⌘K ----------

test("a query ranks a label's start first, then a word's start, then anywhere, then scattered letters", () => {
  const start = rank("down", "Download your taste");
  const word = rank("taste", "Download your taste");
  const inside = rank("load", "Download your taste");
  const scattered = rank("dyt", "Download your taste");
  assert.ok(start > word && word > inside && inside > scattered && scattered > 0, `${start} ${word} ${inside} ${scattered}`);
  assert.equal(rank("xyz", "Download your taste"), -1);
  // Case and the spaces around a query don't count.
  assert.equal(rank("  DOWN ", "Download your taste"), start);
  // A shorter label that starts with it comes before a longer one.
  assert.ok(rank("open", "Open a taste file…") > rank("open", "Open a taste file… and more"));
  // An earlier word before a later one.
  assert.ok(rank("taste", "Taste your taste") > rank("taste", "Reset your taste…"));
  // A word starts after anything that isn't a letter or a digit.
  assert.ok(rank("tall", "⇕ tall: a taller keybed") >= 80 - 1);
  // No query names everything alike.
  assert.equal(rank("", "anything"), rank("", "else"));
});

test("fuzzy finds a query's letters in order, and the marks are what rank counted", () => {
  assert.deepEqual(fuzzy("dyt", "Download your taste"), [0, 9, 14]);
  assert.equal(fuzzy("tyd", "Download your taste"), null);
  assert.deepEqual(hitMarks("down", "Download your taste"), [0, 1, 2, 3]);
  assert.deepEqual(hitMarks("taste", "Download your taste"), [14, 15, 16, 17, 18]);
  assert.deepEqual(hitMarks("load", "Download"), [4, 5, 6, 7]);
  assert.deepEqual(hitMarks("dyt", "Download your taste"), [0, 9, 14]);
  assert.deepEqual(hitMarks("", "Download"), []);
  assert.deepEqual(hitMarks("q", "Download"), []);
});

test("the list keeps its groups in order with no query, and shows every command but five sounds", () => {
  const items = (n, p) => Array.from({ length: n }, (_, i) => ({ label: `${p} ${i}` }));
  const groups = [
    { name: "This level", items: items(3, "here") },
    { name: "Anywhere", items: items(30, "anywhere") },
    { name: "Sounds", items: items(12, "sound"), cap: SOUNDS_SHOWN },
  ];
  const list = cmdkList(groups, "");
  assert.deepEqual(list.map((g) => g.name), ["This level", "Anywhere", "Sounds"]);
  assert.deepEqual(list.map((g) => g.hits.length), [3, 30, 5]);
  assert.deepEqual(list[1].hits.map((h) => h.item.label).slice(0, 3), ["anywhere 0", "anywhere 1", "anywhere 2"]);
  // A group with nothing to show is left out.
  assert.deepEqual(cmdkList([{ name: "This level", items: [] }, ...groups.slice(1)], "").map((g) => g.name), ["Anywhere", "Sounds"]);
});

test("with a query the group with the best hit leads, its hits best first, and eight sounds at most", () => {
  const groups = [
    { name: "This level", items: [{ label: "Another pair" }] },
    { name: "Anywhere", items: [{ label: "Reset your taste…" }, { label: "Download your taste" }, { label: "Open a taste file…" }] },
    { name: "Sounds", items: [{ label: "Glass Pad" }, { label: "Taste Maker" }], cap: SOUNDS_SHOWN },
  ];
  const list = cmdkList(groups, "taste");
  // "Taste Maker" starts with it: Sounds leads.
  assert.deepEqual(list.map((g) => g.name), ["Sounds", "Anywhere"]);
  assert.equal(list[0].hits[0].item.label, "Taste Maker");
  // Within Anywhere each has it as its third word: a tie, in the order given.
  assert.deepEqual(list[1].hits.map((h) => h.item.label), ["Reset your taste…", "Download your taste", "Open a taste file…"]);
  const many = cmdkList([{ name: "Sounds", items: Array.from({ length: 20 }, (_, i) => ({ label: `Pad ${i}` })), cap: SOUNDS_SHOWN }], "pad");
  assert.equal(many[0].hits.length, 8);
  // A prefix outranks a word inside a longer label, across groups too.
  const prefix = cmdkList([
    { name: "Anywhere", items: [{ label: "Hear the pool" }] },
    { name: "Sounds", items: [{ label: "Pool Party" }], cap: SOUNDS_SHOWN },
  ], "pool");
  assert.equal(prefix[0].hits[0].item.label, "Pool Party");
});
