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
