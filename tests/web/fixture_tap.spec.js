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
const { test, expect } = require("./fixtures");

const ECHO = "self.onmessage = (e) => postMessage(e.data);";

async function echo(page) {
  await page.route("**/tap-test/", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>tap</title>" }));
  await page.route("**/tap-test/worker.js", (r) => r.fulfill({ contentType: "text/javascript", body: ECHO }));
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
  expect(await app.count("perform_wire"), "a failed request reached the engine").toBe(0);
  expect(await app.count("perform_offer"), "a failed request reached the engine").toBe(0);
});
