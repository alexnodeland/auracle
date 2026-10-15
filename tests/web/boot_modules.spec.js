// How the page asks for its code at boot.
//
// Two things were wrong, and neither shows to a player on a fast local server.
// main.js asked for its modules one `await import()` at a time, so each waited
// on the reply to the one before and the engine's worker did not start until
// the last had come: over a real connection, a first visit paid every round
// trip in turn. And vessel.js and live-face.js imported faces.js (and
// vessel.js) by a bare name, which carries no build stamp: a second fetch of
// the same file, kept by the browser on its own terms, so an update could
// leave an old copy drawing the faces.
//
// The first is held where it can be seen: taste-geom.js is the first module
// main.js asks for, and its reply is not sent until words.js, the second, has
// been asked for. Asked one at a time, words.js is never asked for while
// taste-geom.js waits, and the wait runs out.
const { test, expect } = require("./fixtures");

test("boot asks for its modules together, and each once under the build's stamp", async ({ page, app }) => {
  const asked = [];
  let sawWords;
  const wordsAsked = new Promise((resolve) => { sawWords = resolve; });
  page.on("request", (req) => {
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/([\w-]+)\.js$/);
    if (!m) return;
    asked.push(url.pathname + url.search);
    if (m[1] === "words") sawWords();
  });
  let together = null;
  await page.route(/\/taste-geom\.js/, async (route) => {
    together = await Promise.race([
      wordsAsked.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 8_000)),
    ]);
    await route.continue();
  });

  await app.boot({ warmed: false, seen: false, wait: false });
  await app.booted();

  expect(together, "words.js was asked for while taste-geom.js was still on its way").toBe(true);

  // Every script of the app is asked for under the build's stamp…
  const unstamped = asked.filter((u) => !/\?v=[0-9a-f]{8,64}$/.test(u));
  expect(unstamped, "scripts asked for without the build's stamp").toEqual([]);
  // …and once: the faces were drawn by a second copy of faces.js and vessel.js.
  for (const name of ["faces", "vessel"]) {
    expect(asked.filter((u) => u.startsWith(`/${name}.js`)), `${name}.js is asked for once`).toHaveLength(1);
  }
});
