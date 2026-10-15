// A toast on TASTE never takes the pointer meant for a sound on the map
// (#412). The toast lane sits bottom right, over the map's corner on a
// narrow window, where a hovered sound under it used to reach the toast and
// not the map, so its card never opened. On TASTE a toast lets the pointer
// through, and only its buttons take a click.
//
// The toast is one the engine's reply raises with nothing else moving: a
// `pool_trimmed` (a generation that ended while you were away), handed to
// main with the map and status it already has (`app.inject`). The sound is put under the toast's place by moving the lane over it
// (the pool's map puts a sound in that corner only on some deals), and the
// check is that the toast is really there and the card opens.
const { test, expect, goLevel } = require("./fixtures");

test("a sound under a toast on TASTE's map opens its card", async ({ page, app }) => {
  await app.boot({ warmed: false, random: 20261001 });
  await app.warmStart([1, 4, 7]);
  await app.filled();
  await goLevel(page, "taste");
  await expect(page.locator("#view-taste")).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__tap.facts.views?.map?.points?.length)).toBe(true);
  // Where the map draws each sound, by the app's own layout.
  const pos = await page.evaluate(async () => {
    const geom = await import("/taste-geom.js");
    const well = document.getElementById("taste-well");
    const W = Math.max(200, well.clientWidth);
    const H = Math.max(160, well.clientHeight);
    const pts = window.__tap.facts.views.map.points.filter((p) => p.id != null);
    const track = document.getElementById("taste-time").classList.contains("on");
    const f = geom.mapFrame(W, H, pts.length, { track });
    return Object.fromEntries([...geom.mapLayout(pts, f.box, f.minD)].map(([id, q]) => [id, q]));
  });
  const box = await page.locator("#taste-crt").boundingBox();
  // The sound nearest the lane's corner, bottom right.
  const id = Object.keys(pos).sort((a, b) => (pos[b].x + pos[b].y) - (pos[a].x + pos[a].y))[0];
  const at = { x: box.x + pos[id].x, y: box.y + pos[id].y };

  // The toast, the lane moved so its text sits over that sound.
  const facts = await page.evaluate(() => ({ views: window.__tap.facts.views, status: window.__tap.facts.status }));
  await app.inject({ type: "pool_trimmed", retired: [Number(id)], ...facts });
  const toast = page.locator("#toasts .toast", { hasText: "The generation that was breeding when you left has ended." });
  await expect(toast).toBeVisible();
  const msg = await toast.locator(".toast-msg").boundingBox();
  await page.evaluate(([dx, dy]) => {
    const h = document.getElementById("toasts");
    h.style.right = `${parseFloat(h.style.right || "16") - dx}px`;
    h.style.bottom = `${parseFloat(h.style.bottom || "16") - dy}px`;
  }, [at.x - (msg.x + msg.width / 2), at.y - (msg.y + msg.height / 2)]);
  const covered = await page.evaluate(([x, y]) => {
    const t = document.querySelector("#toasts .toast:last-child");
    const r = t.getBoundingClientRect();
    return x > r.left && x < r.right && y > r.top && y < r.bottom;
  }, [at.x, at.y]);
  expect(covered, "the toast stands over the sound").toBe(true);

  // Pointing there reaches the map, and the sound's card opens.
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id || null, [at.x, at.y])).toBe("taste-crt");
  await page.mouse.move(1, 1);
  await page.mouse.move(at.x, at.y);
  const plate = page.locator("#taste-plate");
  await expect(plate).toHaveAttribute("data-id", String(id));
  await expect(plate).toHaveClass(/\bon\b/);
});
