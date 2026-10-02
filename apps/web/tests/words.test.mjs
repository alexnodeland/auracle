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
  leanSentence,
  onApple,
  platformKeys,
  fittedFrom,
  mapFoot,
  haloLegend,
  pickSaid,
  refitSaid,
  weightSaid,
  weightsMore,
  directionLegend,
  forecastNote,
  noForecasts,
  stripSaid,
  mathLines,
  copyLabel,
  plateGuess,
  NO_WEIGHTS,
  TASTE_LABELS,
  pickWords,
  trackLabel,
  LOOKING_BACK,
  joinedLabel,
  movedMost,
  dotsLegend,
  replayAt,
  stepMoved,
  PALETTE,
  FAMILIES,
  onThisSound,
  panelCount,
  walkSaid,
  walkLabel,
  belowNote,
  fromLine,
  grownFrom,
  bredRatings,
  changeParts,
  markWord,
  hzWord,
  dbWord,
  msWord,
  FIGURE_OF,
  EXPLAIN_UI,
  explainTitle,
  explainSays,
  explainAlt,
  turnedWord,
  lessonSteps,
  cutoffWord,
  lessonPlay,
  stepOf,
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

test("EVOLVE POOL narrates each walk from the engine's reason, and only a refused child is rated below the pool", () => {
  assert.equal(walkLabel(3, 10), "walk 3 of 10");
  assert.equal(walkSaid(41, null), "joined the pool");
  assert.equal(walkSaid(0, "not_admitted"), "rated below the pool");
  assert.equal(walkSaid(0, "duplicate"), "already in the pool");
  assert.equal(walkSaid(0, "no_move"), "came back unchanged");
  assert.equal(walkSaid(0, "outside_support"), "couldn’t start");
  assert.equal(walkSaid(0, "stale"), "");
  for (const r of ["not_admitted", "duplicate", "no_move", "outside_support"]) {
    // "keep" is PERFORM's Keep pad, and nothing else (voice.md's word table).
    assert.ok(!/\b(keep|kept)\b/.test(walkSaid(0, r)), walkSaid(0, r));
    voiced(walkSaid(0, r));
  }
});

test("the bank's lineage lines name the seed, what changed, and both ratings with their words", () => {
  assert.equal(fromLine("Soft Pad", "+reverb, cutoff 1.2 kHz → 3.4 kHz"), "from Soft Pad · +reverb, cutoff 1.2 kHz → 3.4 kHz");
  assert.equal(fromLine("Soft Pad", ""), "from Soft Pad");
  assert.equal(grownFrom("Soft Pad", 3), "Grown from Soft Pad in generation 3.");
  assert.equal(belowNote(1), "1 more was bred and rated below the pool.");
  assert.equal(belowNote(3), "3 more were bred and rated below the pool.");
  const r = bredRatings("Soft Pad", 0.7, "Warm Drone 2", 0.62);
  assert.equal(r, "when it bred them, it rated Soft Pad 70% · fairly sure and Warm Drone 2 62% · leaning");
  // A percentage never stands alone (voice.md, the model's voice).
  assert.ok(!/\d%(?! ·)/.test(r), r);
  for (const s of [fromLine("Soft Pad", "+reverb"), grownFrom("Soft Pad", 1), belowNote(2), r]) voiced(s);
});

test("a module's lean on the spec card reads as a sentence", () => {
  const s = leanSentence("analog sustain", 0.6, 0.62, 0.2);
  assert.equal(s, "In analog sustain (60% of your pool), you lean toward it (θ +0.62 ± 0.20).");
  assert.equal(leanSentence("Warm Wash", 0.35, -0.41, 0.12),
    "In Warm Wash (35% of your pool), you lean away from it (θ −0.41 ± 0.12).");
  for (const x of [s, leanSentence("b", 0.1, -1, 0.5)]) {
    voiced(x);
    assert.match(x, /^[A-Z]/, `a sentence starts with a capital: ${x}`);
    assert.match(x, /\.$/, `a sentence ends with a period: ${x}`);
  }
});

test("a key chord is written in the platform's own words", () => {
  // On an Apple platform, the Mac's symbols, as written.
  for (const k of ["⌘Z", "⇧⌘Z", "⌘0", "⇧Esc"]) assert.equal(platformKeys(k, true), k);
  // Elsewhere, Ctrl for ⌘, then Alt, then Shift, spelled as the guide does.
  assert.equal(platformKeys("⌘Z", false), "Ctrl Z");
  assert.equal(platformKeys("⇧⌘Z", false), "Ctrl Shift Z");
  assert.equal(platformKeys("⌘0", false), "Ctrl 0");
  assert.equal(platformKeys("⌘−", false), "Ctrl −");
  assert.equal(platformKeys("⌘=", false), "Ctrl =");
  assert.equal(platformKeys("⇧Esc", false), "Shift Esc");
  assert.equal(platformKeys("⌥⌘K", false), "Ctrl Alt K");
  // Inside a sentence, only the chord changes.
  assert.equal(platformKeys("Shift-click it to bookmark a spot, and ⇧1–9 jumps to one.", false),
    "Shift-click it to bookmark a spot, and Shift 1–9 jumps to one.");
  assert.equal(platformKeys("They snap to the grid, and ⇧ places them freely.", false),
    "They snap to the grid, and Shift places them freely.");
  assert.equal(platformKeys("Bookmark 3 set. ⇧3 comes back here.", false),
    "Bookmark 3 set. Shift 3 comes back here.");
  assert.equal(platformKeys("no keys here", false), "no keys here");
  // Which platform: Apple's say so in `platform` (or userAgentData).
  assert.equal(onApple({ platform: "MacIntel" }), true);
  assert.equal(onApple({ platform: "iPhone" }), true);
  assert.equal(onApple({ platform: "Win32" }), false);
  assert.equal(onApple({ platform: "Linux x86_64" }), false);
  assert.equal(onApple({ userAgentData: { platform: "macOS" }, platform: "" }), true);
  assert.equal(onApple({ userAgentData: { platform: "Windows" }, platform: "Win32" }), false);
});

test("TASTE and LEARNING say what the model was fitted from, or how far it is", () => {
  assert.equal(fittedFrom({ fitted: true, picks: 18 }), "From 18 picks.");
  assert.equal(fittedFrom({ fitted: true, picks: 1, stars: 2, cuts: 1 }), "From 1 pick, 2 stars, and 1 cut.");
  assert.equal(fittedFrom({ fitted: false, left: 3 }), "3 more picks and it fits your taste.");
  assert.equal(fittedFrom({ fitted: false, left: 1 }), "1 more pick and it fits your taste.");
  assert.equal(fittedFrom({ fitted: false, left: 0 }), "Fitting your taste…");
});

test("TASTE's and LEARNING's sentences are in the voice", () => {
  const facts = { audio: 18, structural: 26, draws: 500, styles: 2, styles_max: 5, obs_per_style: 20 };
  const all = [
    fittedFrom({ fitted: true, picks: 18 }), mapFoot(40, 0.312), haloLegend(true), haloLegend(false),
    pickSaid("Glass Pad", "Soft Wash"), pickSaid(null, null), refitSaid(), weightSaid("grit", -0.12, 0.3, true),
    weightsMore(true, 44, 6), weightsMore(false, 44, 6), directionLegend({ r2: 0.16 }), directionLegend(null),
    forecastNote({ expected: 0.64, was: 0.58 }), noForecasts(true), noForecasts(false), stripSaid(1),
    ...mathLines(facts, 6), copyLabel("idle"), copyLabel("copied"), copyLabel("select"), plateGuess(0.59), NO_WEIGHTS,
    ...Object.values(TASTE_LABELS),
  ];
  for (const s of all) {
    voiced(s);
    assert.ok(!/\b(lens|posterior|preference|vote|duel|export)\b/i.test(s), `the word table: ${s}`);
    assert.ok(s.split(/\s+/).length <= 25, `no block past 25 words: ${s}`);
  }
  assert.equal(mapFoot(40, 0.312), "A flat view of 40 sounds: close dots usually sound alike (it shows 31% of how they differ).");
  assert.equal(pickSaid("Glass Pad", "Soft Wash"), "You picked Glass Pad over Soft Wash. Every rating moved.");
  assert.equal(weightSaid("grit", -0.12, 0.3, true), "grit: likes less, −0.12 ± 0.30, still a guess");
  assert.equal(directionLegend({ r2: 0.16 }), "the arrow: liking rises · explains 16%");
  assert.equal(plateGuess(0.59), "would like: 59% · leaning", "a percentage, never alone: with its word");
});

test("the math states the engine's numbers, and nothing else", () => {
  const lines = mathLines({ audio: 18, structural: 26, draws: 500, styles: 2, styles_max: 5, obs_per_style: 20 }, 6);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /18 audio and 26 structural features/);
  assert.match(lines[2], /It holds 500 draws of w\. Each pick reweights them, and every 6 picks it fits them again\./);
  assert.match(lines[3], /one more style for every 20 things it learns from, up to 5\./);
  // Other numbers, other words: nothing in it is written down twice.
  const other = mathLines({ audio: 20, structural: 30, draws: 250, styles: 1, styles_max: 3, obs_per_style: 10 }, 8);
  assert.match(other.join(" "), /20 audio and 30 structural.*250 draws.*every 8 picks.*every 10 things.*up to 3/);
});

test("the track and the replay say which moment they show", () => {
  assert.equal(trackLabel(7, true), "now · after 7 picks");
  assert.equal(trackLabel(1, false), "after 1 pick");
  assert.equal(pickWords(0), "before any picks");
  assert.equal(joinedLabel(3), "+3");
  assert.equal(movedMost("grit", -0.123), "That pick moved grit most (−0.12).");
  assert.equal(dotsLegend("grit"), "dots: grit");
  for (const t of [trackLabel(7, true), LOOKING_BACK, movedMost("grit", 0.1), dotsLegend("body")]) voiced(t);
});

test("REPLAY credits each step to what it was", () => {
  assert.equal(replayAt("pick", 21), "after 21 picks");
  assert.equal(replayAt("map", 24), "refit · after 24 picks");
  assert.equal(replayAt("file", 60), "opened file · after 60 picks");
  assert.equal(stepMoved("pick", true, "grit", 0.034), "That pick moved grit most (+0.03).");
  assert.equal(stepMoved("map", true, "grit", 0.23), "The refit moved grit most (+0.23).");
  assert.equal(stepMoved("map", false, "grit", 0.23), "The refit moved grit most (+0.23).");
  assert.equal(stepMoved("pick", false, "body", -0.2), "Since the moment before, body moved most (−0.20).");
  assert.equal(stepMoved("star", true, "body", 0.1), "That star moved body most (+0.10).");
  for (const k of ["pick", "map", "gen", "file", "star", "cut"]) {
    voiced(replayAt(k, 3));
    voiced(stepMoved(k, true, "grit", 0.1));
    voiced(stepMoved(k, false, "grit", 0.1));
  }
});

test("the palette is the engine's eighteen, in its order, each in the house voice", () => {
  // `auracle_session::perform::PALETTE`: the six first, at the same indices,
  // then the twelve in family order.
  assert.deepEqual(
    PALETTE.map((c) => c.name),
    ["Bright", "Snap", "Motion", "Body", "Grit", "Space", "Warmth", "Air", "Thump", "Heft", "Punch", "Round", "Throb", "Sway", "Distance", "Haze", "Bite", "Lo-fi"],
  );
  // The approved end words (voice.md's word table).
  const ends = Object.fromEntries(PALETTE.map((c) => [c.name, `${c.low} · ${c.high}`]));
  assert.equal(ends.Round, "hard · round");
  assert.equal(ends.Throb, "steady · throbbing");
  assert.equal(ends.Sway, "fixed · swaying");
  assert.equal(ends.Heft, "slight · heavy");
  // Six families of three.
  for (const f of FAMILIES) assert.equal(PALETTE.filter((c) => c.family === f).length, 3, f);
  for (const c of PALETTE) {
    assert.equal(c.aim.length, 2, c.name);
    for (const s of [c.hear, c.how]) {
      voiced(s);
      assert.match(s, /^[A-Z].*\.$/, `a sentence: ${s}`);
    }
  }
});

test("what a control does on this sound is said from its wiring", () => {
  assert.equal(onThisSound("Bite", { knobs: ["filter resonance", "env decay"] }), "On this sound it turns filter resonance and env decay.");
  assert.equal(onThisSound("Space", { knobs: ["amp release"], only: "far" }), "On this sound it turns amp release. It turns toward far only.");
  assert.equal(onThisSound("Grit", { search: true }), "Nothing here turns Grit: turn it past the notch, and it asks for an offer instead.");
  assert.equal(onThisSound("Heft", { pending: true }), "Heft hasn’t been measured on this sound yet. It turns once it has.");
  for (const s of [onThisSound("A", {}), onThisSound("A", { search: true }), onThisSound("A", { pending: true })]) voiced(s);
  assert.equal(panelCount(6, 8), "6 of 8 on the panel");
});

test("what changed counts the modules: a tree re-laid by an insertion says only what it gained and lost", () => {
  // A seed mix(filter(vco), pluck) and a child with a delay inserted above:
  // `tree_diff` is positional, so the addresses shift. Before: filter, mix,
  // delay, pluck. After: delay, delay, mix. Net: delay +1, filter −1,
  // pluck −1, mix 0. Read entry by entry it said "filter → delay, mix →
  // delay, −delay, −pluck, +mix".
  const diff = [
    { addr: "r#op", before: "filter", after: "delay" },
    { addr: "r/0#op", before: "mix", after: "delay" },
    { addr: "r/0/0#op", before: "delay", after: null },
    { addr: "r/1#src", before: "pluck", after: null },
    { addr: "r/0/1#op", before: null, after: "mix" },
  ];
  assert.deepEqual(changeParts(diff), ["filter → delay", "−pluck"]);
});

test("what changed: a moved module is not said, a swap is, and counts carry ×n", () => {
  // Moved: gone in one place, new in another.
  assert.deepEqual(changeParts([
    { addr: "r/0#op", before: "delay", after: null },
    { addr: "r/1/0#op", before: null, after: "delay" },
  ]), []);
  // Gains before losses, whatever order the diff lists them in.
  assert.deepEqual(changeParts([
    { addr: "r/0#op", before: "delay", after: null },
    { addr: "r/1#op", before: null, after: "chorus" },
  ]), ["+chorus", "−delay"]);
  // A plain swap.
  assert.deepEqual(changeParts([{ addr: "r#op", before: "filter", after: "delay" }]), ["filter → delay"]);
  // Two of one kind gained, one lost; the empty slot is not a module.
  assert.deepEqual(changeParts([
    { addr: "r/0#op", before: null, after: "chorus" },
    { addr: "r/1#op", before: null, after: "chorus" },
    { addr: "r/2#mod", before: "lfo", after: "no mod" },
    { addr: "r/3#mod", before: "none", after: null },
  ]), ["+chorus ×2", "−lfo"]);
  // Knobs follow the modules, worded by the caller; a removed module's knobs
  // and the grammar's bookkeeping are not changes of their own.
  assert.deepEqual(changeParts([
    { addr: "r/0#cut", before: "0.41", after: "0.62" },
    { addr: "r/1#op", before: null, after: "delay" },
    { addr: "r/1#time", before: null, after: "0.30" },
    { addr: "r/1#leaf", before: "a", after: "b" },
  ], (d, site) => `${site}: ${d.before} → ${d.after}`), ["+delay", "cut: 0.41 → 0.62"]);
});

test("a bank row's mark says what pointing at EVOLVE POOL means for it", () => {
  assert.equal(markWord("seed"), "seed");
  assert.equal(markWord("may"), "may be replaced");
  assert.equal(markWord("will"), "will be replaced");
  assert.equal(markWord("other"), "");
  for (const k of ["seed", "may", "will"]) voiced(markWord(k));
});

// ---------- Explain anything (explain.js) ----------

// The facts a render measures (`auracle_features::explain::Facts`), as made
// and turned toward the high end, for every control's sentence.
const FACTS_MADE = {
  centroid_hz: 359, rolloff_hz: 1210, zcr_hz: 640, flatness: 0.0001, flux: 0.09, attack_ms: 5.7,
  crest_db: 16.3, level_db: -19.4, swing: 0.76, tail_db: -60, bass_pct: 76.2, high_db: -1.1,
  held_move_oct: 0.044, motion_oct: [0.28, 0.4, 0.04],
};
const FACTS_TURNED = {
  centroid_hz: 2480, rolloff_hz: 6200, zcr_hz: 2100, flatness: 0.004, flux: 0.12, attack_ms: 447,
  crest_db: 9.2, level_db: -17, swing: 0.93, tail_db: -14.4, bass_pct: 31, high_db: 0.7,
  held_move_oct: 0.31, motion_oct: [0.34, 0.36, 0.05],
};

test("a measurement is said in its own unit", () => {
  assert.equal(hzWord(359.4), "359 Hz");
  assert.equal(hzWord(999.7), "1.0 kHz");
  assert.equal(hzWord(2480), "2.5 kHz");
  assert.equal(hzWord(12400), "12 kHz");
  assert.equal(dbWord(-18.4), "−18 dB", "a true minus");
  assert.equal(dbWord(3, true), "+3 dB");
  assert.equal(msWord(5.73), "5.7 ms");
  assert.equal(msWord(447.4), "447 ms");
  assert.equal(msWord(1240), "1.2 s");
  assert.equal(cutoffWord(3700), "cutoff 3.7 kHz");
});

test("every palette control has a figure, and each figure says what was measured, made then turned", () => {
  assert.deepEqual(Object.keys(FIGURE_OF).sort(), PALETTE.map((c) => c.name).sort());
  for (const c of PALETTE) {
    const st = { at: 1, knobs: ["filter cutoff", "env / out decay"], only: "" };
    const s = explainSays(c, st, FACTS_MADE, FACTS_TURNED);
    voiced(s);
    assert.ok(s.startsWith(`Turned to ${c.high}, `), s);
    assert.ok(s.endsWith(" Here it turns filter cutoff and env / out decay."), s);
    assert.ok(s.split(/(?<=\.)\s/).length <= 2, `at most two sentences: ${s}`);
    assert.ok(!/NaN|undefined/.test(s), s);
    assert.ok(s.split(/\s+/).length <= 40, s);
    voiced(explainAlt(c, "Reese", FIGURE_OF[c.name], s));
    assert.equal(explainTitle(c.name), `${c.name} · what it does`);
  }
  const bright = PALETTE[0];
  assert.equal(
    explainSays(bright, { at: 1, knobs: ["filter cutoff"] }, FACTS_MADE, FACTS_TURNED),
    "Turned to bright, its center moves from 359 Hz to 2.5 kHz. Here it turns filter cutoff.",
  );
  const snap = PALETTE[1];
  assert.equal(
    explainSays(snap, { at: -0.4, knobs: ["env / out attack"], only: "bloom" }, FACTS_MADE, FACTS_TURNED),
    "Turned 40% toward bloom, its attack goes from 5.7 ms to 447 ms. Here it turns env / out attack, toward bloom only.",
  );
  const space = PALETTE.find((c) => c.name === "Space");
  assert.equal(
    explainSays(space, { search: true }, FACTS_MADE, null),
    "Nothing here turns SPACE: turn it past the notch, and it asks for an offer instead. Here its last 300 ms sits 60 dB under the phrase.",
  );
  const grit = PALETTE.find((c) => c.name === "Grit");
  assert.ok(explainSays(grit, { at: 1, knobs: [] }, FACTS_MADE, FACTS_TURNED).includes("goes from −40 dB to −24 dB, where noise is 0 dB"));
  assert.equal(explainSays(bright, { pending: true }, null, null), "BRIGHT hasn’t been measured on this sound yet. It turns once it has.");
  assert.equal(explainSays(bright, { at: 1 }, null, null), EXPLAIN_UI.listening);
  assert.equal(turnedWord(bright, 0.995), "turned to bright");
  assert.equal(turnedWord(bright, -0.25), "turned 25% toward dark");
});

test("the lesson on filters is about the sound in hand, and says what BRIGHT does on it", () => {
  const steps = lessonSteps("Reese", { knobs: ["filter cutoff"], cut: true });
  assert.equal(steps.length, 3);
  assert.ok(steps[0].p[0].startsWith("This is Reese,"));
  assert.ok(steps[1].p[0].includes("on Reese"));
  assert.ok(steps[2].try.startsWith("Done leaves Reese as it was"));
  assert.equal(steps[2].list[2], "On Reese, BRIGHT turns filter cutoff: the same kind of knob as this lesson’s cutoff.");
  assert.equal(
    lessonSteps("Glass Pad", { knobs: ["vco detune", "lfo rate"], cut: false })[2].list[2],
    "On Glass Pad, BRIGHT turns vco detune and lfo rate, not a filter: it listens for where the energy sits, whatever moves it.",
  );
  assert.ok(lessonSteps("Hornet", { search: true })[2].list[2].includes("no knob moves BRIGHT"));
  assert.ok(lessonSteps("Hornet", { pending: true })[2].list[2].includes("still listening"));
  assert.equal(lessonSteps("Hornet", null)[2].list[2], "BRIGHT listens for where the energy sits, whatever moves it.");
  for (const s of lessonSteps("Reese", { knobs: ["filter cutoff", "env / out decay"], cut: true })) {
    for (const t of [s.h, ...(s.p || []), ...(s.list || []), s.try]) voiced(t);
  }
  assert.equal(lessonPlay("Reese", false, false), "Play Reese");
  assert.equal(lessonPlay("Reese", true, false), "Play Reese through it");
  assert.equal(lessonPlay("Reese", true, true), "Stop");
  assert.equal(stepOf(1, 3), "2 of 3");
});
