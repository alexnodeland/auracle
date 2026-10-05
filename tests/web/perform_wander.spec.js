// Wander answers at once, says what it is doing on itself, and its own drag
// is not a hand on the sound.
//
// Before: turning Wander into drift left 21 s of nothing (the first move
// waited a whole period, 36 s at the left of the zone, counted from the last
// move), turning it counted as a touch so the status line said "paused — your
// hands are on it" as it was being turned up, the dial had no marks for its
// zones, the middle zone was called "offer" like the pad and Blend's end, and
// its state was one more clause on PERFORM's status line.
//
// Now: let go in a new zone and the first move is asked for about 1.5 s later;
// Wander's drag never pauses it; three ticks mark ideas, drift and roam; the
// line under Wander carries its state ("drift · next in 9 s", "paused 3 s",
// "frozen") with a thin arc counting down; the status line keeps to the patch.
//
// PERFORM's requests to the engine are read through the fixture's tap.
const { test, expect } = require("./fixtures");

test("Wander answers a second and a half after it is let go, and says what it is doing on itself", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot();
  await app.openOnPerform("Glass Pad");
  const wander = page.locator('.pf-knob[data-i="7"]');
  const sub = wander.locator(".pf-k-sub");
  await page.evaluate(() => {
    const s = document.querySelector(".pf-status");
    window.__statuses = [s.textContent];
    new MutationObserver(() => window.__statuses.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true });
    const w = document.querySelector('.pf-knob[data-i="7"] .pf-k-sub');
    window.__wander = [[performance.now(), w.textContent]];
    new MutationObserver(() => window.__wander.push([performance.now(), w.textContent])).observe(w, { childList: true, characterData: true, subtree: true });
  });

  // Three ticks where ideas, drift and roam begin.
  const ticks = await wander.locator(".pf-k-zone").getAttribute("d");
  expect((ticks.match(/M/g) || []).length).toBe(3);

  // The middle zone is "ideas".
  await wander.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp"); // 0.20
  await expect(sub).toHaveText(/^ideas/);
  await page.keyboard.press("Home");
  await expect(sub).toHaveText("still", { timeout: 5_000 });

  // Drag it into drift. While it is held it is not "paused".
  const b = await wander.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  const grabbed = await app.now();
  await page.mouse.down();
  await page.mouse.move(x, y - 99, { steps: 12 }); // +0.55: drift
  expect(await sub.textContent()).toMatch(/^drift/);
  const released = await app.now();
  await page.mouse.up();
  await page.mouse.move(10, 10);
  // The first move is asked for about 1.5 s after the hand left.
  await expect.poll(async () => (await app.sent({ type: "perform_drift" }, { after: released })).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const firstMove = (await app.sent({ type: "perform_drift" }, { after: released }))[0]._at - released;
  console.log(`Wander let go in drift → first move asked for after ${(firstMove / 1000).toFixed(2)} s`);
  expect(firstMove).toBeGreaterThan(1_000);
  expect(firstMove).toBeLessThan(3_000);

  // After the move, it counts down to the next one, with its arc.
  await app.engine((timeout) => expect(sub).toHaveText(/^(drift · next in \d+ s|nothing better nearby)$/, { timeout }), { ms: 120_000 });
  await app.engine((timeout) => expect(sub).toHaveText(/^drift · next in \d+ s$/, { timeout }), { ms: 30_000 });
  // The arc starts empty (the wait has barely begun) and fills as the
  // countdown repaints, so it is waited for rather than read the instant the
  // caption appears.
  await expect(wander.locator(".pf-k-count")).toHaveAttribute("d", /^M /, { timeout: 5_000 });

  // Hands on another control: Wander says it is paused, and for how long.
  const bright = page.locator('.pf-knob[data-i="0"]');
  await bright.click();
  await expect(sub).toHaveText(/^paused [1-4] s$/, { timeout: 2_000 });
  await expect(sub).not.toHaveText(/^paused/, { timeout: 8_000 });

  // Frozen: a tap on Wander (the FREEZE pad went into it, Plan-008 C1).
  await wander.click();
  await expect(sub).toHaveText("frozen");
  await wander.click();

  const statuses = await page.evaluate(() => window.__statuses);
  expect(statuses.filter((t) => /wander|paused|drifting|gliding|walking/.test(t)), "the status line keeps to the patch").toEqual([]);
  const said = await page.evaluate(() => window.__wander);
  const whileTurned = said.filter(([t]) => t >= grabbed && t <= released).map(([, w]) => w);
  expect(whileTurned.filter((w) => /paused/.test(w)), "turning Wander is not a touch").toEqual([]);
  expect(said.some(([, w]) => /^drift · (walking…|gliding)/.test(w)), "it said it was moving").toBe(true);
});

// A tap on Wander freezes it (#80 named the pad FREEZE and the state
// *frozen*); its tooltip and how it works said a tap would "hold" it.
test("Wander's tooltip and how it works say a tap freezes it", async ({ page, app }) => {
  await app.boot();
  await app.level("perform");
  const wander = page.locator('.pf-knob[data-i="7"]');
  await expect(wander).toHaveAttribute("title", /Tap to freeze it\./);
  await expect(wander).not.toHaveAttribute("title", /hold it/);
  await page.locator(".pf-why-btn").click();
  const body = page.locator(".pf-why-body");
  await expect(body).toContainText("Tap Wander to freeze it;");
  await expect(body).not.toContainText("to hold it");
});
