// A returning visit's restore (#285, docs/architecture/web-runtime.md "The
// farm on demand"). With no farm worker ready, the engine worker restores the
// bank itself one sound at a time: each sound read from the render store when
// this build has measured it before (the farm's store, key and namespace),
// rendered and written back otherwise, with its progress posted and the
// player's requests answered between sounds. A farm worker that reports
// ready after the handshake's window takes the rest of the restore, or of a
// fill, rather than sitting out the boot. Whichever ran, the bank comes back
// as `import_state` builds it, in its order.
//
// worker.js runs here as it is, over the built engine (harness.mjs). The
// render store is the harness's stand-in IndexedDB (`idb`), carried from one
// thread to the next as a browser keeps it between visits. The bank `import_state`
// builds is computed in this thread, over the same binary: an engine of the
// glue's own, handed the same save (`import_session_checked`).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { workerFor, fakeCrew, startWorker } from "./harness.mjs";

const SEED = 1;
const POOL = 12;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;

const glue = await import(new URL("../../apps/web/pkg/auracle_wasm.js", import.meta.url).href);
glue.initSync({ module: readFileSync(new URL("../../apps/web/pkg/auracle_wasm_bg.wasm", import.meta.url)) });

// The session every test restores: a bank of POOL sounds, filled with no
// farm and saved (`saved`), and that pool as the worker held it (`pool`).
// Made once for the file.
let saving = null;
function serialSession() {
  saving ??= (async () => {
    const w = await startWorker({ seed: SEED, poolSize: POOL });
    try {
      const [{ json }] = await w.send({ type: "save" });
      return { saved: json, pool: await bankOf(w) };
    } finally {
      await w.close();
    }
  })();
  return saving;
}

/** The bank as `import_state` builds it from `saved`: each sound's id and
 *  standardized φ, in bank order, as `pool_features` lists them. */
function importState(saved) {
  const e = new glue.WasmEngine(BigInt(SEED), POOL);
  try {
    assert.equal(JSON.parse(e.import_session_checked(saved)).status, "ok");
    e.restandardize_if_untaught();
    return JSON.parse(e.pool_features()).rows;
  } finally {
    e.free();
  }
}

/** The bank as the worker holds it now, in the same form. */
async function bankOf(w) {
  const [r] = await w.send({ type: "taste_views" });
  return r.views.features.rows;
}

/** A farm worker's render, as farm.js makes it (`farm_render`). */
function render(tree, phrase) {
  const job = glue.farm_render(tree, phrase, false);
  try {
    return { ok: job.ok, cached: job.ok ? job.cached : "" };
  } finally {
    job.free();
  }
}

/** Boot from `saved` and wait for `filled`, as main boots a returning visit. */
async function restore(w, saved, extra = {}) {
  const after = w.replies.length;
  await w.boot({ seed: SEED, poolSize: POOL, saved, ...extra });
  return after;
}

const recalling = (w, after) => w.repliesOf("fill_progress", { after }).filter((r) => /^recalling \d+ of \d+ sounds…$/.test(r.label || ""));
const cacheLine = (w, after) => w.repliesOf("log", { after }).filter((r) => r.kind === "render_cache" && r.here);

test("a restore with no farm comes back sound by sound, with its bar moving and a request answered between sounds, as import_state builds it", { timeout: TIMEOUT }, async (t) => {
  const { saved } = await serialSession();
  const w = await workerFor(t, { boot: false, idb: {} });
  // A preset list asked for while the third sound is measured, as main asks
  // while the veil is up.
  const ask = { type: "presets" };
  w.post(ask, { during: { call: "bank_absorb", nth: 3 } });
  const after = await restore(w, saved);

  // The bar moved: one step per sound, counting up, each posted before the
  // restore ended, not all at its end.
  const steps = recalling(w, after);
  assert.deepEqual(steps.map((r) => r.pool), Array.from({ length: POOL }, (_, i) => i + 1), "the restore did not say each sound as it landed");
  for (const r of steps) assert.equal(r.workers, 0, "a restore with no farm said it had renderers");
  const recalled = w.repliesOf("fill_progress", { after }).find((r) => /^recalled/.test(r.label || ""));
  assert.equal(recalled.label, `recalled ${POOL} sounds`);
  assert.ok(steps.every((r) => r._n < recalled._n), "the restore's progress came after it ended");

  // Answered between two sounds: before the fourth was folded in.
  const [presets] = await w.answers(ask);
  assert.ok(presets.rows.length > 0);
  const trace = await w.trace();
  const absorbs = trace.flatMap((e, i) => (e.ev === "call" && e.name === "bank_absorb" ? [i] : []));
  const answered = trace.findIndex((e) => e.ev === "out" && e.n === presets._n);
  assert.ok(absorbs.length >= POOL, "the sounds were not folded in one at a time");
  assert.ok(answered > absorbs[2] && answered < absorbs[3], "the request waited for more than the sound in hand");
  assert.equal(trace.some((e) => e.ev === "call" && /^import_session(_checked)?$/.test(e.name)), false, "the restore took the one call");

  // Every sound was rendered here (the store was empty) and kept there.
  const [line] = cacheLine(w, after);
  assert.deepEqual([line.served, line.rendered], [0, POOL], "the render cache's line does not say what this worker did");
  const rows = (await w.idb())["auracle-renders"].stores.rows;
  assert.equal(rows.length, POOL, "a render made here was not kept in the store");

  assert.deepEqual(await bankOf(w), importState(saved), "the bank is not import_state's, in its order");
  await w.close();
});

test("a restore with no farm reads what this build measured before from the render store, and renders none of it", { timeout: TIMEOUT }, async (t) => {
  const { saved } = await serialSession();
  // The first visit renders the bank and keeps it in the store.
  const first = await workerFor(t, { boot: false, idb: {} });
  await restore(first, saved);
  const kept = await first.idb();
  await first.close();

  // The next finds it there.
  const w = await workerFor(t, { boot: false, idb: kept });
  const after = await restore(w, saved);
  const [line] = cacheLine(w, after);
  assert.deepEqual([line.served, line.rendered], [POOL, 0], "a sound in the store was rendered again");
  const trace = await w.trace();
  assert.equal(trace.some((e) => e.ev === "call" && e.name === "bank_render"), false, "a sound in the store was rendered again");
  assert.equal(recalling(w, after).length, POOL, "the restore did not say each sound as it landed");
  assert.deepEqual(await bankOf(w), importState(saved), "the bank is not import_state's, in its order");
  await w.close();
});

test("a farm worker that reports ready after the handshake's window takes the rest of a restore", { timeout: TIMEOUT }, async (t) => {
  const { saved } = await serialSession();
  const crew = fakeCrew(2, { ready: false, render });
  t.after(() => crew.close());
  const w = await workerFor(t, { boot: false });
  const after = w.replies.length;
  const booting = restore(w, saved, { farmPorts: crew.ports });
  // The handshake's window closes with no worker ready: the crew is kept, and
  // the restore begins here. The workers report ready once the first sound
  // has landed.
  const late = await w.reply("log", { where: (r) => r.kind === "farm_late", after });
  assert.equal(late.workers, 2);
  await w.until((r) => r.type === "fill_progress" && /^recalling 1 of/.test(r.label || ""), { after });
  crew.ready();
  await booting;

  const jobs = crew.heard.flat().filter((m) => m.type === "job").map((m) => m.i);
  assert.ok(jobs.length > 0, "the late workers were handed none of the bank");
  assert.ok(Math.min(...jobs) >= 1, "the late workers were handed a sound already restored here");
  assert.ok(recalling(w, after).some((r) => r.workers === 2), "the bar never said the renderers had joined");
  assert.deepEqual(w.repliesOf("farm_done", { after }).length, 1, "boot's crew was not reaped once, at boot's end");
  assert.deepEqual(await bankOf(w), importState(saved), "the bank is not import_state's, in its order");
  await w.close();
});

test("a farm worker that reports ready after the handshake's window takes the rest of a fill, and the pool is the serial one", { timeout: TIMEOUT }, async (t) => {
  const { pool } = await serialSession();
  const crew = fakeCrew(2, { ready: false, render });
  t.after(() => crew.close());
  const w = await workerFor(t, { boot: false });
  const after = w.replies.length;
  const booting = w.boot({ seed: SEED, poolSize: POOL, farmPorts: crew.ports });
  await w.reply("log", { where: (r) => r.kind === "farm_late", after });
  // Ready once the fill has begun here.
  await w.until((r) => r.type === "fill_progress" && r.pool > 0, { after });
  crew.ready();
  await booting;
  assert.ok(crew.heard.some((h) => h.some((m) => m.type === "job")), "the late workers were handed none of the fill");
  assert.ok(w.repliesOf("fill_progress", { after }).some((r) => r.workers === 2), "the bar never said the renderers had joined");
  assert.deepEqual(await bankOf(w), pool, "the pool is not the one this seed fills with no farm");
  await w.close();
});

test("a farm worker that reports ready after the rest of its crew failed is handed the draws they left, and the fill finishes as the serial one", { timeout: TIMEOUT }, async (t) => {
  const { pool } = await serialSession();
  // Three workers. A and B are ready in the handshake's window, so the fill
  // begins on the farm. Whichever is handed draw 0 sits on it, and the other
  // answers AHEAD draws past it at once (with no render: none of them can be
  // folded in while draw 0 is out, and a run's answers go when it ends);
  // then both decline a job, as a broken instance does. The run ends with
  // the draws it was handed still issued and none folded in, and the fill
  // goes on in this worker. C is still starting, and reports ready once this
  // worker's first batch has landed, so the next batch goes back to the farm
  // with most of those draws not yet folded in. C renders.
  const AHEAD = 8;
  let ahead = 0;
  let sitting = null;
  const crew = fakeCrew(3, {
    ready: [true, true, false],
    render,
    job: (k, m) => {
      if (k === 2) return undefined;
      if (m.i === 0) {
        sitting = k;
        return null;
      }
      if (ahead < AHEAD) {
        ahead++;
        return { type: "done", i: m.i, ok: false };
      }
      return { type: "cannot", i: m.i, reason: "a broken instance (the test's)" };
    },
    answered: (k, reply) => {
      if (reply.type === "cannot" && reply.i !== 0) crew.answer(sitting, { type: "cannot", i: 0, reason: "a broken instance (the test's)" });
    },
  });
  t.after(() => crew.close());
  const w = await workerFor(t, { boot: false });
  const after = w.replies.length;
  const booting = w.boot({ seed: SEED, poolSize: POOL, farmPorts: crew.ports });
  await w.until((r) => r.type === "fill_progress" && r.pool > 0, { after });
  crew.ready(2);
  await booting;

  const handed = (k) => crew.heard[k].filter((m) => m.type === "job").map((m) => m.i);
  const failed = [...handed(0), ...handed(1)];
  const late = handed(2);
  assert.ok(failed.includes(0) && Math.max(...failed) > AHEAD, "the crew that failed was not handed draw 0 and the draws past it");
  assert.ok(late.length > 0, "the worker ready late was handed none of the fill");
  assert.ok(Math.min(...late) <= Math.max(...failed), "the worker ready late was handed only new draws, not the ones the failed crew left");
  assert.equal(w.repliesOf("playable", { after }).length, 1, "the pool was never playable");
  assert.deepEqual(await bankOf(w), pool, "the pool is not the one this seed fills with no farm");
  await w.close();
});
