// The menu bar's film chip: on a first visit it offers the tour, then each
// view's own film the first time that view is opened, and folds to "▶ film"
// afterwards. It links only films publish.py has listed in data-films, and
// stays out of a film's own recording (?film).
//
// The app ships with data-films="{}" until films are published, so these
// tests serve index.html with a list injected, as publish.py would write it.
const { test, expect, goLevel } = require("./fixtures");

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

/** A first visit (the warm start and the tours not yet seen), seeded, at
 *  `query`. */
async function boot(app, query = "") {
  await app.boot({ warmed: false, seen: false, query });
}

/** The warm start a fresh visitor gets, 500 ms after the veil drops, its
 *  cards on their way from the engine. */
const warmStartShown = (app) =>
  app.engine((timeout) => expect(app.page.locator("#warmstart")).toBeVisible({ timeout }), { ms: 60_000 });

test("the chip offers the tour first, then each view's film once, then folds", async ({ page, app }) => {
  await withFilms(page);
  await boot(app);
  const chip = page.locator("#film-chip");
  const link = page.locator("#fc-link");
  // Behind the warm start it waits, folded.
  await warmStartShown(app);
  await expect(chip).not.toHaveClass(/\bopen\b/);
  await page.locator("#warm-skip").click();

  // The very first thing it says is the tour.
  await expect(chip).toHaveClass(/\bopen\b/);
  await expect(link).toContainText("take the tour · 2:31");
  await expect(link).toHaveAttribute("href", /first-session\.html#film-tour$/);

  // Another view, the first time: that view's own film.
  await goLevel(page, "evolve");
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
  await app.reload();
  await goLevel(page, "evolve");
  await expect(chip).not.toHaveClass(/\bopen\b/);
  // A view not yet visited still gets its note.
  await goLevel(page, "taste");
  await expect(chip).toHaveClass(/\bopen\b/);
  await expect(link).toContainText("watch TASTE in depth · 4:55");
});

test("a film's own recording never shows the chip", async ({ page, app }) => {
  await withFilms(page);
  await boot(app, "?film");
  // A fresh visitor gets the warm start 500 ms after the veil drops, film or
  // not: wait for it rather than checking once, or it opens over the tabs.
  await warmStartShown(app);
  await page.locator("#warm-skip").click();
  await goLevel(page, "taste");
  await expect(page.locator("#film-chip")).toBeHidden();
});

test("with no films published, there is no chip", async ({ page, app }) => {
  await boot(app);
  // A fresh visitor always gets the warm start, 500 ms after the veil drops:
  // wait for it rather than checking once, or it opens over the tabs below.
  await warmStartShown(app);
  await page.locator("#warm-skip").click();
  for (const v of ["perform", "patch", "evolve", "taste", "learning"]) {
    await goLevel(page, v);
    await expect(page.locator("#film-chip")).toBeHidden();
  }
});
