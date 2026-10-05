// A search control's offer is aimed the way the control was turned, and B
// says how far it went (ADR-008).
//
// Pinned in a real browser against the real engine, on Glass Pad, where Grit
// is a search control in the seeded runs (nothing in it is rough to turn):
//
// - Turning Grit up past its notch and letting go asks the engine for an offer
//   carrying the control and the way it was turned, says so ("growing a
//   grittier offer"), and B counts while it grows.
// - When it lands, B's strip says how far it moved that way, in the model's
//   amber: "grittier by 0.8σ", or plainly "not grittier: …".
// - The Offer button's offer is not aimed: its request carries no control,
//   and its B strip says nothing about a direction.
//
// What it does not claim: that this particular offer did get grittier. The
// engine's test (`an_aimed_offer_moves_the_way_it_was_turned`) and the census
// (`make offer-census`) measure that over seeds; here the strip must say
// whichever is true.
//
// What PERFORM asks the engine for is read through the fixture's tap.
const { test, expect, PERFORM_SEED } = require("./fixtures");

/** Drag a knob vertically by `dy` px (negative is up), and let go. */
async function drag(page, loc, dy) {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 10 });
  await page.mouse.up();
}

test("a search control's offer is aimed the way it was turned, and B says how far it went", async ({ page, app }) => {
  test.setTimeout(100_000); // about 43 to 46 s on CI: an aimed offer and a plain one grown
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("Glass Pad", { wired: true });
  // Two offers grown below, an aimed one (up to three walks) and a plain one.
  const OFFER_MS = await app.offerBudget({ waits: 2 });
  const grit = page.locator('.pf-knob[data-i="4"]');
  await expect(grit, "Grit is a search control on Glass Pad").toHaveClass(/\bsearch\b/);
  const strip = page.locator(".pf-offer");
  // The offers asked for from here (`perform_offer`), as the tap kept them.
  const offers = async (after) => (await app.sent({ type: "perform_offer" }, { after })).map((m) => ({ control: m.control, sign: m.sign, bg: !!m.bg }));
  const turned = await app.now();

  // Turned up past the notch and let go: an aimed request, said as such.
  await drag(page, grit, -90);
  await expect(grit).toHaveAttribute("aria-valuenow", "0.00");
  await expect(page.locator("#toasts")).toContainText("growing a grittier offer instead", { timeout: 5_000 });
  // Asked for once, aimed: Grit (index 4), up. Spares grown in the
  // background are the Offer button's, and carry no control.
  await expect.poll(async () => (await offers(turned)).some((p) => p.control === 4), { timeout: 5_000 }).toBe(true);
  const asked = (await offers(turned)).filter((p) => p.control != null);
  expect(asked).toEqual([{ control: 4, sign: 1, bg: false }]);
  // B says what it is growing, and counts once it takes a while.
  await expect(strip).toContainText(/growing a grittier offer…|grittier by|not grittier/, { timeout: 5_000 });

  // Landed: B reports the move along Grit, in amber, in one of two sentences.
  await expect(strip).toHaveClass(/\bready\b/, { timeout: OFFER_MS });
  const aim = strip.locator(".pf-offer-aim");
  await expect(aim).toHaveText(/^(grittier by \d+\.\dσ|not grittier: this walk found no way there\. Turn it again to try another)$/);
  const colour = await aim.evaluate((e) => getComputedStyle(e).color);
  const amber = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--phos-b-dim)";
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(colour, "the move is the model's measurement: amber").toBe(amber);
  const said = await aim.textContent();
  if (said.startsWith("grittier by")) expect(Number(said.match(/by (\d+\.\d)σ/)[1])).toBeGreaterThan(0);

  // The Offer button passes on it and asks undirected: no control on the
  // request, no direction in B.
  const pressed = await app.now();
  await page.locator(".pf-pad", { hasText: /^(Offer|Next)/ }).first().click();
  await expect(strip).toHaveClass(/\bready\b/, { timeout: OFFER_MS });
  await expect(strip.locator(".pf-offer-aim")).toHaveCount(0);
  const plain = await offers(pressed);
  expect(plain.every((p) => p.control == null && p.sign == null)).toBe(true);
});
