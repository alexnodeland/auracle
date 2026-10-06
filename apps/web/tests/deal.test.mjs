// Unit tests for EVOLVE's dealing rules (deal.js): which answer to a deal
// goes up, which waits as the next pair, which is dealt again and which is
// thrown away. The table, the undo window's pick and the engine are fakes
// that do what main.js and the worker do: `place` puts a pair up and tells
// the dealer, as `placePair` does, and each deal asked for takes the next
// answer from a scripted engine, handed back when the test says it lands.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { createDealer, usable, holdsCut, samePair, RETRIES } from "../deal.js";

const P = [1, 7];
const Q = [2, 10];
const R = [5, 22];
const S = [12, 20];
const T = [3, 4];

/** A dealer over a fake table. `answers` is the engine's stream: each deal
 *  asked for takes the next answer, in order, and `land()` hands the oldest
 *  one asked for back to the dealer (the worker answers in order). `heard`
 *  says which sounds are here (all of them by default). The helpers do what
 *  main.js does around the dealer: `pick` holds the pair in its undo window
 *  and puts it away, `skip` puts it away (↻), `undo` takes the pick back. */
function setup({ answers = [], heard = () => true } = {}) {
  const t = {
    table: null,
    held: null,
    cut: new Set(),
    gone: new Set(),
    asked: [], // "table" | "ahead", in the order asked
    shown: [], // every pair put up, in order
    fetched: [],
    nothing: 0, // how many times the table was told there is nothing to deal
    inFlight: [], // answers asked for and not yet landed, oldest first
    stream: [...answers],
  };
  const dealer = createDealer({
    table: () => t.table,
    held: () => t.held,
    cut: t.cut,
    gone: t.gone,
    heard: (id) => heard(id),
    ask: (ahead) => {
      t.asked.push(ahead ? "ahead" : "table");
      t.inFlight.push(t.stream.length ? t.stream.shift() : null);
    },
    place: (pair) => {
      t.table = pair;
      t.shown.push(pair);
      dealer.placed(pair);
    },
    fetch: (pair) => t.fetched.push(pair),
    nothing: () => {
      t.nothing += 1;
    },
  });
  t.dealer = dealer;
  /** The oldest deal out lands (or `pair`, in its place). */
  t.land = (...pair) => {
    const answer = t.inFlight.shift();
    dealer.dealt(pair.length ? pair[0] : answer, null);
  };
  /** Every deal out lands, and every deal those ask for, until none is out. */
  t.settle = () => {
    while (t.inFlight.length) t.land();
  };
  t.skip = () => {
    const prev = t.table;
    t.table = null;
    return dealer.another(prev);
  };
  t.pick = () => {
    t.held = t.table;
    return t.skip();
  };
  t.undo = () => {
    const displaced = t.table;
    t.table = t.held;
    t.held = null;
    dealer.retract(displaced, null);
  };
  return t;
}

/** A table with P up, dealt from the stream and settled. */
function upWith(answers, opts) {
  const t = setup({ answers, ...opts });
  t.dealer.deal();
  t.settle();
  return t;
}

test("a pair may go up unless a side is cut or gone, or it is the pair on the table, the one put away or the pick held", () => {
  const cut = new Set();
  const gone = new Set();
  const at = (more) => ({ cut, gone, ...more });
  assert.equal(usable(Q, at({ table: P })), true);
  assert.equal(usable(Q, at({ table: [10, 2] })), false, "the pair on the table, its sides swapped");
  assert.equal(usable(Q, at({ left: Q })), false, "the pair just put away");
  assert.equal(usable(Q, at({ held: Q })), false, "the pick held in its undo window");
  assert.equal(usable(null, at()), false);
  assert.equal(usable([2], at()), false);
  cut.add(10);
  assert.equal(usable(Q, at()), false, "a side cut");
  assert.equal(holdsCut(Q, cut), true);
  cut.clear();
  gone.add(2);
  assert.equal(usable(Q, at()), false, "a side gone from the pool");
  assert.equal(samePair(P, [7, 1]), true);
  assert.equal(samePair(null, P), false);
});

test("the waiting table puts up the first answer it may, and asks for the pair after once its sounds are here", () => {
  const here = new Set();
  const t = setup({ answers: [P, Q], heard: (id) => here.has(id) });
  t.dealer.deal();
  t.land();
  assert.deepEqual(t.shown, [P]);
  assert.deepEqual(t.asked, ["table"], "the pair after is not dealt before the table's sounds are here");
  for (const id of P) here.add(id);
  t.dealer.dealAhead();
  assert.deepEqual(t.asked, ["table", "ahead"]);
  t.land();
  assert.deepEqual(t.dealer.next, Q);
  assert.deepEqual(t.fetched, [Q], "its sounds are fetched as it waits");
  t.dealer.dealAhead();
  assert.equal(t.asked.length, 2, "one pair waits, and no other is dealt");
});

test("with the table waiting, an answer it may not put up is dealt again three times, and the fourth goes up anyway", () => {
  // P up, and the deal ahead came back empty: nothing waits.
  const t = upWith([P]);
  t.asked.length = 0;
  assert.equal(t.skip(), false);
  // The pool too small to deal anything but the pair just put away.
  for (let i = 0; i < RETRIES; i++) {
    t.land(P);
    assert.equal(t.table, null, `answer ${i + 1} went up`);
  }
  assert.deepEqual(t.asked, Array(RETRIES + 1).fill("table"));
  t.land(P);
  assert.deepEqual(t.table, P, "the fourth answer goes up, so the cards are not dimmed for good");
});

test("an answer holding a sound cut while it was out is dealt again however many tries it takes", () => {
  const t = upWith([P]);
  t.asked.length = 0;
  t.skip();
  t.cut.add(22);
  for (let i = 0; i < RETRIES + 3; i++) t.land(R);
  assert.equal(t.table, null, "a pair holding a cut sound was put up");
  // The skip's deal, and one more for each answer.
  assert.deepEqual(t.asked, Array(1 + RETRIES + 3).fill("table"));
  t.land(S);
  assert.deepEqual(t.table, S);
});

test("a refused answer with another deal out waits for that one", () => {
  const t = upWith([P]);
  t.skip(); // a deal for the table
  t.dealer.deal(); // and another, out at once
  const asked = t.asked.length;
  t.land(P); // the pair just put away: refused
  assert.equal(t.asked.length, asked, "a third deal was asked for");
  t.land(Q);
  assert.deepEqual(t.table, Q);
});

test("an answer that may not wait as the next pair is dealt again, at most three times", () => {
  const t = upWith([P, P, P, P, P]);
  // The deal ahead came back as the pair on the table each time: three more
  // were asked for, and then no more until the table changes.
  assert.deepEqual(t.asked, ["table", "ahead", "ahead", "ahead", "ahead"]);
  assert.equal(t.dealer.next, null);
  assert.equal(t.dealer.out, 0);
});

test("a pick puts the next pair up at once and deals the one after", () => {
  const t = upWith([P, Q, R]);
  assert.deepEqual(t.dealer.next, Q);
  assert.equal(t.pick(), true, "the next pair went up in the pick's own call");
  assert.deepEqual(t.table, Q);
  assert.deepEqual(t.asked, ["table", "ahead", "ahead"]);
  t.land();
  assert.deepEqual(t.dealer.next, R);
});

test("a pick with the next deal still out waits for that deal, and asks for no second", () => {
  const t = upWith([P, Q, R]);
  t.pick(); // Q up, the deal behind it out
  assert.equal(t.pick(), false, "with nothing waiting the table waits");
  assert.equal(t.table, null);
  assert.deepEqual(t.asked, ["table", "ahead", "ahead"], "a second deal was asked for");
  t.land();
  assert.deepEqual(t.table, R, "the deal that was out goes up");
  assert.deepEqual(t.shown, [P, Q, R]);
});

test("a pair waiting that loses a sound to a cut or the pool is dropped, and another is dealt", () => {
  const t = upWith([P, Q, R]);
  t.cut.add(10);
  t.dealer.check();
  assert.equal(t.dealer.next, null);
  assert.deepEqual(t.asked, ["table", "ahead", "ahead"]);
  t.land();
  assert.deepEqual(t.dealer.next, R);
  t.gone.add(5);
  t.dealer.check();
  assert.equal(t.dealer.next, null);
  assert.equal(t.dealer.out, 1);
});

test("a deal the engine could not run ends the table's wait only when no other is out", () => {
  const t = upWith([P]);
  t.skip();
  t.dealer.deal();
  assert.equal(t.dealer.failed(), false, "another deal is still out");
  assert.equal(t.dealer.failed(), true);
  assert.equal(t.dealer.out, 0);
});

test("a taken-back pick puts its pair back, and the pair that went up in its place waits as the next", () => {
  const t = upWith([P, Q, R]);
  t.pick(); // Q up, from ahead
  t.undo();
  assert.deepEqual(t.table, P);
  assert.deepEqual(t.dealer.next, Q, "the pair the player saw is the next");
  assert.equal(t.pick(), true);
  assert.deepEqual(t.table, Q);
});

test("a pick taken back while the table waited leaves the deal that was out to become the next", () => {
  const t = upWith([P, Q, R]);
  t.pick(); // Q up, the deal behind it out
  t.pick(); // the table waits on that deal
  t.undo(); // Q back, nothing went up in its place
  assert.deepEqual(t.table, Q);
  assert.equal(t.dealer.out, 1, "a second deal was asked for");
  t.land();
  assert.deepEqual(t.table, Q, "the deal covered the pair taken back");
  assert.deepEqual(t.dealer.next, R);
});

test("a taken-back pick whose own pair went up again leaves the deal behind it as the next", () => {
  // A pool too small to deal another: after three refusals the pick's own
  // pair goes up again, and taking the pick back finds it on the table.
  const t = upWith([P]);
  t.pick();
  for (let i = 0; i <= RETRIES; i++) t.land(P);
  assert.deepEqual(t.table, P);
  t.undo();
  assert.deepEqual(t.table, P);
  assert.equal(t.dealer.next, null, "the pair on the table waits as its own next");
});

// A sound is cut, taken back, and cut again while a deal asked for in
// between (rightly without it in `exclude`) is out, and the engine's answer
// holds it. The deal is the table's (↻ with nothing waiting) or the next
// pair's (↻ put the waiting pair up and asked for the one after), and it
// lands before the second cut or after. main.js does on a cut what `cutRow`
// does: the pair waiting is checked, and a pair on the table holding the
// sound is put away.
for (const forTable of [true, false]) {
  for (const lands of ["before", "after"]) {
    test(`a pair dealt while a cut was taken back never goes up once the sound is cut again (the ${forTable ? "table's" : "next pair's"} deal, landing ${lands} the cut)`, () => {
      const X = 22;
      const t = upWith(forTable ? [P] : [P, Q]);
      let mark = -1; // how many pairs had gone up when X was cut again
      const cutAgain = () => {
        mark = t.shown.length;
        t.cut.add(X);
        t.dealer.check();
        if (t.table && t.table.includes(X)) t.skip();
      };
      // The engine's answers from here: the deal asked for while X is not
      // cut holds it.
      t.stream.push([X, 9], S, T, R);
      t.cut.add(X);
      t.cut.delete(X); // taken back
      t.skip(); // a deal asked for now does not exclude X
      assert.equal(t.dealer.out, 1);
      if (lands === "after") cutAgain();
      t.land();
      if (lands === "before") cutAgain();
      t.settle();
      assert.deepEqual(t.shown.slice(mark).filter((p) => p.includes(X)), [], "a pair holding the cut sound went up");
      assert.ok(t.table && !t.table.includes(X), "no pair, or the cut sound, on the table");
      assert.ok(!(t.dealer.next || []).includes(X), "the cut sound waits as the next pair");
    });
  }
}

test("a sound cut while the waiting table's fourth deal is out is not put up by it", () => {
  // The pool deals the pair just put away three times, each refused and
  // dealt again; a sound is cut while the fourth deal is out, and the fourth
  // answer holds it. It used to go up as the fourth try.
  const t = upWith([P]);
  t.skip();
  for (let i = 0; i < RETRIES; i++) t.land(P);
  assert.equal(t.table, null);
  t.cut.add(22);
  t.land(R);
  assert.equal(t.table, null, "the fourth answer, holding the cut sound, went up");
  t.land(S);
  assert.deepEqual(t.table, S);
});

// An empty answer (#195): the engine deals nothing when fewer than two
// sounds in the pool may be dealt. A waiting table used to put that up as if
// it were a pair, and main brought the buttons back live with nothing on
// the cards.

test("a waiting table whose deal comes back empty puts nothing up, and asks for no other deal", () => {
  const t = upWith([P, Q]);
  t.pick(); // Q up; the deal behind it out
  t.skip(); // ↻: the table waits on that deal
  t.land(null);
  assert.equal(t.table, null);
  assert.equal(t.nothing, 1, "the table was not told there is nothing to deal");
  assert.equal(t.dealer.empty, true);
  assert.deepEqual(t.shown, [P, Q], "something was put up");
  assert.equal(t.dealer.out, 0, "another deal was asked for");
});

test("an empty answer with another deal out leaves the table waiting for that one", () => {
  const t = upWith([P]);
  t.skip();
  t.dealer.deal(); // a second deal out
  t.land(null);
  assert.equal(t.nothing, 0, "said too soon: a deal is still out");
  t.land(Q);
  assert.deepEqual(t.table, Q);
  assert.equal(t.dealer.empty, false);
});

test("a table with nothing to deal asks again when a sound may have come back, and the pair it gets goes up", () => {
  const t = upWith([P]);
  t.skip();
  t.land(null);
  assert.equal(t.dealer.empty, true);
  t.dealer.soundsBack(); // the pool changed, but still nothing to deal
  assert.equal(t.dealer.out, 1);
  t.land(null);
  assert.equal(t.nothing, 2);
  t.stream.push(R);
  t.dealer.soundsBack(); // a cut taken back
  t.dealer.soundsBack(); // and the pool changed: one deal is out already
  assert.equal(t.dealer.out, 1, "a second deal was asked for while one was out");
  t.land();
  assert.deepEqual(t.table, R);
  assert.equal(t.dealer.empty, false);
  t.dealer.soundsBack();
  assert.equal(t.asked.filter((a) => a === "table").length, 4, "a table with a pair asked for a deal of its own");
});

test("a pick taken back on a table with nothing to deal puts its pair back", () => {
  const t = upWith([P, Q]);
  t.pick(); // Q up, the deal behind it out
  t.pick(); // the table waits on it
  t.land(null);
  assert.equal(t.dealer.empty, true);
  t.undo();
  assert.deepEqual(t.table, Q);
  assert.equal(t.dealer.empty, false);
  t.dealer.soundsBack();
  assert.equal(t.dealer.out, 1, "only the pair after it is dealt");
  assert.equal(t.asked.at(-1), "ahead");
});

// A taken-back pick and the deal behind the pair it put back (#211). P is on
// the table and Q waits; a pick puts Q up and the deal behind it (R) is asked
// for once Q's sounds are here; ⌘Z puts P back with Q waiting. Whether R was
// asked for by then depends on how long Q's sounds took, and it used to be
// thrown away when it had been: the pair after Q was then the deal after R.

test("a taken-back pick keeps the deal behind the pair it put back as the pair after next", () => {
  const t = upWith([P, Q, R, S]);
  t.pick(); // Q up
  t.settle(); // R lands as the next
  t.undo();
  assert.deepEqual(t.table, P);
  assert.deepEqual(t.dealer.next, Q);
  assert.deepEqual(t.dealer.afterNext, R, "the deal behind Q was thrown away");
  const asked = t.asked.length;
  assert.equal(t.pick(), true);
  assert.deepEqual(t.table, Q);
  assert.deepEqual(t.dealer.next, R);
  assert.equal(t.asked.length, asked, "a deal was asked for with R waiting");
  t.pick();
  assert.deepEqual(t.table, R);
  assert.equal(t.fetched.filter((p) => samePair(p, R)).length, 1, "R's sounds were fetched twice");
});

test("a deal behind the put-back pair that lands after ⌘Z is kept, and judged when that pair goes up", () => {
  const t = upWith([P, Q, Q, R]);
  t.pick(); // Q up, the deal behind it out
  t.undo();
  t.land(); // it lands after ⌘Z, with P on the table: it is Q again
  assert.deepEqual(t.dealer.afterNext, Q, "kept as it is");
  t.pick(); // Q up: Q behind Q may not wait, and is dealt again
  assert.deepEqual(t.dealer.next, null);
  t.land();
  assert.deepEqual(t.dealer.next, R);
});

test("a pair kept after the next is offered when the next is dropped by a cut", () => {
  const t = upWith([P, Q, R, S]);
  t.pick();
  t.settle();
  t.undo(); // P up, Q next, R after it
  t.cut.add(2); // a side of Q
  t.dealer.check();
  assert.deepEqual(t.dealer.next, R);
  assert.equal(t.dealer.afterNext, null);
  assert.equal(t.dealer.out, 0, "a deal was asked for with R there to take Q's place");
});

/** #211's probe on the dealer: pick, ⌘Z, pick again, pick, with the deals
 *  behind Q all landed before ⌘Z, one landed and the next still out, the
 *  first still out, or none asked for before ⌘Z (Q's sounds arriving only
 *  after it). `behindQ` is what the engine deals after Q. Returns every pair
 *  put up and every deal asked for, in order (each draws the engine's
 *  next). */
function probe(order, behindQ) {
  const unheard = new Set();
  const t = setup({ answers: [P, Q, ...behindQ, S, T, R], heard: (id) => !unheard.has(id) });
  t.dealer.deal();
  t.settle(); // P up, Q waiting with its sounds
  if (order === "not asked") for (const id of Q) unheard.add(id);
  t.pick(); // Q up
  if (order === "landed") t.settle();
  if (order === "one landed") t.land();
  t.undo();
  if (order === "still out" || order === "one landed") t.settle();
  if (order === "not asked") {
    unheard.clear();
    t.dealer.dealAhead(); // Q's renders land
  }
  t.pick(); // Q up again
  t.settle();
  t.pick(); // the pair after Q
  t.settle();
  return { shown: t.shown.map((p) => p.join()), asked: t.asked.join() };
}

for (const [name, behindQ] of [
  ["dealt at once", [R]],
  ["the pick's own pair first, refused and dealt again", [P, R]],
  ["the pick's own pair three times", [P, P, P, R]],
  ["the pick's own pair four times, refused until the dealer gives up", [P, P, P, P, R]],
]) {
  test(`picking again after ⌘Z shows the same pairs and asks for the same deals however Q's sounds were timed (the deal behind Q: ${name})`, () => {
    const b = probe("not asked", behindQ);
    assert.equal(b.shown.at(-1), R.join(), "the pair after Q is the first deal behind it that may go up");
    for (const order of ["landed", "one landed", "still out"]) {
      assert.deepEqual(probe(order, behindQ), b, `the deal behind Q ${order} at ⌘Z`);
    }
  });
}

// ↻ after ⌘Z (#211, the maintainer's decision): the same pairs either way.
// A deal is judged against the pick held when the pair it was dealt behind
// went up, and Q keeps the pick that put it up (P) through the take-back, so
// an R that is P itself is refused in every order: landed before ⌘Z, landed
// after it, or asked for only once Q goes up again. It used to be refused in
// the first order (5,22 after Q, in #211's probe) and go up in the others
// (1,7).

/** #211's probe with ↻ in place of the second pick: pick, ⌘Z, ↻, ↻. */
function probeSkip(order, behindQ) {
  const unheard = new Set();
  const t = setup({ answers: [P, Q, ...behindQ, S, T, R], heard: (id) => !unheard.has(id) });
  t.dealer.deal();
  t.settle(); // P up, Q waiting with its sounds
  if (order === "not asked") for (const id of Q) unheard.add(id);
  t.pick(); // Q up
  if (order === "landed") t.settle();
  if (order === "one landed") t.land();
  t.undo();
  if (order === "still out" || order === "one landed") t.settle();
  if (order === "not asked") {
    unheard.clear();
    t.dealer.dealAhead(); // Q's renders land
  }
  t.skip(); // ↻: Q up again, no pick held
  t.settle();
  t.skip(); // the pair after Q
  t.settle();
  return { shown: t.shown.map((p) => p.join()), asked: t.asked.join() };
}

for (const [name, behindQ] of [
  ["dealt at once", [R]],
  ["the pick's own pair first, refused and dealt again", [P, R]],
  ["the pick's own pair three times", [P, P, P, R]],
]) {
  test(`↻ after ⌘Z shows the same pairs and asks for the same deals however Q's sounds were timed (the deal behind Q: ${name})`, () => {
    const b = probeSkip("not asked", behindQ);
    assert.equal(b.shown.at(-1), R.join(), "the pair after Q is the first deal behind it that is not the pick that put Q up");
    for (const order of ["landed", "one landed", "still out"]) {
      assert.deepEqual(probeSkip(order, behindQ), b, `the deal behind Q ${order} at ⌘Z`);
    }
  });
}

test("a deal is judged against the pick that put up the pair it was dealt behind, however late it lands", () => {
  const t = upWith([P, Q]);
  t.pick(); // Q up, with P's pick held; the deal behind Q out
  t.held = null; // P's undo window closes before that deal lands
  t.land(P);
  assert.equal(t.dealer.next, null, "the pick that put Q up waits as the next pair");
  assert.equal(t.dealer.out, 1, "it was not dealt again");
  t.land(R);
  assert.deepEqual(t.dealer.next, R);
});

test("a pick's deal and a deal asked for ahead are judged against the same pick", () => {
  // O up and P waiting; a pick of O puts P up. The deal behind P is asked
  // for ahead when P's sounds are here, and by the pick of P when they are
  // not: either way the engine's O is refused, though the pick of P has
  // committed O's by then.
  const O = [30, 31];
  const run = (heardFirst) => {
    const unheard = new Set();
    const t = setup({ answers: [O, P, O, R], heard: (id) => !unheard.has(id) });
    t.dealer.deal();
    t.settle(); // O up, P waiting
    if (!heardFirst) for (const id of P) unheard.add(id);
    t.pick(); // P up, the pick of O held
    t.pick(); // the pick of P: O's is committed, P's held
    t.settle();
    return { shown: t.shown.map((p) => p.join()), asked: t.asked.length };
  };
  const ahead = run(true);
  assert.deepEqual(ahead.shown, [O, P, R].map((p) => p.join()));
  assert.deepEqual(run(false), ahead);
});

test("a pair waiting that holds a sound cut while it was out is dealt again however many times, not counted as a refusal", () => {
  const t = setup({ answers: [P] });
  t.dealer.deal();
  t.land(); // P up, the deal behind it out
  t.cut.add(22);
  for (let i = 0; i < RETRIES + 2; i++) t.land([22, 9]);
  assert.equal(t.dealer.out, 1, "it stopped dealing again, as for a refusal");
  t.land(P); // the pair on the table: a refusal, counted
  t.land(S);
  assert.deepEqual(t.dealer.next, S);
});

// A deal the engine could not run (#211): a waiting table has nothing
// coming, says so, and ↻ deals again.

test("a waiting table whose deal failed puts nothing up until ↻ deals again", () => {
  const t = upWith([P]);
  t.skip(); // ↻: the table waits on a deal
  assert.equal(t.dealer.failed(), true, "the table waits on nothing else");
  assert.equal(t.dealer.stuck, true);
  assert.equal(t.table, null);
  assert.equal(t.dealer.out, 0);
  t.dealer.soundsBack();
  assert.equal(t.dealer.out, 0, "it dealt again by itself");
  const asked = t.asked.length;
  assert.equal(t.dealer.retry(), true);
  assert.equal(t.asked.length, asked + 1);
  assert.equal(t.asked.at(-1), "table");
  assert.equal(t.dealer.stuck, false);
  assert.equal(t.dealer.retry(), false, "↻ pressed twice asked twice");
  t.land(Q);
  assert.deepEqual(t.table, Q);
});

test("a deal dealt ahead that failed leaves the table as it was, and ↻ does not retry it", () => {
  const t = upWith([P]);
  assert.equal(t.dealer.out, 0);
  t.dealer.deal(); // stands in for a deal ahead out
  assert.equal(t.dealer.failed(), false, "the table has a pair");
  assert.equal(t.dealer.stuck, false);
  assert.equal(t.dealer.retry(), false);
  assert.deepEqual(t.table, P);
});

test("a failed deal's table takes a pair back from ⌘Z, and is no longer stuck", () => {
  const t = upWith([P, Q]);
  t.pick(); // Q up, the deal behind it out
  t.pick(); // the table waits on that deal
  t.dealer.failed();
  assert.equal(t.dealer.stuck, true);
  t.undo(); // Q back
  assert.deepEqual(t.table, Q);
  assert.equal(t.dealer.stuck, false);
  assert.equal(t.dealer.retry(), false);
});
