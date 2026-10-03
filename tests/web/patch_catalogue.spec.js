// PATCH's catalog, on demand in the well (Plan-008 C2a, the mock's
// `pt-cat`), and the thing in hand on the well's top line.
//
// What this claims:
//
// - The catalog is closed at rest. ADD MODULE opens it (and closes it), / opens
//   it with the search focused, Esc and ✕ close it; a new patch opens it.
// - Its search finds modules by sound ("grit" finds distortion and bitcrush).
// - A module clicked is in hand: its sockets light, and the well's top line
//   names it with its price ("prices what, not where") and ▶ to hear it at a
//   socket, says what happens at the socket under the pointer, and Esc puts
//   it down. A module dragged from the catalog onto a socket is placed.
// - θ, what the model thinks of a module, shows only under the model view.
// - What is set aside is the catalog's first group, and SET ASIDE n at the
//   well's foot opens the shelf it can be dragged back from.
const { test, expect } = require("@playwright/test");
const { boot, openPreset, now, replied, warmStartAndFit } = require("./patch_page");
const { modelView } = require("./shell");

const cat = (page) => page.locator("#nodebank");

test("ADD MODULE and / open the catalog, and ✕ and Esc close it", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Glass Pad");
  await expect(cat(page)).toBeHidden();
  await page.locator("#pt-add").click();
  await expect(cat(page)).toBeVisible();
  await expect(page.locator("#pt-add")).toHaveAttribute("aria-expanded", "true");
  // A press on ADD MODULE again closes it.
  await page.locator("#pt-add").click();
  await expect(cat(page)).toBeHidden();
  // / opens it in the search.
  await page.locator("#rack-subject").click();
  await page.keyboard.press("/");
  await expect(cat(page)).toBeVisible();
  await expect(page.locator("#nb-q")).toBeFocused();
  // Searching by sound.
  await page.keyboard.type("grit");
  await expect(page.locator('#nb-groups .nb-item[data-kind="distortion"]')).toBeVisible();
  await expect(page.locator('#nb-groups .nb-item[data-kind="bitcrush"]')).toBeVisible();
  await expect(page.locator('#nb-groups .nb-item[data-kind="reverb"]')).toBeHidden();
  // Esc clears the search, then leaves it, then closes the catalog.
  await page.keyboard.press("Escape");
  await expect(page.locator("#nb-q")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#nb-q")).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cat(page)).toBeHidden();
  // ✕ closes it too.
  await page.locator("#pt-add").click();
  await page.locator("#nb-collapse").click();
  await expect(cat(page)).toBeHidden();
  // A new patch opens it, and leaving the new patch closes it.
  await page.locator("#patch-new-btn").click();
  await expect(cat(page)).toBeVisible({ timeout: 30_000 });
  await page.locator("#patch-back").click();
  await expect(cat(page)).toBeHidden({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("a module in hand is priced on the well's top line, can be heard at a socket, and Esc puts it down", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Glass Pad");
  await page.locator("#pt-add").click();
  await page.locator('#nb-groups .nb-item[data-kind="distortion"]').click();
  const line = page.locator("#pick-chip");
  await expect(line).toBeVisible();
  await expect(line.locator(".pick-armed b")).toHaveText(/distortion/i);
  await expect(line.locator(".sd-price")).toHaveAttribute("title", /prices what you are adding, not where/);
  await expect(line.locator("#pv-play")).toBeVisible();
  // The top line starts past the open catalog.
  const c = await cat(page).boundingBox();
  const l = await line.boundingBox();
  expect(l.x).toBeGreaterThanOrEqual(c.x + c.width);
  // At a socket: what happens there, and ▶ hears it there.
  const jack = page.locator("#rack-svg .jack.legal[data-childkey]").last();
  await jack.hover();
  await expect(line.locator(".pick-chip-text")).toHaveText(/^insert after /i);
  await line.locator("#pv-play").click();
  await expect(page.locator(".pv-label")).toContainText(/rendering|hear it/, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(line).toBeHidden();
  await expect(page.locator("#rack-svg .jack.legal")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a module dragged from the catalog onto a socket is placed there", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Glass Pad");
  await page.locator("#pt-add").click();
  const before = await page.locator('#rack-svg g.mod-group[data-kind="distortion"]').count();
  const item = page.locator('#nb-groups .nb-item[data-kind="distortion"]');
  await item.scrollIntoViewIfNeeded(); // the catalog scrolls
  const chip = await item.boundingBox();
  const t0 = await now(page);
  await page.mouse.move(chip.x + 20, chip.y + chip.height / 2);
  await page.mouse.down();
  await page.mouse.move(chip.x + 40, chip.y + chip.height / 2, { steps: 4 });
  // The cable is out: the sockets it can go into are lit. The one nearest the
  // well's middle, clear of the edges (where a drag pans the camera), and its
  // ring itself (its label sits beside it).
  await expect(page.locator("#rack-svg .jack.legal[data-childkey]").first()).toBeVisible();
  const target = await page.evaluate(() => {
    const f = document.getElementById("rack-scroll").getBoundingClientRect();
    const cx = f.left + f.width / 2;
    const cy = f.top + f.height / 2;
    let best = null;
    for (const j of document.querySelectorAll("#rack-svg .jack.legal[data-childkey]")) {
      const c = [...j.querySelectorAll(":scope > circle")].pop();
      const r = (c || j).getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.d) best = { x, y, d };
    }
    return best;
  });
  expect(target).not.toBeNull();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await replied(page, "bench", t0);
  await expect(page.locator('#rack-svg g.mod-group[data-kind="distortion"]')).toHaveCount(before + 1, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("θ shows under the model view only, and what is set aside is the catalog's first group", async ({ page }) => {
  test.setTimeout(240_000);
  // θ needs a fitted model: the warm start's three picks and the fit.
  const errors = await boot(page, { warmed: false });
  await warmStartAndFit(page);
  await openPreset(page, "Reese");
  await page.locator("#pt-add").click();
  const theta = page.locator('#nb-groups .nb-item[data-kind="filter"] .ni-theta');
  await expect(theta).toBeHidden();
  await modelView(page, true);
  await expect(theta).toBeVisible();
  await modelView(page, false);
  await expect(theta).toBeHidden();
  // Set the filter aside from its structure menu: SET ASIDE 1 at the foot, and
  // the catalog's first group.
  await expect(page.locator("#tray-chip")).toBeHidden();
  const filter = page.locator('#rack-svg .rack-controls g[data-kind="filter"] .mod-menu-btn').first();
  await filter.click({ force: true });
  const t0 = await now(page);
  await page.locator("#ctx-menu .cm-item").filter({ hasText: /^set aside/ }).click();
  await replied(page, "bench", t0);
  await expect(page.locator("#tray-chip")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#tray-n")).toHaveText("1");
  const first = await page.evaluate(() => [...document.querySelectorAll("#nb-body > section:not(.hidden), #nb-body > #nb-groups")][0]?.id);
  expect(first).toBe("nb-aside");
  await expect(page.locator("#nb-aside-list .tray-item")).toHaveCount(1);
  // The chip opens the shelf to drag from.
  await page.locator("#tray-chip").click();
  await expect(page.locator("#tray")).toBeVisible();
  await expect(page.locator("#tray-items .tray-item .t-jack")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#tray")).toBeHidden();
  expect(errors).toEqual([]);
});
