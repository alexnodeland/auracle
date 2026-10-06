// AURACLE render cache's store (`auracle-renders`): its name, its two object
// stores and the one rule for when its rows are dropped, for the two threads
// that open it.
//
// - The engine worker opens it once, at boot, before any farm worker is handed
//   the phrase (worker.js `farmBoot`), and closes it again. On a first visit
//   that is where the store is created and stamped with the namespace.
// - Each farm worker opens it when the phrase arrives and keeps it, to read and
//   write rows (farm.js `cacheOpen`). The store is stamped by then, so its open
//   only reads.
//
// The order is the point. When every farm worker found no store (a first
// visit) or another build's stamp, each one cleared the store and wrote the
// stamp, and those writes queued behind one another and behind the first
// renders. At farm width 6 the first sounds waited about 1.5 s for them; at
// width 2 the wait did not show (#200, docs/notes/test-audit-2026-10/
// measurements.md). The farm's open still creates and stamps a store it finds
// without one, so a store the engine worker could not open costs that wait
// and nothing else.
//
// What the namespace guarantees (a row written under another build's φ is
// never a hit) is farm.js's to explain: it rests on the key every row is
// stored under, not on this stamp.

export const RENDER_DB = "auracle-renders";
export const RENDER_ROWS = "rows";
export const RENDER_META = "meta";

// Rows retained before the store is dropped wholesale. ~1 KB each, so this is
// ~20 MB. Eviction is "clear everything", which is crude and deliberately so:
// an LRU needs an access-time write on every *hit*, turning the cheap path into
// a write, and the thing being protected is a disk quota rather than a working
// set. A cleared cache costs one slow boot.
export const RENDER_MAX_ROWS = 20000;

const done = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** The store, open under the namespace `ns`, through `idb` (the thread's
 *  `indexedDB`). Created when there is none; cleared and stamped with `ns` when
 *  its stamp is another namespace's or it holds more than `RENDER_MAX_ROWS`
 *  rows; otherwise only read. Resolves the connection, or null when there is
 *  none to be had (no IndexedDB, a private window, a refusal). Never rejects:
 *  a store that will not open costs a slower boot and nothing else. */
export async function renderStoreOpen(idb, ns) {
  let db = null;
  try {
    if (!idb || !ns) return null;
    db = await new Promise((resolve, reject) => {
      const open = idb.open(RENDER_DB, 1);
      // The version has only ever been 1, so this cannot happen today. Were it
      // to move, another tab's connection to the older version would hold
      // this open until that tab let go, and the engine worker's boot waits
      // on it: give up instead.
      let gaveUp = false;
      open.onblocked = () => {
        gaveUp = true;
        reject(new Error(`${RENDER_DB} is held open by another tab`));
      };
      open.onupgradeneeded = () => {
        const made = open.result;
        if (!made.objectStoreNames.contains(RENDER_ROWS)) made.createObjectStore(RENDER_ROWS);
        if (!made.objectStoreNames.contains(RENDER_META)) made.createObjectStore(RENDER_META);
      };
      open.onsuccess = () => {
        if (gaveUp) open.result.close();
        else resolve(open.result);
      };
      open.onerror = () => reject(open.error);
    });
    const prev = await done(db.transaction(RENDER_META, "readonly").objectStore(RENDER_META).get("ns"));
    const count = await done(db.transaction(RENDER_ROWS, "readonly").objectStore(RENDER_ROWS).count());
    // The whole eviction policy, in one condition. φ moving orphans every row
    // measured under the old φ (their keys carry the old namespace, so they
    // could never be read), and nothing finer is correct; clearing them is
    // for the disk quota.
    if (prev !== ns || count > RENDER_MAX_ROWS) {
      await done(db.transaction(RENDER_ROWS, "readwrite").objectStore(RENDER_ROWS).clear());
      await done(db.transaction(RENDER_META, "readwrite").objectStore(RENDER_META).put(ns, "ns"));
    }
    return db;
  } catch (_) {
    try {
      if (db) db.close();
    } catch (_) {
      /* already closed */
    }
    return null;
  }
}
