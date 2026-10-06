"""The taught session behind the TASTE film, and the page scripts that build it.

TASTE shows what the model has learned, so every chapter needs a session that
has learned something, and the same one in every take. gen_shots.py builds it
off camera in each shot's set-up, from the pieces here:

- WATCH, appended to shotgen's seeded INIT: a passive listener on the engine
  worker (as www/capture-screens.mjs does) that keeps the latest taste views
  and calibration in `window.__vt`. The app's own handlers see the same
  messages in the same order. It lets a set-up find a dot, a row or a bin by
  what it is, not by pixels.
- The listener: one consistent taste, held for the whole session. It likes
  dark, slow sounds (warm pads, washes, drones) and bright, struck ones (glass
  plucks, bells), the example the TASTE guide page gives, and dislikes
  anything noisy or gritty. A pool patch is named `<character> <role>` from
  its measured sound (crates/auracle-session/src/naming.rs), so judging the
  name is judging the sound, the same way every time; a preset is judged by
  its name from a table.
- Page scripts (`js(...)`, run by footage.mjs's `log`/`eval` ops): the warm
  start answered by the listener, N duels, stars on named rows, duels to the
  edge of a refit, and invisible 2-px markers over what a shot points at.
  The markers replay the app's own drawing code (main.js drawMapTab,
  drawDirectionsTab, drawTrustFromEngine, drawStylesTab), so if that layout
  changes, change it here too.

Nothing here writes to the app's state except through its own controls: the
clicks are the buttons a person would press, and the markers are
pointer-events: none and invisible.
"""
import json

# The latest taste views and calibration the engine worker sent, kept in
# window.__vt, and the last pair it dealt ahead (`ahead`; `aheads` counts
# them): main.js deals the next pair while one is on the table, and the
# teaching scripts wait for that deal before they answer (`settle`).
# Passive: an extra "message" listener on each worker.
WATCH = ("(() => { const N = window.Worker; const vt = (window.__vt = { views: null, calib: null, fits: 0, ahead: null, aheads: 0 }); "
         "window.Worker = class extends N { constructor(...a) { super(...a); this.addEventListener('message', (e) => { "
         "const m = e.data; if (!m || typeof m.type !== 'string') return; if (m.views) vt.views = m.views; "
         "if (m.type === 'duel' && m.ahead) { vt.ahead = m.pair || null; vt.aheads += 1; } "
         "if (m.type === 'fitted') vt.fits += 1; if (m.type === 'calibration') vt.calib = m.calib; }); } }; })();")

# ---------------------------------------------------------------- the listener
# character: [dark-and-slow affinity, bright-and-struck affinity]; role: the same
# pair for the envelope; NZ: what noise or grit costs. A patch's liking is its
# better island, minus the grit. The topology signature only breaks ties.
LISTENER = r"""
const CH = { Warm: [1, 0], Round: [0.8, 0], Murky: [0.3, 0], Fat: [0.5, 0.1], Soft: [0.4, 0.3],
  Gritty: [0.1, 0.1], Glass: [0, 1], Bright: [0.1, 0.8], Noisy: [0, 0.1] };
const RO = { Swell: [1, 0], Pad: [1, 0], Wash: [0.9, 0], Drone: [0.8, 0.1], Key: [0.3, 0.5],
  Bell: [0.1, 0.9], Pluck: [0, 1], Stab: [0, 0.7], Lead: [0.1, 0.3] };
const NZ = { Gritty: 0.6, Noisy: 0.8, Murky: 0.3 };
const PRE = {
  'Cathedral': 1, 'Glass Pad': 0.9, 'Detune Dream': 0.7, 'Ember': 1, 'Slow Weather': 1, 'Morph Pad': 0.8,
  'Sweep Machine': 0.5, 'Sea Change': 0.9, 'Pump Room': 0.4, 'Tidal': 0.8, 'Nine Against Four': 0.6,
  'Pluck': 1, 'Bell Jar': 1, 'Tine': 1, 'Coin Toss': 0.8, 'Gut String': 0.7, 'Ghost Bell': 0.9,
  'Choirboy': 0.6, 'Twelve String': 0.8,
  'Long Room': 0.5, 'Cloud Chamber': 0.5, 'Loom': 0.3, 'Glass Rain': 0.4, 'Long Way Down': 0.3,
  'Held Under': 0.2, 'Sub & Sparkle': 0.1, 'First Bass': 0, 'Reese': -0.3, 'Acid Line': -0.6,
  'Anvil': -0.8, 'Iron Bass': -0.6,
  'Folded Lead': -0.8, 'Hornet': -1, 'Solo Flight': -0.2, 'Telegraph': -0.8, 'Wobble Board': -0.6,
  'Falling Sign': -0.4, 'Loudhailer': -0.8, 'Fifth Wheel': -0.4, 'Ask The Dice': -0.4,
  'Noise Wash': -1, 'Dub Echo': -0.2, 'Static Ocean': -1, 'Rotor': -0.8, 'Handheld': -0.5,
  'Jet Wash': -1, 'Vox Machina': -0.5, 'One Way': -0.4,
  'Flint': -0.6, 'Deadfall': -0.6, 'Ricochet': -0.8, 'Heartbeat': -0.5, 'Morse': -0.6, 'Ticker': -0.6,
  'Woodblock': -0.3, 'Gated Snare': -1,
  'Two Minds': -0.5, 'Ceiling': -0.3, 'Undertow': 0.2, 'Sour Mash': -1, 'Wrong Number': -1, 'Inside Out': -0.7,
};
const SIG = { lp: 0.1, ladr: 0.1, cho: 0.1, rvb: 0.1, dly: 0.05, sin: 0.05, noiz: -0.2, fold: -0.2, crsh: -0.2,
  clip: -0.1, ring: -0.1, drv: -0.1 };
const liking = (name, sig = '') => {
  const n = String(name || '').replace(/\s+\d+$/, '').trim();
  let u;
  if (n in PRE) u = PRE[n];
  else {
    const [c, r] = n.split(/\s+/);
    const ch = CH[c], ro = RO[r];
    u = ch && ro ? Math.max(ch[0] * ro[0], ch[1] * ro[1]) - (NZ[c] || 0) : 0;
  }
  const tie = String(sig || '').split(/[·+\s]+/).reduce((s, t) => s + (SIG[t] || 0), 0);
  return u + 0.1 * Math.max(-1, Math.min(1, tie));
};
"""

# ---------------------------------------------------------------- page helpers
HELPERS = r"""
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
// The app's own TASTE lengths (dot sizes, bars, whiskers), from the module
// main.js draws with, so a marker lands where the drawing does.
const GEOM = await import(new URL('taste-geom.js', document.baseURI).href);
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out after ' + Math.round(ms / 1000) + ' s waiting for ' + what);
    await sleep(150);
  }
}
const idle = () => !$('wm-lamp').classList.contains('thinking');
const nameOf = (s) => ($('name-' + s).childNodes[0]?.textContent || '').trim();
const sigOf = (s) => $('name-' + s).querySelector('.dn-sig')?.textContent || '';
const dealt = () => !$('choose-a').disabled && !$('choose-b').disabled;
const named = () => ['a', 'b'].every((s) => { const t = nameOf(s); return t && !t.startsWith('#') && !/^candidate/.test(t); });
const pairIds = () => [...document.querySelectorAll('#name-a .dn-id, #name-b .dn-id')].map((e) => e.textContent).join();
const tableIds = () => [...document.querySelectorAll('#name-a .dn-id, #name-b .dn-id')].map((e) => Number(e.textContent.replace(/\D/g, '')));
const samePair = (p, q) => !!(p && q && p.length === 2 && q.length === 2 && p.includes(q[0]) && p.includes(q[1]));
// The app deals the next pair while one is on the table (deal.js
// dealAhead), once the table's two sounds are in, and a pick or a skip puts
// that pair up at once. A pick made while that deal is still on its way races
// it: the next two pairs can then come up in either order, and the session
// would differ from take to take. So the listener answers only once the pair
// on the table has its sounds and the pair behind it is dealt, the way a
// person who plays both first always does. A deal that repeats the table's
// pair, or the pair whose pick is still in its undo window (__vtPicked), is
// refused by the app and asked again, so it does not count; after three
// refusals the app stops asking, and so does this wait.
async function settle() {
  await until(() => dealt() && !document.querySelector('#play-a.pending, #play-b.pending'), 120000, 'the pair to render');
  const ids = tableIds();
  await until(() => { const a = window.__vt.ahead; return a && !samePair(a, ids) && !samePair(a, window.__vtPicked); }, 30000, 'the next pair, dealt ahead').catch(() => {});
}
// Answer the pair on the table ('a' or 'b'), remembering which pair it was.
function choose(side) {
  window.__vtPicked = tableIds();
  $('choose-' + side).click();
}
// Skip the pair on the table (records nothing), and wait for the next.
async function skip() {
  const was = pairIds();
  $('skip-duel').click();
  await until(() => dealt() && pairIds() !== was, 60000, 'a new pair');
}
// Every pool dot on the map, where drawMapTab puts it, in page pixels.
const dots = () => {
  const V = window.__vt && window.__vt.views;
  const c = $('taste-crt');
  if (!V || !V.map || !V.map.points || !c) return [];
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = c.width, h = c.height, k = r.width / w;
  const pts = V.map.points;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = 34 * dpr;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (v) => pad + ((v - x0) / Math.max(1e-9, x1 - x0)) * (w - 2 * pad);
  const sy = (v) => pad + ((v - y0) / Math.max(1e-9, y1 - y0)) * (h - 2 * pad);
  const fitted = !!V.styles;
  const names = new Map((V.ranked || []).map((q) => [q.id, q.name]));
  const unsure = GEOM.mapUnsureScale(pts.filter((p) => p.id != null).map((p) => p.utility_std));
  return pts.filter((p) => p.id != null).map((p) => ({
    id: p.id, name: names.get(p.id) || ('#' + p.id), x: Math.round(r.left + sx(p.x) * k), y: Math.round(r.top + sy(p.y) * k),
    glow: fitted ? 1 / (1 + Math.exp(-p.utility)) : null, std: p.utility_std, style: p.style,
    radius: +GEOM.mapDotRadius(unsure(p.utility_std)).toFixed(1) }));
};
// An invisible 2-px marker, for the pointer ops and the marks.
const marker = (id, d) => {
  let m = document.getElementById(id);
  if (!m) { m = document.createElement('div'); m.id = id; document.body.appendChild(m); }
  Object.assign(m.style, { position: 'fixed', left: (d.x - 1) + 'px', top: (d.y - 1) + 'px', width: '2px', height: '2px',
    pointerEvents: 'none', opacity: '0', zIndex: '0' });
  m.dataset.name = d.name; m.dataset.id = d.id;
  return d.name + (d.id !== '' ? ' #' + d.id : '') + ' at ' + d.x + ',' + d.y
    + (d.glow != null ? ' glow ' + d.glow.toFixed(2) : '') + (d.std != null ? ' std ' + d.std.toFixed(2) : '')
    + (d.radius != null ? ' r ' + d.radius : '');
};
const markAt = (id, x, y, name) => marker(id, { x, y, name: name || id, id: '' });
// The canvas, as the drawing code sees it.
const crt = () => { const c = $('taste-crt'); const r = c.getBoundingClientRect();
  return { c, r, w: c.width, h: c.height, k: r.width / c.width, dpr: window.devicePixelRatio || 1 }; };
const byShare = () => (window.__vt.views.styles || []).map((s, k) => ({ ...s, k })).sort((a, b) => b.share - a.share);
// DIRECTIONS (drawDirectionsTab): its rows, and each style's bar and drawn
// whisker, on the one scale taste-geom.js fits them to.
const dirRows = () => {
  const { r, w, h, k, dpr } = crt();
  const styles = byShare().filter((s) => s.share >= 0.08);
  const chosen = new Map();
  for (const s of styles) [...s.theta].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean)).slice(0, 7).forEach((t) => {
    const sc = Math.abs(t.mean); if (!chosen.has(t.name) || chosen.get(t.name) < sc) chosen.set(t.name, sc); });
  const names = [...chosen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n]) => n);
  const cx = w * 0.60, usable = w * 0.30, rowH = h / (names.length + 1), lane = 7 * dpr;
  const scale = GEOM.directionsScale(styles.flatMap((s) => s.theta.filter((t) => names.includes(t.name))), usable);
  const X = (px) => Math.round(r.left + (cx + px) * k);
  return names.map((name, i) => {
    const y = rowH * (i + 1);
    const bars = styles.map((s, si) => {
      const t = s.theta.find((q) => q.name === name); if (!t) return null;
      const yy = y + (si - (styles.length - 1) / 2) * lane;
      const b = GEOM.directionsBar(t, scale, usable);
      return { k: s.k, mean: +t.mean.toFixed(3), std: +t.std.toFixed(3), len: Math.abs(b.len) / usable,
        x: X(b.len), y: Math.round(r.top + yy * k), lo: X(b.lo), hi: X(b.hi), clip: b.clipLo || b.clipHi,
        // Where the drawn whisker ends past the centre line, and by how much
        // (a share of the half-width), when its interval crosses zero.
        cross: b.crossesZero, far: b.crossesZero ? X(t.mean < 0 ? b.hi : b.lo) : null,
        over: b.crossesZero ? Math.min(-b.lo, b.hi) / usable : 0 };
    }).filter(Boolean);
    return { name, y: Math.round(r.top + y * k), cx: X(0), label: Math.round(r.left + (cx - usable - 10 * dpr) * k), bars };
  });
};
// TRUST (drawTrustFromEngine): the square, its buckets, and the lines under it.
const trustGeo = () => {
  const { r, w, h, k, dpr } = crt();
  const E = window.__vt.calib || {};
  const pad = 56 * dpr, x0 = pad, y0 = pad * 0.5, side = Math.min(w - pad * 2.4, h - pad * 2.0);
  const sx = (p) => x0 + p * side, sy = (p) => y0 + (1 - p) * side;
  const P = (x, y) => ({ x: Math.round(r.left + x * k), y: Math.round(r.top + y * k) });
  return { n: E.n, brier: E.brier, skill: E.skill, check_n: E.check_n, check_skill: E.check_skill,
    diag: P(sx(0.62), sy(0.62)), xaxis: P(sx(0.5), y0 + side + 26 * dpr),
    head: P(x0, y0 + side + 48 * dpr), check: P(x0, y0 + side + 66 * dpr),
    bins: (E.bins || []).filter((b) => b.n).map((b) => ({ n: b.n, p: +b.predicted.toFixed(3), o: +b.observed.toFixed(3), ...P(sx(b.predicted), sy(b.observed)) })) };
};
// STYLES (drawStylesTab): each lens's title line, in share order.
const styleTitles = () => {
  const { r, h, k, dpr } = crt();
  const st = byShare(); const blockH = h / st.length;
  return st.map((s, row) => ({ k: s.k, share: +s.share.toFixed(3), x: Math.round(r.left + 30 * dpr * k), y: Math.round(r.top + (row * blockH + 20 * dpr) * k) }));
};
"""


def js(body):
    """An async page script: the listener and the helpers, then `body`."""
    return "(async () => {" + LISTENER + HELPERS + body + "})()"


# ---------------------------------------------------------------- teaching
# The warm start, answered by the listener: its three favourite cards.
WARM = js(r"""
await until(() => !$('warmstart').classList.contains('hidden') && document.querySelectorAll('.warm-cell .warm-item').length === 9, 180000, 'the warm start');
const cards = [...document.querySelectorAll('.warm-cell .warm-item')].map((e, i) => ({ i, e, name: e.querySelector('.wi-name')?.textContent.trim() }));
const ranked = cards.map((c) => ({ ...c, s: liking(c.name) })).sort((p, q) => q.s - p.s || p.i - q.i);
const picked = ranked.slice(0, 3);
for (const p of picked) { p.e.click(); await sleep(300); }
await sleep(300);
$('warm-go').click();
return cards.map((c) => c.name).join(', ') + '  ->  ' + picked.map((p) => p.name).join(', ');
""")


def teach(n):
    """`n` duels in EVOLVE, each answered by the listener; then the last
    vote's undo window, and any refit it armed."""
    return js(r"""
const N = %d;
const out = [];
let n = 0, redeals = 0;
while (n < N) {
  await until(dealt, 300000, 'a pair to be dealt');
  await settle();
  // A side still named by a bare #id has no bank row yet: re-deal (skip records nothing).
  const ok = await until(named, 20000, 'names').catch(() => false);
  if (!ok) {
    if (++redeals > 40) throw new Error('forty pairs in a row with an unnamed side');
    await skip().catch(() => {});
    continue;
  }
  redeals = 0;
  const a = nameOf('a'), b = nameOf('b');
  const ua = liking(a, sigOf('a')), ub = liking(b, sigOf('b'));
  const side = ub > ua ? 'b' : 'a';
  choose(side);
  n += 1;
  out.push(n + ' ' + a + ' ' + ua.toFixed(2) + ' | ' + b + ' ' + ub.toFixed(2) + ' -> ' + side.toUpperCase());
  await sleep(250);
}
await sleep(8000);
await until(idle, 300000, 'the model to finish');
return out.join('\n');
""" % n)


def teach_to_edge(most=12):
    """Duels until the meter reads "1 more pick and it redraws your taste
    map": the next pick, on camera, lands a refit."""
    return js(r"""
const out = [];
for (let i = 0; i < %d; i++) {
  await until(dealt, 300000, 'a pair');
  await sleep(600);
  await until(() => !$('duel-mid').classList.contains('learning'), 60000, 'the refit beat');
  await settle();
  if (/^1 more pick/.test($('teach-copy').textContent)) return out.join('\n') + '\n(at the edge: ' + $('teach-copy').textContent + ')';
  const a = nameOf('a'), b = nameOf('b');
  const side = liking(b, sigOf('b')) > liking(a, sigOf('a')) ? 'b' : 'a';
  choose(side);
  out.push(a + ' | ' + b + ' -> ' + side);
  await sleep(300);
}
throw new Error('never reached the edge of a refit: ' + $('teach-copy').textContent);
""" % most)


def stars_named(pairs):
    """Stars on named rows of the evolution bank: [[name, n], …]."""
    return js("document.querySelector(\".bf[data-f='pool']\").click();\nawait sleep(600);\nconst want = %s;\n" % json.dumps(pairs) + r"""
const out = [];
for (const [name, n] of want) {
  const row = [...document.querySelectorAll('#bank-list .bank-item')].find((e) => e.querySelector('.bi-name')?.textContent.trim() === name);
  if (!row) throw new Error('no bank row ' + name);
  row.querySelector(".star[data-s='" + n + "']").click();
  out.push(name + ' ' + n);
  await sleep(500);
}
return out.join(', ');
""")


def stars_by_taste(love=3, hate=2):
    """Stars from the listener on the evolution bank: five on the `love` rows
    it likes most, one on the `hate` rows it likes least."""
    return js(r"""
document.querySelector(".bf[data-f='pool']").click();
await sleep(600);
const rows = [...document.querySelectorAll('#bank-list .bank-item')].map((e) => ({ e, name: e.querySelector('.bi-name')?.textContent.trim() }))
  .map((r) => ({ ...r, u: liking(r.name) }));
const by = rows.slice().sort((a, b) => b.u - a.u);
const want = [...by.slice(0, %d).map((r) => [r, 5]), ...by.slice(-%d).map((r) => [r, 1])];
const out = [];
for (const [r, n] of want) { r.e.querySelector(".star[data-s='" + n + "']").click(); out.push(r.name + ' ' + n); await sleep(500); }
return out.join(', ');
""" % (love, hate))


# The first pair is dealt at "playable", while the pool is still filling, and
# the pair the app deals ahead behind it as soon as the first pair's sounds
# are in. Which pairs those were used to depend on how far the fill got; since
# #211 each deal made while the pool fills draws from a fixed number of its
# first sounds and waits for them, so they are the same in every take.
# Skipped twice once the pool is full (skip records nothing), the pair on the
# table is the one dealt behind those two, and every later deal is the same in
# every take. (One skip used to be enough, when a pair was dealt only once the
# one before it was answered.)
REDEAL = js(r"""
await until(dealt, 120000, 'a pair');
const out = [nameOf('a') + ' | ' + nameOf('b')];
for (let i = 0; i < 2; i++) {
  await settle();
  await skip();
  out.push(nameOf('a') + ' | ' + nameOf('b'));
}
await until(named, 20000, 'names').catch(() => {});
out[out.length - 1] = nameOf('a') + ' | ' + nameOf('b');
return out.join('  ->  ') + '  (' + window.__vt.aheads + ' dealt ahead)';
""")

# The pair on the table re-dealt with skip (which records nothing) until one
# side is a sound the listener likes and neither is one it dislikes, of two
# different kinds, so the two auditions on camera are musical; then both
# rendered.
NICE_PAIR = js(r"""
const out = [];
for (let i = 0; i < 40; i++) {
  await until(dealt, 120000, 'a pair');
  await settle();
  await until(named, 20000, 'names').catch(() => {});
  const a = nameOf('a'), b = nameOf('b'), ua = liking(a), ub = liking(b);
  out.push(a + ' | ' + b);
  if (Math.max(ua, ub) >= 0.5 && Math.min(ua, ub) >= 0 && a.split(' ')[1] !== b.split(' ')[1]) break;
  if (i === 39) throw new Error('no musical pair in forty deals: ' + out.join(' / '));
  await skip();
}
await until(() => !document.querySelector('#play-a.pending, #play-b.pending'), 90000, 'the pair to render');
return out.join('  /  ');
""")

# The listener's side of the pair on the table, tagged for a real click.
PICK = js(r"""
const side = liking(nameOf('b'), sigOf('b')) > liking(nameOf('a'), sigOf('a')) ? 'b' : 'a';
$('choose-a').removeAttribute('data-vt'); $('choose-b').removeAttribute('data-vt');
$('choose-' + side).dataset.vt = 'pick';
return nameOf('a') + ' | ' + nameOf('b') + ' -> ' + side;
""")

# The side the model rates lower (the bank's %), tagged: a pick against it.
AGAINST = js(r"""
const pct = (name) => { const row = [...document.querySelectorAll('#bank-list .bank-item')].find((e) => e.querySelector('.bi-name')?.textContent.trim() === name);
  return row ? parseInt(row.querySelector('.bi-pct').textContent, 10) : NaN; };
await until(() => !$('choose-a').disabled, 60000, 'a pair');
const a = nameOf('a'), b = nameOf('b');
const side = pct(a) < pct(b) ? 'a' : 'b';
$('choose-a').removeAttribute('data-vt'); $('choose-b').removeAttribute('data-vt');
$('choose-' + side).dataset.vt = 'against';
return a + ' ' + pct(a) + '% vs ' + b + ' ' + pct(b) + '% -> ' + side;
""")

# ---------------------------------------------------------------- markers
def mark_dots(pairs):
    """Markers over named dots: [[marker id, patch name], …]."""
    body = "const out = [];\n"
    for mid, name in pairs:
        body += ("{ const d = dots().find((q) => q.name === %s); if (!d) throw new Error('no dot named ' + %s + ' among ' + dots().map((q) => q.name).join(', ')); out.push(marker(%s, d)); }\n"
                 % (json.dumps(name), json.dumps(name), json.dumps(mid)))
    return js(body + "return out.join(' | ');\n")


# The dot the cold open plays: among the brightest quarter, the first the
# listener likes (a musician clicks a bright dot that sounds good to them).
BEST = js(r"""
const ds = dots().filter((q) => q.glow != null).map((q) => ({ ...q, like: liking(q.name) })).sort((a, b) => b.glow - a.glow);
if (!ds.length) throw new Error('no fitted dot');
const d = ds.slice(0, Math.ceil(ds.length / 4)).find((q) => q.like >= 0.5) || ds.find((q) => q.like >= 0.3) || ds[0];
return marker('vt-best', d) + ' (brightest: ' + ds[0].name + ' ' + ds[0].glow.toFixed(2) + ')';
""")

# DIRECTIONS: the rows dir4 names (two sounds and a part), the rows every
# style pulls the same way, the
# longest bar each way, and the longest bar whose drawn whisker plainly
# crosses the centre line. Every row is logged with its bars (x: the interval
# crosses zero; >: a whisker cut at the edge), so the narration can be checked
# against the screen.
DIR_MARKS = js(r"""
const rows = dirRows();
const base = (n) => String(n).split(':')[0];
// A row this session does not show gets its marker in the canvas's corner,
// named "absent", so every mark resolves and the log says which are real.
const { r: box } = crt();
const absent = (id) => markAt(id, Math.round(box.left + 2), Math.round(box.top + 2), 'absent');
// Rows where every style's bar points the same way, strongest first.
const agree = rows.filter((q) => q.bars.length > 1 && (q.bars.every((b) => b.mean < 0) || q.bars.every((b) => b.mean > 0)))
  .map((q) => ({ q, side: q.bars[0].mean < 0 ? 'away' : 'toward', m: Math.min(...q.bars.map((b) => Math.abs(b.mean))) }))
  .sort((p, q) => q.m - p.m);
if (agree[0]) markAt('vt-agree', agree[0].q.label + 4, agree[0].q.y, agree[0].q.name); else absent('vt-agree');
// dir4's two kinds of row, whichever this session shows: what you hear (a
// measurement of the sound: main.js NICE_NAMES, its first group) and what the
// patch is built from (a count of one kind of module, n_…). The topmost of
// each is marked, other than the row dir3 points at when there is another.
const HEARD = new Set(['centroid_mean', 'centroid_std', 'rolloff_mean', 'flatness_mean', 'flux_mean', 'zcr_mean', 'rms_mean',
  'rms_std', 'crest', 'attack_s', 'tail_ratio', 'bass_fraction', 'held_centroid_std', 'high_ratio', 'chord_flatness_delta',
  'motion_slow', 'motion_mid', 'motion_fast']);
const kind = (test) => { const all = rows.filter((q) => test(base(q.name))); return all.find((q) => !agree[0] || q !== agree[0].q) || all[0]; };
const heard = kind((k) => HEARD.has(k)), built = kind((k) => k.startsWith('n_'));
const words = [];
if (heard) { markAt('vt-heard', heard.label + 4, heard.y, heard.name); words.push('heard ' + heard.name); } else absent('vt-heard');
if (built) { markAt('vt-built', built.label + 4, built.y, built.name); words.push('built ' + built.name); } else absent('vt-built');
const all = rows.flatMap((q) => q.bars.map((b) => ({ ...b, row: q.name })));
const right = all.filter((b) => b.mean > 0).sort((p, q) => q.mean - p.mean)[0];
const left = all.filter((b) => b.mean < 0).sort((p, q) => p.mean - q.mean)[0];
markAt('vt-right', right.x, right.y, right.row);
markAt('vt-left', left.x, left.y, left.row);
const crossing = all.filter((b) => b.cross).sort((p, q) => q.len - p.len);
const guess = crossing.find((b) => b.over >= 0.03) || crossing[0];
if (guess) markAt('vt-guess', guess.far, guess.y, guess.row); else absent('vt-guess');
return JSON.stringify({ named: words, agree: agree.map((a) => a.q.name + ' ' + a.side + ' ' + a.m.toFixed(3)),
  right: right.row + ' ' + right.mean, left: left.row + ' ' + left.mean,
  guess: guess ? guess.row + ' ' + guess.mean + '±' + guess.std + ' over ' + guess.over.toFixed(2) : null,
  guesses: crossing.length + ' of ' + all.length + ' bars cross the centre line',
  styles: byShare().filter((q) => q.share >= 0.08).map((q) => q.k + ' ' + q.share.toFixed(3)),
  rows: rows.map((q) => q.name + ' ' + q.bars.map((b) => b.mean + '±' + b.std + (b.cross ? 'x' : '') + (b.clip ? '>' : '')).join(' ')) });
""")

TRUST_MARKS = js(r"""
const g = trustGeo();
markAt('vt-honest', g.diag.x, g.diag.y, 'diagonal');
markAt('vt-xaxis', g.xaxis.x, g.xaxis.y, 'x axis');
markAt('vt-head', g.head.x, g.head.y, 'headline');
markAt('vt-check', g.check.x, g.check.y, 'check line');
const big = [...g.bins].sort((p, q) => q.n - p.n)[0];
if (big) markAt('vt-bin', big.x, big.y, 'n=' + big.n);
return JSON.stringify(g);
""")

STYLE_MARKS = js(r"""
const t = styleTitles();
t.forEach((s, i) => markAt('vt-lens' + i, s.x, s.y, 'lens ' + s.k));
const V = window.__vt.views, names = new Map((V.ranked || []).map((q) => [q.id, q.name]));
return JSON.stringify({ titles: t,
  chips: [...document.querySelectorAll('#style-chips .style-chip')].map((c) => (c.querySelector('.sc-name').value || c.querySelector('.sc-name').placeholder) + ' ' + c.querySelector('.sc-share').textContent),
  exemplars: V.styles.map((s) => (s.exemplars || []).slice(0, 2).map((i) => names.get(i))) });
""")


# ---------------------------------------------------------------- targets
# Chosen by what they are, not by name, so a new pool still gives the film
# what it needs: a firm yes (bright and the surest of the bright), a maybe
# (bright and the least sure, and a sound the listener likes), the dimmest
# dot, and a tight group of neighbours whose names share a word.
STARRED = r"""
const starred = (name) => { const row = [...document.querySelectorAll('#bank-list .bank-item')].find((e) => e.querySelector('.bi-name')?.textContent.trim() === name);
  return row ? row.querySelectorAll('.star.lit').length : 0; };
"""
MAP_TARGETS = js(STARRED + r"""
const ds = dots().filter((d) => d.glow != null).map((d) => ({ ...d, like: liking(d.name) }));
const byGlow = ds.slice().sort((a, b) => b.glow - a.glow);
const top = byGlow.slice(0, Math.ceil(ds.length * 0.4));
// A lens drawn in one of the map's pale inks (STYLE_COLORS 2 and 4) reads as
// white, not bright: the firm yes is an amber dot where there is one.
const amber = (d) => [0, 1, 3].includes(d.style % 5);
const surest = (xs) => xs.slice().sort((a, b) => a.std - b.std)[0];
const yes = surest(top.filter((d) => d.like >= 0.3 && amber(d))) || surest(top.filter((d) => d.like >= 0.3)) || surest(top);
const maybe = top.filter((d) => d.id !== yes.id && d.like >= 0.3).sort((a, b) => b.std - a.std)[0]
  || top.filter((d) => d.id !== yes.id).sort((a, b) => b.std - a.std)[0];
const dim = byGlow[byGlow.length - 1];
// Neighbours: the dot whose three nearest share the first word of its name.
const word = (d) => d.name.split(' ')[0];
const near = (d) => ds.filter((q) => q.id !== d.id).map((q) => ({ q, r: Math.hypot(q.x - d.x, q.y - d.y) })).sort((a, b) => a.r - b.r).slice(0, 3);
let best = null;
for (const d of ds) {
  const n = near(d); const same = n.filter((x) => word(x.q) === word(d) || (/^(Noisy|Gritty)$/.test(word(x.q)) && /^(Noisy|Gritty)$/.test(word(d)))).length;
  const spread = n.reduce((s, x) => s + x.r, 0);
  if (!best || same > best.same || (same === best.same && spread < best.spread)) best = { d, n, same, spread };
}
const group = [best.d, ...best.n.map((x) => x.q)].sort((a, b) => a.x - b.x);
const out = [marker('vt-yes', yes), marker('vt-maybe', maybe), marker('vt-dim', dim)];
group.forEach((g, i) => out.push(marker('vt-n' + (i + 1), g)));
return out.join(' | ');
""")

# The wrong beat's pair: re-dealt with skip (which records nothing) until one
# side is a sound the model rates highly, the listener dislikes and nobody has
# starred, and the other side is rated lower. Marks that sound's dot, and tags
# the other side's choose button: the pick against the model.
WRONG_PAIR = js(STARRED + r"""
const pct = (name) => { const row = [...document.querySelectorAll('#bank-list .bank-item')].find((e) => e.querySelector('.bi-name')?.textContent.trim() === name);
  return row ? parseInt(row.querySelector('.bi-pct').textContent, 10) : NaN; };
const out = [];
let target = null;
for (let i = 0; i < 60 && !target; i++) {
  await until(dealt, 120000, 'a pair');
  await settle();
  await until(named, 20000, 'names').catch(() => {});
  const a = nameOf('a'), b = nameOf('b'), pa = pct(a), pb = pct(b);
  out.push(a + ' ' + pa + '% | ' + b + ' ' + pb + '%');
  const bad = (n, p) => p >= 70 && liking(n) <= -0.3 && !starred(n);
  if (bad(a, pa) && pb < pa) target = ['a', a];
  else if (bad(b, pb) && pa < pb) target = ['b', b];
  if (target) break;
  await skip();
}
if (!target) throw new Error('no pair with a sound the model rates highly and the listener dislikes: ' + out.join(' / '));
const other = target[0] === 'a' ? 'b' : 'a';
$('choose-a').removeAttribute('data-vt'); $('choose-b').removeAttribute('data-vt');
$('choose-' + other).dataset.vt = 'against';
window.__vtWrong = target[1];
return out.join('  /  ') + '  ->  ' + target[1];
""")

MARK_WRONG = lambda mid: js(r"""
const d = dots().find((q) => q.name === window.__vtWrong);
if (!d) throw new Error('no dot named ' + window.__vtWrong);
return marker(%s, d);
""" % json.dumps(mid))

# The loop beat's walk: two dots the listener likes, the first bright, the
# second a maybe nobody has starred; and where each sits in the keyboard
# cursor's order (the map's arrow keys step through the dots by x).
WALK_TARGETS = js(STARRED + r"""
const ds = dots().filter((d) => d.glow != null).map((d) => ({ ...d, like: liking(d.name) }));
const order = ds.slice().sort((a, b) => a.x - b.x);
const byGlow = ds.slice().sort((a, b) => b.glow - a.glow);
const top = byGlow.slice(0, Math.ceil(ds.length * 0.4));
const t1 = top.filter((d) => d.like >= 0.5).sort((a, b) => a.x - b.x)[0] || top.slice().sort((a, b) => b.like - a.like)[0];
const t2 = top.filter((d) => d.id !== t1.id && d.like >= 0.3 && !starred(d.name)).sort((a, b) => b.std - a.std)[0]
  || top.filter((d) => d.id !== t1.id && !starred(d.name)).sort((a, b) => b.std - a.std)[0];
window.__vtWalk = { t1: order.findIndex((d) => d.id === t1.id), t2: order.findIndex((d) => d.id === t2.id), at: -1 };
return marker('vt-t1', t1) + ' | ' + marker('vt-t2', t2) + ' | steps ' + JSON.stringify(window.__vtWalk);
""")

# Step the map's keyboard cursor to a target, one arrow key at a time (the
# canvas's own keydown handler moves the dashed ring).
WALK_TO = lambda key: js(r"""
const w = window.__vtWalk, to = w[%s];
const c = $('taste-crt'); c.focus();
while (w.at !== to) {
  const k = w.at < to ? 'ArrowRight' : 'ArrowLeft';
  c.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  w.at += w.at < to ? 1 : -1;
  await sleep(170);
}
return 'at ' + w.at;
""" % json.dumps(key))

# STYLES: the chip to play first (the lens whose example the listener likes
# best), the one to play second (a different kind of example), tagged.
STYLE_PICK = js(r"""
const V = window.__vt.views, names = new Map((V.ranked || []).map((q) => [q.id, q.name]));
const chips = [...document.querySelectorAll('#style-chips .style-chip')];
const shown = V.styles.map((s, k) => ({ k, share: s.share, ex: names.get((s.exemplars || [])[0]) })).filter((s) => s.share >= 0.02 && s.ex);
shown.forEach((s, i) => { s.chip = chips[i]; s.like = liking(s.ex); });
const first = shown.slice().sort((a, b) => b.like - a.like)[0];
const second = shown.filter((s) => s !== first).sort((a, b) => (a.ex.split(' ')[1] === first.ex.split(' ')[1]) - (b.ex.split(' ')[1] === first.ex.split(' ')[1]) || b.like - a.like)[0];
chips.forEach((c) => c.removeAttribute('data-vt'));
first.chip.dataset.vt = 'first'; second.chip.dataset.vt = 'second';
return JSON.stringify({ first: [first.k, first.ex, first.chip.querySelector('.sc-name').placeholder], second: [second.k, second.ex, second.chip.querySelector('.sc-name').placeholder],
  all: shown.map((s) => [s.k, s.ex, +s.share.toFixed(3)]) });
""")

# ---------------------------------------------------------------- readings
HEADER = ("'picks ' + document.getElementById('duel-count').textContent + ' · gen ' + document.getElementById('gen-count').textContent"
          " + ' · ' + document.getElementById('skill').textContent + ' · pool ' + (document.querySelector(\".bf-n[data-n='pool']\")?.textContent || '?')")

# The bank beside the map: its first rows, and whether it is sorted by the
# model's guess (the % on each row), as map3 says.
BANK = ("(() => { const rows = [...document.querySelectorAll('#bank-list .bank-item')].map((e) => "
        "[e.querySelector('.bi-name')?.textContent.trim(), parseInt(e.querySelector('.bi-pct')?.textContent, 10)]); "
        "const sorted = rows.every((r, i) => i === 0 || !(r[1] > rows[i - 1][1])); "
        "return JSON.stringify({ sorted, n: rows.length, top: rows.slice(0, 6) }); })()")

# Every style and every dot, for the rehearsal's sidecar.
SUMMARY = js(r"""
const V = window.__vt.views;
const names = new Map((V.ranked || []).map((q) => [q.id, q.name]));
const st = (V.styles || []).map((s, k) => ({ k, name: s.name || null, share: +s.share.toFixed(3), ex: (s.exemplars || []).slice(0, 3).map((i) => names.get(i) || ('#' + i)) }));
const c = window.__vt.calib;
return JSON.stringify({ styles: st, calib: c && { n: c.n, skill: +c.skill.toFixed(3), check_n: c.check_n }, explained: V.map.explained,
  dots: dots().map((d) => ({ ...d, like: +liking(d.name).toFixed(2) })) });
""")

# The bench took the patch a click or the keyboard cursor opened.
BENCHED = lambda mid: "document.getElementById('live-label').textContent.trim() === document.getElementById('%s').dataset.name" % mid
LABEL_SNAP = "window.__vtLabel = document.getElementById('live-label').textContent.trim()"
LABEL_MOVED = "document.getElementById('live-label').textContent.trim() !== window.__vtLabel"
