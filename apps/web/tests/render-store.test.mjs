// The render cache's store, and who opens it first. Run: node --test apps/web/tests
//
// render-store.js is a module and is imported as one. The order is read out of
// the two workers' own source: worker.js (the engine worker's `farmBoot`,
// `renderStoreReady`, `farmSetup`, `farmPhrase`) and farm.js (`onJob`'s
// phrase, `cacheOpen`) cannot be imported, since each boots on load, so their
// functions are lifted out and run as written, over a stand-in IndexedDB that
// keeps one database in memory, answers every request on a later task, as a
// browser does, and logs who did what (fake-idb.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as renderStore from "../render-store.js";
import { fakeIndexedDB } from "./fake-idb.mjs";

const { renderStoreOpen, RENDER_ROWS, RENDER_META, RENDER_MAX_ROWS } = renderStore;

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const workerSrc = read("../worker.js");
const farmSrc = read("../farm.js");

// The source of `[async ]function name(…) { … }` in `src`, braces matched.
function lift(src, name) {
  let at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `no function ${name}`);
  if (src.slice(at - 6, at) === "async ") at -= 6;
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

const NS = "e3:q0.4.0:this-build";
const PHRASE = '{"phrase":"stand-in"}';
const later = (fn) => setImmediate(fn);
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a first visit's open creates the store and stamps it with the namespace", async () => {
  const idb = fakeIndexedDB();
  const db = await renderStoreOpen(idb.as("farm"), NS);
  assert.ok(db, "no connection");
  assert.equal(idb.log.filter((e) => e.op === "upgrade").length, 1, "the store was not created");
  assert.deepEqual([...idb.store().stores.keys()].sort(), [RENDER_META, RENDER_ROWS].sort());
  assert.equal(idb.store().stores.get(RENDER_META).get("ns"), NS, "not stamped with the namespace");
});

test("a store stamped with this build's namespace is opened by reading it, with nothing written", async () => {
  const idb = fakeIndexedDB();
  idb.seed({ ns: NS, rows: 3 });
  const db = await renderStoreOpen(idb.as("farm"), NS);
  assert.ok(db, "no connection");
  assert.deepEqual(idb.writes(), [], "an open of a stamped store wrote");
  assert.equal(idb.log.some((e) => e.op === "upgrade"), false);
  assert.equal(idb.store().stores.get(RENDER_ROWS).size, 3, "the rows went");
});

test("another build's stamp, or more rows than the cap, clears the store and stamps it again", async () => {
  const other = fakeIndexedDB();
  other.seed({ ns: "e2:q0.3.0:another-build", rows: 3 });
  assert.ok(await renderStoreOpen(other.as("farm"), NS));
  assert.equal(other.store().stores.get(RENDER_ROWS).size, 0, "another build's rows were kept");
  assert.equal(other.store().stores.get(RENDER_META).get("ns"), NS);

  const full = fakeIndexedDB();
  full.seed({ ns: NS, rows: RENDER_MAX_ROWS + 1 });
  assert.ok(await renderStoreOpen(full.as("farm"), NS));
  assert.equal(full.store().stores.get(RENDER_ROWS).size, 0, "a store over the cap was kept");

  const atCap = fakeIndexedDB();
  atCap.seed({ ns: NS, rows: RENDER_MAX_ROWS });
  assert.ok(await renderStoreOpen(atCap.as("farm"), NS));
  assert.deepEqual(atCap.writes(), [], "a store at the cap was cleared");
});

test("a store that cannot be opened is null, never a rejection", async () => {
  assert.equal(await renderStoreOpen(undefined, NS), null, "no IndexedDB");
  assert.equal(await renderStoreOpen(fakeIndexedDB().as("farm"), null), null, "no namespace");
  const throws = { open() { throw new Error("SecurityError"); } };
  assert.equal(await renderStoreOpen(throws, NS), null, "an open that throws");
  const refused = {
    open() {
      const req = {};
      later(() => {
        req.error = new Error("UnknownError");
        req.onerror?.();
      });
      return req;
    },
  };
  assert.equal(await renderStoreOpen(refused, NS), null, "an open refused");
  // Blocked by another tab's connection, then let through once it closes:
  // given up at once, and the connection that comes later is closed.
  let closed = 0;
  const blocked = {
    open() {
      const req = {};
      later(() => {
        req.onblocked?.();
        later(() => {
          req.result = { close: () => closed++ };
          req.onsuccess?.();
        });
      });
      return req;
    },
  };
  assert.equal(await renderStoreOpen(blocked, NS), null, "a blocked open");
  await settle();
  await settle();
  assert.equal(closed, 1, "the late connection was left open");
});

// How the engine worker hands a crew the phrase, read from its source. The
// order the tests below check is the app's only while these hold: `init` gives
// boot's crew its ports through `farmBoot`, which waits for the stamp, and
// `farmSetup` (which posts the phrase) is called from `farmBoot` and `crewUp`
// alone. `init` calling `farmSetup` on its ports itself, as it did before
// #200, fails here.
function phraseOnlyThroughTheStamp() {
  assert.ok(
    /^\s*farmed = await farmBoot\(m\.farmPorts, ns\);$/m.test(workerSrc),
    "init does not hand boot's crew its ports through farmBoot",
  );
  const calls = (src) => (src.match(/\bfarmSetup\(/g) || []).length;
  assert.equal(
    calls(workerSrc) - 1, // its own definition
    calls(lift(workerSrc, "farmBoot")) + calls(lift(workerSrc, "crewUp")),
    "farmSetup hands a crew the phrase from somewhere other than farmBoot and crewUp",
  );
}

// How long a crew waits on the stamp, as worker.js has it.
const RENDER_STAMP_MS = Number(/^const RENDER_STAMP_MS = (\d+);$/m.exec(workerSrc)?.[1]);

// The engine worker's side of a crew, as written: `farmBoot` (boot's crew) and
// `crewUp` (a walk crew's) and what they call, over `engine` and `glue`
// stand-ins, with `farmHandshake` answered at once and main's side of
// `farm_want` left to `news`. `renderStoreModule` is render-store.js itself,
// or `module`.
function engineWorker(idb, { module = async () => renderStore, news = () => {} } = {}) {
  assert.ok(RENDER_STAMP_MS > 0, "worker.js has no RENDER_STAMP_MS");
  assert.ok(
    /^const renderStoreModule = \(\) => import\(`\.\/render-store\.js\?v=\$\{V\}`\);$/m.test(workerSrc),
    "worker.js does not import render-store.js as renderStoreModule",
  );
  phraseOnlyThroughTheStamp();
  const crewReady = /^const crewReady = .*;$/m.exec(workerSrc);
  assert.ok(crewReady, "worker.js has no crewReady");
  return new Function(
    "self", "engine", "glue", "renderStoreModule", "farmHandshake", "FARM_HANDSHAKE_MS", "RENDER_STAMP_MS",
    "CREW_SPAWN_MS", "news", "onFarmMessage",
    [
      "const farm = [];",
      "const farmPreDead = new Set();",
      "let renderStamped = null;",
      "let farmSink = null, farmClosed = false, farmCrew_ = 0;",
      "let crewSeq = 0, crewWaiting = null, crewRaising = null, crewIdleTimer = null;",
      crewReady[0],
      ...["farmPhrase", "farmSetup", "renderStoreReady", "farmBoot", "farmUsable", "farmSay", "farmShutdown"]
        .concat(["crewUp", "crewArrived", "crewKeep"])
        .map((name) => lift(workerSrc, name)),
      "return { farmBoot, renderStoreReady, crewUp, crewArrived, farm };",
    ].join("\n"),
  )(
    { indexedDB: idb.as("engine") },
    { phrase_json: () => PHRASE },
    { cache_namespace: () => NS },
    module,
    async () => true,
    5000,
    RENDER_STAMP_MS,
    10000,
    news,
    () => {},
  );
}

// One farm worker, as written: `onJob` (its phrase and its jobs), `cacheOpen`,
// `cacheGet` and `cachePut`, with its wasm instance computing this build's
// namespace, each sound's key (the namespace, then the tree) and a render of
// it (`farm_render`: its φ, `phi:<tree>`, each logged as `rendered`), and
// render-store.js imported.
function farmWorker(idb, who) {
  assert.ok(/import\(`\.\/render-store\.js\?v=\$\{V\}`\)/.test(farmSrc), "farm.js does not import render-store.js");
  const port = { postMessage: (msg) => idb.log.push({ who, op: "said", type: msg.type, i: msg.i, hit: !!msg.hit }) };
  const wasm = {
    cache_namespace: () => NS,
    farm_key: (tree) => `${NS}/${tree}`,
    farm_render(tree, _phrase, wantAudio) {
      idb.log.push({ who, op: "rendered", tree, wantAudio });
      return { ok: true, cached: `phi:${tree}`, take_samples: () => new Float32Array(4), free() {} };
    },
  };
  return new Function(
    "self", "wasm", "port", "store",
    [
      "const EMPTY = new Float32Array(0);",
      "let cacheDb = null;",
      "let cacheNs = null;",
      "let phrase = null;",
      ...["idbReq", "cacheOpen", "cacheGet", "cachePut", "onJob"].map((name) => lift(farmSrc, name)),
      "return { onJob, opened: () => ({ db: cacheDb, ns: cacheNs, phrase }) };",
    ].join("\n"),
  )({ indexedDB: idb.as(who) }, wasm, port, renderStore);
}

// A crew of `width` farm workers on `idb` and a port to each, every message on
// a port delivered on a later task. `taken()` resolves once each worker has
// taken what was posted to it.
function crewOf(idb, width) {
  const farms = Array.from({ length: width }, (_, k) => farmWorker(idb, `farm ${k}`));
  const taken = [];
  const ports = farms.map((f, k) => ({
    postMessage(msg) {
      idb.log.push({ who: "engine", op: "posted", type: msg.type, to: k });
      taken.push(new Promise((resolve) => later(() => resolve(f.onJob(msg)))));
    },
  }));
  return { farms, ports, taken: () => Promise.all(taken) };
}

// Boot's crew, booted as `init` boots it: the stamp started, then `farmBoot`.
async function bootCrew(idb, width, opts) {
  const engine = engineWorker(idb, opts);
  const { farms, ports, taken } = crewOf(idb, width);
  engine.renderStoreReady(NS);
  assert.equal(await engine.farmBoot(ports, NS), true);
  await taken();
  return { engine, farms };
}

// The store was created once, by the engine worker, and stamped before any
// farm worker was handed the phrase or opened it; the farm workers' opens
// wrote nothing, and each holds the store, the namespace and the phrase.
function stampedFirst(idb, farms) {
  const at = (pred) => idb.log.findIndex(pred);
  const stamped = at((e) => e.who === "engine" && e.op === "readwrite" && e.store === RENDER_META);
  const firstPhrase = at((e) => e.op === "posted" && e.type === "phrase");
  const firstFarmOpen = at((e) => e.who.startsWith("farm") && e.op === "open");
  assert.ok(stamped >= 0, "the engine worker never stamped the store");
  assert.ok(firstPhrase > stamped, "a farm worker was handed the phrase before the store was stamped");
  assert.ok(firstFarmOpen > stamped, "a farm worker opened the store before it was stamped");
  assert.deepEqual(
    idb.log.filter((e) => e.op === "upgrade").map((e) => e.who),
    ["engine"],
    "the store was not created once, by the engine worker",
  );
  assert.deepEqual(idb.writes().filter((e) => e.who !== "engine"), [], "a farm worker wrote while opening the store");
  assert.ok(at((e) => e.who === "engine" && e.op === "close") > stamped, "the engine worker kept its connection");
  for (const f of farms) {
    const { db, ns, phrase } = f.opened();
    assert.ok(db, "a farm worker has no store to read and write rows in");
    assert.equal(ns, NS);
    assert.equal(phrase, PHRASE);
  }
}

test("the engine worker creates and stamps the render store before boot's crew is handed the phrase, and the crew's opens write nothing", async () => {
  const idb = fakeIndexedDB();
  const { farms } = await bootCrew(idb, 6);
  stampedFirst(idb, farms);
});

test("a farm worker keeps the row of every render, one made with its audio too, and reads the store only for a job that wants no audio", async () => {
  // A restore with no farm reads every bank entry from the store (worker.js
  // `bankPass`), the first ones too, which the farm renders with their audio
  // (`FARM_AUDIO_AHEAD`). Kept only for a job that wanted no audio, those
  // were rendered again on that visit (#285).
  const idb = fakeIndexedDB();
  const { farms } = await bootCrew(idb, 1);
  const [farm] = farms;
  const rows = () => idb.store().stores.get(RENDER_ROWS);
  const rendered = () => idb.log.filter((e) => e.op === "rendered").map((e) => `${e.tree}${e.wantAudio ? " with audio" : ""}`);
  const done = (i) => idb.log.find((e) => e.op === "said" && e.type === "done" && e.i === i);

  // Rendered with its audio, and its row kept.
  await farm.onJob({ type: "job", i: 0, tree: "a", wantAudio: true });
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(rows().get(`${NS}/a`), "phi:a", "a render made with its audio was not kept");
  // Wanting no audio, the same sound is read, not rendered.
  await farm.onJob({ type: "job", i: 1, tree: "a", wantAudio: false });
  assert.equal(done(1).hit, true, "a sound in the store was not read from it");
  // Wanting its audio, it is rendered again: a row has no samples.
  await farm.onJob({ type: "job", i: 2, tree: "a", wantAudio: true });
  assert.equal(done(2).hit, false);
  // A miss wanting no audio is rendered and kept.
  await farm.onJob({ type: "job", i: 3, tree: "b", wantAudio: false });
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(rows().get(`${NS}/b`), "phi:b");
  assert.deepEqual(rendered(), ["a with audio", "a with audio", "b"]);
});

test("a walk crew wanted while the render store is being stamped is asked for, and handed the phrase, after the stamp", async () => {
  // A machine whose boot has no farm (width 0, two or three cores) still
  // raises walk crews, and nothing else waits on the stamp started at init.
  const idb = fakeIndexedDB();
  const release = idb.hold("engine");
  const { farms, ports, taken } = crewOf(idb, 2);
  const engine = engineWorker(idb, {
    news(msg) {
      idb.log.push({ who: "engine", op: "news", type: msg.type });
      if (msg.type === "farm_want") later(() => engine.crewArrived({ crew: msg.crew, ports }));
    },
  });
  engine.renderStoreReady(NS);
  const raised = engine.crewUp();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(
    idb.log.some((e) => e.op === "posted" && e.type === "phrase"),
    false,
    "a walk crew was handed the phrase while the store was being stamped",
  );
  release();
  assert.equal(await raised, true);
  await taken();
  stampedFirst(idb, farms);
  const at = (pred) => idb.log.findIndex(pred);
  assert.ok(
    at((e) => e.op === "news" && e.type === "farm_want") > at((e) => e.op === "readwrite" && e.store === RENDER_META),
    "the walk crew was asked for before the store was stamped",
  );
});

test("a render store the engine worker could not open is created by the crew, which still caches", async () => {
  const idb = fakeIndexedDB();
  const { farms } = await bootCrew(idb, 3, { module: async () => { throw new Error("import failed"); } });
  assert.equal(idb.log.some((e) => e.who === "engine" && e.op === "open"), false);
  assert.ok(idb.log.some((e) => e.who.startsWith("farm") && e.op === "upgrade"), "no farm worker created the store");
  assert.equal(idb.store().stores.get(RENDER_META).get("ns"), NS);
  for (const f of farms) assert.ok(f.opened().db, "a farm worker has no store");
});

test("an engine-worker open that does not answer holds boot's crew for RENDER_STAMP_MS and no longer, and its late connection is closed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const idb = fakeIndexedDB();
  const release = idb.hold("engine");
  const engine = engineWorker(idb);
  const phrased = [];
  const ports = Array.from({ length: 3 }, (_, k) => ({
    postMessage: (msg) => msg.type === "phrase" && phrased.push(k),
  }));
  engine.renderStoreReady(NS);
  let booted = null;
  engine.farmBoot(ports, NS).then((ok) => (booted = ok));
  for (let i = 0; i < 4; i++) await settle();
  t.mock.timers.tick(RENDER_STAMP_MS - 1);
  for (let i = 0; i < 4; i++) await settle();
  assert.deepEqual(phrased, [], "boot's crew was handed the phrase before the stamp or the bound");
  t.mock.timers.tick(1);
  for (let i = 0; i < 4; i++) await settle();
  assert.deepEqual(phrased, [0, 1, 2], "boot's crew was not handed the phrase once the bound had gone by");
  assert.equal(booted, true);
  // The open answers at last: the store is stamped and the connection let go.
  release();
  for (let i = 0; i < 10; i++) await settle();
  assert.equal(idb.store().stores.get(RENDER_META).get("ns"), NS);
  assert.ok(idb.log.some((e) => e.who === "engine" && e.op === "close"), "the engine worker kept the late connection");
});
