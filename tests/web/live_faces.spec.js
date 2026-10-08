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
//   a key sounds.
// - A frame of live faces is cheap: the loop's own time a frame, and the
//   long tasks while a key sounds, on the reference profile, are budgets.
//
// It reads each face's layer (`.face-live`, a canvas over the face) for lit
// pixels, and, where it must know the output sounds, the output through an
// analyser on everything the app connects to the destination, as
// perform_stage.spec.js does.
const { test, expect, goLevel, landed } = require("./fixtures");

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
  // How much of the live layers under \`sel\` is lit: pixels with alpha.
  window.__lit = (sel) => {
    let n = 0;
    for (const c of document.querySelectorAll(sel + " canvas.face-live")) {
      if (!c.width || !c.height) continue;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++;
    }
    return n;
  };
})();`;

/** The output's loudest sample now, dB. */
const peakDb = (page) => page.evaluate(() => window.__pwPeakDb());
const lit = (page, sel) => page.evaluate((s) => window.__lit(s), sel);

/** Boot at PATCH (its face lands at once: PERFORM's wait behind its first
 *  measurement), with the face of the sound you're playing at OUT. */
async function boot(app, opts) {
  const { page } = app;
  await page.addInitScript(INIT);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("auracle-view", "patch");
    } catch (_) {}
  });
  await app.boot(opts);
  await app.engine((timeout) => expect(page.locator("#out-face img.face")).toBeVisible({ timeout }));
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

  test("nothing over a face moves while a key sounds", async ({ page, app }) => {
    await boot(app);
    await page.keyboard.down("a");
    await app.engine((timeout) => expect.poll(() => peakDb(page), { timeout }).toBeGreaterThan(-40), { ms: 30_000 });
    await app.quiet();
    await page.keyboard.up("a");
    await expect(page.locator("canvas.face-live")).toHaveCount(0);
  });
});

// A player holds a key this long while the frames are timed (a gesture's
// length, not a wait for anything).
const HELD_MS = 3_000;

test("a frame of live faces is cheap on the reference profile", async ({ page, app }) => {
  // The loop's own time each frame (live-face.js `liveFacesFrame`), and every
  // long task, from the page's clock.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const frames = (window.__liveFrames = []);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        if (cb.name !== "liveFacesFrame") return cb(t);
        const t0 = performance.now();
        cb(t);
        frames.push(performance.now() - t0);
      });
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
    window.__liveFrames.length = 0;
    window.__long.length = 0;
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
    const f = window.__liveFrames.slice().sort((a, b) => a - b);
    const total = f.reduce((a, b) => a + b, 0);
    return { n: f.length, fps: (frames * 1000) / ms, p50: f[f.length >> 1], p95: f[Math.floor(f.length * 0.95)], max: f[f.length - 1], share: total / ms, long: window.__long.slice() };
  }, HELD_MS);
  await page.keyboard.up("a");
  expect(got.n, "the faces were drawn each frame the key sounded").toBeGreaterThan(10);
  test.info().annotations.push({ type: "live faces", description: JSON.stringify(got) });
  // A throttled page is paused now and then (CDP's throttle), and a frame
  // that takes the pause looks long: the median is the frame's cost, the
  // share of the window the loop's whole cost.
  app.budget("a frame of live faces at PERFORM, the loop's own time (median)", got.p50, 2);
  app.budget("the live faces' share of the main thread while a key sounds at PERFORM (percent)", got.share * 100, 10);
  app.budget("the longest task while a key sounds at PERFORM", got.long.length ? Math.max(...got.long) : 0, 50);
});
