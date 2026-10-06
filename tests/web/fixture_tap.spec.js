// The fixture's tap (fixtures.js), on an engine that answers every request
// with itself, so what the tap does with requests and replies is seen without
// booting the instrument: a page and a worker served here, the worker at a
// path ending in worker.js, which is how the tap knows the engine.
//
// - A hold armed with `from` begins at the request it names, keeps the
//   engine's replies from then until `release`, and is spent once it begins:
//   nothing of it is left armed (it used to leave its patterns in `holdNext`).
// - `fail` answers a request as the worker answers one it could not run, an
//   `engine_error` naming it, injected; the request is still in `sent` and
//   never reaches the engine. `once` fails the next one only; `fatal`, every
//   one that matches.
// - A speed budget (`app.budget`, ADR-022) is the test's annotation, and an
//   over-budget one fails the test only under AURACLE_PERF=1.
// - A request's last reply is the one carrying its number (`re`) without
//   `more`, whatever its type and wherever it lands (`app.replyTo`), and
//   `app.answered` waits for exactly the requests sent so far that the
//   worker answers; a reply the tap gives for a request (`app.answer`,
//   `app.fail`) carries its number too. Here on an engine that answers the
//   way worker.js does.
// - `app.visit` is a new load of the address, seeded as `boot` seeds it and
//   with a level's hash, even when only the hash changed.
// - A page error in a context `newContext` made fails the test, as one in
//   the test's own context does; the context has the project's `use`.
const { test, expect, UNANSWERED } = require("./fixtures");

const ECHO = "self.onmessage = (e) => postMessage(e.data);";

// Answers as worker.js does (its `post` and `answer`): `re` on each reply to a
// request, `more` on all but its last. A `slow` request is answered with a
// step at once and its last reply only once the spec says `go`; `news`
// makes the engine say something of its own; a request the worker never
// answers (UNANSWERED) gets nothing.
const ANSWERS = `const never = new Set(${JSON.stringify(UNANSWERED)});
const held = [];
self.onmessage = (e) => {
  const m = e.data;
  if (never.has(m.type)) return;
  if (m.type === "slow") {
    postMessage({ type: "step", re: m.rid, more: true });
    held.push(m);
    return;
  }
  if (m.type === "go") {
    for (const h of held.splice(0)) postMessage({ type: "done", re: h.rid });
    return;
  }
  if (m.type === "news") return postMessage({ type: "done" });
  postMessage({ type: m.type, re: m.rid });
};`;

async function echo(page, body = ECHO) {
  await page.route("**/tap-test/", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>tap</title>" }));
  await page.route("**/tap-test/worker.js", (r) => r.fulfill({ contentType: "text/javascript", body }));
  await page.goto("/tap-test/");
  await page.evaluate(() => {
    window.__echo = new Worker("/tap-test/worker.js");
  });
}

test("a hold armed with from begins at the request it names, and is spent once it has", async ({ page, app }) => {
  await echo(page);
  await app.hold("ping", { from: "go" });
  await app.post({ type: "ping", n: 1 });
  await app.reply("ping", { where: { n: 1 } });
  expect(await app.holding(), "held before the request it waits for").toBe(false);
  await app.post({ type: "go" });
  await app.post({ type: "ping", n: 2 });
  await expect.poll(() => app.held()).toHaveLength(1);
  expect(await app.holding()).toBe(true);
  expect(await page.evaluate(() => ({ next: window.__tap.holdNext, from: window.__tap.holdFrom })), "spent once begun").toEqual({ next: [], from: null });
  expect(await app.release()).toBe(1);
  await app.reply("ping", { where: { n: 2 } });
  // Spent: the same request again holds nothing.
  await app.post({ type: "go" });
  await app.post({ type: "ping", n: 3 });
  await app.reply("ping", { where: { n: 3 } });
  expect(await app.held()).toEqual([]);
});

test("a failed request is answered as the worker answers one it could not run", async ({ page, app }) => {
  await echo(page);
  await app.fail("perform_graft", { message: "Error: injected", once: true });
  await app.post({ type: "perform_graft", req: 7 });
  const failed = await app.reply("engine_error", { injected: true });
  expect(failed).toMatchObject({ type: "engine_error", request: "perform_graft", id: null, req: 7, message: "Error: injected", fatal: false });
  expect(await app.sentCount("perform_graft"), "the request is still in sent").toBe(1);
  // Once: the next one reaches the engine.
  await app.post({ type: "perform_graft", req: 8 });
  await app.reply("perform_graft", { where: { req: 8 } });
  // Fatal, for every request that matches.
  await app.fail({ type: ["perform_wire", "perform_offer"] }, { message: "the engine is down", fatal: true });
  await app.post({ type: "perform_wire", req: 9 });
  await app.post({ type: "perform_offer", req: 10 });
  await app.post({ type: "perform_offer", req: 11 });
  await expect
    .poll(async () => (await app.replies("engine_error", { injected: true })).map((r) => [r.request, r.req, r.fatal]))
    .toEqual([
      ["perform_graft", 7, false],
      ["perform_wire", 9, true],
      ["perform_offer", 10, true],
      ["perform_offer", 11, true],
    ]);
  await app.quiet();
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("perform_wire"), "a failed request reached the engine").toBe(0);
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("perform_offer"), "a failed request reached the engine").toBe(0);
});

test("a speed budget is recorded on the gate and judged only under AURACLE_PERF", async ({ app }, info) => {
  // Under AURACLE_PERF=1 the budget over its limit fails this test, as it
  // must: expected there.
  test.fail(process.env.AURACLE_PERF === "1", "AURACLE_PERF judges a budget over its limit");
  expect(app.budget("within", 40.4, 100), "a budget within its limit").toBe(true);
  expect(app.budget("over", 150, 100), "a budget over its limit").toBe(false);
  expect(app.budget("never seen", Infinity, 100), "a moment never seen is over").toBe(false);
  expect(info.annotations.filter((a) => a.type === "budget").map((a) => a.description)).toEqual([
    "within 40 ms of 100 ms",
    "over 150 ms of 100 ms (over)",
    "never seen Infinity ms of 100 ms (over)",
  ]);
  // Taken off again: the run's summary lists the budgets the app missed
  // (shard.mjs budgets), and these were missed on purpose.
  info.annotations.splice(0, info.annotations.length, ...info.annotations.filter((a) => a.type !== "budget"));
});

test("a request's last reply is the one that names it, not the first of its type", async ({ page, app }) => {
  await echo(page, ANSWERS);
  await app.post({ type: "slow", rid: 1 });
  await app.post({ type: "news" });
  await app.post({ type: "log_edit", rid: 2 });
  // The engine's own `done`, and the slow request's step, land first: neither
  // answers it.
  await app.reply("done");
  await app.reply("step");
  expect(await app.unanswered(), "the slow request waits; a log line never will").toEqual([{ type: "slow", rid: 1, _at: expect.any(Number) }]);
  await app.post({ type: "go" });
  const done = await app.replyTo({ type: "slow", rid: 1 });
  expect(done).toMatchObject({ type: "done", re: 1 });
  expect(done.more, "its last reply").toBeUndefined();
  expect(await app.replies("done"), "the engine's own done came first").toHaveLength(2);
  await app.answered();
  expect(await app.unanswered()).toEqual([]);
  // Asked by type and by lane; a request main did not number is not waited for.
  await app.post({ type: "edit_param", rid: 3 });
  await app.post({ type: "edit_param" });
  await app.answered({ lanes: ["bench"] });
  expect((await app.replyTo(3)).type).toBe("edit_param");
  await expect(app.answered({ lanes: ["nowhere"] })).rejects.toThrow(/no lane named nowhere/);
});

test("answered waits while a request it covers has no last reply, and says which", async ({ page, app }) => {
  await echo(page, ANSWERS);
  await app.post({ type: "slow", rid: 1 });
  await app.post({ type: "edit_param", rid: 2 });
  await app.answered({ types: ["edit_param"] });
  await expect(app.answered({ types: ["slow"], timeout: 1_500 })).rejects.toThrow(/still waiting for slow #1/);
  await app.post({ type: "go" });
  await app.answered({ types: ["slow"] });
});

test("a reply the tap gives for a request carries the request's number", async ({ page, app }) => {
  await echo(page, ANSWERS);
  await app.answer("edit_structure", { type: "bench", edited: "structure" });
  await app.fail("edit_set_tree", { message: "Error: injected", once: true });
  await app.post({ type: "edit_structure", rid: 5 });
  await app.post({ type: "edit_set_tree", rid: 6 });
  await app.answered({ lanes: ["bench"] });
  expect(await app.replyTo(5)).toMatchObject({ type: "bench", edited: "structure", re: 5 });
  expect(await app.replyTo(6)).toMatchObject({ type: "engine_error", request: "edit_set_tree", re: 6 });
});

test("a visit is a new load of the seeded address, a level's hash and all", async ({ page, app }) => {
  await page.route(/\/tap-test\/(\?[^#]*)?$/, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>tap</title>" }));
  await app.visit("/tap-test/#taste", { seed: 7, wait: false });
  expect(new URL(page.url()).search + new URL(page.url()).hash).toBe("?seed=7#taste");
  await page.evaluate(() => { window.__before = true; });
  // Another hash alone: a new document, not a move within this one.
  await app.visit("/tap-test/#learning", { seed: 7, wait: false });
  expect(new URL(page.url()).hash).toBe("#learning");
  expect(await page.evaluate(() => window.__before ?? null), "the page before the visit").toBeNull();
});

test("a page error in a context of the test's own fails the test, as one in its own context does", async ({ newContext, pageErrors }) => {
  const context = await newContext();
  const page = await context.newPage();
  // The project's `use` holds there too: its baseURL.
  await page.goto("/pkg/build.json");
  await page.evaluate(() => setTimeout(() => { throw new Error("thrown in another context"); }, 0));
  await expect.poll(() => [...pageErrors]).toEqual(["thrown in another context"]);
  // Taken off again: thrown on purpose, and the test's teardown would fail on it.
  pageErrors.splice(0);
});
