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
// - A page whose paint of a face measures over budget while it is idle
//   (here, its glow's strokes slowed) starts the face painter then, before
//   the first key, and the faces are born painted by it: no frame of them
//   is painted on the page.
// - The layers a painter paints are the same pixels, frame by frame, as the
//   same frames painted on the page throughout, whether it took them over
//   mid-sound, as it stood, once a window of frames painted on the page
//   measured over budget, or painted them from the first frame, the idle
//   probe over budget.
// - Wherever the faces are painted, a live layer is stroked only in the
//   loop's call that read the signals, and a painter started in a frame is
//   started only once a window of frames was painted on the page; where
//   that is (Chromium, whose canvas calls only record the drawing, paints
//   them on the page; Firefox, which blurs the glow as it is called, hands
//   them to the painter at idle) is a speed, recorded beside them.
// - A frame of live faces is cheap: the loop's own time a frame, its share
//   of the main thread, and the long tasks while a key sounds, on the
//   reference profile at the Air's Retina scale, are budgets.
//
// It reads each face's layer (`.face-live`, a canvas over the face, which
// shows the pictures the worker paints once it paints them, so read by
// drawing it onto a canvas of the spec's own) for lit pixels, and, where it
// must know the output sounds, the output through an analyser on everything
// the app connects to the destination, as perform_stage.spec.js does.
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

/** Each face painter started (live-paint.js's worker), the layers handed to
 *  it, and the frames sent it after (counted on the page, as sent). */
const PAINTERS = () => {
  const W = window.Worker;
  window.__painters = 0;
  window.__handed = 0;
  window.__sent = 0;
  window.Worker = class extends W {
    constructor(url, opts) {
      super(url, opts);
      if (!/live-paint\.js/.test(String(url))) return;
      window.__painters++;
      const post = this.postMessage.bind(this);
      this.postMessage = (m, ...rest) => {
        if (m.seed) window.__handed += m.seed.length;
        else if (m.faces.length) window.__sent++;
        return post(m, ...rest);
      };
    }
  };
};

/** How many of the live layers under `sel` are painted on the page (a 2D
 *  context) and how many show a painter's pictures (none). Each was given its
 *  context as it was made, so asking makes none. */
const layerKinds = (page, sel) =>
  page.evaluate((s) => {
    const kinds = { here: 0, shown: 0 };
    for (const c of document.querySelectorAll(s + " canvas.face-live")) kinds[c.getContext("2d") ? "here" : "shown"]++;
    return kinds;
  }, sel);

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
    // runs, so nothing is painted or measured, and there is no idle probe
    // (which in Firefox, blurring the glow as it is called, would measure
    // over budget and start one), so none is.
    await page.addInitScript(PAINTERS);
    await boot(app);
    await page.keyboard.down("a");
    await app.engine((timeout) => expect.poll(() => peakDb(page), { timeout }).toBeGreaterThan(-40), { ms: 30_000 });
    await app.quiet();
    await page.keyboard.up("a");
    await expect(page.locator("canvas.face-live")).toHaveCount(0);
    expect(await page.evaluate(() => window.__painters), "no face painter was started").toBe(0);
  });
});

test("a page whose paint of a face measures over budget while it is idle starts the face painter then, and the faces are born painted by it, lit, with no frame painted on the page", async ({ page, app }) => {
  // Every glow stroked on a canvas that is not on the page (the idle
  // probe's, live-face.js `warm`, and a face's own drawing) and every stroke
  // on a live layer slowed, 3 ms each (two outlines a frame, so over the 2
  // ms a frame the page's paint may take), as a browser that blurs the glow
  // on the CPU is: the probe measures over, and the faces go to the painter
  // before the first key. Each stroke on a live layer is counted: none is
  // painted on the page.
  await page.addInitScript(() => {
    window.__strokedHere = 0;
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (...a) {
      const c = this.canvas;
      const live = !!(c && c.classList && c.classList.contains("face-live"));
      if (live) window.__strokedHere++;
      if (live || (c && !c.isConnected && this.shadowBlur > 0)) {
        const t0 = performance.now();
        while (performance.now() - t0 < 3);
      }
      return stroke.apply(this, a);
    };
  });
  await page.addInitScript(PAINTERS);
  await boot(app);
  // The probe ran while the page was idle, and started the painter: waited
  // for, so the key comes after it.
  await expect.poll(() => page.evaluate(() => window.__painters), { message: "a face painter started while the page was idle" }).toBe(1);
  await page.keyboard.down("a");
  await app.engine((timeout) => expect.poll(() => lit(page, "#out-face"), { timeout }).toBeGreaterThan(50), { ms: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__sent), { message: "frames sent to the face painter" }).toBeGreaterThan(10);
  const got = await page.evaluate(() => ({ painters: window.__painters, handed: window.__handed, strokedHere: window.__strokedHere }));
  expect(got.painters, "one face painter").toBe(1);
  expect(got.handed, "nothing handed to it: no layer was painted on the page first").toBe(0);
  expect(got.strokedHere, "no frame painted on the page").toBe(0);
  expect(await layerKinds(page, "#out-face"), "the layer was born showing the painter's pictures").toEqual({ here: 0, shown: 1 });
  expect(await lit(page, "#out-face"), "and is lit by them").toBeGreaterThan(50);
  await page.keyboard.up("a");
  await expect.poll(() => lit(page, "#out-face")).toBe(0);
});

// The Air's screen is Retina: a face's layer there has four times the pixels
// it has at 1×.
const AIR_SCALE = 2;

test.describe("at the Air's Retina scale", () => {
  test.use({ deviceScaleFactor: AIR_SCALE });

  test("the live faces painted by their painter, handed to it mid-sound or from the first frame, are the same pixels, frame by frame, as painted on the page", async ({ page, app }) => {
    await page.addInitScript(INIT);
    await app.boot();
    // Three loops over the same frames: the app's own modules, the same
    // sounds (a waveform made from the frame's number), the same faces and
    // clock. One paints on the page throughout. One is the app's way on a
    // page whose paint gets over budget as the faces are played (its
    // switch's budget is one no paint meets, and it has no idle probe): it
    // paints on the page while a window of frames is timed, starts
    // live-paint.js's worker, paints on until the worker is up, hands it
    // each layer as it stands, and from then on the worker paints. One is
    // the app's way on a page whose idle probe measured over budget
    // (live-face.js `warm`): the worker started before the first frame, and
    // every layer born showing its pictures. After each frame (and once each
    // worker has painted it and the page shows it), each worker's layers
    // are compared with the page's byte for byte: a face that sounds, grows
    // louder, is handed over, moves, is resized, falls silent, fades and is
    // cleared, and a face too small for the live outline.
    const got = await page.evaluate(async () => {
      const v = window.__aurBuild;
      const { createLiveFaces, createPaintSwitch, LIVE_PAINT_WINDOW } = await import(`./live-face.js?v=${v}`);
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
      // The idle callbacks the loops ask for (the idle probe's retake), run
      // by the spec.
      const idles = [];
      const loop = (paintWorker, left, paintSwitch) => {
        const big = host(left);
        const small = host(left + 460);
        let queued = null;
        const lf = createLiveFaces({
          signals: [() => signal(220), () => signal(330)],
          held: () => true,
          silk: () => "#e8e4da",
          paintWorker,
          paintSwitch,
          idle: (f) => idles.push(f),
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
      // A painter: whether it has answered the page's first message (it is
      // up), and whether the loop gave up on it (live-face.js `paintHere`
      // ends it, and paints on the page from then on).
      const painter = () => {
        const p = { started: false, up: false, gaveUp: false };
        p.make = () => {
          p.started = true;
          const w = new Worker(`./live-paint.js?v=${v}`, { type: "module" });
          w.addEventListener("message", (e) => {
            if (e.data && e.data.frame === 0) p.up = true;
          });
          const end = w.terminate.bind(w);
          w.terminate = () => {
            p.gaveUp = true;
            end();
          };
          return w;
        };
        return p;
      };
      const handedP = painter();
      const bornP = painter();
      const handed = loop(handedP.make, 0, createPaintSwitch({ budget: -1 }));
      const born = loop(bornP.make, 0, createPaintSwitch({ budget: -1 }));
      // The idle probe, before the first frame, over a budget no paint
      // meets, and its retake, in an idle callback of its own.
      born.lf.warm(48000, { w: 458, h: 499, box: { x: 139, y: 38, w: 180, h: 299 } });
      const retakeAsked = idles.length === 1 && !bornP.started;
      idles.shift()();
      const bornAtIdle = retakeAsked && bornP.started;
      const here = loop(null, 0);
      const shown = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const until = async (ok) => {
        while (!ok()) await new Promise((r) => setTimeout(r, 1));
      };
      // The bytes of `b`'s layers that are not `a`'s (Infinity for a layer
      // count or size that differs), and the lit pixels of `a`'s.
      const differ = (a, b) => {
        if (a.length !== b.length) return { diff: Infinity, lit: 0 };
        let diff = 0;
        let lit = 0;
        for (let j = 0; j < a.length; j++) {
          if (a[j].width !== b[j].width || a[j].height !== b[j].height) return { diff: Infinity, lit: 0 };
          const pa = window.__pixels(a[j]);
          const pb = window.__pixels(b[j]);
          for (let k = 0; k < pa.length; k++) if (pa[k] !== pb[k]) diff++;
          for (let k = 3; k < pa.length; k += 4) if (pa[k]) lit++;
        }
        return { diff, lit };
      };
      const out = { frames: 0, compared: 0, differing: [], bornDiffering: [], lit: 0, cleared: 0, sizes: [], handedAt: 0, startedAt: 0, window: LIVE_PAINT_WINDOW, bornAtIdle };
      // 60 frames a second: the trail is cleared 1.6 s (96 frames) after the
      // sound stops, at frame 50.
      for (frame = 1; frame <= 160; frame++) {
        if (frame === 20) amp = 0.5;
        if (frame === 30) x = 150;
        if (frame === 40) height = 480;
        if (frame === 50) amp = 0;
        t += 1000 / 60;
        handed.step();
        born.step();
        here.step();
        // The frame that started the handed loop's painter, and the frame
        // after which the faces were handed to it (the first message the
        // loop counts as sent).
        if (!out.startedAt && handedP.started) out.startedAt = frame;
        if (!out.handedAt && handed.lf.counts.posted) out.handedAt = frame;
        // A painter started in this frame is up before the next frame is
        // read (the first starts the worker and fetches its module, on a
        // loaded runner too), so the frame the faces are handed over at is
        // one of the loop's order, not of how long that took.
        await until(() => !handedP.started || handedP.up || handedP.gaveUp);
        // Each worker's frame, painted, however long that takes (a glow at
        // 916×998): a step taken before would find the painter busy and
        // only wait, and the loops would part. A painter the loop gave up
        // on answers no more.
        await until(() => handedP.gaveUp || handed.lf.counts.painted >= handed.lf.counts.posted);
        await until(() => bornP.gaveUp || born.lf.counts.painted >= born.lf.counts.posted);
        // …and shown (a frame or two after), compared with the page's.
        let a = { diff: -1, lit: 0 };
        let b = { diff: -1, lit: 0 };
        for (let tries = 0; tries < 10 && (a.diff !== 0 || b.diff !== 0); tries++) {
          await shown();
          a = differ(here.layers(), handed.layers());
          b = differ(here.layers(), born.layers());
        }
        out.frames++;
        if (a.diff === 0 && b.diff === 0) out.compared++;
        if (a.diff !== 0) out.differing.push({ frame, diff: a.diff });
        if (b.diff !== 0) out.bornDiffering.push({ frame, diff: b.diff });
        if (a.lit) out.lit++;
        else out.cleared++;
      }
      out.gaveUp = handedP.gaveUp;
      out.bornGaveUp = bornP.gaveUp;
      out.paintedHere = handed.lf.counts.here;
      out.painted = handed.lf.counts.painted;
      out.bornHere = born.lf.counts.here;
      out.bornPainted = born.lf.counts.painted;
      out.sizes = here.layers().map((c) => [c.width, c.height]);
      // The workers' layers show their pictures (no 2D context: nothing was
      // drawn on them here); the page's were drawn on.
      out.shown = handed.layers().every((c) => c.getContext("2d") === null);
      out.bornShown = born.layers().every((c) => c.getContext("2d") === null);
      out.drawnHere = here.layers().every((c) => c.getContext("2d") !== null);
      return out;
    });
    test.info().annotations.push({ type: "frames compared", description: JSON.stringify(got) });
    expect(got.gaveUp, "the handed loop kept its painter").toBe(false);
    expect(got.bornGaveUp, "the probed loop kept its painter").toBe(false);
    // A window of frames timed on the page (live-face.js
    // `LIVE_PAINT_WINDOW`), the painter started by the last of them, and
    // the hand-over at the first frame after it was up, while the sound
    // plays (it stops at frame 50), with a trail to take up.
    expect(got.startedAt, "the painter started once a window of frames was timed").toBe(got.window);
    expect(got.handedAt, "handed over at the first frame after it was up").toBe(got.window + 1);
    expect(got.handedAt, "while the sound played").toBeLessThan(50);
    expect(got.paintedHere, "painted on the page until then").toBe(got.window + 1);
    expect(got.shown, "the handed loop's layers showed its painter's pictures").toBe(true);
    expect(got.painted, "its painter painted the frames after").toBeGreaterThan(50);
    // The probed loop: its painter started by the probe, before any frame,
    // and every frame painted by it.
    expect(got.bornAtIdle, "the probed loop's painter started by the probe's retake, in an idle callback of its own").toBe(true);
    expect(got.bornHere, "no frame of the probed loop painted on the page").toBe(0);
    expect(got.bornShown, "its layers showed its painter's pictures").toBe(true);
    expect(got.bornPainted, "its painter painted the frames").toBeGreaterThan(50);
    expect(got.drawnHere, "the other loop drew on the page").toBe(true);
    expect(got.lit, "frames with something drawn").toBeGreaterThan(40);
    expect(got.cleared, "frames after the trail was cleared").toBeGreaterThan(0);
    expect(got.sizes, "drawn at the screen's scale, and resized").toEqual([
      [458 * 2, 480 * 2],
      [458 * 2, 499 * 2],
    ]);
    expect(got.differing, "every frame the same pixels, handed over mid-sound").toEqual([]);
    expect(got.bornDiffering, "every frame the same pixels, painted by the painter from the first").toEqual([]);
  });
});

// A player holds a key this long while the frames are timed (a gesture's
// length, not a wait for anything).
const HELD_MS = 3_000;

/** A key held at PERFORM, booted on the reference profile, and the live
 *  faces' frames timed while it sounds, for `ms` (a gesture's length) or
 *  until `windows` windows of frames (live-face.js `LIVE_PAINT_WINDOW`,
 *  `paintWindow`) have been read; with what the faces' layers under the
 *  well are once it has. */
async function timedLiveFaces(page, app, { ms = 0, windows = 0 } = {}) {
  // The loop's own time each call (live-face.js `liveFacesFrame`), and
  // what the call did: a call that reads a signal is a frame, painted on
  // the page in that call (it stroked a live layer) or sent to the
  // painter; a call that reads nothing found the painter still busy with
  // the last frame and only asks for the next (a few microseconds), and
  // is not a frame. The page's time showing the pictures the painter
  // answers with (its `onmessage`), and when each frame sent was shown;
  // every long task, from the page's clock; the painter's own time
  // painting each frame (live-paint.js answers each with it). And, from
  // boot: each frame painted on the page before the first was sent to a
  // painter (its time), every stroke on a live layer made anywhere but in
  // a call that read the signals, whether the painter was started in a
  // frame or outside one (the idle probe, live-face.js `warm`) and how
  // many frames the page had painted by then, and how many before it
  // handed the faces over.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const calls = (window.__liveCalls = []);
    const frames = (window.__liveFrames = []);
    const before = (window.__beforePainter = []);
    let read = false;
    let stroked = false;
    let posted = false;
    let inLoop = false;
    let anySent = false;
    let paintedHere = 0;
    window.__stray = 0;
    window.__started = null;
    window.__handedAfter = null;
    const getData = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function (...a) {
      read = true;
      return getData.apply(this, a);
    };
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (...a) {
      if (this.canvas && this.canvas.classList && this.canvas.classList.contains("face-live")) {
        stroked = true;
        if (!inLoop || !read) window.__stray++;
      }
      return stroke.apply(this, a);
    };
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
        read = stroked = posted = false;
        inLoop = true;
        const t0 = performance.now();
        try {
          cb(t);
        } finally {
          inLoop = false;
        }
        const ms = performance.now() - t0;
        calls.push(ms);
        if (stroked) {
          paintedHere++;
          if (!anySent) before.push(ms);
        }
        if (read) frames.push({ ms, here: stroked, sent: posted });
      });
    const painted = (window.__painted = []);
    const shown = (window.__shown = []);
    // Each frame from its sending to its pictures shown: ms, and the
    // page's frames from the one that read it to the one that shows it
    // (1: the next; a frame painted on the page shows in its own).
    const late = (window.__late = []);
    window.__painters = 0;
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(url, opts) {
        super(url, opts);
        if (!/live-paint\.js/.test(String(url))) return;
        window.__painters++;
        window.__started = { inFrame: inLoop, after: paintedHere + (inLoop && stroked ? 1 : 0) };
        const sent = new Map();
        const post = this.postMessage.bind(this);
        this.postMessage = (m, ...rest) => {
          if (m.seed || m.faces.length) {
            posted = true;
            anySent = true;
            if (m.seed) window.__handedAfter = paintedHere;
            sent.set(m.frame, { at: performance.now(), frame: pageFrames });
          }
          return post(m, ...rest);
        };
        this.addEventListener("message", (e) => {
          if (e.data.layers && e.data.layers.length) painted.push(e.data.ms);
        });
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
  const paintWindow = await page.evaluate(async () => (await import(`./live-face.js?v=${window.__aurBuild}`)).LIVE_PAINT_WINDOW);
  await goLevel(page, "perform");
  await app.engine((timeout) => expect(page.locator("#view-perform .pf-face img.face").first()).toBeVisible({ timeout }));
  await page.keyboard.down("a");
  await app.engine((timeout) => expect.poll(() => lit(page, "#view-perform .pf-faces"), { timeout }).toBeGreaterThan(50), { ms: 30_000 });
  await page.evaluate(() => {
    for (const k of ["__liveCalls", "__liveFrames", "__painted", "__shown", "__late", "__long"]) window[k].length = 0;
    // Every frame the page draws meanwhile, to say how smooth it stayed.
    window.__pageFrames = 0;
    window.__counting = true;
    const count = () => {
      window.__pageFrames++;
      if (window.__counting) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    window.__from = performance.now();
  });
  if (windows) await expect.poll(() => page.evaluate(() => window.__liveFrames.length), { message: "frames of the live faces read while the key sounds" }).toBeGreaterThanOrEqual(windows * paintWindow);
  else await page.evaluate((ms) => new Promise((ok) => setTimeout(ok, ms)), ms);
  const got = await page.evaluate(() => {
    window.__counting = false;
    const ms = performance.now() - window.__from;
    const sorted = (a) => a.slice().sort((x, y) => x - y);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const mid = (a) => (a.length ? a[a.length >> 1] : null);
    const all = window.__liveFrames;
    const f = sorted(all.map((x) => x.ms));
    const sh = sorted(window.__shown);
    const w = sorted(window.__painted);
    const before = sorted(window.__beforePainter);
    return {
      ms,
      // The frames, those painted on the page in the call that read them
      // and those sent to the painter, and the calls that waited.
      n: f.length,
      here: all.filter((x) => x.here).length,
      sent: all.filter((x) => x.sent).length,
      waited: window.__liveCalls.length - f.length,
      fps: (window.__pageFrames * 1000) / ms,
      p50: mid(f),
      p95: f.length ? f[Math.floor(f.length * 0.95)] : null,
      max: f.length ? f[f.length - 1] : null,
      hereP50: mid(sorted(all.filter((x) => x.here).map((x) => x.ms))),
      sentP50: mid(sorted(all.filter((x) => x.sent).map((x) => x.ms))),
      // Every call, a frame or a wait, and showing every answer.
      share: (sum(window.__liveCalls) + sum(sh)) / ms,
      // The page's time showing each answer's pictures (median).
      shown: sh.length,
      showP50: mid(sh),
      long: window.__long.slice(),
      dpr: devicePixelRatio,
      // Since boot: the frames painted on the page before the first was
      // sent to a painter (how many, their median and longest), strokes
      // on a live layer outside a call that read, face painters started,
      // where the first was started (in a frame, or outside one: the idle
      // probe) and how many frames the page had painted by then, and by
      // the hand-over (none: there was none).
      beforePainter: { n: before.length, p50: mid(before), max: before.length ? before[before.length - 1] : null },
      stray: window.__stray,
      painters: window.__painters,
      started: window.__started,
      handedAfter: window.__handedAfter,
      // The painter's: frames painted, a second, and a frame's time there
      // (median).
      painted: w.length,
      paintedFps: (w.length * 1000) / ms,
      paintP50: mid(w),
      // From a frame's sending to its pictures shown (medians).
      lateMs: mid(sorted(window.__late.map((l) => l.ms))),
      lateFrames: mid(sorted(window.__late.map((l) => l.frames))),
    };
  });
  const layers = await layerKinds(page, "#view-perform .pf-faces");
  await page.keyboard.up("a");
  test.info().annotations.push({ type: "live faces", description: JSON.stringify({ ...got, layers }) });
  return { ...got, layers, paintWindow };
}

test.describe("on the reference profile, at the Air's Retina scale", () => {
  test.use({ deviceScaleFactor: AIR_SCALE });

  test("a frame of live faces is cheap on the reference profile", async ({ page, app }) => {
    const got = await timedLiveFaces(page, app, { ms: HELD_MS });
    expect(got.n, "the loop ran frames while the key sounded").toBeGreaterThan(10);
    expect(got.here + got.sent, "each painted on the page or sent to the painter").toBeGreaterThan(10);
    // A throttled page is paused now and then (CDP's throttle), and a frame
    // that takes the pause looks long: the median of the frames is the
    // frame's cost, the share of the window the live faces' whole cost on
    // the page (the loop's every call, and showing the painter's pictures).
    app.budget("a frame of live faces at PERFORM, the loop's own time (median)", got.p50, 2);
    app.budget("the live faces' share of the main thread while a key sounds at PERFORM (percent)", got.share * 100, 10);
    app.budget("the longest task while a key sounds at PERFORM", got.long.length ? Math.max(...got.long) : 0, 50);
  });

  test("each frame of the live faces is painted on the page in the call that read it, or by a face painter started at idle or after a window of frames", async ({ page, app }) => {
    // Where the faces are painted is decided from what painting them on the
    // page measures (live-face.js `createPaintSwitch`): a speed, recorded
    // beside the frames (the annotation `live faces`: the page's paint a
    // frame, the painters started, where and after how many frames), never
    // asserted. Chromium, whose canvas calls only record the drawing,
    // measures inside budget and paints them on the page; Firefox, which
    // blurs the glow as it is called, measures over it at idle and starts
    // the painter then; a loaded runner may measure either. What holds
    // wherever they are painted is asserted: a live layer is stroked only in
    // the loop's call that read the signals, and a painter started in a
    // frame is started only once the page has painted a window of frames
    // (outside a frame, it was the idle probe). The key is held until
    // three windows of frames are read.
    const got = await timedLiveFaces(page, app, { windows: 3 });
    const { paintWindow } = got;
    expect(got.stray, "no live layer stroked but in the loop's call that read the signals").toBe(0);
    expect(got.here + got.sent, "frames painted on the page or sent to the painter").toBeGreaterThanOrEqual(paintWindow);
    expect(got.painters, "one face painter at most").toBeLessThanOrEqual(1);
    expect(!got.started || !got.started.inFrame || got.started.after >= paintWindow, `a painter started in a frame only once a window of frames was painted on the page (${JSON.stringify(got.started)})`).toBe(true);
    expect(got.painters > 0 || got.layers.shown === 0, "no layer shows a painter's pictures where none was started").toBe(true);
    expect(got.layers.here + got.layers.shown, "the well's layers").toBeGreaterThan(0);
  });
});
