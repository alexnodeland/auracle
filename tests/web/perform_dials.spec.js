// PERFORM's dials and the pads beside them (#532, #523).
//
// - A dial or the XY pad pressed with the mouse takes the focus with no
//   ring, once a key has been pressed too (any key in Chromium, Tab in
//   Firefox, made focus a script gives count as the keyboard's: the ring
//   came up under the mouse). A dial reached with Tab still shows it, and
//   its arrows still turn it.
// - PEEK and TAKE pressed (by their keys: the pads wait, dashed) while an
//   offer grows say it is still growing, not "Nothing offered yet". B held
//   until the offer lands plays it at once, all of B; TAKE pressed while it
//   grew takes nothing. Every offer is kept from the engine (the tap's
//   `holdRequests`, from boot, so a spare cannot land first) and B's is
//   answered by the spec.
const { readFileSync } = require("fs");
const path = require("path");
const { test, expect, goLevel, PERFORM_SEED } = require("./fixtures");

test("a dial or the XY pad pressed with the mouse shows no focus ring, and a dial reached with Tab shows one", async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await goLevel(page, "perform");
  await app.reached();
  const dial = page.locator('.pf-knob[data-i="0"]');
  // A key first: after one, focus a script gives counts as the keyboard's
  // (Tab in Firefox, any key in Chromium), and that drew the ring.
  await page.keyboard.press("Tab");
  const b = await dial.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 30, { steps: 5 });
  // Held: the dial has the keys, and no ring.
  await expect(dial).toBeFocused();
  await expect(dial).toHaveCSS("outline-style", "none");
  await page.mouse.up();
  // Let go: a pointer's turn leaves no focus (↵ is KEEP).
  await expect(dial).not.toBeFocused();
  await expect(dial).toHaveCSS("outline-style", "none");

  // The XY pad, the same: pressed after a key, it keeps the focus (its
  // arrows), with no ring.
  await page.locator(".pf-xy-btn").click();
  const field = page.locator(".pf-xy-field");
  await expect(field).toBeVisible();
  await page.keyboard.press("Tab");
  const f = await field.boundingBox();
  await page.mouse.move(f.x + f.width * 0.3, f.y + f.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width * 0.6, f.y + f.height * 0.4, { steps: 5 });
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS("outline-style", "none");
  await page.mouse.up();
  await expect(field).toHaveCSS("outline-style", "none");
  await page.locator(".pf-xy-btn").click();
  await expect(field).toBeHidden();

  // Reached with the keyboard (Shift+Tab back from the next dial), the ring
  // shows, and the arrows turn it.
  await page.locator('.pf-knob[data-i="1"]').focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dial).toBeFocused();
  await expect(dial).toHaveCSS("outline-style", "solid");
  const before = await dial.getAttribute("aria-valuetext");
  await page.keyboard.press("ArrowUp");
  await expect(dial).not.toHaveAttribute("aria-valuetext", before);
  await expect(dial).toHaveCSS("outline-style", "solid");
});

test("PEEK and TAKE pressed while an offer grows say it is growing, and B held until it lands plays all of it", async ({ page, app }) => {
  // What B is told to play at, each time (the worklet's `b_mix`).
  await page.addInitScript(() => {
    window.__bMix = [];
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (m, ...rest) {
      if (m && m.type === "b_mix") window.__bMix.push(m.mix);
      return post.call(this, m, ...rest);
    };
  });
  // Every offer kept from the engine, from boot: a spare grown ahead too.
  await app.holdRequests("perform_offer");
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("Glass Pad");
  await page.keyboard.press("n");
  const b = page.locator(".pf-offer");
  await expect(b).toContainText("growing an offer…");
  const t0 = await app.toastMark();
  // PEEK held (its key: the pad waits, dashed), then TAKE.
  await page.keyboard.down("b");
  await app.toast("Still growing an offer. Keep holding Peek to hear it as it lands.", { since: t0 });
  await page.keyboard.press("Shift+Enter");
  await app.toast("Still growing an offer. Take it once it’s in B.", { since: t0 });
  const said = await app.toasts(t0);
  expect(said.filter((t) => /Nothing offered/.test(t)), "nothing said there was nothing offered").toEqual([]);
  const lastMix = () => page.evaluate(() => window.__bMix[window.__bMix.length - 1]);
  // B lands, B still held: every offer out is answered with Glass Pad's own
  // tree, which B then plays.
  const glass = JSON.parse(readFileSync(path.join(__dirname, "../../apps/web/perform-wirings.json"), "utf8")).presets.find((p) => p.name === "Glass Pad");
  const out = await app.sent({ type: "perform_offer" });
  expect(out.length, "an offer is out").toBeGreaterThan(0);
  for (const m of out) await app.inject({ type: "perform_offered", req: m.req, re: m.rid, offer: { tree: JSON.parse(m.tree), makeup: glass.makeup, taste: false, diff: [] } });
  await expect(b).toHaveClass(/\bready\b/);
  await expect.poll(lastMix, { message: "B is all of what is heard while PEEK is held" }).toBe(1);
  await page.keyboard.up("b");
  await expect.poll(lastMix, { message: "let go, B goes back to Blend's home" }).toBe(0);
  // TAKE pressed while it grew took nothing: B is still in B.
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad");
  await expect(b).toHaveClass(/\bready\b/);
});
