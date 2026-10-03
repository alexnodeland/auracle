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
// A spec reaches the engine only by wrapping `Worker` before `main.js` runs:
// here, to record what PERFORM asks it for.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");
const budget = require("./perform_budget.js");

const INIT = `(() => {
  const Orig = window.Worker;
  const posts = (window.__pfOffers = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && m.type === "perform_offer")
          posts.push({ control: m.control, sign: m.sign, bg: !!m.bg });
        return post(m, t);
      };
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
})();`;

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await budget.watch(page);
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  return errs;
}

async function openOnPerform(page, name) {
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30_000 });
}

async function wired(page) {
  await page.waitForFunction(
    () =>
      /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
      ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired")),
    null,
    { timeout: 120_000 },
  );
}

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

test("a search control's offer is aimed the way it was turned, and B says how far it went", async ({ page }) => {
  test.setTimeout(360_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  await wired(page);
  // Two offers grown below, an aimed one (up to three walks) and a plain one.
  const OFFER_MS = await budget.offerBudget(page, { waits: 2 });
  const grit = page.locator('.pf-knob[data-i="4"]');
  await expect(grit, "Grit is a search control on Glass Pad").toHaveClass(/\bsearch\b/);
  const strip = page.locator(".pf-offer");
  await page.evaluate(() => (window.__pfOffers.length = 0));

  // Turned up past the notch and let go: an aimed request, said as such.
  await drag(page, grit, -90);
  await expect(grit).toHaveAttribute("aria-valuenow", "0.00");
  await expect(page.locator("#toasts")).toContainText("growing a grittier offer instead", { timeout: 5_000 });
  // Asked for once, aimed: Grit (index 4), up. Spares grown in the
  // background are the Offer button's, and carry no control.
  await page.waitForFunction(() => window.__pfOffers.some((p) => p.control === 4), null, { timeout: 5_000 });
  const asked = await page.evaluate(() => window.__pfOffers.filter((p) => p.control != null));
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
  await page.evaluate(() => (window.__pfOffers.length = 0));
  await page.locator(".pf-pad", { hasText: /^(Offer|Next)/ }).first().click();
  await expect(strip).toHaveClass(/\bready\b/, { timeout: OFFER_MS });
  await expect(strip.locator(".pf-offer-aim")).toHaveCount(0);
  const plain = await page.evaluate(() => window.__pfOffers);
  expect(plain.every((p) => p.control == null && p.sign == null)).toBe(true);
  expect(errs).toEqual([]);
});
