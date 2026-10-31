// profile.js's arithmetic: the rate a profile throttles a Chromium page at
// (`pageRateOf`: the render's rate, at most the profile's `pageRateMax`), and
// the calibration line each runner prints for it. The page's cap is held here
// and not in reference_profile.spec.js, which holds the wiring (that the
// fixture hands CDP what `pageRateOf` says): a spec sees the cap only on a
// machine fast enough to reach it, and most runners are not. `make web-check`
// runs it.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const profile = require("./profile.js");

/** A calibration as `calibrated` keeps it, with these fields over it. Its
 *  figures are the test's own, not `profiles.json`'s. */
const calibration = (over) => ({
  name: "air",
  browser: "chromium",
  preset: "Solo Flight",
  referenceMs: 356,
  referenceIs: "an estimate",
  measuredMs: 120,
  times: [119, 120, 122],
  rate: 2.97,
  pageRateMax: 4.5,
  pageRateMaxIs: "an estimate of the Air's CPU",
  farm: 2,
  ...over,
});

test("a page is throttled at the render's rate while that is under the profile's cap", () => {
  assert.equal(profile.pageRateOf(calibration({ rate: 2.97 })), 2.97);
  assert.equal(profile.pageRateOf(calibration({ rate: 4.5 })), 4.5);
});

test("a page is throttled at the profile's cap where the render's rate is over it", () => {
  assert.equal(profile.pageRateOf(calibration({ rate: 5.01 })), 4.5);
  assert.equal(profile.pageRateOf(calibration({ rate: 15.9 })), 4.5);
});

test("a machine as slow as the reference has its page at ×1", () => {
  assert.equal(profile.pageRateOf(calibration({ rate: 1 })), 1);
});

test("a profile with no cap throttles the page at the render's rate", () => {
  assert.equal(profile.pageRateOf(calibration({ rate: 5.01, pageRateMax: null })), 5.01);
  assert.equal(profile.pageRateOf(calibration({ rate: 5.01, pageRateMax: undefined })), 5.01);
});

test("the air profile has a cap over ×1, so its page throttle is the render's rate only up to it", () => {
  const air = profile.profileOf("air");
  assert.equal(typeof air.pageRateMax, "number");
  assert.ok(air.pageRateMax > 1, `pageRateMax ${air.pageRateMax}`);
  assert.ok(air.pageRateMaxIs, "the cap says how it is known (pageRateMaxIs)");
  assert.ok(air.referenceIs, "the reference's time says how it is known (referenceIs)");
});

test("the calibration line says what was measured, what is estimated, and the page at its cap", () => {
  const line = profile.calibrationLine(calibration({ rate: 5.27, measuredMs: 68 }));
  assert.equal(
    line,
    "air in chromium: one render of Solo Flight 68 ms here (measured), 356 ms on the reference (an estimate): the engine and the farm ×5.27, the page ×4.5 (the render's rate, at most ×4.5, an estimate of the Air's CPU)",
  );
});

test("the calibration line gives the page the render's rate under the cap", () => {
  assert.match(profile.calibrationLine(calibration({ rate: 2.97 })), /: the engine and the farm ×2\.97, the page ×2\.97 \(the render's rate, at most ×4\.5/);
});

test("the calibration line names no cap for a profile without one", () => {
  const line = profile.calibrationLine(calibration({ rate: 5.01, pageRateMax: null, pageRateMaxIs: null }));
  assert.match(line, /: the engine and the farm ×5\.01, the page ×5\.01$/);
});

test("in Firefox the calibration line says the page is not throttled", () => {
  assert.match(profile.calibrationLine(calibration({ browser: "firefox", rate: 2.7 })), /: the engine and the farm ×2\.7, the page not throttled \(no throttle in firefox\)$/);
});

test("on a machine as slow as the reference the calibration line says it is not slowed", () => {
  assert.match(profile.calibrationLine(calibration({ rate: 1, measuredMs: 400 })), /400 ms here \(measured\), 356 ms on the reference \(an estimate\): ×1 \(this machine is as slow as the reference, or slower: not slowed\)$/);
});
