// The lint's own tests (make spec-lint): each house rule, and each setting
// made here, on code it must flag and code it must let through, linted as
// a file here would be (eslint.config.mjs, without the suppressions); and
// suppressions.mjs's checks on the cases they exist for. Not a spec:
// Playwright runs `*.spec.js` only.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { rises, stale } from "./suppressions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const eslint = new ESLint({ cwd: here });

/** The rules `code` breaks, linted as the file `name` here. */
async function broken(code, name = "probe.spec.js") {
  const [result] = await eslint.lintText(code, { filePath: join(here, name) });
  const fatal = result.messages.find((m) => m.fatal);
  assert.equal(fatal, undefined, fatal && fatal.message);
  return result.messages.map((m) => m.ruleId);
}

/** A spec on the fixture whose one test runs `body`. */
const spec = (body) => `const { test, expect } = require("./fixtures");

test("probe", async ({ page, app }) => {
${body}
  await expect(page.locator("#a")).toBeVisible();
});
`;

const flags = async (rule, code, name) => assert.ok((await broken(code, name)).includes(rule), `${rule} should flag:\n${code}`);
const passes = async (rule, code, name) => assert.ok(!(await broken(code, name)).includes(rule), `${rule} should let through:\n${code}`);

test("a spec on the fixture breaks no rule", async () => {
  assert.deepEqual(await broken(spec("  await app.boot();")), []);
});

test("use-the-fixture: @playwright/test only in the fixture, the config and boot_agrees", async () => {
  const code = 'const { test } = require("@playwright/test");\n';
  await flags("auracle/use-the-fixture", code);
  await passes("auracle/use-the-fixture", code, "boot_agrees.spec.js");
  await passes("auracle/use-the-fixture", code, "fixtures.js");
});

test("no-own-pageerror: the fixture's listener is the one", async () => {
  await flags("auracle/no-own-pageerror", spec('  page.on("pageerror", () => {});'));
  await passes("auracle/no-own-pageerror", 'page.on("pageerror", () => {});\n', "fixtures.js");
});

test("no-runner-clock: the runner's clock, and an argument worked out on it, but not the page function's body", async () => {
  await flags("auracle/no-runner-clock", spec("  const t0 = Date.now();"));
  await flags("auracle/no-runner-clock", spec("  await page.evaluate((t) => t, Date.now());"));
  await passes("auracle/no-runner-clock", spec("  await page.evaluate(() => performance.now());"));
  await passes("auracle/no-runner-clock", spec("  await page.addInitScript(() => { window.__at = performance.now(); });"));
  await passes("auracle/no-runner-clock", "const t = () => Date.now();\n", "patch_page.js");
});

test("no-aur-in-spec and aur-allow-list: window.__aur through named helpers, and only the listed members", async () => {
  await flags("auracle/no-aur-in-spec", spec("  await page.evaluate(() => window.__aur.wb.rack);"));
  await passes("auracle/aur-allow-list", "const f = (page) => page.evaluate(() => window.__aur.patch());\n", "patch_page.js");
  await flags("auracle/aur-allow-list", "const f = (page) => page.evaluate(() => window.__aur.note('x'));\n", "patch_page.js");
});

test("no-read-after-action: a one-shot read straight after an action, but not the retry it asks for", async () => {
  const rule = "auracle/no-read-after-action";
  await flags(rule, spec('  await page.locator("#b").click();\n  expect(await app.count("duel")).toBe(1);'));
  await flags(rule, spec('  await page.keyboard.press("x");\n  expect(await page.locator("#b").textContent()).not.toBe("y");'));
  await flags(rule, spec('  await page.locator("#b").click();\n  expect.soft(await app.count("duel"), "one").toBe(1);'));
  await passes(rule, spec('  await page.locator("#b").click();\n  await expect(async () => { expect(await app.count("duel")).toBeGreaterThan(0); }).toPass();'));
  await passes(rule, spec('  await page.locator("#b").click();\n  await expect.poll(() => app.count("duel")).toBe(1);'));
  await passes(rule, spec('  await expect(async () => {\n    await page.locator("#b").click();\n    expect(await app.count("duel")).toBe(1);\n  }).toPass();'));
  await passes(rule, spec('  await app.quiet();\n  expect(await app.sentCount("duel")).toBe(1);'));
});

test("budget-not-expect: a duration or a difference of moments under a limit, but not an order", async () => {
  const rule = "auracle/budget-not-expect";
  await flags(rule, spec("  const ms = 1;\n  expect(ms).toBeLessThan(300);"));
  await flags(rule, spec("  const r = { pickMs: 1 };\n  expect(r.pickMs, \"quick\").toBeLessThanOrEqual(PICK_MS);"));
  await flags(rule, spec("  const waitedFor = 1;\n  expect(waitedFor).toBeLessThan(1_000);"));
  await flags(rule, spec("  const t0 = await app.now();\n  const t1 = await app.now();\n  expect(t1 - t0).toBeLessThan(300);"));
  await passes(rule, spec("  const r = { pressedMs: 1, landedMs: 2 };\n  expect(r.pressedMs).toBeLessThan(r.landedMs);"));
  await passes(rule, spec("  app.budget(\"a press → lit\", 1, 100);"));
});

test("expect-expect: the fixture's asserting waits count as checks", async () => {
  const bare = (body) => `const { test } = require("./fixtures");\n\ntest("probe", async ({ app }) => {\n${body}\n});\n`;
  await flags("playwright/expect-expect", bare("  await app.boot({ wait: false });"));
  await passes("playwright/expect-expect", bare("  await app.boot();\n  await app.toast(/^Picked /);"));
  await passes("playwright/expect-expect", bare('  await app.reply("fitted");'));
  await passes("playwright/expect-expect", bare('  await app.answered({ lanes: ["bench"] });'));
  await passes("playwright/expect-expect", bare('  const [asked] = await app.sent("edit_set_tree");\n  await app.replyTo(asked);'));
  // A read of what is still waiting fails on nothing: it is no check.
  await flags("playwright/expect-expect", bare("  await app.unanswered();"));
});

test("no-useless-await is on, so the fixture's app.last carries a disable with its reason", async () => {
  await flags("playwright/no-useless-await", spec('  const r = await app.last("refined");'));
});

test("a disable says why, and names its rule", async () => {
  const rule = "@eslint-community/eslint-comments/require-description";
  await flags(rule, spec("  // eslint-disable-next-line playwright/no-wait-for-timeout\n  await page.waitForTimeout(100);"));
  await passes(rule, spec("  // eslint-disable-next-line playwright/no-wait-for-timeout -- a drag's step\n  await page.waitForTimeout(100);"));
  await flags("@eslint-community/eslint-comments/no-unlimited-disable", `/* eslint-disable -- all of it */\n${spec("")}`);
});

test("a Node tool (.mjs) is not read as Playwright code", async () => {
  assert.deepEqual(await broken("const describe = (p) => p;\nexport const s = describe(1);\n", "tool.mjs"), []);
});

test("suppressions: a key with no file is stale", () => {
  assert.deepEqual(stale({ "a.spec.js": {}, "b.spec.js": {} }, (f) => f === "a.spec.js").length, 1);
});

test("suppressions: a count may fall and never rise", () => {
  const base = { "a.spec.js": { r: { count: 2 } } };
  const always = () => true;
  assert.deepEqual(rises(base, { "a.spec.js": { r: { count: 1 } } }, always), []);
  assert.equal(rises(base, { "a.spec.js": { r: { count: 3 } } }, always).length, 1);
});

test("suppressions: no file gains an entry, or a rule the set had", () => {
  const base = { "a.spec.js": { r: { count: 2 } }, "b.spec.js": { s: { count: 1 } } };
  assert.equal(rises(base, { ...base, "a.spec.js": { r: { count: 2 }, s: { count: 1 } } }, () => true).length, 1, "a rule new to a file's entry");
  assert.equal(rises(base, { ...base, "c.spec.js": { r: { count: 1 } } }, () => true).length, 1, "an entry for a file the base had");
  assert.equal(rises(base, { ...base, "new.spec.js": { r: { count: 1 } } }, () => false).length, 1, "a new file starts at zero");
});

test("suppressions: a renamed file takes its old entry, and a rule new to the set is taken in once", () => {
  const base = { "old.spec.js": { r: { count: 2 } } };
  assert.deepEqual(rises(base, { "new.spec.js": { r: { count: 2 } } }, (f) => f === "old.spec.js"), [], "a rename");
  assert.equal(rises(base, { "new.spec.js": { r: { count: 3 } } }, (f) => f === "old.spec.js").length, 1, "a rename that grew");
  assert.deepEqual(rises(base, { ...base, "c.spec.js": { fresh: { count: 4 } } }, () => true), [], "a rule new to the set");
});
