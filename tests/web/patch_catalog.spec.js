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
// - A pointer's ✕ (on the catalog, on TEACH) leaves the focus nowhere, so
//   Space plays; the keyboard's goes back to the chip that opened it.
// - Which way your taste leans on a module shows under the model view only:
//   the longer description and the keyboard's card leave it out at rest.
// - Beside the open catalog, at 1000 and 1440 px, the line is one line: the
//   price and ▶ whole, the reasons cut short; and the module in hand is drawn
//   at a socket clear of every module (C2a drew it over the MIX), and stays
//   drawn under a still pointer, even on a socket's edge.
const { test, expect } = require("@playwright/test");
const { boot, openPreset, now, replied, warmStartAndFit } = require("./patch_page");
const { modelView, openCatalog } = require("./shell");

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
  // At a socket: what happens there, and ▶ hears it there. The pointer goes
  // to a lit socket's ring where nothing stands over it (the catalog covers
  // the well's left).
  const at = await page.evaluate(() => {
    for (const j of [...document.querySelectorAll("#rack-svg .jack.legal[data-childkey]")].reverse()) {
      const r = [...j.querySelectorAll(":scope > circle")].pop().getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (j.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  });
  expect(at).not.toBeNull();
  await page.mouse.move(at.x, at.y);
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

test("a pointer's ✕ on the catalog or on TEACH leaves the focus nowhere, so Space plays; the keyboard's goes back to the chip", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await page.locator("#pt-add").click();
  await expect(page.locator("#nodebank")).toBeVisible();
  await page.locator("#nb-collapse").click();
  await expect(page.locator("#nodebank")).toBeHidden();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  // Space, with the focus nowhere, is the transport: the face at OUT plays
  // (or waits for the lane, lit at once), and the catalog stays shut.
  await page.keyboard.press(" ");
  await expect.poll(() => page.evaluate(() => {
    const b = document.querySelector("#rack-play");
    return b.classList.contains("playing") || b.classList.contains("pending");
  })).toBe(true);
  await expect(page.locator("#nodebank")).toBeHidden();
  // The keyboard: ADD MODULE, then ✕ from the keyboard, and the focus is back.
  await page.locator("#pt-add").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#nb-q")).toBeFocused();
  await page.locator("#nb-collapse").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pt-add")).toBeFocused();
  // TEACH, once a pair is dealt: the pointer's ✕ lets the focus go too.
  await expect(page.locator("#pt-teach")).toBeVisible({ timeout: 90_000 });
  await page.locator("#pt-teach").click();
  await expect(page.locator("#play-duel")).toBeVisible();
  await page.locator("#pd-fold").click();
  await expect(page.locator("#play-duel")).toBeHidden();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  expect(errors).toEqual([]);
});

test("which way your taste leans on a module shows under the model view only, in the description and the keyboard's card", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await openCatalog(page);
  await page.locator('#nb-groups .nb-item[data-kind="chorus"]').hover();
  await expect(page.locator("#pt-read.open .pr-more")).toBeVisible();
  await expect(page.locator("#pt-read .sd-model")).toBeHidden();
  await page.locator('#nb-groups .nb-item[data-kind="chorus"]').focus();
  await expect(page.locator("#nb-spec")).toBeVisible();
  await expect(page.locator("#nb-spec .sp-model")).toBeHidden();
  // The card stands beside the catalog, not at the window's edge.
  const card = await page.locator("#nb-spec").boundingBox();
  const cat = await page.locator("#nodebank").boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(cat.x + cat.width);
  expect(card.x).toBeLessThan(cat.x + cat.width + 40);
  // MODEL on: the lean is there.
  await page.locator("#model-btn").click();
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
  await page.locator('#nb-groups .nb-item[data-kind="chorus"]').hover();
  await expect(page.locator("#pt-read .sd-model")).toBeVisible();
  expect(errors).toEqual([]);
});

test("closing the catalog puts down a socket ⋯ handed it: the line goes, and the next module is only in hand", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').focus();
  await page.keyboard.press("F2");
  await page.locator("#ctx-menu .cm-item").filter({ hasText: /^insert after/ }).click();
  await expect(cat(page)).toBeVisible();
  await expect(page.locator("#pick-armed")).toContainText("the socket is chosen");
  await page.locator("#nb-collapse").click();
  await expect(cat(page)).toBeHidden();
  await expect(page.locator("#pick-chip")).toBeHidden();
  // Open again: a module clicked is in hand, its sockets lit, not placed.
  const posted = () => page.evaluate(() => window.__pwPosted.filter((p) => p.type === "edit_structure").length);
  const before = await posted();
  await openCatalog(page);
  await page.locator('#nb-groups .nb-item[data-kind="distortion"]').click();
  await expect(page.locator("#pick-armed b")).toHaveText(/distortion/i);
  await expect(page.locator("#rack-svg .jack.legal").first()).toBeVisible();
  expect(await posted()).toBe(before);
  expect(errors).toEqual([]);
});

for (const [w, h] of [[1000, 760], [1440, 900]]) test(`beside the open catalog at ${w} px the armed line stays one line with its price and ▶ whole, and the module in hand is drawn clear of every module`, async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: w, height: h });
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  {
    await openCatalog(page);
    await page.locator('#nb-groups .nb-item[data-kind="distortion"]').click();
    const line = page.locator("#pick-chip");
    await expect(line).toBeVisible();
    // Every lit socket a pointer can reach (the catalog covers the well's
    // left), found where it is now: the camera refits after a resize.
    const reach = (key) => page.evaluate((k) => {
      for (const j of document.querySelectorAll("#rack-svg .jack.legal[data-childkey]")) {
        if (k != null && j.getAttribute("data-childkey") !== k) continue;
        const r = [...j.querySelectorAll(":scope > circle")].pop().getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (j.contains(document.elementFromPoint(x, y))) return { x, y, key: j.getAttribute("data-childkey") };
      }
      return null;
    }, key);
    const keys = await page.evaluate(() => [...document.querySelectorAll("#rack-svg .jack.legal[data-childkey]")].map((j) => j.getAttribute("data-childkey")));
    let reached = 0;
    for (const key of keys) {
      // Wait for the camera to be still (the catalog opening refits it, on
      // its tween): the socket where it is twice running is where it stays.
      let at = null;
      await expect.poll(async () => {
        const a = await reach(key);
        const b = await new Promise((r) => setTimeout(r, 250)).then(() => reach(key));
        at = b;
        return !a || !b ? "gone" : Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 0.5 ? "still" : "moving";
      }, { timeout: 15_000 }).not.toBe("moving");
      if (!at) continue;
      reached += 1;
      await page.mouse.move(at.x, at.y);
      // The line names this socket's module before anything is read.
      const title = await page.evaluate((k) => window.__aur.wb.rack.modules.find((m) => m.key === k)?.title || "", at.key);
      await expect(line.locator(".pick-chip-text")).toHaveText(new RegExp(`^insert after ${title}$`, "i"));
      const got = await page.evaluate(() => {
        const box = (e) => e.getBoundingClientRect();
        const chip = box(document.getElementById("pick-chip"));
        const play = box(document.getElementById("pv-play"));
        const price = document.querySelector("#pick-chip .sd-price");
        const ghost = [...document.querySelectorAll("#rack-svg .pick-ghost")].find((g) => !g.classList.contains("pick-lead"));
        const g = ghost ? box(ghost) : null;
        const over = g ? [...document.querySelectorAll("#rack-svg .rack-plates .mod-plate")].map(box)
          .filter((q) => g.left < q.right - 1 && q.left < g.right - 1 && g.top < q.bottom - 1 && q.top < g.bottom - 1).length : -1;
        return {
          height: chip.height,
          playIn: play.width >= 18 && play.left >= chip.left && play.right <= chip.right,
          priceWhole: price.querySelector(".pr-mute") ? true : price.scrollWidth <= price.clientWidth + 1,
          over,
        };
      });
      expect(got.height, `${w}: one line`).toBeLessThan(50);
      expect(got.playIn, `${w}: ▶ whole, inside the line`).toBe(true);
      expect(got.priceWhole, `${w}: the price whole`).toBe(true);
      expect(got.over, `${w}: the ghost at ${at.key} covers no module`).toBe(0);
    }
    expect(reached, `${w}: a lit socket to point at`).toBeGreaterThan(0);
    // A still pointer anywhere on a lit socket keeps it (and the module in
    // hand drawn once): resting on the ring's edge used to enter and leave
    // it about thirty times a second as its stroke changed with its state.
    const edge = await page.evaluate(() => {
      // Between the ring's outer edge at rest (stroke 1.6) and lit (2): r + 0.9
      // rack units from its centre.
      for (const j of document.querySelectorAll("#rack-svg .jack.legal[data-childkey]")) {
        const el = [...j.querySelectorAll(":scope > circle")].pop();
        const c = el.getBoundingClientRect();
        const r = Number(el.getAttribute("r")) || 0;
        if (!r || !c.width) continue;
        const k = c.width / (2 * r);
        const x = c.left + c.width / 2 + (r + 0.9) * k;
        const y = c.top + c.height / 2;
        const at = document.elementFromPoint(x, y);
        if (at && at.closest("#rack-svg") && !at.closest(".nodebank")) return { x, y };
      }
      return null;
    });
    if (edge) {
      await page.mouse.move(edge.x, edge.y);
      const drawn = await page.evaluate(() => new Promise((resolve) => {
        let n = 0;
        const mo = new MutationObserver((ms) => { for (const m of ms) for (const x of m.addedNodes) if (x.classList && x.classList.contains("pick-ghost")) n++; });
        mo.observe(document.getElementById("rack-svg"), { childList: true, subtree: true });
        setTimeout(() => { mo.disconnect(); resolve(n); }, 1500);
      }));
      expect(drawn, `${w}: the module in hand drawn again under a still pointer`).toBeLessThanOrEqual(2);
    }
    await page.keyboard.press("Escape");
    await expect(line).toBeHidden();
  }
  expect(errors).toEqual([]);
});
