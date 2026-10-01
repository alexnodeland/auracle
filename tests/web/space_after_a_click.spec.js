// Space plays the sound you're playing after a click on any control, and a
// setting's chip on the rack cycles from the keyboard on Enter.
//
// A click leaves a drawn control focused: a rack setting's chip (the VCO's
// wave, the filter's mode), a rack knob, a PERFORM control, the XY pad. The
// global key handler let a focused control keep Space, so Space after a click
// on the wave chip cycled the wave again (the chip's own keydown took it),
// and after a PERFORM control it did nothing at all. Space is the transport
// now unless a native button has keyboard focus (a mouse click blurs one) or
// the focused control's own handler used the key (a bank row opening).
//
// What this claims:
//
// - After a click on the wave chip or the filter-mode chip, Space plays (the
//   output sounds, ▶ lights) and the chip keeps what it says; Space again
//   stops it.
// - A chip focused from the keyboard cycles on Enter, back on ⇧Enter, and
//   leaves Space to the transport. Its tooltip says so.
// - In PERFORM, Space plays after a drag on a control, a click on the XY pad,
//   and a click on a pad (FREEZE stays frozen).
//
// It reads the output level through an analyser on everything the app
// connects to the destination, as patch_audible.spec.js does. What it does
// not claim: which phrase plays (patch_audible.spec.js holds that it is the
// sound as edited, in every view).
const { test, expect } = require("@playwright/test");

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
  try {
    for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"])
      localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 60_000 });
  return errors;
}

async function openPreset(page, name) {
  await page.locator('.viewtab[data-view="play"]').click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await expect(page.locator("#rack-subject")).toContainText(name, { timeout: 60_000 });
  await expect(page.locator("#rack-svg .knob-hit").first()).toBeVisible();
  await expect(page.locator("#rack-play")).toBeEnabled({ timeout: 30_000 });
}

const peakDb = (page) => page.evaluate(() => window.__pwPeakDb());
const focused = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()}${a.getAttribute("role") ? `[role=${a.getAttribute("role")}]` : ""}${a.dataset?.addr ? ` ${a.dataset.addr}` : ""}` : "none";
  });

/** Quiet at the output: nothing held, nothing playing. */
async function quiet(page) {
  await expect.poll(() => peakDb(page), { timeout: 15_000, intervals: [100] }).toBeLessThan(-80);
}

/** Space, and the output sounds within a few seconds; Space again, and it
 *  stops. `where` names the moment for the failure message. */
async function spacePlays(page, where) {
  await quiet(page);
  await page.keyboard.press(" ");
  await expect
    .poll(() => peakDb(page), { timeout: 10_000, intervals: [100], message: `Space plays ${where}` })
    .toBeGreaterThan(-50);
  await page.keyboard.press(" ");
  await quiet(page);
}

/** The rack's chip for the first knob whose address ends in `#site`. */
async function chipOf(page, site) {
  const addr = await page.evaluate((s) => {
    for (const m of window.__aur.wb.rack.modules) {
      const k = m.knobs.find((x) => x.addr.endsWith(`#${s}`));
      if (k) return k.addr;
    }
    return null;
  }, site);
  expect(addr, `the patch has a ${site} setting`).not.toBeNull();
  const g = page.locator(`#rack-svg g[data-addr="${addr}"]`);
  return { addr, g, body: g.locator(".enum-body"), text: g.locator(".enum-text") };
}

test("Space after a click on a wave or filter-mode chip plays the sound and leaves the chip alone", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page);
  await openPreset(page, "Falling Sign");
  for (const site of ["wave", "fkind"]) {
    const chip = await chipOf(page, site);
    const was = (await chip.text.textContent()).trim();
    await chip.body.click();
    await expect(chip.text).not.toHaveText(was);
    const now = (await chip.text.textContent()).trim();
    console.log(`[space_after_a_click] ${site}: ${was} → ${now}, focus on ${await focused(page)}`);
    await expect(page.locator("#rack-play")).toBeEnabled({ timeout: 30_000 });
    await spacePlays(page, `after a click on the ${site} chip`);
    await expect(chip.text, `Space left the ${site} chip alone`).toHaveText(now);
  }
  expect(errors).toEqual([]);
});

test("a setting's chip focused from the keyboard cycles on Enter and back on ⇧Enter, and Space still plays", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page);
  await openPreset(page, "Falling Sign");
  const chip = await chipOf(page, "wave");
  await expect(chip.body.locator("title")).toHaveText(/Enter to cycle/);
  await expect(chip.g).toHaveAttribute("aria-keyshortcuts", "Enter Shift+Enter");
  await expect(chip.text).toHaveText("sqr");
  await chip.g.focus();
  await page.keyboard.press("Enter");
  await expect(chip.text).toHaveText("sin");
  await page.keyboard.press("Shift+Enter");
  await expect(chip.text).toHaveText("sqr");
  expect(await focused(page)).toContain(chip.addr);
  await expect(page.locator("#rack-play")).toBeEnabled({ timeout: 30_000 });
  await spacePlays(page, "with the chip focused");
  await expect(chip.text).toHaveText("sqr");
  expect(errors).toEqual([]);
});

test("in PERFORM, Space plays after a drag on a control, a click on the XY pad, and a click on a pad", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page);
  await openPreset(page, "Falling Sign");
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator("#view-perform")).toBeVisible();

  // A named control, dragged a little and let go: it keeps the focus.
  const ctl = page.locator("#view-perform .pf-knob[role=slider]").first();
  const box = await ctl.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 12, { steps: 4 });
  await page.mouse.up();
  console.log(`[space_after_a_click] a PERFORM control dragged: focus on ${await focused(page)}`);
  await spacePlays(page, "after a drag on a PERFORM control");

  // The XY pad, clicked.
  const xy = page.locator("#view-perform .pf-xy-field");
  const xbox = await xy.boundingBox();
  await page.mouse.click(xbox.x + xbox.width * 0.6, xbox.y + xbox.height * 0.4);
  console.log(`[space_after_a_click] the XY pad clicked: focus on ${await focused(page)}`);
  await spacePlays(page, "after a click on the XY pad");

  // A pad: FREEZE, clicked, stays frozen through Space.
  const freeze = page.locator(".pf-pad", { hasText: "Freeze" });
  await freeze.click();
  await expect(freeze).toHaveAttribute("aria-pressed", "true");
  await spacePlays(page, "after a click on FREEZE");
  await expect(freeze, "Space did not press FREEZE again").toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});
