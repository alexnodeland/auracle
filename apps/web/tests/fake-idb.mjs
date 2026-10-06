// IndexedDB, as far as the app's workers use it: the render cache's store
// (render-store.js), the face store (worker.js) and the rows each reads and
// writes. One database per name, kept in memory; every request answered on a
// later task, as a browser answers it. Shared by render-store.test.mjs, which
// runs the two workers' store code lifted out of their source, and by the
// worker harness (tests/worker/harness.mjs), which gives worker.js itself a
// store to read and write in a Node thread.
import { RENDER_DB, RENDER_ROWS, RENDER_META } from "../render-store.js";

const later = (fn) => setImmediate(fn);

/** A stand-in IndexedDB. `as(who)` is one thread's `indexedDB`; `log` is
 *  every open, upgrade, transaction (by its mode) and close, in order, each
 *  with who made it. `hold(who)` keeps that thread's opens unanswered until
 *  the function it returns is called. `dbs` is what a thread left (`dump`),
 *  to start from: `{ [name]: { version, stores: { [store]: [[key, value]] } } }`. */
export function fakeIndexedDB({ dbs: from = {} } = {}) {
  const log = [];
  const dbs = new Map(); // name -> { version, stores: Map<name, Map> }
  for (const [name, { version, stores }] of Object.entries(from)) {
    dbs.set(name, { version, stores: new Map(Object.entries(stores).map(([s, rows]) => [s, new Map(rows)])) });
  }
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
  // A render store as an earlier visit left it.
  const seed = ({ ns, rows = 0 }) => {
    const meta = new Map(ns == null ? [] : [["ns", ns]]);
    const kept = new Map(Array.from({ length: rows }, (_, i) => [`${ns}/${i}`, "{}"]));
    dbs.set(RENDER_DB, { version: 1, stores: new Map([[RENDER_ROWS, kept], [RENDER_META, meta]]) });
  };
  const store = () => dbs.get(RENDER_DB);
  const writes = (who) => log.filter((e) => e.op === "readwrite" && (who == null || e.who === who));
  // Every database as it stands, in the form `dbs` takes.
  const dump = () =>
    Object.fromEntries(
      [...dbs].map(([name, db]) => [name, { version: db.version, stores: Object.fromEntries([...db.stores].map(([s, rows]) => [s, [...rows]])) }]),
    );
  return { log, as, hold, seed, store, writes, dump };
}
