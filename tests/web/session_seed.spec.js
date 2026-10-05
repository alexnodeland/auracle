// `?seed=N` deals a session that can be shared or replayed (apps/web/main.js
// `seedOverride`): the engine derives every stream from the session's seed,
// so a fresh session (nothing saved in the browser) with the same seed fills
// the same pool, and another seed fills another. Each boot here is a browser
// context of its own, so no saved session carries over between them. The
// fixture boots every other spec with a seed of its own (fixtures.js SEED).
const { test, expect, openApp } = require("./fixtures");

/** The pool a fresh session with `seed` fills: every sound's id and name. */
async function poolOf(app) {
  await app.filled();
  const { ranked } = await app.facts();
  return ranked.map((r) => `${r.id} ${r.name}`).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

test("the same ?seed fills the same pool on a fresh session, and another seed another", async ({ app, browser }) => {
  await app.boot({ seed: 7 });
  const first = await poolOf(app);
  expect(first.length).toBe(40);

  const use = test.info().project.use;
  const fresh = async (seed) => {
    const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const other = await openApp(page);
    await other.boot({ seed });
    const pool = await poolOf(other);
    await context.close();
    expect(errors, `uncaught exceptions with ?seed=${seed}`).toEqual([]);
    return pool;
  };
  expect(await fresh(7), "?seed=7 again").toEqual(first);
  const other = await fresh(8);
  expect(other.length).toBe(40);
  expect(other, "?seed=8 filled the pool ?seed=7 did").not.toEqual(first);
});
