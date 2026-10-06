// The render cache's store, and who opens it first. Run: node --test apps/web/tests
//
// render-store.js is a module and is imported as one. The order is read out of
// the two workers' own source: worker.js (the engine worker's `farmBoot`,
// `renderStoreReady`, `farmSetup`, `farmPhrase`) and farm.js (`onJob`'s
// phrase, `cacheOpen`) cannot be imported, since each boots on load, so their
// functions are lifted out and run as written, over a stand-in IndexedDB that
// keeps one database in memory, answers every request on a later task, as a
// browser does, and logs who did what.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as renderStore from "../render-store.js";

const { renderStoreOpen, RENDER_DB, RENDER_ROWS, RENDER_META, RENDER_MAX_ROWS } = renderStore;

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

// IndexedDB, as far as the store uses it. `as(who)` is one thread's
// `indexedDB`; `log` is every open, upgrade, transaction (by its mode) and
// close, in order, each with who made it. `hold(who)` keeps that thread's opens
// unanswered until the function it returns is called.
function fakeIndexedDB() {
  const log = [];
  const dbs = new Map(); // name -> { version, stores: Map<name, Map> }
  const held = new Map(); // who -> a promise their opens wait on
  const hold = (who) => {
    let release;
    held.set(who, new Promise((resolve) => (release = resolve)));
    return () => {
      held.delete(who);
      release();
    };
  };
  function connection(who, db) {
    return {
      objectStoreNames: { contains: (s) => db.stores.has(s) },
      createObjectStore(s) {
        db.stores.set(s, new Map());
      },
      transaction(s, mode) {
        const rows = db.stores.get(s);
        if (!rows) throw new Error(`NotFoundError: no object store ${s}`);
        log.push({ who, op: mode, store: s });
        const ask = (fn) => {
          const req = {};
          later(() => {
            req.result = fn();
            req.onsuccess?.();
          });
          return req;
        };
        const write = (fn) => {
          if (mode !== "readwrite") throw new Error("ReadOnlyError");
          return ask(fn);
        };
        return {
          objectStore: () => ({
            get: (k) => ask(() => rows.get(k)),
            count: () => ask(() => rows.size),
            clear: () => write(() => rows.clear()),
            put: (v, k) => write(() => void rows.set(k, v)),
          }),
        };
      },
      close() {
        log.push({ who, op: "close" });
      },
    };
  }
  const as = (who) => ({
    open(name, version) {
      const req = {};
      log.push({ who, op: "open" });
      const answer = () =>
        later(() => {
          let db = dbs.get(name);
          if (!db) dbs.set(name, (db = { version: 0, stores: new Map() }));
          req.result = connection(who, db);
          if (version > db.version) {
            db.version = version;
            log.push({ who, op: "upgrade" });
            req.onupgradeneeded?.();
          }
          req.onsuccess?.();
        });
      const gate = held.get(who);
      if (gate) gate.then(answer);
      else answer();
      return req;
    },
  });
  // A store as an earlier visit left it.
  const seed = ({ ns, rows = 0 }) => {
    const meta = new Map(ns == null ? [] : [["ns", ns]]);
    const kept = new Map(Array.from({ length: rows }, (_, i) => [`${ns}/${i}`, "{}"]));
    dbs.set(RENDER_DB, { version: 1, stores: new Map([[RENDER_ROWS, kept], [RENDER_META, meta]]) });
  };
  const store = () => dbs.get(RENDER_DB);
  const writes = (who) => log.filter((e) => e.op === "readwrite" && (who == null || e.who === who));
  return { log, as, hold, seed, store, writes };
}

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

// The engine worker's side of boot's crew, as written: `farmBoot` and what it
// calls, over `engine` and `glue` stand-ins, and `farmHandshake` answered at
// once. `renderStoreModule` is render-store.js itself, or `module`.
function engineWorker(idb, { module = async () => renderStore } = {}) {
  assert.ok(RENDER_STAMP_MS > 0, "worker.js has no RENDER_STAMP_MS");
  assert.ok(
    /^const renderStoreModule = \(\) => import\(`\.\/render-store\.js\?v=\$\{V\}`\);$/m.test(workerSrc),
    "worker.js does not import render-store.js as renderStoreModule",
  );
  phraseOnlyThroughTheStamp();
  return new Function(
    "self", "engine", "glue", "renderStoreModule", "farmHandshake", "FARM_HANDSHAKE_MS", "RENDER_STAMP_MS",
    "onFarmMessage",
    [
      "const farm = [];",
      "const farmPreDead = new Set();",
      "let renderStamped = null;",
      lift(workerSrc, "farmPhrase"),
      lift(workerSrc, "farmSetup"),
      lift(workerSrc, "renderStoreReady"),
      lift(workerSrc, "farmBoot"),
      "return { farmBoot, renderStoreReady, farm };",
    ].join("\n"),
  )(
    { indexedDB: idb.as("engine") },
    { phrase_json: () => PHRASE },
    { cache_namespace: () => NS },
    module,
    async () => true,
    5000,
    RENDER_STAMP_MS,
    () => {},
  );
}

// One farm worker, as written: `onJob` (its phrase) and `cacheOpen`, with its
// wasm instance computing this build's namespace and render-store.js imported.
function farmWorker(idb, who) {
  assert.ok(/import\(`\.\/render-store\.js\?v=\$\{V\}`\)/.test(farmSrc), "farm.js does not import render-store.js");
  const port = { postMessage: (msg) => idb.log.push({ who, op: "said", type: msg.type }) };
  return new Function(
    "self", "wasm", "port", "store",
    [
      "let cacheDb = null;",
      "let cacheNs = null;",
      "let phrase = null;",
      lift(farmSrc, "cacheOpen"),
      lift(farmSrc, "onJob"),
      "return { onJob, opened: () => ({ db: cacheDb, ns: cacheNs, phrase }) };",
    ].join("\n"),
  )({ indexedDB: idb.as(who) }, { cache_namespace: () => NS }, port, renderStore);
}

// Boot's crew of `width` farm workers on `idb`, booted as `init` boots it: the
// stamp started, then `farmBoot` with a port to each worker, every message on a
// port delivered on a later task. Resolves once every worker has taken the
// phrase.
async function bootCrew(idb, width, opts) {
  const engine = engineWorker(idb, opts);
  const farms = Array.from({ length: width }, (_, k) => farmWorker(idb, `farm ${k}`));
  const taken = [];
  const ports = farms.map((f, k) => ({
    postMessage(msg) {
      idb.log.push({ who: "engine", op: "posted", type: msg.type, to: k });
      taken.push(new Promise((resolve) => later(() => resolve(f.onJob(msg)))));
    },
  }));
  engine.renderStoreReady(NS);
  assert.equal(await engine.farmBoot(ports, NS), true);
  await Promise.all(taken);
  return { engine, farms };
}

test("the engine worker creates and stamps the render store before boot's crew is handed the phrase, and the crew's opens write nothing", async () => {
  const idb = fakeIndexedDB();
  const { farms } = await bootCrew(idb, 6);
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
