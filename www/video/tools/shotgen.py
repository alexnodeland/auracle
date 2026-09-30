"""Shared pieces for generating a walkthrough's shots.json (tools/footage.mjs).

A film's generator (films/<film>/gen_shots.py) imports these, builds the spec
as data, and writes it with `dump`, one step per line, so a regenerated file
diffs like a hand-written one:

    import os, sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
    from shotgen import INIT, FILLED, QUIET, WIRING, pick, taught, perform, dump

- INIT seeds Math.random before the app boots, so every shot runs the same
  session: the same pool, warm-start deal and duel sides. That is what makes a
  rehearsal predict the recording.
- FILLED waits for a pool of 40; QUIET for the toasts to clear; WIRING logs
  how PERFORM wired this patch (controls move with the session, so pick them
  by what they do, not by name).
- pick() finds a warm-start card by index, by name, or as the first card of a
  category; taught() answers the warm start, re-deals the duel (REDEAL) and
  optionally votes.
- DEALS (in INIT) keeps every pair the engine deals, in order, in
  `window.__deals`; REDEAL skips until the pair on the table is the fifth one
  dealt (REDEAL_AT), each skip once the pair behind the table has been dealt,
  so the pair on the table is the same in every take.
"""
import json
# The pairs the engine deals ahead (main.js requestAhead), watched passively:
# an extra "message" listener on each worker, so the app's own handlers see the
# same messages in the same order. REDEAL waits on it. It draws nothing from
# Math.random, so it changes no session.
DEALS = ("(() => { const N = window.Worker; const d = (window.__deals = { all: [], ahead: null, aheads: 0 }); "
         "window.Worker = class extends N { constructor(...a) { super(...a); this.addEventListener('message', (e) => { "
         "const m = e.data; if (!m || m.type !== 'duel') return; if (!m.pair) { d.none = (d.none || 0) + 1; return; } d.all.push(m.pair); "
         "if (m.ahead) { d.ahead = m.pair || null; d.aheads += 1; } }); } }; })();")
SEED = "(() => { let s = 20260927 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();"
INIT = SEED + " " + DEALS
FILLED = {"op": "until", "js": "Number(document.querySelector(\".bf-n[data-n='pool']\")?.textContent || 0) >= 40", "ms": 300000}
QUIET = {"op": "until", "js": "!document.querySelector('#toasts .toast')", "ms": 45000}
WIRING = {"op": "log", "name": "wiring", "js": "[...document.querySelectorAll('.pf-knob')].slice(0, 6).map((k) => k.querySelector('.pf-k-name').textContent + ':' + (k.classList.contains('search') ? 'search' : k.classList.contains('half-lo') ? 'up' : k.classList.contains('half-hi') ? 'down' : 'both')).join(' ')"}
# The preset library by category (crates/auracle-grammar/src/presets.rs). The
# warm start deals one card per category, then fills to nine, so a category
# always has a card on the grid, whichever cards the session deals.
CATS = {
    "bass": ["First Bass", "Sub & Sparkle", "Acid Line", "Reese", "Anvil", "Iron Bass", "Held Under"],
    "pad": ["Cathedral", "Glass Pad", "Detune Dream", "Ember", "Slow Weather", "Morph Pad", "Sweep Machine",
            "Sea Change", "Pump Room", "Tidal", "Nine Against Four"],
    "texture": ["Noise Wash", "Dub Echo", "Static Ocean", "Rotor", "Long Room", "Handheld", "Jet Wash",
                "Cloud Chamber", "Vox Machina", "Glass Rain", "One Way", "Loom", "Long Way Down"],
}
def pick(p, then=""):
    """A warm-start card: by index, by name, or the first card of a category."""
    if isinstance(p, int):
        return ".warm-item >> nth=%d" % p
    names = CATS.get(p, [p])
    return ", ".join(".warm-item:has(.wi-name:text-is('%s'))%s" % (n, then) for n in names)
def taught(votes=0, picks=(0, 4, 7), redeal=True):
    s = [
        {"op": "until", "sel": "#warmstart:not(.hidden)", "ms": 180000},
        FILLED,
    ] + [{"op": "click", "sel": pick(p)} for p in picks] + [
        {"op": "click", "sel": "#warm-go"},
        {"op": "until", "sel": "#belief .bl-u", "state": "attached", "ms": 180000},
    ]
    if redeal:
        s += [REDEAL]
    if votes:
        s += [{"op": "view", "v": "evolve"}, {"op": "wait", "ms": 2000}]
        for i in range(votes):
            s += [{"op": "click", "sel": "#choose-a" if i % 2 == 0 else "#choose-b"}, {"op": "wait", "ms": 1500}]
    # Fitted: the wordmark's E stops thinking, and the one engine thread is free.
    s += [{"op": "until", "js": "!document.getElementById('wm-lamp').classList.contains('thinking')", "ms": 240000}]
    return s
# The duel's first pair is dealt at "playable", while the pool is still
# filling, the pair behind it is dealt ahead as soon as the first pair's sounds
# are in, and a pair is dealt again when one of its patches leaves the pool.
# So how many pairs have been dealt by the time the pool is full depends on
# timing, while the engine's deals come in the same order in every take (its
# duel stream is its own, ADR-001). REDEAL skips (skip records nothing) until
# the pair on the table is the REDEAL_AT-th pair dealt, from the full pool, so
# the table and every later deal are the same in every take. Each skip waits
# for the table's sounds and for the pair behind it to be dealt (a skip before
# that deal lands would race it). One fixed skip was enough while a pair was
# dealt only once the one before it was answered. Run in any view: it presses
# the app's own skip button. Not yet exact: a deal from the filling pool
# draws from the engine's duel stream a number of times that depends on the
# pool's size (rejection sampling), so a take whose early deals met a
# smaller pool can deal other pairs later (the tour rehearsal of 29
# September: 11 taught takes agreed, one did not). Its log lists every deal.
REDEAL_AT = 5
REDEAL = {"op": "log", "name": "redeal", "js": r"""(async () => {
const K = %d;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) { let v = false; try { v = fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('redeal: timed out waiting for ' + what); await sleep(150); }
}
const d = window.__deals;
if (!d) throw new Error('redeal: shotgen.DEALS is not in this film\'s init');
const dealt = () => !$('choose-a').disabled && !$('duel-a').classList.contains('dealing');
const ids = () => [...document.querySelectorAll('#name-a .dn-id, #name-b .dn-id')].map((e) => Number(e.textContent.replace(/\D/g, '')));
const same = (p, q) => !!(p && q && p.length === 2 && q.length === 2 && p.includes(q[0]) && p.includes(q[1]));
const names = () => ids().map((i) => '#' + i).join(' | ');
// Which deal the pair on the table is (1-based; 0 if not seen). A reply with
// no pair (a pool too small to deal from) is not counted (DEALS).
const index = () => { const t = ids(); for (let i = d.all.length - 1; i >= 0; i--) if (same(d.all[i], t)) return i + 1; return 0; };
const out = [];
for (let i = 0; i < 12; i++) {
  await until(() => dealt() && !document.querySelector('#play-a.pending, #play-b.pending'), 120000, 'the pair to render');
  const table = ids();
  // The pair behind it. A deal that repeats the table's pair is refused by
  // the app and asked again; after three refusals it stops asking, and so
  // does this wait.
  await until(() => d.ahead && !same(d.ahead, table), 30000, 'the next pair, dealt ahead').catch(() => {});
  const n = index();
  out.push(names() + ' (deal ' + n + ')');
  if (n >= K) break;
  const was = names();
  $('skip-duel').click();
  await until(() => dealt() && names() !== was, 60000, 'a new pair');
}
if (index() !== K) throw new Error('redeal: the table is deal ' + index() + ', not ' + K + ': ' + out.join(' -> '));
return out.join(' -> ') + ' [dealt: ' + d.all.map((p) => p.join('/')).join(' ') + (d.none ? '; ' + d.none + ' with no pair' : '') + ']';
})()""" % REDEAL_AT}
def perform(name):
    return [{"op": "preset", "name": name}, {"op": "view", "v": "perform"}, {"op": "measured", "name": name}, WIRING]
def dump(spec, path):
    # One step per line: readable diffs, and the file stays close to the hand-written films.
    def one(x):
        return json.dumps(x, ensure_ascii=False)
    out = ['{', f'  "viewport": {one(spec["viewport"])},', f'  "dpr": {spec["dpr"]},', f'  "query": {one(spec["query"])},', f'  "init": {one(spec["init"])},', '  "setup": [']
    out.append(',\n'.join('    ' + one(x) for x in spec["setup"]))
    out.append('  ],')
    out.append('  "shots": [')
    shots = []
    for sh in spec["shots"]:
        lines = ['    {']
        keys = [k for k in sh if k not in ("setup", "marks", "actions")]
        for k in keys:
            lines.append(f'      {one(k)}: {one(sh[k])},')
        lines.append('      "setup": [')
        lines.append(',\n'.join('        ' + one(x) for x in sh.get("setup", [])))
        lines.append('      ],')
        lines.append(f'      "marks": {one(sh.get("marks", {}))},')
        lines.append('      "actions": [')
        lines.append(',\n'.join('        ' + one(x) for x in sh.get("actions", [])))
        lines.append('      ]')
        lines.append('    }')
        shots.append('\n'.join(lines))
    out.append(',\n'.join(shots))
    out.append('  ]')
    out.append('}')
    text = '\n'.join(out) + '\n'
    json.loads(text)
    open(path, 'w').write(text)
