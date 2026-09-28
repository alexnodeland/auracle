// Framing without rendering: for each beat of a walkthrough, where each camera
// keyframe (film.js `cam`) crops the rehearsal's screenshots, and where each
// callout's point and label land. Prints JSON for framing.py, which draws the
// contact sheets and flags a callout outside its frame.
//
//   node www/video/tools/framing.mjs FILM [BEAT]   (run by framing.py)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const film = process.argv[2];
const only = process.argv[3];
const VIDEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fdir = path.join(VIDEO, "films", film);
const ddir = path.join(VIDEO, "out", film, "dry");
const tl = JSON.parse(fs.readFileSync(`${fdir}/timeline.json`, "utf8"));
let src = fs.readFileSync(`${fdir}/film.js`, "utf8");
src = src.replace(/import\s*\{[^}]*\}\s*from\s*"[^"]*walk\.js";/, `
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function aim(z, x, y) { if (z <= 1) return [z, 0.5, 0.5]; const f = (p, span) => clamp(((p * z) / span - 0.5) / (z - 1), 0, 1); return [z, f(x, 1920), f(y, 1080)]; }
let captured = null;
async function walkthrough(stage, opts) { captured = opts; }
export function plan() { return captured; }`);
const tmp = path.join(os.tmpdir(), `framing-${film}-${process.pid}.mjs`);
fs.writeFileSync(tmp, src);
const mod = await import(tmp);
await mod.build({});
fs.unlinkSync(tmp);
const { plan } = mod.plan();

function wordTime(l, word) {
  const i = l.text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return l.t0;
  if (l.words) return l.words[Math.min(l.text.slice(0, i).split(/\s+/).filter(Boolean).length, l.words.length - 1)];
  return l.t0 + ((l.t1 - l.t0) * i) / l.text.length;
}
function at(b, spec) {
  if (typeof spec === "number") return b.t0 + spec;
  const off = /([+-]\d+(?:\.\d+)?)$/.exec(spec);
  if (off) return at(b, spec.slice(0, off.index)) + Number(off[1]);
  const [id, w] = spec.split(":");
  const l = tl.lines.find((x) => x.id === id);
  return w ? wordTime(l, w) : l.t0;
}
const anchor = (r, side) => {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return side === "top" ? [cx, r.y] : side === "bottom" ? [cx, r.y + r.h] : side === "left" ? [r.x, cy] : side === "right" ? [r.x + r.w, cy] : [cx, cy];
};
const out = [];
for (const p of plan) {
  if (only && p.beat !== only) continue;
  const b = tl.beats.find((x) => x.id === p.beat);
  let meta;
  try { meta = JSON.parse(fs.readFileSync(`${ddir}/${p.shot}.json`, "utf8")); } catch { console.error(`${p.beat}: no rehearsal`); continue; }
  const snaps = (meta.snaps || []).filter((f) => !/setup-failed/.test(f));
  if (!snaps.length) continue;
  const cams = (p.cam || [[0, 1, 0.5, 0.5]]).map(([a, z, fx, fy]) => ({ t: at(b, a), z, fx, fy }));
  cams.forEach((c, i) => {
    const w = 1920 / c.z, h = 1080 / c.z;
    const x0 = c.fx * (c.z - 1) * w, y0 = c.fy * (c.z - 1) * h;
    const img = i === 0 ? snaps[0] : snaps[Math.min(snaps.length - 1, Math.max(1, Math.round((i / Math.max(1, cams.length - 1)) * (snaps.length - 1))))];
    const t = i + 1 < cams.length ? (c.t + cams[i + 1].t) / 2 : Math.max(c.t, b.t1 - 0.5);
    const calls = [];
    for (const co of p.callouts || []) {
      const a0 = at(b, co.at), a1 = co.until != null ? at(b, co.until) : b.t1;
      if (!(t >= a0 && t < a1)) continue;
      const r = co.mark && meta.rects && meta.rects[co.mark];
      if (!r) { calls.push({ text: co.text, missing: co.mark }); continue; }
      let [x, y] = anchor(r, co.side);
      x += co.ox || 0; y += co.oy || 0;
      calls.push({ text: co.text, x, y, tx: x + (co.dx ?? 0), ty: y + (co.dy ?? -90) });
    }
    out.push({ beat: p.beat, i, img: path.join(ddir, img), crop: [x0, y0, w, h], calls });
  });
}
console.log(JSON.stringify(out));
