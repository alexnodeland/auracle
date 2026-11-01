// Unit tests for guide.js: what the guide pill reads back from storage, the
// first steps' old key migrated into it, which steps a level shows, and the
// closing line said once (the pill on a fake page).
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { readGuide, stepsShown, createGuide, GUIDE_KEY, OLD_STEPS_KEY } from "../guide.js";

const store = (o) => (k) => (k in o ? o[k] : null);

test("nothing stored is a fresh start, and nothing to migrate", () => {
  assert.deepEqual(readGuide(store({})), { done: [], closed: [], ended: [], migrated: false });
});

test("the pill's own key is read as it was written: × per level", () => {
  const got = readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["play", "turn"], closed: ["patch"] }) }));
  assert.deepEqual(got, { done: ["play", "turn"], closed: ["patch"], ended: [], migrated: false });
});

test("a × from before the levels had their own steps closed PERFORM's only", () => {
  const got = readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: [], closed: true }) }));
  assert.deepEqual(got.closed, ["perform"]);
});

test("the first steps' old array is migrated, and the pill opens", () => {
  const got = readGuide(store({ [OLD_STEPS_KEY]: JSON.stringify(["play", "offer"]) }));
  assert.deepEqual(got, { done: ["play", "offer"], closed: [], ended: [], migrated: true });
});

test("the new key wins over the old one", () => {
  const got = readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["turn"], closed: false }), [OLD_STEPS_KEY]: JSON.stringify(["play"]) }));
  assert.deepEqual(got.done, ["turn"]);
  assert.equal(got.migrated, false);
});

test("what cannot be read is a fresh start; ids are strings, each once", () => {
  assert.deepEqual(readGuide(store({ [GUIDE_KEY]: "{" })).done, []);
  assert.deepEqual(readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["play", 3, "play", null], closed: "yes" }) })), { done: ["play"], closed: [], ended: [], migrated: false });
  assert.deepEqual(readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: [], closed: ["patch", 4, "patch"] }) })).closed, ["patch"]);
  assert.deepEqual(readGuide(store({ [OLD_STEPS_KEY]: "not json" })), { done: [], closed: [], ended: [], migrated: true });
  assert.deepEqual(readGuide(() => { throw new Error("private window"); }), { done: [], closed: [], ended: [], migrated: false });
});

test("the levels whose closing line was said are read back, each once", () => {
  const got = readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["play"], closed: [], ended: ["perform", 2, "perform"] }) }));
  assert.deepEqual(got.ended, ["perform"]);
  assert.deepEqual(readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: [], closed: [], ended: "perform" }) })).ended, []);
});

// PERFORM's five, as perform.js and main.js add them: the turn left out while
// the sound in hand is one no control reaches (#480).
const performSteps = (reachesNone) => [
  { id: "play" },
  { id: "turn", skip: () => reachesNone() },
  { id: "offer" },
  { id: "zoom" },
  { id: "model" },
  { id: "patch-play", levels: ["patch"] },
];
const ids = (shown) => ({ here: shown.here.map((s) => s.id), now: shown.now?.id ?? null });

test("a level shows its own steps, the first not done up next", () => {
  const steps = performSteps(() => false);
  assert.deepEqual(ids(stepsShown(steps, "perform", new Set(["play"]))), { here: ["play", "turn", "offer", "zoom", "model"], now: "turn" });
  assert.deepEqual(ids(stepsShown(steps, "patch", new Set())), { here: ["patch-play"], now: "patch-play" });
});

test("on a sound no control reaches, the turn is left out: its pip, and the step up next", () => {
  let none = true;
  const steps = performSteps(() => none);
  const shown = stepsShown(steps, "perform", new Set(["play"]));
  assert.deepEqual(ids(shown), { here: ["play", "offer", "zoom", "model"], now: "offer" });
  // Every other step done: the level's steps are done, and its closing line
  // is due, with the turn still not done.
  const rest = new Set(["play", "offer", "zoom", "model"]);
  assert.equal(stepsShown(steps, "perform", rest).now, null);
  // A sound a control turns: the turn is back, and up next.
  none = false;
  assert.deepEqual(ids(stepsShown(steps, "perform", rest)), { here: ["play", "turn", "offer", "zoom", "model"], now: "turn" });
});

test("a step done is shown done whether or not the sound in hand could do it", () => {
  const steps = performSteps(() => false);
  const done = new Set(["play", "turn"]);
  assert.equal(stepsShown(steps, "perform", done).now.id, "offer");
  // Left out on a sound no control reaches, it was still done.
  assert.equal(stepsShown(performSteps(() => true), "perform", done).now.id, "offer");
});

/** A fake page for the pill: `document` makes the few elements guide.js
 *  builds, `localStorage` is `kept` (a Map, which a reload keeps), and the
 *  closing line's timer is node:test's. `load()` is a visit: a new slot for
 *  the pill, over the same storage. Its `shows()` is what the pill shows:
 *  null when it is hidden, else `{ step }` (the step up next) or
 *  `{ closing }` (the level's closing line). */
function onPage(t) {
  const kept = new Map();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const make = (tag) => {
    const classes = new Set();
    const e = {
      tag,
      className: "",
      textContent: "",
      dataset: {},
      children: [],
      setAttribute() {},
      append: (...xs) => e.children.push(...xs),
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    };
    Object.defineProperty(e, "innerHTML", { set: () => (e.children = []) });
    return e;
  };
  const doc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const ls = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "document", { value: { createElement: make }, configurable: true, writable: true });
  const storage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  t.after(() => {
    for (const [k, d] of [["document", doc], ["localStorage", ls]]) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  });
  const find = (e) => (/\bpf-step\b/.test(e.className) ? e : e.children.map(find).find(Boolean) || null);
  return {
    kept,
    wait: (ms) => t.mock.timers.tick(ms),
    load() {
      const el = make("div");
      return {
        el,
        shows() {
          if (el.classList.contains("hidden")) return null;
          const s = find(el);
          if (!s) return null;
          return /\ball\b/.test(s.className) ? { closing: s.textContent } : { step: s.dataset.step };
        },
      };
    },
  };
}

const LOOP = "That is the loop.";

/** PERFORM's five on a visit's pill, as perform.js and main.js add them, the
 *  turn left out while `none.reaches` is true. */
function performGuide(visit, none) {
  const g = createGuide({ el: visit.el, ends: { perform: LOOP } });
  for (const s of performSteps(() => none.reaches)) g.add({ ...s, text: () => s.id });
  return g;
}

test("the closing line is said once: the turn done on a later sound ticks off without it", (t) => {
  const page = onPage(t);
  const pill = page.load();
  const none = { reaches: true };
  const g = performGuide(pill, none);
  for (const id of ["play", "offer", "zoom"]) g.done(id);
  assert.deepEqual(pill.shows(), { step: "model" });
  // The last step shown on a sound no control reaches: the closing line,
  // then the pill goes.
  g.done("model");
  assert.deepEqual(pill.shows(), { closing: LOOP });
  page.wait(7000);
  assert.equal(pill.shows(), null);
  // A sound a control turns: the turn is back, and up next.
  none.reaches = false;
  g.refresh();
  assert.deepEqual(pill.shows(), { step: "turn" });
  // Done, it ticks off and the pill goes, with no second closing line.
  g.done("turn");
  assert.equal(pill.shows(), null, "the closing line is not said again");
  assert.ok(g.isDone("turn"));
});

test("a closing line said before a reload is not said again after it", (t) => {
  const page = onPage(t);
  const none = { reaches: true };
  const first = page.load();
  const g = performGuide(first, none);
  for (const id of ["play", "offer", "zoom", "model"]) g.done(id);
  assert.deepEqual(first.shows(), { closing: LOOP });
  // The next visit, on a sound a control turns.
  none.reaches = false;
  const next = page.load();
  const h = performGuide(next, none);
  assert.deepEqual(next.shows(), { step: "turn" });
  h.done("turn");
  assert.equal(next.shows(), null, "the closing line is not said again");
  assert.deepEqual(JSON.parse(page.kept.get(GUIDE_KEY)).ended, ["perform"]);
});

test("a level whose steps are all done the first time says its closing line", (t) => {
  const page = onPage(t);
  const pill = page.load();
  const g = performGuide(pill, { reaches: false });
  for (const id of ["play", "turn", "offer", "zoom"]) g.done(id);
  g.done("model");
  assert.deepEqual(pill.shows(), { closing: LOOP });
  page.wait(7000);
  assert.equal(pill.shows(), null);
});
