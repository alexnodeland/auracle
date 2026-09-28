"""RESEARCH HARNESS, not shipped: pedalboard (GPL) hosts the plugin here only
to measure feasibility; the shippable path is clack-host / the `vst3` crate.

Stage-4 feasibility: Auracle's named controls on a third-party synth.

Surge XT is hosted headlessly (pedalboard, research harness only), plays the
standard audition phrase, and Auracle's own φ extractor
(`auracle-features --example phi_of_render`) measures every render. The
named-control math is the same as crates/auracle-session/src/perform.rs:
standardize, finite-difference Jacobian, ridge on the top-4 support,
purity, verification of each half at ±1/2 and ±1.
"""
import json, os, subprocess, sys
import numpy as np
from pedalboard import load_plugin

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 44100
# Build first: cargo build --release -p auracle-features --example phi_of_render
PHI_BIN = os.environ.get("PHI_BIN", "target/release/examples/phi_of_render")
# The standard phrase: (notes, on_s, off_s)
PHRASE = [([60], 1.80, 0.20), ([72], 0.30, 0.15), ([60, 64], 0.50, 0.20), ([48], 0.80, 1.10)]
DUR = sum(on + off for _, on, off in PHRASE)
PHI_NAMES = ["centroid_mean", "centroid_std", "rolloff_mean", "flatness_mean", "flux_mean", "zcr_mean", "rms_mean", "rms_std",
             "crest", "attack_s", "tail_ratio", "bass_fraction", "held_centroid_std", "high_ratio", "chord_flatness_delta",
             "motion_slow", "motion_mid", "motion_fast"]
CONTROLS = [("Bright", {"centroid_mean": 1, "rolloff_mean": 1}), ("Snap", {"attack_s": -1, "crest": 1}),
            ("Motion", {"held_centroid_std": 1, "motion_slow": 1, "motion_mid": 1, "motion_fast": 1}),
            ("Body", {"bass_fraction": 1}), ("Grit", {"flatness_mean": 1}), ("Space", {"tail_ratio": 1})]
KNOBS = ["a_filter_1_cutoff", "a_filter_1_resonance", "a_filter_1_feg_mod_amount", "a_filter_eg_attack", "a_filter_eg_decay",
         "a_filter_eg_sustain", "a_filter_eg_release", "a_amp_eg_attack", "a_amp_eg_decay", "a_amp_eg_sustain",
         "a_amp_eg_release", "a_osc_1_shape", "a_osc_1_width_1", "a_osc_1_sub_mix", "a_osc_1_unison_detune"]

# Surge XT's prebuilt Linux plugins (releases-xt 1.3.4, plugins-only tarball).
p = load_plugin(os.environ.get("SURGE", "Surge XT.vst3"))
p.parameters["a_filter_1_type"].raw_value = 0.1  # a lowpass, not "off"
p.parameters["a_filter_1_resonance"].raw_value = 0.3
p.parameters["a_filter_1_feg_mod_amount"].raw_value = 0.65
BASE = {k: p.parameters[k].raw_value for k in KNOBS}

def events():
    ev, t = [], 0.0
    for notes, on, off in PHRASE:
        for n in notes:
            ev.append((bytes([0x90, n, 100]), t))
            ev.append((bytes([0x80, n, 0]), t + on))
        t += on + off
    return ev

def render(vals, path):
    for k, v in vals.items():
        p.parameters[k].raw_value = float(np.clip(v, 0, 1))
    p.reset()
    a = p(events(), duration=DUR, sample_rate=SR, num_channels=2)
    mono = a.mean(axis=0).astype(np.float32)
    mono.tofile(path)

def phis(paths):
    out = subprocess.run([PHI_BIN, *paths], capture_output=True, text=True, check=True).stdout.strip().splitlines()
    return [np.array(json.loads(l)) if l != "null" else None for l in out]

K = int(os.environ.get("K", "1"))
def phi_avg(vals, tag):
    """φ of a setting, averaged over K renders: Surge is not deterministic
    render to render, so one render is one noisy measurement."""
    paths = []
    for r in range(K):
        path = os.path.join(HERE, "r", f"{tag}_{r}.f32"); render(vals, path); paths.append(path)
    ps = [x for x in phis(paths) if x is not None]
    return np.mean(ps, 0)

rng = np.random.default_rng(7)
os.makedirs(os.path.join(HERE, "r"), exist_ok=True)
# 1. a "pool" of Surge sounds for the standardizer
pool = []
for i in range(40):
    v = {k: rng.uniform(0, 1) for k in KNOBS}
    path = os.path.join(HERE, "r", f"pool{i}.f32"); render(v, path); pool.append(path)
P = np.array([x for x in phis(pool) if x is not None])
mu, sd = P.mean(0), P.std(0) + 1e-9
z = lambda phi: (phi - mu) / sd
# 2. Jacobian at the base patch
H = float(os.environ.get("H", "0.08"))
# noise floor: the same setting rendered 6 times
rep = [z(phi_avg(BASE, f"noise{i}")) for i in range(6)]
noise = np.std(rep, 0)
print("φ noise (σ units, per coordinate, averaged over K=%d):" % K, " ".join(f"{n}:{v:.3f}" for n, v in zip(PHI_NAMES, noise) if v > 0.02))
z0 = z(phi_avg(BASE, "base"))
cols = []
for k in KNOBS:
    h = H if BASE[k] < 0.5 else -H
    v = dict(BASE); v[k] = BASE[k] + h
    cols.append((z(phi_avg(v, f"d_{k}")) - z0) / h)
J = np.array(cols).T

def ridge(A, d, lam=0.05):
    return np.linalg.solve(A.T @ A + lam * np.eye(A.shape[1]), A.T @ d)

rows = []
for name, axis in CONTROLS:
    d = np.array([axis.get(n, 0.0) for n in PHI_NAMES], float); d /= np.linalg.norm(d)
    x = ridge(J, d); sup = np.argsort(-np.abs(x))[:4]
    xs = ridge(J[:, sup], d); moved = J[:, sup] @ xs
    along = moved @ d; purity = along / (np.linalg.norm(moved) + 1e-12)
    alpha = 0.5 / np.abs(xs).max(); reach = alpha * along
    gains = {KNOBS[i]: alpha * g for i, g in zip(sup, xs)}
    # verify each half on real renders
    def at(c):
        v = dict(BASE)
        for k, g in gains.items(): v[k] = np.clip(BASE[k] + c * g, 0, 1 - 1e-6)
        path = os.path.join(HERE, "r", f"v_{name}_{c:+.2f}.f32"); render(v, path)
        return path
    def atz(c):
        v = dict(BASE)
        for k, g in gains.items(): v[k] = np.clip(BASE[k] + c * g, 0, 1 - 1e-6)
        return z(phi_avg(v, f"v_{name}_{c:+.2f}")) @ d
    zz = [atz(c) for c in (-1, -0.5, 0.5, 1)]; b = z0 @ d
    up = zz[3] - b if (zz[2] - b > 0 and zz[3] > zz[2]) else 0.0
    down = b - zz[0] if (b - zz[1] > 0 and zz[0] < zz[1]) else 0.0
    search = purity < 0.35 or reach < 0.15 or (up < 0.075 and down < 0.075)
    rows.append((name, purity, reach, down, up, search, gains))
print(f"{'control':8} {'purity':>6} {'reach':>6} {'down':>6} {'up':>6}  knobs (gain at full turn)")
for name, pur, reach, down, up, search, gains in rows:
    ks = ", ".join(f"{k.replace('a_','')} {g:+.2f}" for k, g in gains.items())
    print(f"{name:8} {pur:6.2f} {reach:6.2f} {down:6.2f} {up:6.2f}  {'SEARCH ' if search else ''}{ks}")
json.dump([{"name": r[0], "purity": r[1], "reach": r[2], "down": r[3], "up": r[4], "search": bool(r[5]), "gains": r[6]} for r in rows],
          open(os.path.join(HERE, "wiring.json"), "w"), indent=1)
