// Is the audio struggling? strain.js's rule, on samples written here: when
// the protections for a slow machine come on and when they go off (#288).
import test from "node:test";
import assert from "node:assert/strict";
import {
  createStrain,
  STRAIN_TICK_MS,
  STRAIN_WARMUP_MS,
  STRAIN_LATE_MS,
  STRAIN_WINDOW_MS,
  STRAIN_HOLD_MS,
  STRAIN_HOLD_MAX_MS,
} from "../strain.js";

/** A strain over a clock the test moves, a sample a tick. */
function rig() {
  let t = 0;
  const s = createStrain({ now: () => t });
  const changes = [];
  const tick = (sample = {}) => {
    t += STRAIN_TICK_MS;
    if (s.sample({ running: true, lag: 0, underruns: 0, ...sample })) changes.push([t, s.on]);
  };
  const ticks = (n, sample) => {
    for (let i = 0; i < n; i++) tick(sample);
  };
  return { s, tick, ticks, changes, at: () => t };
}
const warm = Math.ceil(STRAIN_WARMUP_MS / STRAIN_TICK_MS);

test("a clock that keeps up never puts the protections on", () => {
  const r = rig();
  r.ticks(10_000, { lag: STRAIN_LATE_MS });
  assert.equal(r.s.on, false);
  assert.deepEqual(r.changes, []);
});

test("two late samples within the window put them on, one does not", () => {
  const r = rig();
  r.ticks(warm);
  r.tick({ lag: 50 });
  r.ticks(Math.ceil(STRAIN_WINDOW_MS / STRAIN_TICK_MS));
  assert.equal(r.s.on, false, "a hiccup (a compile) is not a struggle");
  r.tick({ lag: 50 });
  assert.equal(r.s.on, false, "two late samples a window apart are not either");
  r.tick({ lag: STRAIN_LATE_MS + 1 });
  assert.equal(r.s.on, true, "two within the window are");
  assert.equal(r.changes.length, 1);
});

test("underruns the browser counts are late samples too, and an unknown lag is not", () => {
  const r = rig();
  r.ticks(warm);
  r.tick({ lag: null, underruns: 3 });
  r.tick({ lag: null, underruns: null });
  assert.equal(r.s.on, false);
  r.tick({ lag: null, underruns: 1 });
  assert.equal(r.s.on, true);
});

test("nothing counts while the audio warms up, or while it is not running", () => {
  const r = rig();
  r.ticks(warm - 1, { lag: 100 });
  assert.equal(r.s.on, false, "the worklet's own compile reads as lag");
  // A suspended context (or a page out of sight) starts the warm-up again.
  r.tick({ running: false, lag: 100 });
  r.ticks(warm, { lag: 100 });
  assert.equal(r.s.on, false, "warming up again");
  r.tick({ lag: 100 });
  assert.equal(r.s.on, false, "warm: the first late sample");
  r.tick({ lag: 100 });
  assert.equal(r.s.on, true, "and the second");
});

test("on, they go off after the hold with no late sample, and come back on for twice as long", () => {
  const r = rig();
  r.ticks(warm);
  r.ticks(2, { lag: 10 });
  assert.equal(r.s.on, true);
  assert.equal(r.s.hold, STRAIN_HOLD_MS);
  const lastLate = r.at();
  // A late sample while on keeps them on.
  r.ticks(STRAIN_HOLD_MS / STRAIN_TICK_MS - 1);
  assert.equal(r.s.on, true);
  r.tick();
  assert.equal(r.s.on, false, "off a hold after the last late sample");
  assert.equal(r.changes.at(-1)[0] - lastLate, STRAIN_HOLD_MS);
  // Leaving was a probe: the audio still struggles, and they come back.
  r.ticks(2, { lag: 10 });
  assert.equal(r.s.on, true);
  assert.equal(r.s.hold, 2 * STRAIN_HOLD_MS, "for twice as long");
  for (let i = 0; i < 10; i++) {
    r.ticks(r.s.hold / STRAIN_TICK_MS);
    r.ticks(2, { lag: 10 });
  }
  assert.equal(r.s.hold, STRAIN_HOLD_MAX_MS, "up to the most");
});

test("a late sample while on starts the hold again", () => {
  const r = rig();
  r.ticks(warm);
  r.ticks(2, { lag: 10 });
  r.ticks(STRAIN_HOLD_MS / STRAIN_TICK_MS / 2);
  r.tick({ underruns: 1 });
  r.ticks(STRAIN_HOLD_MS / STRAIN_TICK_MS - 1);
  assert.equal(r.s.on, true, "the hold counts from the last late sample");
  r.tick();
  assert.equal(r.s.on, false);
});
