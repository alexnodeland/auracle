// A farm worker keeps every row it writes (#360). Each render a farm worker
// makes is written to the render store without waiting (farm.js `cachePut`),
// and a write not yet committed when the worker closes or is terminated is
// aborted: the row is lost, and the next visit renders that sound again. The
// fill's last render is posted a moment before the engine says `bye`, so its
// row was lost in about half of the boots (restore.spec.js, unseeded).
//
// Here every write a farm worker makes commits half a second late (the
// transaction is kept open by reads before its put), so the last render's
// row is always still open when `bye` comes, and each worker says, as it
// closes, how many of its writes committed and how many were cut off.
const { test, expect } = require("./fixtures");

// Ahead of farm.js in every farm worker: each readwrite transaction's put
// waits 500 ms (reads keep the transaction alive meanwhile), and at
// `self.close` the worker posts what its writes came to.
const SLOW_COMMIT = `(() => {
  const ch = new BroadcastChannel("pw-farm-close");
  const me = { opened: 0, committed: 0, aborted: 0 };
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
    const tx = transaction.call(this, names, mode, ...rest);
    if (mode !== "readwrite") return tx;
    tx.addEventListener("complete", () => me.committed++);
    tx.addEventListener("abort", () => me.aborted++);
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = (name) => {
      const st = objectStore(name);
      return {
        put(...args) {
          me.opened++;
          const t0 = performance.now();
          const hop = () => {
            if (performance.now() - t0 < 500) st.get("__pw_none").onsuccess = hop;
            else st.put(...args);
          };
          hop();
        },
      };
    };
    return tx;
  };
  const close = self.close.bind(self);
  self.close = () => {
    ch.postMessage({ ...me });
    close();
  };
})();`;

test("a farm worker closes only once every row it wrote to the render store has committed", async ({ page, app }) => {
  await page.addInitScript(() => {
    const got = (window.__pwClosed = []);
    new BroadcastChannel("pw-farm-close").onmessage = (e) => got.push(e.data);
  });
  // Boot's crew of two, which fills the pool and writes a row per render.
  await app.boot({ query: "?farm=2", farmPrefix: SLOW_COMMIT });
  await app.reply("filled", { timeout: 300_000 });
  // Each of boot's two said what its writes came to as it closed. One
  // terminated before it closed says nothing, and fails here too.
  await app.engine((timeout) => expect.poll(() => page.evaluate(() => window.__pwClosed.length), { message: "a worker of boot's crew was terminated before it closed", timeout }).toBeGreaterThanOrEqual(2), { ms: 30_000 });
  const closed = await page.evaluate(() => window.__pwClosed);
  console.log(`farm workers' writes as they closed: ${JSON.stringify(closed)}`);
  expect(closed.map((c) => c.aborted), "a worker closed with a write still open").toEqual(closed.map(() => 0));
  expect(closed.map((c) => c.committed), "a worker closed before its writes committed").toEqual(closed.map((c) => c.opened));
  expect(closed.reduce((n, c) => n + c.committed, 0), "the crew wrote no rows").toBeGreaterThan(0);
});
