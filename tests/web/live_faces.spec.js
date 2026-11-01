// The face of the sound you're playing answers what you hear, at every level
// (live-face.js): over the face, inline at its own size, what sounds now is
// drawn in the face's own bands against the same bank, as stage mode draws it
// (the vessel's outline lit by how loud it is, and the live outline), left to
// fade like phosphor and cleared in silence.
//
// What this claims:
// - A held key lights PERFORM's well face, and PATCH's face at OUT; once the
//   key is up and the sound has faded, the layer is cleared.
// - A face hears its own sound and nothing else: an EVOLVE card's ▶ lights
//   that card's face, never the other card's.
// - The sound's mark on TASTE's map lights while its phrase plays.
// - The face in flight between the levels draws what sounds while it flies.
// - Under reduced motion nothing over a face moves: no layer is drawn while
//   a key sounds, and no face painter (live-paint.js's worker) is started.
// - The layers painted in their worker (live-paint.js) are the same pixels,
//   frame by frame, as the same frames painted on the page.
// - A frame of live faces is cheap: the loop's own time a frame it sends
//   the painter, its share of the main thread, and the long tasks while a
//   key sounds, on the reference profile at the Air's Retina scale, are
//   budgets.
//
// It reads each face's layer (`.face-live`, a canvas over the face, which
// shows the pictures the worker paints, so read by drawing it onto a canvas
// of the spec's own) for lit pixels, and, where it must know the output
// sounds, the output through an analyser on everything the app connects to
// the destination, as perform_stage.spec.js does.
const { test, expect, goLevel, landed, bankTab } = require("./fixtures");
const { openPreset } = require("./patch_page");

const INIT = `(() => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode) {
      let a = this.context.__pwTap;
      if (!a) {
        a = this.context.createAnalyser();
        a.fftSize = 2048;
        this.context.__pwTap = a;
        window.__pwTap = a;
      }
      connect.call(this, a);
    }
    return r;
  };
  window.__pwPeakDb = () => {
    const a = window.__pwTap;
    if (!a) return -Infinity;
    const b = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(b);
    let peak = 0;
    for (const x of b) peak = Math.max(peak, Math.abs(x));
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  };
  // A layer's pixels as shown: drawn onto a canvas of the spec's own (a
  // layer that shows the worker's pictures has no 2D context).
  window.__pixels = (c) => {
    const s = document.createElement("canvas");
    s.width = c.width;
    s.height = c.height;
    const g = s.getContext("2d");
    g.drawImage(c, 0, 0);
    return g.getImageData(0, 0, c.width, c.height).data;
  };
  // How much of the live layers under \`sel\` is lit: pixels with alpha.
  window.__lit = (sel) => {
    let n = 0;
    for (const c of document.querySelectorAll(sel + " canvas.face-live")) {
      if (!c.width || !c.height) continue;
      const d = window.__pixels(c);
      for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++;
    }
    return n;
  };
})();`;

/** The output's loudest sample now, dB. */
const peakDb = (page) => page.evaluate(() => window.__pwPeakDb());
const lit = (page, sel) => page.evaluate((s) => window.__lit(s), sel);

/** The sound held: one that sounds as long as a key is down and stops soon
 *  after it is up (`amp(0.03, 0.35, 0.55, 0.2)`: a fast attack, a sustain,
 *  a short release). The sound a boot deals is any of the pool's, and an
 *  unseeded one (the nightly hunt's) dealt Soft Bell and Bright Key, still
 *  lit 10 s after the key was up (#423), and Soft Pluck, gone before the
 *  face flew (#416), as their traces show. #398's PERFORM faces stayed
 *  unlit for 30 s and #414's output peaked at -78 dB while the key was held
 *  (seen in their logs; their sounds unknown). */
const HELD = "First Bass";

/** Boot at PATCH (its face lands at once: PERFORM's wait behind its first
 *  measurement), with HELD in hand, its face at OUT. */
async function boot(app, opts) {
  const { page } = app;
  await page.addInitScript(INIT);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("auracle-view", "patch");
    } catch (_) {}
  });
  await app.boot(opts);
  await openPreset(app, HELD);
  await app.engine((timeout) => expect(page.locator("#out-face img.face")).toBeVisible({ timeout }));
  // HELD has just joined the pool: its own face there (what TASTE's mark
  // stands for, and the face in flight lands on) is the engine's answer
  // after the open's, so it is waited for too.
  await bankTab(page, "pool");
  await app.engine((timeout) => expect(page.locator("#bank-list .bank-item.live > .face-slot > img.face").first()).toBeVisible({ timeout }));
}

/** A key held until the face's layer lights (the voices may still be
 *  taking the sound), then let go, and the layer cleared once it fades. */
async function holdLights(app, sel) {
  const { page } = app;
  await page.keyboard.down("a");
  await app.engine((timeout) => expect.poll(() => lit(page, sel), { timeout }).toBeGreaterThan(50), { ms: 30_000 });
  await page.keyboard.up("a");
  await expect.poll(() => lit(page, sel)).toBe(0);
}

test("a held key lights the face of the sound you're playing at PERFORM and at PATCH, and silence clears it", async ({ page, app }) => {
  await boot(app);
  // Quiet: nothing over the face.
  expect(await lit(page, "#out-face")).toBe(0);
  await holdLights(app, "#out-face");
  await goLevel(page, "perform");
  await app.engine((timeout) => expect(page.locator("#view-perform .pf-face img.face").first()).toBeVisible({ timeout }));
  expect(await lit(page, "#view-perform .pf-faces")).toBe(0);
  await holdLights(app, "#view-perform .pf-faces");
});

test("an EVOLVE card's ▶ lights that card's face, and never the other's", async ({ page, app }) => {
  await boot(app);
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#face-a img.face")).toBeVisible({ timeout }), { ms: 60_000 });
  await app.engine((timeout) => expect(page.locator("#face-b img.face")).toBeVisible({ timeout }), { ms: 60_000 });
  await page.locator("#play-a").click();
  await app.engine((timeout) => expect.poll(() => lit(page, "#face-a"), { timeout }).toBeGreaterThan(50), { ms: 30_000 });
  expect(await lit(page, "#face-b"), "B's face hears nothing of A's phrase").toBe(0);
  // Stopped, it fades and is cleared.
  await page.locator("#play-a").click();
  await expect.poll(() => lit(page, "#face-a")).toBe(0);
});

test("the sound's mark on TASTE's map lights while its phrase plays", async ({ page, app }) => {
  await boot(app);
  const t0 = await app.now();
  await goLevel(page, "taste");
  // The face flew to the mark: the mark is the sound you're playing's.
  const [m] = await app.marks("level-landed", { after: t0 });
  expect(m.detail.flew && m.detail.flew.fade, "the face flew to its mark").toBeNull();
  await page.keyboard.press(" ");
  await app.engine((timeout) => expect.poll(() => lit(page, "#taste-well"), { timeout }).toBeGreaterThan(5), { ms: 30_000 });
  await page.keyboard.press(" ");
  await expect.poll(() => lit(page, "#taste-well")).toBe(0);
});

test("the face in flight draws what sounds while it flies", async ({ page, app }) => {
  await boot(app);
  await page.keyboard.down("a");
  await app.engine((timeout) => expect.poll(() => lit(page, "#out-face"), { timeout }).toBeGreaterThan(50), { ms: 30_000 });
  // Each frame of the move: how much of the face in flight is in silk, the
  // live outline's color (the face itself is green).
  const silk = await page.evaluate(async () => {
    const [r, g, b] = getComputedStyle(document.documentElement).getPropertyValue("--silk").trim().match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
    let most = 0;
    let frames = 0;
    document.querySelector('.rail-stop[data-level="perform"]').click();
    // The move lays the level out for two frames before the face takes off.
    for (let wait = 0; ; wait++) {
      await new Promise((ok) => requestAnimationFrame(ok));
      const cv = document.querySelector(".zoom-face.on");
      if (!cv) {
        if (frames || wait > 30) break;
        continue;
      }
      frames++;
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 120 && Math.abs(d[i] - r) < 30 && Math.abs(d[i + 1] - g) < 30 && Math.abs(d[i + 2] - b) < 30) n++;
      most = Math.max(most, n);
    }
    return { most, frames };
  });
  await landed(page);
  await page.keyboard.up("a");
  expect(silk.frames, "the face flew").toBeGreaterThan(0);
  expect(silk.most, "what sounds, drawn over the face in flight").toBeGreaterThan(5);
});

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("nothing over a face moves while a key sounds, and no face painter is started", async ({ page, app }) => {
    // Each face painter started (live-paint.js's worker): the loop never
    // runs, so none is, not even while the page is idle after boot (the
    // loop's warm-up, which starts it where there is motion).
    await page.addInitScript(() => {
      const W = window.Worker;
      window.__painters = 0;
      window.Worker = class extends W {
        constructor(url, opts) {
          super(url, opts);
          if (/live-paint\.js/.test(String(url))) window.__painters++;
        }
      };
    });
    await boot(app);
    await page.keyboard.down("a");
    await app.engine((timeout) => expect.poll(() => peakDb(page), { timeout }).toBeGreaterThan(-40), { ms: 30_000 });
    await app.quiet();
    await page.keyboard.up("a");
    await expect(page.locator("canvas.face-live")).toHaveCount(0);
    expect(await page.evaluate(() => window.__painters), "no face painter was started").toBe(0);
  });
});

// The Air's screen is Retina: a face's layer there has four times the pixels
// it has at 1×.
const AIR_SCALE = 2;

test.describe("at the Air's Retina scale", () => {
  test.use({ deviceScaleFactor: AIR_SCALE });

  test("the live faces painted in their worker are the same pixels, frame by frame, as painted on the page", async ({ page, app }) => {
    await page.addInitScript(INIT);
    await app.boot();
    // Two loops over the same frames: the app's own modules, the same
    // sounds (a waveform made from the frame's number), the same faces and
    // clock, one painting in live-paint.js's worker as the app does, one on
    // the page. After each frame (and once the worker has painted it and
    // the page shows it), the two layers are compared byte for byte: a face
    // that sounds, grows louder, moves, is resized, falls silent, fades and
    // is cleared, and a face too small for the live outline.
    const got = await page.evaluate(async () => {
      const v = window.__aurBuild;
      const { createLiveFaces } = await import(`./live-face.js?v=${v}`);
      const { decodeFace, bankStats, FACE_LEN, FACE_BANDS, FACE_SLICES } = await import(`./faces.js?v=${v}`);
      const tilt = (slope, wob) => Array.from({ length: FACE_BANDS }, (_, i) => Math.max(-60, -slope * i + 4 * Math.sin(i * wob)));
      const face = (ltas) => {
        const b = new Uint8Array(FACE_LEN);
        const enc = (db) => Math.max(0, Math.min(255, Math.round((db + 60) / 0.5)));
        for (let i = 0; i < FACE_BANDS; i++) b[i] = enc(ltas[i]);
        for (let t = 0; t < FACE_SLICES; t++) for (let i = 0; i < FACE_BANDS; i++) b[FACE_BANDS + t * FACE_BANDS + i] = enc(ltas[i] - t);
        return decodeFace(b);
      };
      const bank = [face(tilt(0.5, 0.3)), face(tilt(1, 0.7)), face(tilt(1.5, 0.2)), face(tilt(2, 0.9))];
      const stats = bankStats(bank);
      let frame = 0;
      let amp = 0.25;
      const signal = (hz) => ({
        context: { sampleRate: 48000 },
        getFloatTimeDomainData(buf) {
          for (let i = 0; i < buf.length; i++) {
            const t = (frame * 800 + i) / 48000;
            buf[i] = amp * (Math.sin(2 * Math.PI * hz * t) + 0.4 * Math.sin(2 * Math.PI * hz * 2.7 * t + frame * 0.3));
          }
        },
      });
      const host = (left) => {
        const h = document.createElement("div");
        h.style.cssText = `position:fixed;left:${left}px;top:0;width:458px;height:499px;z-index:9999;pointer-events:none`;
        document.body.append(h);
        return h;
      };
      let t = 1000;
      let height = 499;
      let x = 139;
      const loop = (paintWorker, left) => {
        const big = host(left);
        const small = host(left + 460);
        let queued = null;
        const lf = createLiveFaces({
          signals: [() => signal(220), () => signal(330)],
          held: () => true,
          silk: () => "#e8e4da",
          paintWorker,
          raf: (f) => (queued = f),
          now: () => t,
        });
        lf.add({
          place(p) {
            p.host = big;
            p.hw = 458;
            p.hh = height;
            Object.assign(p.box, { x, y: 38, w: 180, h: 299 });
            p.face = bank[1];
            p.stats = stats;
            p.color = "#8ef0b1";
            p.hears = 1;
            p.inHand = true;
            return true;
          },
        });
        lf.add({
          place(p) {
            p.host = small;
            p.hw = 458;
            p.hh = 499;
            Object.assign(p.box, { x: 200, y: 200, w: 20, h: 30 });
            p.face = bank[2];
            p.stats = stats;
            p.color = "#8ef0b1";
            p.hears = 2;
            p.inHand = false;
            return true;
          },
        });
        lf.wake();
        return {
          lf,
          step() {
            const f = queued;
            queued = null;
            if (f) f();
          },
          layers: () => [...big.querySelectorAll("canvas.face-live"), ...small.querySelectorAll("canvas.face-live")],
        };
      };
      // The painter, and whether the loop gave up on it (live-face.js
      // `paintHere` ends it, and paints on the page from then on).
      let gaveUp = false;
      const there = loop(() => {
        const w = new Worker(`./live-paint.js?v=${v}`, { type: "module" });
        const end = w.terminate.bind(w);
        w.terminate = () => {
          gaveUp = true;
          end();
        };
        return w;
      }, 0);
      const here = loop(null, 0);
      const shown = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const out = { frames: 0, compared: 0, differing: [], lit: 0, cleared: 0, painted: 0, sizes: [] };
      // 60 frames a second: the trail is cleared 1.6 s (96 frames) after the
      // sound stops, at frame 50.
      for (frame = 1; frame <= 160; frame++) {
        if (frame === 20) amp = 0.5;
        if (frame === 30) x = 150;
        if (frame === 40) height = 480;
        if (frame === 50) amp = 0;
        t += 1000 / 60;
        there.step();
        here.step();
        // The worker's frame, painted, however long that takes (the first
        // starts the worker, fetches its module and paints a glow at
        // 916×998, on a loaded runner too): a step taken before would find
        // the painter busy and only wait, and the two loops would part. A
        // painter the loop gave up on answers no more.
        while (!gaveUp && there.lf.counts.painted < there.lf.counts.posted) await new Promise((ok) => setTimeout(ok, 1));
        // …and shown (a frame or two after), compared with the page's.
        let same = false;
        let diff = -1;
        let lit = 0;
        for (let tries = 0; tries < 10 && !same; tries++) {
          await shown();
          const a = here.layers();
          const b = there.layers();
          if (a.length !== b.length) continue;
          diff = 0;
          lit = 0;
          for (let j = 0; j < a.length; j++) {
            if (a[j].width !== b[j].width || a[j].height !== b[j].height) {
              diff = Infinity;
              break;
            }
            const pa = window.__pixels(a[j]);
            const pb = window.__pixels(b[j]);
            for (let k = 0; k < pa.length; k++) if (pa[k] !== pb[k]) diff++;
            for (let k = 3; k < pa.length; k += 4) if (pa[k]) lit++;
          }
          same = diff === 0;
        }
        out.frames++;
        if (same) out.compared++;
        else out.differing.push({ frame, diff });
        if (lit) out.lit++;
        else out.cleared++;
      }
      out.gaveUp = gaveUp;
      out.painted = there.lf.counts.painted;
      out.sizes = here.layers().map((c) => [c.width, c.height]);
      // The worker's layers show its pictures (no 2D context: nothing was
      // drawn on them here); the page's were drawn on.
      out.shown = there.layers().every((c) => c.getContext("2d") === null);
      out.drawnHere = here.layers().every((c) => c.getContext("2d") !== null);
      return out;
    });
    test.info().annotations.push({ type: "frames compared", description: JSON.stringify(got) });
    expect(got.gaveUp, "the loop kept its painter").toBe(false);
    expect(got.shown, "the worker's loop showed its pictures").toBe(true);
    expect(got.drawnHere, "the other loop drew on the page").toBe(true);
    expect(got.painted, "the worker painted the frames").toBeGreaterThan(50);
    expect(got.lit, "frames with something drawn").toBeGreaterThan(40);
    expect(got.cleared, "frames after the trail was cleared").toBeGreaterThan(0);
    expect(got.sizes, "drawn at the screen's scale, and resized").toEqual([
      [458 * 2, 480 * 2],
      [458 * 2, 499 * 2],
    ]);
    expect(got.differing, "every frame the same pixels").toEqual([]);
  });
});

// A player holds a key this long while the frames are timed (a gesture's
// length, not a wait for anything).
const HELD_MS = 3_000;

test.describe("on the reference profile, at the Air's Retina scale", () => {
  test.use({ deviceScaleFactor: AIR_SCALE });

  test("a frame of live faces is cheap on the reference profile", async ({ page, app }) => {
    // The loop's own time each call (live-face.js `liveFacesFrame`), and
    // whether the call sent the painter a frame: a call that finds the
    // painter still busy with the last only asks for the next (a few
    // microseconds), and is not a frame. The page's time showing the
    // pictures the worker answers with (its `onmessage`), and when each
    // frame sent was shown; every long task, from the page's clock; and the
    // worker's own time painting each frame (live-paint.js answers each
    // with it).
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      const calls = (window.__liveCalls = []);
      const frames = (window.__liveFrames = []);
      let posted = false;
      // The page's frames so far (every callback of one is handed its time).
      let pageFrames = 0;
      let lastAt = -1;
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          if (t !== lastAt) {
            lastAt = t;
            pageFrames++;
          }
          if (cb.name !== "liveFacesFrame") return cb(t);
          posted = false;
          const t0 = performance.now();
          cb(t);
          const ms = performance.now() - t0;
          calls.push(ms);
          if (posted) frames.push(ms);
        });
      const painted = (window.__painted = []);
      const shown = (window.__shown = []);
      // Each frame from its sending to its pictures shown: ms, and the
      // page's frames from the one that read it to the one that shows it
      // (1: the next; painted on the page, it showed in its own).
      const late = (window.__late = []);
      const W = window.Worker;
      window.Worker = class extends W {
        constructor(url, opts) {
          super(url, opts);
          if (!/live-paint\.js/.test(String(url))) return;
          const sent = new Map();
          const post = this.postMessage.bind(this);
          this.postMessage = (m, ...rest) => {
            posted = true;
            sent.set(m.frame, { at: performance.now(), frame: pageFrames });
            return post(m, ...rest);
          };
          this.addEventListener("message", (e) => painted.push(e.data.ms));
          // The page's handler, timed.
          Object.defineProperty(this, "onmessage", {
            set(f) {
              this.addEventListener("message", (e) => {
                const t0 = performance.now();
                f(e);
                const t1 = performance.now();
                shown.push(t1 - t0);
                const s = sent.get(e.data.frame);
                sent.delete(e.data.frame);
                if (s) late.push({ ms: t1 - s.at, frames: pageFrames - s.frame + 1 });
              });
            },
          });
        }
      };
      window.__long = [];
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__long.push(e.duration);
        }).observe({ type: "longtask" });
      } catch (_) {
        /* no long tasks in this browser: none are counted */
      }
    });
    await boot(app, { profile: "air" });
    await goLevel(page, "perform");
    await app.engine((timeout) => expect(page.locator("#view-perform .pf-face img.face").first()).toBeVisible({ timeout }));
    await page.keyboard.down("a");
    await app.engine((timeout) => expect.poll(() => lit(page, "#view-perform .pf-faces"), { timeout }).toBeGreaterThan(50), { ms: 30_000 });
    const got = await page.evaluate(async (ms) => {
      for (const k of ["__liveCalls", "__liveFrames", "__painted", "__shown", "__late", "__long"]) window[k].length = 0;
      // Every frame the page draws meanwhile, to say how smooth it stayed.
      let frames = 0;
      let on = true;
      const count = () => {
        frames++;
        if (on) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      await new Promise((ok) => setTimeout(ok, ms));
      on = false;
      const sorted = (a) => a.slice().sort((x, y) => x - y);
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      const mid = (a) => (a.length ? a[a.length >> 1] : null);
      const f = sorted(window.__liveFrames);
      const sh = sorted(window.__shown);
      const w = sorted(window.__painted);
      return {
        // The calls that sent the painter a frame, and those that waited.
        n: f.length,
        waited: window.__liveCalls.length - f.length,
        fps: (frames * 1000) / ms,
        p50: mid(f),
        p95: f.length ? f[Math.floor(f.length * 0.95)] : null,
        max: f.length ? f[f.length - 1] : null,
        // Every call, a frame or a wait, and showing every answer.
        share: (sum(window.__liveCalls) + sum(sh)) / ms,
        // The page's time showing each answer's pictures (median).
        shown: sh.length,
        showP50: mid(sh),
        long: window.__long.slice(),
        dpr: devicePixelRatio,
        // The worker's: frames painted, a second, and a frame's time there
        // (median).
        painted: w.length,
        paintedFps: (w.length * 1000) / ms,
        paintP50: mid(w),
        // From a frame's sending to its pictures shown (medians).
        lateMs: mid(sorted(window.__late.map((l) => l.ms))),
        lateFrames: mid(sorted(window.__late.map((l) => l.frames))),
      };
    }, HELD_MS);
    await page.keyboard.up("a");
    test.info().annotations.push({ type: "live faces", description: JSON.stringify(got) });
    expect(got.n, "the loop sent the painter the faces' frames while the key sounded").toBeGreaterThan(10);
    expect(got.painted, "and the painter answered them").toBeGreaterThan(10);
    // A throttled page is paused now and then (CDP's throttle), and a frame
    // that takes the pause looks long: the median of the frames sent is the
    // frame's cost, the share of the window the live faces' whole cost on
    // the page (the loop's every call, and showing the worker's pictures).
    app.budget("a frame of live faces at PERFORM, the loop's own time (median)", got.p50, 2);
    app.budget("the live faces' share of the main thread while a key sounds at PERFORM (percent)", got.share * 100, 10);
    app.budget("the longest task while a key sounds at PERFORM", got.long.length ? Math.max(...got.long) : 0, 50);
  });
});
