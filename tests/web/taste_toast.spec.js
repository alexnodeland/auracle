// A toast on TASTE never takes the pointer meant for a sound on the map
// (#412). The toast lane sits bottom right, over the map's corner on a
// narrow window, where a hovered sound under it used to reach the toast and
// not the map, so its card never opened. On TASTE a toast lets the pointer
// through, and only its buttons take a click.
//
// The toast is one the engine's reply raises with nothing else moving: a
// `pool_trimmed` (a generation that ended while you were away), handed to
// main with the map and status it already has (`app.inject`), retiring a
// sound other than the one pointed at. The sound is put under the toast's
// place by moving the lane over it
// (the pool's map puts a sound in that corner only on some deals), and the
// check is that the toast is really there and the card opens.
const { test, expect, goLevel } = require("./fixtures");

test("a sound under a toast on TASTE's map opens its card", async ({ page, app }) => {
  await app.boot({ warmed: false, random: 20261001 });
  await app.warmStart([1, 4, 7]);
  await app.filled();
  await goLevel(page, "taste");
  await expect(page.locator("#view-taste")).toBeVisible();
  await expect.poll(async () => !!(await app.facts()).views?.map?.points?.length).toBe(true);
  const facts = await app.facts();
  // Where the map draws each sound, by the app's own layout.
  const pos = await page.evaluate(async (points) => {
    const geom = await import("/taste-geom.js");
    const well = document.getElementById("taste-well");
    const W = Math.max(200, well.clientWidth);
    const H = Math.max(160, well.clientHeight);
    const pts = points.filter((p) => p.id != null);
    // The track's room along the map's foot is kept from the start.
    const f = geom.mapFrame(W, H, pts.length, { track: true });
    return Object.fromEntries([...geom.mapLayout(pts, f.box, f.minD)].map(([id, q]) => [id, q]));
  }, facts.views.map.points);
  const box = await page.locator("#taste-crt").boundingBox();
  // The sound nearest the lane's corner, bottom right, is the one pointed at;
  // the toast retires another (the one farthest from it), so the sound under
  // the toast is still on the map, as it would be.
  const order = Object.keys(pos).sort((a, b) => (pos[b].x + pos[b].y) - (pos[a].x + pos[a].y));
  const id = order[0];
  const gone = order[order.length - 1];
  const at = { x: box.x + pos[id].x, y: box.y + pos[id].y };

  await app.inject({ type: "pool_trimmed", retired: [Number(gone)], views: facts.views, status: facts.status });
  const toast = page.locator("#toasts .toast", { hasText: "The generation that was breeding when you left has ended." });
  await expect(toast).toBeVisible();
  // Move the lane so the toast's text sits over the sound, then, at once,
  // check it covers the point and that the point reaches the map.
  const probe = await page.evaluate(([x, y]) => {
    const over = () => {
      const t = [...document.querySelectorAll("#toasts .toast")].find((e) => e.textContent.includes("breeding when you left"));
      if (!t || !t.isConnected || t.classList.contains("out")) return false;
      const r = t.getBoundingClientRect();
      return x > r.left && x < r.right && y > r.top && y < r.bottom;
    };
    const t = [...document.querySelectorAll("#toasts .toast")].find((e) => e.textContent.includes("breeding when you left"));
    const m = t.querySelector(".toast-msg").getBoundingClientRect();
    const h = document.getElementById("toasts");
    h.style.right = `${parseFloat(h.style.right || "16") - (x - (m.left + m.width / 2))}px`;
    h.style.bottom = `${parseFloat(h.style.bottom || "16") - (y - (m.top + m.height / 2))}px`;
    const covered = over();
    return { covered, hit: document.elementFromPoint(x, y)?.id || null };
  }, [at.x, at.y]);
  expect(probe.covered, "the toast stands over the sound").toBe(true);
  expect(probe.hit, "pointing there reaches the map").toBe("taste-crt");

  // The sound's card opens, with the toast still over it.
  await page.mouse.move(1, 1);
  await page.mouse.move(at.x, at.y);
  const plate = page.locator("#taste-plate");
  await expect(plate).toHaveAttribute("data-id", String(id));
  await expect(plate).toHaveClass(/\bon\b/);
  expect(
    await page.evaluate(([x, y]) => {
      const over = () => {
        const t = [...document.querySelectorAll("#toasts .toast")].find((e) => e.textContent.includes("breeding when you left"));
        if (!t || !t.isConnected || t.classList.contains("out")) return false;
        const r = t.getBoundingClientRect();
        return x > r.left && x < r.right && y > r.top && y < r.bottom;
      };
      return over();
    }, [at.x, at.y]),
    "the toast was still over the sound when its card opened",
  ).toBe(true);
});
