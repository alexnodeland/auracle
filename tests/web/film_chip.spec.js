// The menu bar's film chip: on a first visit it offers the tour, then each
// view's own film the first time that view is opened, and folds to "▶ film"
// afterwards. It links only films publish.py has listed in data-films, and
// stays out of a film's own recording (?film).
//
// The app ships with data-films="{}" until films are published, so these
// tests serve index.html with a list injected, as publish.py would write it.
const { test, expect } = require("@playwright/test");

const FILMS = { tour: "2:31", "view-perform": "5:12", "view-patch": "5:40", "view-evolve": "4:40", "view-taste": "4:55" };

async function withFilms(page) {
  await page.route(
    (url) => url.pathname === "/" || url.pathname.endsWith("/index.html"),
    async (route) => {
      const res = await route.fetch();
      const attr = JSON.stringify(FILMS).replace(/"/g, "&quot;");
      const body = (await res.text()).replace(
        /class="film-chip hidden" id="film-chip" data-films="[^"]*"/,
        `class="film-chip" id="film-chip" data-films="${attr}"`,
      );
      await route.fulfill({ response: res, body });
    },
  );
}

async function boot(page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
}

test("the chip offers the tour first, then each view's film once, then folds", async ({ page }) => {
  test.setTimeout(180_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await withFilms(page);
  await boot(page);
  const chip = page.locator("#film-chip");
  const link = page.locator("#fc-link");
  // Behind the warm start it waits, folded.
  await expect(page.locator("#warmstart")).toBeVisible({ timeout: 60_000 });
  await expect(chip).not.toHaveClass(/\bopen\b/);
  await page.locator("#warm-skip").click();

  // The very first thing it says is the tour.
  await expect(chip).toHaveClass(/\bopen\b/);
  await expect(link).toContainText("take the tour · 2:31");
  await expect(link).toHaveAttribute("href", /first-session\.html#film-tour$/);

  // Another view, the first time: that view's own film.
  await page.locator('.viewtab[data-view="evolve"]').click();
  await expect(chip).toHaveClass(/\bopen\b/);
  await expect(link).toContainText("watch EVOLVE in depth · 4:40");
  await expect(link).toHaveAttribute("href", /views\/evolve\.html#film-view-evolve$/);

  // Folded by hand, it stays a quiet ▶ film that still links the view's film.
  await page.locator("#fc-close").click();
  await expect(chip).not.toHaveClass(/\bopen\b/);
  await expect(page.locator("#fc-text")).toHaveText("film");
  await expect(link).toHaveAttribute("href", /views\/evolve\.html#film-view-evolve$/);
  await expect(link).toHaveAttribute("title", /EVOLVE in depth · 4:40/);

  // Once per view: back in EVOLVE after a reload, nothing is said.
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator('.viewtab[data-view="evolve"]').click();
  await expect(chip).not.toHaveClass(/\bopen\b/);
  // A view not yet visited still gets its note.
  await page.locator('.viewtab[data-view="taste"]').click();
  await expect(chip).toHaveClass(/\bopen\b/);
  await expect(link).toContainText("watch TASTE in depth · 4:55");
  expect(errs).toEqual([]);
});

test("a film's own recording never shows the chip", async ({ page }) => {
  test.setTimeout(180_000);
  await withFilms(page);
  await boot(page, "?film");
  if (await page.locator("#warm-skip").isVisible()) await page.locator("#warm-skip").click();
  await page.locator('.viewtab[data-view="taste"]').click();
  await expect(page.locator("#film-chip")).toBeHidden();
});

test("with no films published, there is no chip", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);
  if (await page.locator("#warm-skip").isVisible()) await page.locator("#warm-skip").click();
  for (const v of ["perform", "play", "evolve", "taste"]) {
    await page.locator(`.viewtab[data-view="${v}"]`).click();
    await expect(page.locator("#film-chip")).toBeHidden();
  }
});
