// PERFORM is playable at once on a patch it has measured before.
//
// Measuring a patch is ~one render per knob plus verification, 10-30 s on a
// CI runner. A booth flicks between the same demo patches all day, so every
// measurement is kept (stale-while-revalidate, persisted across reloads):
// a revisit is wired within 0.5 s of PERFORM showing it, and the same patch
// after a reload within 1.5 s (the interaction spec's budget; this allowed 5 s
// and 8 s). The presets ship measured (budgets.spec.js), so this blocks that
// file: it is the player's own cache being checked here.
//
// The same holds for Offer: one offer is grown in the background once a patch
// is steady, and pressing Offer hands it over instead of starting ~10 s of
// renders. And a kept wiring from another build's DSP still plays at once, but
// is re-measured rather than trusted.
//
// The engine is reached through the fixture's tap: its requests held
// (`app.holdRequests`), counted (`app.sentCount`), and its offers read.
const fs = require("fs");
const path = require("path");
const { test, expect, PERFORM_SEED, bankTab } = require("./fixtures");

// Acid Line as the app keys its wiring (`wireKey`: the tree's JSON with its
// uids dropped), from the shipped file.
const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, "../../apps/web/perform-wirings.json"), "utf8"));
const acid = shipped.presets.find((p) => p.name === "Acid Line");
const acidKey = JSON.stringify(JSON.parse(acid.tree), (k, v) => (k === "uid" ? undefined : v));

test("a patch measured once is playable at once, even after a reload", { tag: "@slow" }, async ({ page, app }) => {
  await page.route("**/perform-wirings.json*", (r) => r.abort());
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await bankTab(page, "presets");
  const open = async (name) => {
    await page.locator(".bank-item", { hasText: name }).first().click();
    await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: 90_000 });
    // From the tab's click to wired controls, in the page's own clock (a
    // first visit is a measurement: an engine wait).
    const ms = await app.engine(() =>
      page.evaluate(async (name) => {
        const live = () =>
          document.querySelector(".pf-name")?.textContent === name &&
          /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
          ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired"));
        const t0 = performance.now();
        document.querySelector('.rail-stop[data-level="perform"]').click();
        for (;;) {
          if (live()) return Math.round(performance.now() - t0);
          if (performance.now() - t0 > 120_000) return Infinity;
          await new Promise((r) => setTimeout(r, 2));
        }
      }, name),
      { ms: 120_000 },
    );
    await app.level("patch");
    return ms;
  };
  await open("Glass Pad");
  await open("Acid Line");
  const revisit = await open("Glass Pad");
  console.log(`revisit wired in ${revisit} ms`);
  expect(revisit, "revisit").toBeLessThan(500);
  // reload: persisted. Acid Line was measured about 1-1.5 s ago, inside the
  // 1.5 s the cache waits before it writes: the write must not die with the
  // page (a test below holds that on its own).
  await app.reload();
  await bankTab(page, "presets");
  const reloaded = await open("Acid Line");
  console.log(`after a reload, wired in ${reloaded} ms`);
  expect(reloaded, "after a reload").toBeLessThan(1500);
  expect(await wiredHow(page, "Acid Line"), "from the player's cache, not measured again").toBe("cached");
});

// How PERFORM last wired the patch `name`: "cached", "shipped" or "measured"
// (the app's own timing mark, `auracle:perform-wired`).
const wiredHow = (page, name) =>
  page.evaluate(
    (name) =>
      performance
        .getEntriesByName("auracle:perform-wired")
        .filter((m) => m.detail?.name === name)
        .pop()?.detail?.how ?? null,
    name,
  );

// A preset opened before is remembered by the page (its tree and makeup), so
// after a reload it reaches the voices and PERFORM from the click, without
// waiting for the engine. The engine's one thread is always busy just after a
// boot (the first patch's render, the table's pair), and one render there is
// seconds on a slow machine: the first test's reload was wired 9.3 s after the
// tab click on a CI runner. Here every message to the engine is held back after
// the reload (`app.holdRequests`), so nothing the engine does can be what wires
// the controls.
test("a preset opened before plays at once after a reload, however busy the engine is", { tag: "@slow" }, async ({ page, app }) => {
  await page.route("**/perform-wirings.json*", (r) => r.abort());
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Acid Line" }).first().click();
  await app.engine((timeout) => expect(page.locator("#live-label")).toHaveText("Acid Line", { timeout }), { ms: 60_000 });
  await app.level("perform");
  await app.reached();
  await app.level("patch");
  // Both caches written (each 1.5 s after it changes): waited for, so this
  // test is about the engine (the next one is about a reload inside those
  // 1.5 s).
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const voiced = JSON.parse(localStorage.getItem("auracle-voiced-presets") || "null");
        const wired = new Map(JSON.parse(localStorage.getItem("auracle-perform-wirings") || "[]"));
        return !!voiced && voiced.presets.some(([n]) => n === "Acid Line") && wired.has(key);
      }, acidKey),
    )
    .toBe(true);
  await app.reload();
  await bankTab(page, "presets");
  await app.holdRequests();
  const ms = await page.evaluate(async () => {
    const row = [...document.querySelectorAll(".bank-item")].find((e) => e.querySelector(".bi-name")?.textContent === "Acid Line");
    const t0 = performance.now();
    row.click();
    document.querySelector('.rail-stop[data-level="perform"]').click();
    const live = () =>
      document.getElementById("live-label")?.textContent === "Acid Line" &&
      document.querySelector(".pf-name")?.textContent === "Acid Line" &&
      /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
      ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired"));
    while (!live() && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 2));
    return performance.now() - t0;
  });
  console.log(`click → PERFORM wired, with the engine held: ${ms.toFixed(0)} ms`);
  expect(ms, "wired without the engine").toBeLessThan(1500);
  // Let the engine answer: the bench becomes the patch the voices play, and
  // PERFORM stays on it.
  expect(await app.releaseRequests(), "the open was asked of the engine").toBeGreaterThan(0);
  await app.level("patch");
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(/^Acid Line/, { timeout }), { ms: 60_000 });
  await app.engine((timeout) => expect(page.locator("#rack-meta")).not.toHaveText(/opening/, { timeout }), { ms: 60_000 });
  await app.level("perform");
  await expect(page.locator(".pf-name")).toHaveText("Acid Line");
  await app.engine((timeout) => expect(page.locator(".pf-status")).toHaveText(/controls reach/, { timeout }), { ms: 30_000 });
});

// Both of the page's own memories (a preset's tree and makeup, and PERFORM's
// measurement of it) are written 1.5 s after they change. A reload, a closed
// tab or a booth's visitor reset in those 1.5 s cancelled the write, and the
// first test, whose reload comes 1-1.5 s after its last measurement, failed
// on CI runners with the patch measured again (8.7 and 10 s). They are
// written as the page is left now. Here each reload follows at once: one
// just after a preset is opened, one just after a patch is measured, and
// every message to the engine is held after each, so nothing the engine does
// can be what plays or wires the patch.
test("a preset opened, or a patch measured, just before a reload is remembered after it", { tag: "@slow" }, async ({ page, app }) => {
  await page.route("**/perform-wirings.json*", (r) => r.abort());
  // From the click, with the engine held: the voices play `name`, and with
  // `perform`, PERFORM's controls are wired to it.
  const fromMemory = async (name, perform) => {
    await app.holdRequests();
    return page.evaluate(
      async ({ name, perform }) => {
        const row = [...document.querySelectorAll(".bank-item")].find((e) => e.querySelector(".bi-name")?.textContent === name);
        const t0 = performance.now();
        row.click();
        if (perform) document.querySelector('.rail-stop[data-level="perform"]').click();
        const live = () =>
          document.getElementById("live-label")?.textContent === name &&
          (!perform ||
            (document.querySelector(".pf-name")?.textContent === name &&
              /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
              ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired"))));
        while (!live() && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 2));
        return Math.round(performance.now() - t0);
      },
      { name, perform },
    );
  };

  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await bankTab(page, "presets");

  // 1. A preset opened, then a reload at once.
  await page.locator(".bank-item", { hasText: "Acid Line" }).first().click();
  // Polled every 10 ms, not by an assertion's backoff (a second apart by
  // then): the reload must land well inside the 1.5 s the old timer took.
  await app.engine((timeout) => page.waitForFunction(() => document.getElementById("live-label")?.textContent === "Acid Line", null, { timeout, polling: 10 }), { ms: 60_000 });
  await app.reload();
  await bankTab(page, "presets");
  // Away from it first, through the engine, whatever the reload left on the
  // bench.
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(/^Glass Pad/, { timeout }), { ms: 60_000 });
  const opened = await fromMemory("Acid Line", false);
  console.log(`a preset opened just before a reload, played with the engine held: ${opened} ms`);
  expect(opened, "a preset opened just before the reload plays without the engine").toBeLessThan(1500);
  await app.releaseRequests();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(/^Acid Line/, { timeout }), { ms: 60_000 });

  // 2. A patch measured, then a reload at once.
  await app.level("perform");
  await expect(page.locator(".pf-name")).toHaveText("Acid Line");
  await app.engine(
    (timeout) =>
      page.waitForFunction(
        () =>
          /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
          ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired")),
        null,
        { timeout, polling: 10 },
      ),
    { ms: 120_000 },
  );
  expect(await wiredHow(page, "Acid Line"), "measured in this test").toBe("measured");
  const ago = await page.evaluate(() => Math.round(performance.now() - performance.getEntriesByName("auracle:perform-wired").pop().startTime));
  console.log(`reloading ${ago} ms after the measurement landed`);
  await app.reload();
  await bankTab(page, "presets");
  await app.level("patch");
  // Away from Acid Line first, so PERFORM has to find it again.
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(/^Glass Pad/, { timeout }), { ms: 60_000 });
  const wired = await fromMemory("Acid Line", true);
  console.log(`a patch measured just before a reload, wired with the engine held: ${wired} ms`);
  expect(wired, "a measurement taken just before the reload wires the controls").toBeLessThan(1500);
  expect(await wiredHow(page, "Acid Line"), "from the player's cache, not measured again").toBe("cached");
  await app.releaseRequests();
});

test("an offer grown ahead lands the moment Offer is pressed", { tag: "@slow" }, async ({ page, app }) => {
  // Counts the offers the engine hands back, to know when the spare is here
  // (a state, not a guess at how long a loaded machine takes to grow one);
  // the page's own, not perform_budget.js's probes (ids from 8_800_000).
  const spares = async () => (await app.replies("perform_offered")).filter((r) => r.req < 8_000_000 && r.offer && r.offer.tree).length;
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("Glass Pad");
  const OFFER_MS = await app.offerBudget({ waits: 1 });
  // Steady, hands off: the spare grows, behind the shipped wiring's re-check.
  await expect.poll(spares, { timeout: OFFER_MS }).toBeGreaterThanOrEqual(1);
  const ms = await page.evaluate(async () => {
    const pad = document.querySelector(".pf-pad.primary");
    const t0 = performance.now();
    pad.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
    pad.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
    while (!document.querySelector(".pf-offer.ready") && performance.now() - t0 < 90_000) await new Promise((r) => setTimeout(r, 2));
    return performance.now() - t0;
  });
  console.log(`Offer with a spare waiting: ${ms.toFixed(0)} ms`);
  expect(ms, "a spare offer is handed over, not grown").toBeLessThan(300);
});

// A kept wiring holds φ (`z`), and a new DSP or featurizer measures the same
// patch differently: after an update that moved the render namespace (quiver
// 0.4.0 did), a wiring from the player's cache is still played at once, but
// the status line says *re-checking* until it is measured again and replaced,
// never trusted as current. The entry seeded here is stamped the way builds
// before the namespace joined the tag stamped one: the bare observation count,
// which a fresh profile matches.
test("a kept wiring from another build's DSP plays at once and is re-measured", { tag: "@slow" }, async ({ page, app }) => {
  await page.addInitScript(([key, data]) => {
    localStorage.setItem("auracle-perform-wirings", JSON.stringify([[key, { data, rev: 0 }]]));
  }, [acidKey, acid.data]);
  // The shipped file is blocked: the wiring under test is the player's own.
  await page.route("**/perform-wirings.json*", (r) => r.abort());
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  // Opened from PATCH, then PERFORM clicked: the app opens at PERFORM now
  // (Plan-008), where the wiring would be marked before the click.
  await app.level("patch");
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Acid Line" }).first().click();
  await app.engine((timeout) => expect(page.locator("#live-label")).toHaveText("Acid Line", { timeout }), { ms: 60_000 });
  // The rack holds it before PERFORM is shown.
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText("Acid Line", { timeout }), { ms: 60_000 });
  const shown = await app.now();
  const ms = await page.evaluate(async () => {
    const live = () =>
      document.querySelector(".pf-name")?.textContent === "Acid Line" &&
      /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
      ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired"));
    const t0 = performance.now();
    document.querySelector('.rail-stop[data-level="perform"]').click();
    while (!live() && performance.now() - t0 < 60_000) await new Promise((r) => setTimeout(r, 2));
    return performance.now() - t0;
  });
  console.log(`a kept wiring from another build, wired in ${ms.toFixed(0)} ms`);
  expect(ms, "played at once from the kept wiring").toBeLessThan(1500);
  expect(await wiredHow(page, "Acid Line"), "wired from the player's cache").toBe("cached");
  // The re-measurement is engine work (about thirty renders, in the
  // background): two waits on it below, bounded by the budget.
  const RECHECK_MS = await app.offerBudget({ waits: 2 });
  // …and the player is told it is being measured again, under this build,
  // until the new measurement lands.
  const status = page.locator(".pf-status");
  await app.engine((timeout) => expect(status, "the status line says the wiring is re-checked").toHaveText(/re-checking/, { timeout }), { ms: 60_000 });
  await expect(status, "the re-check lands").not.toHaveText(/re-checking/, { timeout: RECHECK_MS });
  await expect(status).toHaveText(/controls reach/);
  // Secondary, internal: the measurement was asked of the engine, and the
  // re-measured wiring replaced the old one, stamped with this build's render
  // namespace (the cache is written 1.5 s after it changes).
  expect((await app.sent({ type: "perform_wire" }, { after: shown })).length, "a measurement was asked for").toBeGreaterThan(0);
  const keptRev = () =>
    page.evaluate((key) => {
      const kept = new Map(JSON.parse(localStorage.getItem("auracle-perform-wirings") || "[]"));
      return String(kept.get(key)?.rev ?? "");
    }, acidKey);
  await expect.poll(keptRev, { timeout: RECHECK_MS, intervals: [1000] }).toMatch(/^0@.+/);
});
