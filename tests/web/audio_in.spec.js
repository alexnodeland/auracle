// AUDIO IN: your own input in the patch (Plan-007 task 4, ADR-015).
//
// The browser's inputs are a stub (an init script): `getUserMedia` answers
// with a tone per fake device (Fake Mic A at 440 Hz, Fake Interface B at
// 660 Hz) from an oscillator in the stub's own AudioContext, never from a real
// microphone; `enumerateDevices` lists them; `navigator.permissions` answers
// for the microphone; an unplug ends the device's tracks and fires
// `devicechange`, as a real one does. The browser's grant lasts the tab
// (sessionStorage), as a real grant outlives a reload.
//
// The output is read as patch_audible.spec.js reads it: anything the app
// connects to the destination is also connected to one analyser, and its
// spectrum is read at the tone.
//
// What this claims:
//
// - The browser is asked for an input only when a player adds AUDIO IN: not at
//   boot, not on opening or playing sounds, not on placing another module.
//   While the browser's prompt is up, the app says what the input is for.
// - A refusal keeps AUDIO IN in the patch and plays it silent, says so, and
//   ASK AGAIN asks again.
// - One capture stream per input: a patch with three AUDIO INs on two inputs
//   opens each device once, and every module reading an input shows its
//   level. Picking an input from a module's menu reuses the stream already
//   open.
// - The input reaches the voices: a tone in is heard at the output with no
//   key down once MONITOR is on, and not at all while it is off, even with a
//   key held. Monitoring starts off on every load, and a sound that listens
//   opened after a reload gets its input without a prompt.
// - The first listen captures a clip and the engine takes it as the
//   session's audition clip; NEW CLIP captures another.
// - After a restore that installs a captured clip, the farm is handed the
//   new phrase before the bank's renders go out; after a capture, the crew
//   standing is handed it (@slow: a crew stands only after a walk).
// - An unplugged input silences its module and says so; plugged back in, it
//   is reopened and heard again.
//
// What it does not claim: anything about a real microphone, the latency of
// the worklet path, or what the clip does to a sound's ratings (the engine's
// tests hold that).
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const SHOTS = process.env.AURACLE_SHOTS || null;

const STUB = `(() => {
  const granted0 = (() => { try { return sessionStorage.getItem("__pwMicGranted") === "1"; } catch (_) { return false; } })();
  const mic = (window.__pwMic = {
    calls: [],
    refuse: false,
    hold: null,
    granted: granted0,
    devices: [
      { deviceId: "mic-a", label: "Fake Mic A", groupId: "ga", freq: 440, present: true },
      { deviceId: "mic-b", label: "Fake Interface B", groupId: "gb", freq: 660, present: true },
    ],
    tracks: [],
    queries: 0,
    // Set before boot: Fake Mic A is mono and its track's settings name no
    // channel count, as Safari's do.
    monoA: (() => { try { return sessionStorage.getItem("__pwMonoA") === "1"; } catch (_) { return false; } })(),
  });
  let ctx = null;
  const toneCtx = () => ctx || (ctx = new AudioContext());
  function tone(freq, mono) {
    const c = toneCtx();
    const o = c.createOscillator();
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = 0.25;
    const d = mono
      ? new MediaStreamAudioDestinationNode(c, { channelCount: 1, channelCountMode: "explicit" })
      : c.createMediaStreamDestination();
    o.connect(g).connect(d);
    o.start();
    return { stream: d.stream, osc: o };
  }
  const md = navigator.mediaDevices;
  md.getUserMedia = async (c) => {
    mic.calls.push(JSON.parse(JSON.stringify(c || {})));
    if (mic.hold) await mic.hold;
    if (mic.refuse) throw new DOMException("Permission denied", "NotAllowedError");
    mic.granted = true;
    try { sessionStorage.setItem("__pwMicGranted", "1"); } catch (_) {}
    const want = c && c.audio && c.audio.deviceId && c.audio.deviceId.exact;
    const dev = want ? mic.devices.find((d) => d.deviceId === want && d.present) : mic.devices.find((d) => d.present);
    if (!dev) throw new DOMException("Requested device not found", "NotFoundError");
    const mono = mic.monoA && dev.deviceId === "mic-a";
    const { stream, osc } = tone(dev.freq, mono);
    const track = stream.getAudioTracks()[0];
    // As Chrome and Edge answer: an unconstrained ask opens the pseudo-device
    // "default", whose settings and label name it, not the real input.
    const asDefault = !want;
    track.getSettings = () => ({
      deviceId: asDefault ? "default" : dev.deviceId,
      groupId: dev.groupId,
      ...(mono ? {} : { channelCount: 2 }),
    });
    Object.defineProperty(track, "label", { value: asDefault ? "Default - " + dev.label : dev.label });
    mic.tracks.push({ id: dev.deviceId, track, osc });
    return stream;
  };
  // As Chrome and Edge list them: the pseudo-device "default" first, in the
  // group of the input it stands for, then the real inputs.
  md.enumerateDevices = async () => {
    const real = mic.devices.filter((d) => d.present);
    const first = real[0];
    const listed = first ? [{ deviceId: "default", groupId: first.groupId, label: "Default - " + first.label }, ...real] : real;
    return listed.map((d) => ({
      deviceId: mic.granted ? d.deviceId : "",
      groupId: d.groupId,
      kind: "audioinput",
      label: mic.granted ? d.label : "",
    }));
  };
  if (navigator.permissions) {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = async (d) => {
      if (d && d.name === "microphone") {
        mic.queries += 1;
        return { state: mic.granted ? "granted" : mic.refuse ? "denied" : "prompt", onchange: null };
      }
      return query(d);
    };
  }
  window.__pwUnplug = (id) => {
    const d = mic.devices.find((x) => x.deviceId === id);
    if (d) d.present = false;
    for (const t of mic.tracks) {
      if (t.id !== id || t.track.readyState === "ended") continue;
      try { t.osc.stop(); } catch (_) {}
      t.track.stop();
      t.track.dispatchEvent(new Event("ended"));
    }
    md.dispatchEvent(new Event("devicechange"));
  };
  window.__pwReplug = (id) => {
    const d = mic.devices.find((x) => x.deviceId === id);
    if (d) d.present = true;
    md.dispatchEvent(new Event("devicechange"));
  };
  window.__pwLiveTracks = () => {
    const out = {};
    for (const t of mic.tracks) if (t.track.readyState === "live") out[t.id] = (out[t.id] || 0) + 1;
    return out;
  };
})();`;

const INIT = `(() => {
  const Orig = window.Worker;
  const last = (window.__pwLast = {});
  const counts = (window.__pwCounts = {});
  const sent = (window.__pwSent = []);
  const phrases = (window.__pwPhrases = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      window.__pwEngine = w;
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && m.type === "set_audition_clip") {
          sent.push({ type: m.type, channels: m.channels, sampleRate: m.sampleRate, frames: m.samples ? m.samples.length / Math.max(1, m.channels) : 0 });
        }
        return post(m, t);
      };
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d.type !== "string") return;
        // The engine refusing a capture, on demand (this listener runs before
        // main's, on the same data): what it says of a silent one.
        if (window.__pwRefuseClip && d.type === "audition_clip" && d.ok === true) {
          window.__pwRefuseClip = false;
          d.ok = false;
          d.note = "That capture was silent, so nothing changed. Check the input, then capture again.";
          d.clip = { ...d.clip, source: "reference" };
          delete d.views;
        }
        last[d.type] = d;
        counts[d.type] = (counts[d.type] || 0) + 1;
        if (d.type === "__pw_phrase") phrases.push({ t: performance.now(), clip: d.clip });
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;

  // What the capture's tap is told: on, off (hand the take back), drop.
  const tapSaid = (window.__pwTapSaid = []);
  const portPost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...rest) {
    if (m && (m.type === "on" || m.type === "off" || m.type === "drop")) tapSaid.push(m.type);
    return portPost.call(this, m, ...rest);
  };

  const toasts = (window.__pwToasts = []);
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (!lane) return;
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          const msg = n.querySelector && n.querySelector(".toast-msg");
          if (msg) toasts.push(msg.textContent);
        }
    }).observe(lane, { childList: true, subtree: true });
  });

  // The output tap: anything connected to a destination is also connected
  // to one analyser per context.
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode) {
      let a = this.context.__pwTap;
      if (!a) {
        a = this.context.createAnalyser();
        a.fftSize = 16384;
        a.smoothingTimeConstant = 0;
        this.context.__pwTap = a;
        window.__pwTap = a;
      }
      connect.call(this, a);
    }
    return r;
  };
  // The output's level at \`hz\` (dB, the strongest bin within 3%), and its
  // peak over the window (dBFS).
  window.__pwAt = (hz) => {
    const a = window.__pwTap;
    if (!a) return null;
    const d = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(d);
    const bin = a.context.sampleRate / a.fftSize;
    let db = -Infinity;
    for (let i = Math.floor((hz * 0.97) / bin); i <= Math.ceil((hz * 1.03) / bin); i++) db = Math.max(db, d[i]);
    const b = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(b);
    let peak = 0;
    for (const x of b) peak = Math.max(peak, Math.abs(x));
    return { db, peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
  };
  try {
    for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

// Prepended to worker.js: every phrase handshake the engine worker posts to a
// farm worker's port is reported to the page, with whether it carries a clip.
const PHRASE_SPY = `{
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...rest) {
    if (m && m.type === "phrase") self.postMessage({ type: "__pw_phrase", clip: typeof m.json === "string" && m.json.includes('"clip"') });
    return post.call(this, m, ...rest);
  };
}
`;
const WORKER_JS = path.join(__dirname, "..", "..", "apps", "web", "worker.js");

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function boot(page, { query = "", spy = false } = {}) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(STUB);
  await page.addInitScript(INIT);
  if (spy) {
    const body = PHRASE_SPY + fs.readFileSync(WORKER_JS, "utf8");
    await page.route(/\/worker\.js(\?|$)/, (route) =>
      route.fulfill({ status: 200, body, contentType: "text/javascript", headers: { "Cache-Control": "no-store" } }));
  }
  await page.goto(`/${query}`);
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  return errors;
}

async function openPreset(page, name) {
  await page.locator('.viewtab[data-view="play"]').click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await expect(page.locator("#rack-subject")).toContainText(name, { timeout: 60_000 });
  await expect(page.locator("#rack-svg .knob-hit").first()).toBeVisible();
}

/** Place AUDIO IN from the module rail into the first socket it lights. */
async function placeAudioIn(page) {
  const chip = page.locator('.nb-item[data-kind="audio_in"]');
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await page.locator("#rack-svg .jack.legal[data-childkey]").first().click();
}

const lane = (page) => page.locator("#rack-svg .ain-lane").first();
const state = (page) => page.evaluate(() => window.__aur.audioIn());
const calls = (page) => page.evaluate(() => window.__pwMic.calls.length);
const at = (page, hz) => page.evaluate((h) => window.__pwAt(h), hz);
// AURACLE_SHOTS=dir saves the states a reviewer looks at; the rack is let
// settle first (a placement moves the plates).
const shot = async (page, name, el) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(1500);
  await (el || page).screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/** The AUDIO IN module's plate, with a margin, for the record. */
const plateShot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(1500);
  const box = await page.locator("#rack-svg g.mod-group[data-kind='audio_in']").first().boundingBox();
  if (!box) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const m = 24;
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    clip: { x: Math.max(0, box.x - m), y: Math.max(0, box.y - m), width: box.width + 2 * m, height: box.height + 2 * m },
  });
};

/** The loudest level at `hz` over `ms` (read every 100 ms). */
async function loudest(page, hz, ms = 1500) {
  let db = -Infinity;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await at(page, hz);
    if (r) db = Math.max(db, r.db);
    await page.waitForTimeout(100);
  }
  return db;
}

test("the browser is asked for an input only when AUDIO IN is added", async ({ page }) => {
  const errors = await boot(page);
  // Booted, a sound opened and played, another module placed: nothing asked.
  await openPreset(page, "Glass Pad");
  await page.keyboard.down("a");
  await page.waitForTimeout(300);
  await page.keyboard.up("a");
  await page.locator('.nb-item[data-kind="distortion"]').click();
  await page.locator("#rack-svg .jack.legal[data-childkey]").first().click();
  await expect(page.locator("#rack-svg g.mod-group[data-kind='distortion']").first()).toBeVisible({ timeout: 30_000 });
  expect(await calls(page)).toBe(0);
  expect(await page.evaluate(() => window.__pwMic.queries)).toBe(0);

  // AUDIO IN placed: the browser's prompt is up (held open here), and the app
  // says what the input is for.
  await page.evaluate(() => { window.__pwMic.hold = new Promise((r) => (window.__pwRelease = r)); });
  await placeAudioIn(page);
  await expect.poll(() => calls(page), { timeout: 10_000 }).toBe(1);
  // On screen while the question is, not queued behind the sound's news.
  await expect(page.locator(".toast-msg").first()).toContainText("AUDIO IN asks the browser for a microphone or an interface", { timeout: 2_000 });
  await expect(lane(page)).toBeVisible({ timeout: 30_000 });
  await expect(lane(page).locator(".ain-dev-text")).toHaveText("asking…");
  await shot(page, "permission-ask");
  await page.evaluate(() => window.__pwRelease());
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  await expect(lane(page).locator(".ain-dev-text")).toHaveText("1 · Fake Mic A");
  expect(await calls(page)).toBe(1);
  // The browser opened its pseudo-device "default" (as Chrome and Edge do);
  // input 1 is the real input it stands for, and it stays open past the
  // hold the ask keeps on its stream.
  expect((await state(page)).list[0].id).toBe("mic-a");
  await page.waitForTimeout(16_000);
  await expect(lane(page)).toHaveAttribute("data-state", "live");
  expect(await page.evaluate(() => window.__pwLiveTracks())).toEqual({ "mic-a": 1 });
  expect(await calls(page)).toBe(1);
  expect(errors).toEqual([]);
});

test("a refused input keeps AUDIO IN in the patch, silent, and ASK AGAIN asks again", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await page.evaluate(() => { window.__pwMic.refuse = true; });
  await placeAudioIn(page);
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 15_000 })
    .toContain("The browser was refused the input, so AUDIO IN stays in the patch, silent.");
  // The module stays, says why it has no input, and offers to ask again.
  await expect(lane(page)).toHaveAttribute("data-state", "refused", { timeout: 30_000 });
  await expect(page.locator("#rack-svg g.mod-group[data-kind='audio_in']")).toHaveCount(1);
  await expect(lane(page).locator(".ain-dev-text")).toHaveText("input refused");
  await expect(lane(page).locator(".ain-ask")).toBeVisible();
  await expect(lane(page).locator(".ain-ask .ain-btn-text")).toHaveText("ask again");
  await expect(lane(page).locator(".ain-monitor")).toBeHidden();
  await shot(page, "refused");
  // Played, it is silent: a key held, nothing of the input at the output.
  await page.keyboard.down("a");
  const held = await loudest(page, 440, 1200);
  await page.keyboard.up("a");
  console.log(`refused, a key held: ${held.toFixed(1)} dB at 440 Hz`);
  expect(held).toBeLessThan(-100);
  // Allowed in the browser this time: ASK AGAIN asks, and the input opens.
  await page.evaluate(() => { window.__pwMic.refuse = false; });
  await lane(page).locator(".ain-ask").click();
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  expect(await calls(page)).toBe(2);
  expect(errors).toEqual([]);
});

// Three AUDIO INs: two on input 1, one on input 2.
const amp = { attack: 0.05, decay: 0.3, sustain: 0.95, release: 0.3 };
const ain = (input) => ({ AudioIn: { input, gain: 24 / 36, channel: "Both" } });
const THREE = { name: "Three Ears", tree: { amp, root: { Mix: { balance: 0.5, a: ain(0), b: { Mix: { balance: 0.5, a: ain(0), b: ain(1) } } } } } };

async function openFile(page, data, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${data.name.replace(/\s/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  await page.setInputFiles("#patch-import-input", file);
}

test("each input is opened once and fanned out to every AUDIO IN that reads it", async ({ page }, info) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  expect(await calls(page)).toBe(1);

  await openFile(page, THREE, info.outputDir);
  const lanes = page.locator("#rack-svg .ain-lane");
  await expect(lanes).toHaveCount(3, { timeout: 60_000 });
  // One stream per device: the ask opened Fake Mic A, and Fake Interface B
  // is opened once, for the one module that reads it.
  await expect.poll(() => page.evaluate(() => window.__pwLiveTracks()), { timeout: 15_000 })
    .toEqual({ "mic-a": 1, "mic-b": 1 });
  expect(await calls(page)).toBe(2);
  // Every module shows its input's level; the keys read input 1, so the one
  // on input 2 says it is the meter's only.
  await expect.poll(async () => (await lanes.evaluateAll((ls) => ls.map((l) => l.dataset.state))).sort(), { timeout: 15_000 })
    .toEqual(["live", "live", "meter"]);
  await expect(page.locator("#rack-svg .ain-lane[data-state='meter'] .ain-dev")).toHaveAttribute("aria-label", "Input 2 · Fake Interface B · meter only");
  await expect(page.locator("#rack-svg .ain-lane[data-state='meter'] .ain-dev-text")).toHaveText(/^2 · Fake .*… · meter only$/);
  await expect.poll(() => lanes.evaluateAll((ls) => ls.every((l) => Number(l.dataset.db) > -30)), { timeout: 10_000 })
    .toBe(true);
  const dbs = await lanes.evaluateAll((ls) => ls.map((l) => Number(l.dataset.db)));
  console.log(`meters: ${dbs.map((d) => d.toFixed(1)).join(", ")} dBFS`);

  // The input menu: picking input 2 for a module on input 1 opens nothing new.
  const first = page.locator("#rack-svg .ain-lane[data-state='live']").first();
  await first.locator(".ain-dev").click();
  const menu = page.locator("#ctx-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".cm-item")).toHaveText([/^1 · Fake Mic A/, /^2 · Fake Interface B/]);
  await shot(page, "device-select");
  await menu.locator(".cm-item", { hasText: "2 · Fake Interface B" }).click();
  await expect.poll(async () => (await lanes.evaluateAll((ls) => ls.map((l) => l.dataset.slot))).sort(), { timeout: 30_000 })
    .toEqual(["0", "1", "1"]);
  expect(await calls(page)).toBe(2);
  expect(await page.evaluate(() => window.__pwLiveTracks())).toEqual({ "mic-a": 1, "mic-b": 1 });
  expect(errors).toEqual([]);
});

test("the input is heard with no key down once MONITOR is on, and not at all while it is off", async ({ page }, info) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  // Monitoring starts off: the input moves the meter and nothing else, with
  // no key and with one held.
  const mon = lane(page).locator(".ain-monitor");
  await expect(mon).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  const offIdle = await loudest(page, 440, 1200);
  await page.keyboard.down("a");
  const offHeld = await loudest(page, 440, 1200);
  await page.keyboard.up("a");
  await plateShot(page, "meter");

  // On: the tone comes through the patch with no key down, and the toast
  // says to use headphones.
  await mon.click();
  await expect(mon).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("Use headphones, or the speakers feed back into the microphone.");
  await expect.poll(() => loudest(page, 440, 600), { timeout: 15_000 }).toBeGreaterThan(-60);
  const on = await loudest(page, 440, 1500);
  await plateShot(page, "monitor-on");

  // Off again: silent again.
  await mon.click();
  await expect(mon).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  const offAgain = await loudest(page, 440, 1200);
  console.log(`440 Hz at the output: off ${offIdle.toFixed(1)} dB, off with a key ${offHeld.toFixed(1)} dB, on ${on.toFixed(1)} dB, off again ${offAgain.toFixed(1)} dB`);
  expect(offIdle).toBeLessThan(-100);
  expect(offHeld).toBeLessThan(-100);
  expect(on).toBeGreaterThan(-45);
  expect(offAgain).toBeLessThan(-100);

  // Monitoring is not kept: after a reload it is off, and a sound that
  // listens, opened again, gets its input without a prompt (the browser
  // granted it) and stays silent.
  await mon.click();
  await expect(mon).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator('.viewtab[data-view="play"]').click();
  await openFile(page, { name: "Mic Pad", tree: { amp, root: ain(0) } }, info.outputDir);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__pwToasts.some((t) => t.startsWith("AUDIO IN asks")))).toBe(false);
  expect((await state(page)).monitor).toBe(false);
  await expect(lane(page).locator(".ain-monitor")).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  const afterReload = await loudest(page, 440, 1200);
  console.log(`after a reload: ${afterReload.toFixed(1)} dB at 440 Hz`);
  expect(afterReload).toBeLessThan(-100);
  expect(errors).toEqual([]);
});

test("the first listen captures a clip, and the engine measures with it", async ({ page }) => {
  const errors = await boot(page);
  expect((await state(page)).clipSource).toBe("reference");
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  // The input carries a signal, so a capture starts, says so at once (NEW
  // CLIP lit while it rolls), and goes to the engine: six seconds of two
  // channels at the context's rate.
  await expect.poll(async () => (await state(page)).capture, { timeout: 15_000 }).toBe("rolling");
  await expect(lane(page).locator(".ain-clip")).toHaveClass(/\bon\b/);
  await expect(page.locator(".toast-msg").first())
    .toHaveText("Capturing 6 s of Fake Mic A as the clip the model hears it through…", { timeout: 2_000 });
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(1);
  const sent = await page.evaluate(() => window.__pwSent[0]);
  const rate = await page.evaluate(() => window.__aur.audioCtx.sampleRate);
  console.log(`clip sent: ${sent.frames} frames × ${sent.channels} at ${sent.sampleRate} Hz`);
  expect(sent.channels).toBe(2);
  expect(sent.sampleRate).toBe(rate);
  expect(sent.frames / rate).toBeGreaterThan(5.5);
  // The engine took it as the session's clip, and says so.
  await expect.poll(() => page.evaluate(() => window.__pwLast.audition_clip && window.__pwLast.audition_clip.ok), { timeout: 30_000 }).toBe(true);
  const reply = await page.evaluate(() => window.__pwLast.audition_clip);
  expect(reply.clip.source).toBe("captured");
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("The model hears sounds with an input through the clip captured from it.");
  expect((await state(page)).clipSource).toBe("captured");
  // Only the first listen captures by itself; NEW CLIP captures again.
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__pwSent.length)).toBe(1);
  await lane(page).locator(".ain-clip").click();
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__pwCounts.audition_clip), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("a restore that installs a captured clip hands the farm the new phrase", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, { query: "?farm=2", spy: true });
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect.poll(() => page.evaluate(() => window.__pwLast.audition_clip && window.__pwLast.audition_clip.ok), { timeout: 40_000 }).toBe(true);
  // The clip is saved with the session.
  const saves = await page.evaluate(() => window.__pwCounts.saved || 0);
  await expect.poll(() => page.evaluate(() => window.__pwCounts.saved || 0), { timeout: 30_000 }).toBeGreaterThan(saves);

  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  const phrases = await page.evaluate(() => window.__pwPhrases);
  const restored = await page.evaluate(() => window.__aur.audioIn().clipSource);
  console.log(`phrases to the farm: ${phrases.length} (${phrases.filter((p) => p.clip).length} with the clip); clip restored: ${restored}`);
  expect(restored).toBe("captured");
  // The handshake (before the restore, no clip), then the clip's phrase.
  expect(phrases.some((p) => !p.clip)).toBe(true);
  expect(phrases.filter((p) => p.clip).length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("a capture hands the farm crew standing the new phrase", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(600_000);
  const errors = await boot(page, { query: "?farm=2", spy: true });
  // A crew stands only after a walk: six picks, their fit, then ⚡.
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await page.locator('.viewtab[data-view="evolve"]').click();
  for (let i = 1; i <= 6; i++) {
    await expect(page.locator(i % 2 ? "#choose-a" : "#choose-b")).toBeEnabled({ timeout: 30_000 });
    await page.locator(i % 2 ? "#choose-a" : "#choose-b").click();
  }
  await expect.poll(() => page.evaluate(() => window.__pwCounts.fitted || 0), { timeout: 120_000 }).toBeGreaterThan(0);
  await page.locator('.viewtab[data-view="play"]').click();
  await expect(page.locator("#rack-evolve")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#rack-evolve").click();
  await expect.poll(() => page.evaluate(() => window.__pwCounts.evolved_from || 0), { timeout: 120_000 }).toBeGreaterThan(0);
  const before = (await page.evaluate(() => window.__pwPhrases)).filter((p) => p.clip).length;
  expect(before).toBe(0);

  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect.poll(() => page.evaluate(() => window.__pwLast.audition_clip && window.__pwLast.audition_clip.ok), { timeout: 40_000 }).toBe(true);
  const reply = await page.evaluate(() => window.__pwLast.audition_clip);
  const after = (await page.evaluate(() => window.__pwPhrases)).filter((p) => p.clip).length;
  console.log(`after the capture: ${reply.farmResent} workers handed the phrase, ${after} phrases with the clip`);
  expect(reply.farmResent).toBeGreaterThan(0);
  expect(after).toBe(reply.farmResent);
  expect(errors).toEqual([]);
});

test("an unplugged input silences its module and says so, and plays again when it is back", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  await lane(page).locator(".ain-monitor").click();
  await expect.poll(() => loudest(page, 440, 600), { timeout: 15_000 }).toBeGreaterThan(-60);

  await page.evaluate(() => window.__pwUnplug("mic-a"));
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("Fake Mic A was unplugged, so AUDIO IN is silent until it’s back.");
  await expect(lane(page)).toHaveAttribute("data-state", "unplugged");
  await expect(lane(page).locator(".ain-dev-text")).toHaveText("1 · Fake Mic A · unplugged");
  expect(await page.evaluate(() => window.__pwLiveTracks())).toEqual({});
  await page.waitForTimeout(1500);
  const gone = await loudest(page, 440, 1200);

  const asked = await calls(page);
  await page.evaluate(() => window.__pwReplug("mic-a"));
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("Fake Mic A is back.");
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  expect(await calls(page)).toBe(asked + 1);
  await expect.poll(() => loudest(page, 440, 600), { timeout: 15_000 }).toBeGreaterThan(-60);
  console.log(`unplugged: ${gone.toFixed(1)} dB at 440 Hz`);
  expect(gone).toBeLessThan(-100);
  expect(errors).toEqual([]);
});

test("a capture cut short drops its take, and the tap stops", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect.poll(async () => (await state(page)).capture, { timeout: 15_000 }).toBe("rolling");
  // Another sound, with no AUDIO IN: its input closes under the capture.
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await expect(page.locator("#rack-svg .ain-lane")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__pwTapSaid), { timeout: 5_000 }).toContain("drop");
  // Nothing comes of it: no clip goes to the engine.
  await page.waitForTimeout(8_000);
  expect(await page.evaluate(() => window.__pwSent.length)).toBe(0);
  expect((await state(page)).capture).toBe(null);
  expect(errors).toEqual([]);
});

test("a refused capture is not taken again by itself; NEW CLIP takes another", async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { window.__pwRefuseClip = true; });
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("That capture was silent, so nothing changed.");
  // The input still carries a signal, and nothing captures by itself.
  await page.waitForTimeout(10_000);
  expect(await page.evaluate(() => window.__pwSent.length)).toBe(1);
  expect((await state(page)).capture).toBe(null);
  await lane(page).locator(".ain-clip").click();
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(2);
  expect(errors).toEqual([]);
});

test("MONITOR ends when the last AUDIO IN leaves the sound you're playing", async ({ page }, info) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  await lane(page).locator(".ain-monitor").click();
  expect((await state(page)).monitor).toBe(true);
  // A sound with no AUDIO IN: monitoring ends with it.
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await expect(page.locator("#rack-svg .ain-lane")).toHaveCount(0, { timeout: 30_000 });
  expect((await state(page)).monitor).toBe(false);
  // The next sound that listens comes up unmonitored, and silent.
  await openFile(page, { name: "Mic Pad", tree: { amp, root: ain(0) } }, info.outputDir);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 60_000 });
  await expect(lane(page).locator(".ain-monitor")).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  expect(await loudest(page, 440, 1200)).toBeLessThan(-100);
  expect(errors).toEqual([]);
});

test("a mono input with no channel count in its settings is captured as one channel", async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("__pwMonoA", "1"); } catch (_) {} });
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(1);
  const sent = await page.evaluate(() => window.__pwSent[0]);
  console.log(`mono clip sent: ${sent.frames} frames × ${sent.channels}`);
  expect(sent.channels).toBe(1);
  expect(errors).toEqual([]);
});
