// burnin.mjs's plan: the Burn-in job's runners by time, and none when too
// heavy (#456).
import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, fileSeconds, testsDeclared, median, TARGET_S, LIMIT_S, MAX_RUNNERS } from "./burnin.mjs";

const t = (file, ...secs) => Object.fromEntries(secs.map((s, i) => [`${file} › test ${i}`, s]));

test("a file's time is its tests' times on main, by their keys", () => {
  const timings = { ...t("a.spec.js", 10, 20), ...t("ab.spec.js", 99) };
  assert.equal(fileSeconds("a.spec.js", timings, ""), 30);
});

test("a file main never timed weighs its declared tests at the median", () => {
  const src = 'test("one", async () => {});\ntest.describe("g", () => { test(`two`, f); });\ntest.use({});\ntest.setTimeout(1);';
  assert.equal(testsDeclared(src), 2);
  const timings = t("other.spec.js", 5, 10, 40);
  assert.equal(median(timings), 10);
  assert.equal(fileSeconds("new.spec.js", timings, src), 20);
});

test("light files get one runner, three times each", () => {
  const p = plan({ files: ["a.spec.js"], timings: t("a.spec.js", 20, 20), sources: {} });
  assert.equal(p.load, 120);
  assert.equal(p.runners, 1);
});

test("runners follow the load, never the file count, up to the most", () => {
  // One heavy file (four minutes once, twelve repeated) takes two runners.
  const heavy = plan({ files: ["h.spec.js"], timings: t("h.spec.js", ...Array(8).fill(30)), sources: {} });
  assert.equal(heavy.runners, Math.ceil((3 * 240) / TARGET_S));
  // Five light files take one.
  const files = ["a", "b", "c", "d", "e"].map((x) => `${x}.spec.js`);
  const light = plan({ files, timings: Object.assign({}, ...files.map((f) => t(f, 5))), sources: {} });
  assert.equal(light.runners, 1);
  assert.ok(heavy.runners <= MAX_RUNNERS);
});

test("a file too heavy for the job's limits is left out, and run once", () => {
  // Fifteen minutes once is forty-five repeated: past LIMIT_S on each of the most runners.
  const p = plan({ files: ["big.spec.js"], timings: t("big.spec.js", ...Array(30).fill(30)), sources: {} });
  assert.ok(3 * 15 * 60 > MAX_RUNNERS * LIMIT_S);
  assert.deepEqual([p.runners, p.files, p.left], [0, [], ["big.spec.js"]]);
});

test("a heavy edit burns in what fits, a new spec first and then the lightest", () => {
  const timings = { ...t("heavy.spec.js", ...Array(16).fill(30)), ...t("mid.spec.js", ...Array(8).fill(30)), ...t("light.spec.js", 20) };
  const src = { "new.spec.js": 'test("a", f); test("b", f);' };
  const p = plan({ files: ["heavy.spec.js", "light.spec.js", "mid.spec.js", "new.spec.js"], timings, sources: src });
  // The new spec and the lightest go first, then mid; heavy (24 minutes
  // repeated) would take the whole past three runners of seven minutes.
  assert.deepEqual(p.files, ["light.spec.js", "mid.spec.js", "new.spec.js"]);
  assert.deepEqual(p.left, ["heavy.spec.js"]);
  assert.ok(p.load <= MAX_RUNNERS * LIMIT_S);
  assert.ok(p.runners >= 1 && p.runners <= MAX_RUNNERS);
  assert.ok(p.load / p.runners <= LIMIT_S);
});

test("no files, no burn-in", () => {
  assert.equal(plan({ files: [], timings: {}, sources: {} }).runners, 0);
});
