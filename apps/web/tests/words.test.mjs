// Unit tests for words.js: the sentences the app builds from engine facts.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import {
  count,
  sureWord,
  guessLabel,
  forecastLine,
  taughtTitle,
  taughtSentence,
  kindsInLog,
  emptyGeneration,
  evolveRefusal,
  series,
} from "../words.js";

// Every sentence here is copy: held to the voice's mechanics.
function voiced(s) {
  assert.ok(!s.includes("—"), `no em dash: ${s}`);
  assert.ok(!s.includes("!"), `no exclamation mark: ${s}`);
  assert.ok(!s.includes("..."), `the ellipsis is one character: ${s}`);
  assert.ok(!/[A-Za-z]'[A-Za-z]/.test(s), `curly apostrophes: ${s}`);
  assert.ok(!/\b(patch #|#\d)/.test(s), `no ids: ${s}`);
}

test("a prediction is a percentage and a word, never a bare number", () => {
  assert.equal(guessLabel(0.59), "59% · leaning");
  assert.equal(guessLabel(0.5), "50% · a hunch");
  assert.equal(guessLabel(0.54), "54% · a hunch");
  assert.equal(guessLabel(0.55), "55% · leaning");
  assert.equal(guessLabel(0.69), "69% · leaning");
  assert.equal(guessLabel(0.7), "70% · fairly sure");
  assert.equal(guessLabel(0.93), "93% · fairly sure");
  // Below even reads the same way: a low guess is as sure as its mirror.
  assert.equal(sureWord(0.41), sureWord(0.59));
  assert.equal(sureWord(0.2), "fairly sure");
  // The word reads the printed percentage: 54.6% prints 55, and says so.
  assert.equal(guessLabel(0.546), "55% · leaning");
});

test("the forecast names the side it guessed, at the probability it gave it", () => {
  assert.equal(forecastLine(0.72), "it guessed this · 72% · fairly sure");
  assert.equal(forecastLine(0.38), "it guessed the other · 62% · leaning");
  assert.equal(forecastLine(0.52), "it guessed this · 52% · a hunch");
  for (const p of [0.1, 0.38, 0.5, 0.72, 0.99]) voiced(forecastLine(p));
});

test("TAUGHT's tooltip breaks the count down by kind", () => {
  assert.equal(taughtTitle({ picks: 52, stars: 4, cuts: 2 }), "52 picks · 4 stars · 2 cuts");
  assert.equal(taughtTitle({ picks: 1, stars: 1, cuts: 0 }), "1 pick · 1 star · 0 cuts");
  assert.equal(count(1, "walk"), "1 walk");
  assert.equal(taughtSentence({ picks: 52, stars: 4, cuts: 2 }), "52 picks, 4 stars, and 2 cuts");
});

test("a taste file's log is counted by kind", () => {
  const log = [
    { feedback: { Duel: { a: [], b: [], chose_a: true } } },
    { feedback: { Duel: { a: [], b: [], chose_a: false } } },
    { feedback: { Stars: { x: [], rating: 3 } } },
    { feedback: { KeepKill: { x: [], kept: false } } },
  ];
  assert.deepEqual(kindsInLog(log), { picks: 2, stars: 1, cuts: 1 });
  assert.equal(kindsInLog(undefined), null);
});

test("a generation whose children were refused says so, not that no move was accepted", () => {
  const s = emptyGeneration(4, ["not_admitted", "not_admitted", "not_admitted"]);
  assert.equal(s, "Generation 4: 3 were bred, but none rated above the sounds they would replace.");
  assert.ok(!/no move was accepted/.test(s));
  // The bar is the sound it would replace, never the parent.
  assert.ok(!/parent/.test(s));
  assert.equal(emptyGeneration(2, ["not_admitted"]),
    "Generation 2: 1 was bred, but it didn’t rate above the sound it would replace.");
});

test("a generation whose walks came back unchanged says that, and what to try", () => {
  assert.equal(emptyGeneration(3, Array(10).fill("no_move")),
    "Generation 3: every walk came back unchanged. A few more picks, or ⚡ on a sound you like, gives the next one a direction.");
});

test("a generation that bred only sounds the pool holds says that", () => {
  assert.equal(emptyGeneration(5, ["duplicate", "duplicate"]),
    "Generation 5: 2 were bred, but each matched a sound already in the pool.");
});

test("a mixed generation counts each outcome, in one sentence", () => {
  const s = emptyGeneration(6, ["no_move", "not_admitted", "duplicate", "no_move", "not_admitted", "not_admitted"]);
  assert.equal(s,
    "Generation 6 put nothing new in the pool: 3 rated below the sounds they would replace, 1 matched a sound already there, and 2 walks came back unchanged.");
});

test("a generation that could not start from its seeds says how to fix it", () => {
  assert.equal(emptyGeneration(7, ["outside_support", "outside_support"]),
    "Generation 7: nothing could be bred, because every seed it picked has a knob on its stop or is deeper than the model scores. Nudge those knobs off their stops.");
});

test("a stopped generation counts only the walks that came back, never \"every walk\"", () => {
  // A stop drops the walks still out: of ten, two came back.
  assert.equal(emptyGeneration(5, ["no_move", "no_move"], { stopped: true }),
    "Generation 5 stopped: 2 walks came back unchanged before it stopped. A few more picks, or ⚡ on a sound you like, gives the next one a direction.");
  assert.equal(emptyGeneration(5, ["no_move"], { stopped: true }),
    "Generation 5 stopped: 1 walk came back unchanged before it stopped. A few more picks, or ⚡ on a sound you like, gives the next one a direction.");
  assert.equal(emptyGeneration(5, ["outside_support", "outside_support", "outside_support"], { stopped: true }),
    "Generation 5 stopped: 3 seeds it picked couldn’t be bred from before it stopped. Nudge those knobs off their stops.");
  assert.equal(emptyGeneration(5, ["not_admitted", "not_admitted"], { stopped: true }),
    "Generation 5 stopped: 2 were bred before it stopped, but none rated above the sounds they would replace.");
  assert.equal(emptyGeneration(5, ["no_move", "duplicate"], { stopped: true }),
    "Generation 5 stopped with nothing new in the pool (before the stop, 1 matched a sound already there and 1 walk came back unchanged).");
  for (const r of [["no_move"], ["outside_support"], ["no_move", "duplicate"]]) {
    assert.ok(!/every walk|every seed/.test(emptyGeneration(5, r, { stopped: true })));
  }
});

test("a stopped generation that bred nothing says the pool is as it was, unless something was replaced", () => {
  assert.equal(emptyGeneration(8, [], { stopped: true }),
    "Generation 8 stopped before it bred anything. The pool is as it was.");
  assert.equal(emptyGeneration(8, [], { stopped: true, replaced: " The sound it rated lowest was replaced: Bell Jar." }),
    "Generation 8 stopped before it bred anything. The sound it rated lowest was replaced: Bell Jar.");
});

test("what a generation replaced takes the second sentence's place", () => {
  const replaced = " The 2 it rated lowest were replaced: Bell Jar and Glass Pad.";
  assert.equal(emptyGeneration(4, Array(10).fill("no_move"), { replaced }),
    `Generation 4: every walk came back unchanged.${replaced}`);
  assert.equal(emptyGeneration(4, ["no_move", "duplicate"], { stopped: true, replaced }),
    `Generation 4 stopped with nothing new in the pool (before the stop, 1 matched a sound already there and 1 walk came back unchanged).${replaced}`);
});

test("every generation outcome is at most two sentences, in the voice", () => {
  const cases = [
    [], ["no_move"], ["duplicate"], ["not_admitted"], ["outside_support"],
    ["no_move", "duplicate", "not_admitted", "outside_support"], ["mystery"],
  ];
  for (const r of cases) {
    for (const stopped of [false, true]) {
      for (const replaced of ["", " The 3 it rated lowest were replaced: A, B, and C."]) {
        const s = emptyGeneration(9, r, { stopped, replaced });
        voiced(s);
        assert.ok(/^[A-Z]/.test(s), `a sentence: ${s}`);
        const sentences = s.split(/\. (?=[A-Z])/);
        assert.ok(sentences.length <= 2, `two sentences at most: ${s}`);
      }
    }
  }
});

test("⚡'s refusals name the sound and the true bar", () => {
  const s = evolveRefusal("not_admitted", "Glass Pad");
  assert.equal(s, "⚡ bred a new sound from Glass Pad, but it didn’t pass the vet or rate above the sound it would replace. Try again.");
  assert.ok(!/parent/.test(s));
  assert.match(evolveRefusal("duplicate", "Glass Pad"), /already holds/);
  assert.match(evolveRefusal("no_move", "Glass Pad"), /came back unchanged/);
  assert.match(evolveRefusal("unknown_seed", "Glass Pad"), /^Glass Pad isn’t in the pool any more/);
  for (const r of ["outside_support", "no_taste", "unknown_seed", "duplicate", "not_admitted", "no_move", undefined]) {
    voiced(evolveRefusal(r, "Glass Pad"));
    voiced(evolveRefusal(r, null));
  }
});

test("lists take the serial comma", () => {
  assert.equal(series(["a"]), "a");
  assert.equal(series(["a", "b"]), "a and b");
  assert.equal(series(["a", "b", "c"]), "a, b, and c");
});
