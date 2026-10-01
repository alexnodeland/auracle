#!/usr/bin/env python3
"""Lay a film's sound in, mix it, and encode the film for the web.

usage: mix.py FILM [--voice DIR] [--score SCORE.json --music DIR | --music DIR] [--app APP.json]
              [--encode [--draft] [--preview]] [--poster T]

Reads www/video/films/FILM/timeline.json (tools/timeline.py) and writes to
www/video/out/FILM/:

  mix.wav        48 kHz stereo, -16 LUFS integrated, true peak under -1 dBTP
  ladder.json    the mix measured against the ladder: each stem's loudness,
                 the bed against the voice, the duck, carve and dip as they
                 acted, the marks, each demo window and its tail, the master
  FILM.mp4       H.264 + AAC, faststart          (with --encode)
  FILM.webm      VP9 + Opus                      (with --encode, not --draft)
  FILM-preview.mp4  720p H.264, to send for review (with --preview or --draft)
  FILM.vtt       captions, from the narration's own timing
  FILM.jpg/.webp the poster frame                (with --poster, seconds)

and writes the music's envelope back into timeline.json (`env.music`,
`env.voice`, 60 Hz), so a scene can pulse with the sound it sits on. Render
the picture again after the first mix and the glows land on the beat.

Sources:
  --voice DIR   voice/tts.py output: manifest.json and one WAV per line
  --score F     a film's score from fit_score.py --film: the bed and the two
                marks, one track per part, each with its `role`. With it,
                --music is the score example's render of it (the folder with
                `stems/`), and every part is mixed on its own stem.
  --music DIR   without --score, a bed as one sound: bed.wav (the whole
                film), or one WAV per section named as in arrangement.json
                (`<section>.wav`, each starting at its section's t0)
  --app F       JSON list of {file, t, gain_db, from, to}: the app's own
                recorded sound (tools/app_audio.py)

The values are www/brand/sound.json's, through sound_defaults.py (ADR-014;
docs/notes/sound-2026-09/SPEC.md sections 5 to 8). None is written here:

- **The voice** passes through the voice chain (VOICE_CHAIN: a high-pass, a
  low-mid cut where the voice measures heavy there, a presence lift and a
  split-band de-esser), at the narration's level, and is then normalized to
  LADDER['narration_lufs'].
- **The bed, on stems** (--score): each part takes its EQ, stereo and pan
  (PARTS), every stem's side signal is high-passed below
  MIX['center_below_hz'], and the parts are levelled against the pad after
  the EQ. The bed at rest sits LADDER['bed_rest_lu'] under the voice,
  measured over the narrated stretches (demo windows left out).
- **The marks:** the lead sits over the pad sounding with it, and the lead and
  the marks' pad are scaled together so each mark's span is
  LADDER['marks_lufs']. After the entrance, its pad (the chord held into the
  bed) eases to bed level over MARKS['into_the_bed']['pad_to_bed_level_s'].
- **Each demo** (timeline.json `demos`): the app's sound is normalized to
  LADDER['demo_lufs'] over its window (first note to last note-off), and the
  bed goes down to LADDER['bed_under_demo_lu'] under it from the first note
  and comes back from the note-off. The app's sound is never ducked: in this
  grammar the instrument never plays under the voice. A film laid out before
  the grammar (no `demos`) plays the app under the voice, so until it is
  re-timed it keeps the duck it had (BEFORE_THE_GRAMMAR['app_duck_db']).
- **Under the voice** one detector and one follower (DUCK) drive three moves:
  the whole bed ducks DUCK['broadband_db'], a further CARVE['db'] in
  CARVE['band_hz'], and the pad a further PAD_DIP['db'] in PAD_DIP['band_hz'].
- **No cues.** A film lays no whoosh, blip, shimmer or sting (ADR-014). Any
  left in out/FILM/cues.json (the picture's stage.sfx() calls) are not laid,
  and the mix says how many.
- **The master:** the whole mix to LADDER['master_lufs'], then a look-ahead
  limiter (LADDER['limiter']).

Loudness is ITU-R BS.1770-4 (K-weighted, gated), computed here rather than
trusted to a filter's defaults. The mix is plain arithmetic, so it is
repeatable.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter, resample_poly, sosfilt, sosfiltfilt

import sound_defaults

LADDER = sound_defaults.LADDER
DUCK = sound_defaults.DUCK
CARVE = sound_defaults.CARVE
PAD_DIP = sound_defaults.PAD_DIP
PARTS = sound_defaults.PARTS
MIX = sound_defaults.MIX
MARKS = sound_defaults.MARKS
VOICE_CHAIN = sound_defaults.VOICE_CHAIN
BEFORE_THE_GRAMMAR = sound_defaults.BEFORE_THE_GRAMMAR

# A film score's tracks each carry a role (fit_score.py --film); the role
# names the part whose EQ, pan and level it takes (sound.json `mix.parts`).
# `pad` is the bed's pad and `mpad` the marks' pad: both are the pad, but only
# the bed's dips under the voice, and only the marks' is scaled with a mark.
ROLE_PART = {"drone": "drone", "pad": "pad", "mpad": "pad", "burble": "burble", "melody": "melody", "lead": "marks_lead"}
BED_ROLES = ("drone", "pad", "mpad", "burble", "melody")
# "While it sounds" (the melody and the lead against the pad, and the app in
# a demo window): momentary loudness above these (sound.json `mix.sounding`).
SOUNDING_LUFS = MIX["sounding"]["part_lufs"]
PAD_SOUNDING_LUFS = MIX["sounding"]["pad_lufs"]


# Arrays of numbers (word times, the picture's envelopes) on one line each: a
# timeline pretty-printed one number per line ran to 17 000 lines of diff.
_NUMS = re.compile(r"\[\s*(-?[\d.eE+-]+(?:,\s*-?[\d.eE+-]+)*)\s*\]")


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dump_json(obj, path):
    s = json.dumps(obj, indent=1, ensure_ascii=False)
    s = _NUMS.sub(lambda m: "[" + ", ".join(x.strip() for x in m.group(1).split(",")) + "]", s)
    with open(path, "w") as f:
        f.write(s + "\n")

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)


def ffmpeg():
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def load(path):
    """Read a WAV as float32 stereo at 48 kHz."""
    sr, x = wavfile.read(path)
    if x.dtype == np.int16:
        x = x.astype(np.float32) / 32768.0
    elif x.dtype == np.int32:
        x = x.astype(np.float32) / 2147483648.0
    elif x.dtype == np.uint8:
        x = (x.astype(np.float32) - 128) / 128.0
    else:
        x = x.astype(np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    x = x[:, :2]
    if sr != SR:
        g = math.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g, axis=0).astype(np.float32)
    return x


def write(path, x):
    # 32-bit integer PCM at full scale: what every reader (ffmpeg included)
    # assumes an int32 WAV means. A 24-bit value in a 32-bit word reads back
    # 48 dB quiet.
    y = np.clip(x, -1, 1)
    wavfile.write(path, SR, (y * 2147483647.0).astype(np.int32))


def cut(x, a, b):
    """x from a to b seconds, zero-padded where it does not reach."""
    i, j = int(round(a * SR)), int(round(b * SR))
    out = np.zeros((max(0, j - i), x.shape[1]), np.float32)
    s0, s1 = max(i, 0), min(j, len(x))
    if s1 > s0:
        out[s0 - i : s1 - i] = x[s0:s1]
    return out


# ---- loudness (ITU-R BS.1770-4) ------------------------------------------

def k_weight(x, sr=SR):
    # Stage 1: high shelf; stage 2: RLB highpass (coefficients for 48 kHz).
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
    a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, -1.99004745483398, 0.99007225036621]
    return lfilter(b2, a2, lfilter(b1, a1, x, axis=0), axis=0)


def _blocks(x, blk_s, hop_s):
    """Mean-square K-weighted power of each block (summed over channels), and
    each block's centre time."""
    y = k_weight(x)
    blk, hop = int(blk_s * SR), int(hop_s * SR)
    if len(y) < blk:
        return np.zeros(0), np.zeros(0)
    p = np.sum(y ** 2, axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    idx = np.arange(0, len(p) - blk + 1, hop)
    return (c[idx + blk] - c[idx]) / blk, idx / SR + blk_s / 2


def lufs(x):
    ms, _ = _blocks(x, 0.4, 0.1)
    if not len(ms):
        return -70.0
    if not np.isfinite(ms).all():
        return float("nan")  # not "silent": a sample that is not a number has no loudness
    l = -0.691 + 10 * np.log10(ms + 1e-12)
    g = ms[l > -70]
    if not len(g):
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(g)) - 10
    g2 = ms[(l > -70) & (l > rel)]
    return float(-0.691 + 10 * np.log10(np.mean(g2)))


def momentary(x):
    """Momentary loudness (400 ms blocks, 100 ms hop): (times, LUFS)."""
    ms, t = _blocks(x, 0.4, 0.1)
    return t, -0.691 + 10 * np.log10(ms + 1e-12)


def short_term(x):
    """Short-term loudness (3 s blocks, 100 ms hop): (times, LUFS)."""
    ms, t = _blocks(x, 3.0, 0.1)
    return t, -0.691 + 10 * np.log10(ms + 1e-12)


def true_peak_db(x):
    up = resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.max(np.abs(up)) + 1e-12)


def limiter(x, ceiling_db=None, look_ms=None, release_ms=None):
    """A look-ahead peak limiter on 4x-oversampled (inter-sample) peaks
    (LADDER['limiter'] unless given)."""
    lim = LADDER["limiter"]
    ceiling_db = lim["ceiling_dbtp"] if ceiling_db is None else ceiling_db
    look_ms = lim["lookahead_ms"] if look_ms is None else look_ms
    release_ms = lim["release_ms"] if release_ms is None else release_ms
    c = 10 ** (ceiling_db / 20)
    peak = np.empty(len(x), np.float32)
    step = 10 * SR
    for i in range(0, len(x), step):
        seg = x[i : i + step]
        up = np.abs(resample_poly(seg, 4, 1, axis=0).astype(np.float32))
        peak[i : i + len(seg)] = up[: 4 * len(seg)].reshape(len(seg), 4, -1).max(axis=(1, 2))
    need = np.minimum(1.0, c / np.maximum(peak, 1e-9))
    # Look ahead: the gain is already down when the peak arrives.
    need = _running_min(need, int(look_ms * SR / 1000))
    rel = math.exp(-1.0 / (release_ms * SR / 1000))
    g = np.empty_like(need)
    cur = 1.0
    for i, v in enumerate(need):
        cur = v if v < cur else v + (cur - v) * rel
        g[i] = cur
    return x * g[:, None]


def _running_min(v, w):
    from scipy.ndimage import minimum_filter1d

    return minimum_filter1d(v, size=2 * w + 1, mode="nearest")


# ---- envelopes ---------------------------------------------------------------

def envelope(x, rate=60):
    hop = SR // rate
    n = len(x) // hop
    m = np.sqrt(np.mean(x[: n * hop].reshape(n, hop, -1) ** 2, axis=(1, 2)) + 1e-12)
    db = 20 * np.log10(m)
    v = np.clip((db + 48) / 42, 0, 1)
    return [round(float(a), 3) for a in v]


def follower(x, attack_ms=None, release_ms=None):
    """An envelope follower: rises toward its input with the attack time
    constant, falls with the release (DUCK['follower'] unless given).

    Exactly the per-sample recurrence cur = x + (cur - x)·k, with k the attack
    coefficient when the input is above cur and the release otherwise; run a
    stretch of constant input at a time, where k cannot change."""
    f = DUCK["follower"]
    a = math.exp(-1.0 / ((f["attack_ms"] if attack_ms is None else attack_ms) * SR / 1000))
    r = math.exp(-1.0 / ((f["release_ms"] if release_ms is None else release_ms) * SR / 1000))
    x = np.asarray(x, np.float64)
    out = np.empty_like(x)
    if not len(x):
        return out
    edges = np.flatnonzero(np.diff(x)) + 1
    starts = np.concatenate([[0], edges])
    ends = np.concatenate([edges, [len(x)]])
    cur = 0.0
    for s, e in zip(starts, ends):
        m = x[s]
        k = a if m > cur else r
        out[s:e] = m + (cur - m) * k ** np.arange(1, e - s + 1)
        cur = out[e - 1]
    return out


def voice_env(vo):
    """The duck's follower: 1 where the voice's short RMS is above the
    detector's threshold (DUCK['detector']), through DUCK['follower']."""
    det = DUCK["detector"]
    hop = max(1, int(round(det["rms_ms"] * SR / 1000)))
    n = len(vo)
    m = np.sqrt(np.mean(vo[: n // hop * hop].reshape(-1, hop, vo.shape[1]) ** 2, axis=(1, 2)))
    mask = (20 * np.log10(m + 1e-9) > det["above_dbfs"]).astype(np.float64)
    mask = np.concatenate([np.repeat(mask, hop), np.zeros(n - n // hop * hop)])
    return follower(mask)


# ---- filters -----------------------------------------------------------------

def _sos(order, hz, kind):
    return butter(order, hz, kind, fs=SR, output="sos")


def eq(x, hz, kind):
    """The EQ's filters: Butterworth of MIX['filter_order'], applied causally."""
    return sosfilt(_sos(MIX["filter_order"], hz, kind), x, axis=0).astype(np.float32)


def split(x, lo_hz, hi_hz):
    """Below, inside and above a band: zero-phase Butterworth of
    MIX['band_split_order'], complementary, so the three sum back to x."""
    o = MIX["band_split_order"]
    below = sosfiltfilt(_sos(o, lo_hz, "low"), x, axis=0)
    above = sosfiltfilt(_sos(o, hi_hz, "high"), x, axis=0)
    return below, x - below - above, above


def peaking(hz, gain_db, q):
    """An RBJ peaking filter as one second-order section."""
    A = 10 ** (gain_db / 40)
    w = 2 * math.pi * hz / SR
    al = math.sin(w) / (2 * q)
    b = [1 + al * A, -2 * math.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * math.cos(w), 1 - al / A]
    return np.array([[b[0] / a[0], b[1] / a[0], b[2] / a[0], 1.0, a[1] / a[0], a[2] / a[0]]])


def band_density_db(x, lo, hi):
    """Mean power density of x's mono sum between lo and hi Hz, in dB."""
    m = x.mean(axis=1)
    p = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(len(m), 1 / SR)
    return 10 * math.log10(p[(f >= lo) & (f < hi)].mean() + 1e-30)


# ---- the voice ---------------------------------------------------------------

def voice_chain(vo, stages=None):
    """The narration through VOICE_CHAIN, in order. Run it on the voice at
    LADDER['narration_lufs']: the de-esser's threshold is in dBFS at that
    level. Returns the voice and what each stage did."""
    stages = VOICE_CHAIN if stages is None else stages
    y = vo.astype(np.float64)
    did = []
    for st in stages:
        kind = st["type"]
        when = st.get("when", "always")
        if kind == "highpass":
            y = sosfilt(_sos(st["order"], st["hz"], "high"), y, axis=0)
            did.append(f"high-pass {st['hz']:g} Hz")
        elif kind == "peaking":
            if when != "always":
                over = band_density_db(y, *when["band_hz"]) - band_density_db(y, *when["over_band_hz"])
                if over <= when["by_db"]:
                    did.append(f"no {st['hz']:g} Hz cut ({when['band_hz'][0]}-{when['band_hz'][1]} Hz is {over:.1f} dB over)")
                    continue
                did.append(f"{st['gain_db']:+g} dB at {st['hz']:g} Hz ({over:.1f} dB over)")
            else:
                did.append(f"{st['gain_db']:+g} dB at {st['hz']:g} Hz")
            y = sosfilt(peaking(st["hz"], st["gain_db"], st["q"]), y, axis=0)
        elif kind == "deesser":
            y, active = deess(y, st)
            did.append(f"de-essed above {st['above_hz']:g} Hz ({active:.1f}% of frames)")
        else:
            raise ValueError(f"voice chain: no stage {kind!r}")
    return y.astype(np.float32), did


def deess(y, st):
    """A split-band de-esser: the band above `above_hz` (a zero-phase
    high-pass, the rest untouched) is turned down by `ratio` over
    `threshold_dbfs` on its RMS, at most `max_cut_db`."""
    hi = sosfiltfilt(_sos(st["split_order"], st["above_hz"], "high"), y, axis=0)
    rest = y - hi
    hop = max(1, int(round(st["detector_rms_ms"] * SR / 1000)))
    n = len(hi) // hop * hop
    lv = 20 * np.log10(np.sqrt(np.mean(hi[:n].reshape(-1, hop, hi.shape[1]) ** 2, axis=(1, 2))) + 1e-9)
    gr = np.clip((lv - st["threshold_dbfs"]) * (1 - 1 / st["ratio"]), 0, st["max_cut_db"])
    gr = np.concatenate([np.repeat(gr, hop), np.zeros(len(hi) - n)])
    gr = follower(gr / st["max_cut_db"], st["attack_ms"], st["release_ms"]) * st["max_cut_db"]
    # Its activity as SPEC section 6 measured it: the share of the time it
    # cuts by more than half a decibel.
    active = float((gr > 0.5).mean() * 100) if len(gr) else 0.0
    return rest + hi * (10 ** (-gr / 20))[:, None], active


# ---- the bed -----------------------------------------------------------------

def place(role, x):
    """One stem in its place (sound.json `mix.parts`): its EQ, its stereo and
    pan, and below MIX['center_below_hz'] in the centre."""
    part = PARTS[ROLE_PART[role]]
    q = part.get("eq") or {}
    y = x.astype(np.float32)
    if isinstance(q, dict):
        if "highpass_hz" in q:
            y = eq(y, q["highpass_hz"], "high")
        if "lowpass_hz" in q:
            y = eq(y, q["lowpass_hz"], "low")
        if "band_hz" in q:
            y = eq(eq(y, q["band_hz"][0], "high"), q["band_hz"][1], "low")
    stereo = part.get("stereo")
    if stereo == "mono":
        m = y.mean(axis=1)
        y = np.stack([m, m], axis=1)
    elif isinstance(stereo, dict):
        mid, side = (y[:, 0] + y[:, 1]) / 2, (y[:, 0] - y[:, 1]) / 2
        low = sosfiltfilt(_sos(MIX["band_split_order"], stereo["side_above_hz"], "low"), side)
        side = low + (side - low) * stereo["side_gain"]
        y = np.stack([mid + side, mid - side], axis=1)
    p = part.get("pan") or 0
    if p:
        th = (p + 1) * math.pi / 4
        y = y * np.array([math.sqrt(2) * math.cos(th), math.sqrt(2) * math.sin(th)])
    mid, side = (y[:, 0] + y[:, 1]) / 2, (y[:, 0] - y[:, 1]) / 2
    side = sosfiltfilt(_sos(MIX["band_split_order"], MIX["center_below_hz"], "high"), side)
    return np.stack([mid + side, mid - side], axis=1).astype(np.float32)


def part_gains(S, span):
    """Each part's gain against the pad, measured after the EQ (SPEC section
    5): integrated over `span` for a level in LU, the momentary median while
    it sounds for one in dB. The pad and the marks' pad are the reference
    (1); the lead is levelled with its mark (mark_gains)."""
    g = {r: 1.0 for r in S}
    if "pad" not in S:
        return g
    a, b = span
    ref = lufs(cut(S["pad"], a, b))
    _, mp = momentary(S["pad"])
    for r, x in S.items():
        if r in ("pad", "mpad", "lead"):
            continue
        lvl = PARTS[ROLE_PART[r]]["level"]
        if not isinstance(lvl, dict) or lvl.get("vs") != "pad":
            continue
        if "lu" in lvl:
            g[r] = 10 ** ((ref + lvl["lu"] - lufs(cut(x, a, b))) / 20)
        else:
            _, mx = momentary(x)
            on = (mx > SOUNDING_LUFS) & (mp > PAD_SOUNDING_LUFS)
            if on.any():
                g[r] = 10 ** ((lvl["db"] - float(np.median(mx[on] - mp[on]))) / 20)
    return g


def mark_gains(S, g, n, marks):
    """The two marks in the film (SPEC section 3). In each mark's span the
    lead sits `marks_lead`'s level over the pad sounding with it, then the lead
    and the marks' pad are scaled together until the span, with the drone and
    everything under it, is LADDER['marks_lufs']. Returns the lead's and the
    marks' pad's gain over time, and what each mark took.

    The lead plays only in the marks, so each mark's gain holds until the next
    mark. The marks' pad also holds the entrance's last chord into the bed: it
    eases from the mark's scale to bed level (1) after the entrance, and holds
    the exit's scale from the exit on."""
    t = np.arange(n) / SR
    cl = np.zeros(n, np.float32)
    cp = np.ones(n, np.float32)
    took = []
    if "lead" not in S or "mpad" not in S:
        return cl, cp, took
    over = PARTS["marks_lead"]["level"]["db"]
    others = sum(S[k] * g.get(k, 1.0) for k in S if k not in ("lead", "mpad"))
    pad_all = S["mpad"] * g.get("mpad", 1.0) + (S["pad"] * g.get("pad", 1.0) if "pad" in S else 0)
    spans = sorted((t0, name) for name, t0 in marks.items() if t0 is not None)
    length = MARKS["length_s"]
    ease = MARKS["into_the_bed"]["pad_to_bed_level_s"]
    for k, (t0, name) in enumerate(spans):
        a, b = int(round(t0 * SR)), int(round((t0 + length) * SR))
        _, mp = momentary(pad_all[a:b])
        _, ml = momentary(S["lead"][a:b])
        on = (ml > SOUNDING_LUFS) & (mp > PAD_SOUNDING_LUFS)
        heard = lufs(S["lead"][a:b] + S["mpad"][a:b] * g.get("mpad", 1.0))
        if heard <= SOUNDING_LUFS or not on.any():
            # Scaling silence up to the ladder makes a silent or NaN film.
            raise ValueError(f"the {name} mark's span ({t0:.2f}-{t0 + length:.2f} s) is silent in the score's stems "
                             f"({heard:.1f} LUFS{'' if on.any() else ', its lead never sounding with its pad'}): "
                             "render the score again, or write it again from this timeline (fit_score.py --film)")
        gl = 10 ** ((over - float(np.median(ml[on] - mp[on]))) / 20)
        lead, mpad = S["lead"][a:b] * gl, S["mpad"][a:b] * g.get("mpad", 1.0)
        rest = others[a:b] if not np.isscalar(others) else 0
        m = 1.0
        for _ in range(20):
            step = 10 ** ((LADDER["marks_lufs"] - lufs(rest + m * (lead + mpad))) / 20)
            m *= step
            if not math.isfinite(m) or abs(20 * math.log10(step)) < 0.005:
                break
        if not math.isfinite(m):
            raise ValueError(f"the {name} mark's level is not a number: a stem under it holds samples that are not numbers")
        nxt = spans[k + 1][0] if k + 1 < len(spans) else t[-1] + 1
        here = (t >= (t0 if k else 0)) & (t < nxt)
        cl[here] = gl * m
        if name == "entrance":
            cp[t < t0 + length] = m
            r = (t >= t0 + length) & (t < t0 + length + ease)
            cp[r] = m + (1 - m) * (t[r] - t0 - length) / ease
        else:
            cp[t >= t0] = m
        took.append({"mark": name, "t0": round(t0, 3), "lead_over_pad_db": over, "scale_db": round(20 * math.log10(m), 2)})
    return cl, cp, took


def app_under_voice(app, env):
    """The app's sound in a film laid out before the grammar: ducked
    BEFORE_THE_GRAMMAR['app_duck_db'] times the follower, as it was mixed
    before ADR-014 (half the old bed's duck)."""
    return (app * (10 ** (BEFORE_THE_GRAMMAR["app_duck_db"] * env / 20))[:, None]).astype(np.float32)


def under_voice(bed, env, duck_db):
    """The duck and the carve on the whole bed: DUCK's broadband cut, and a
    further CARVE in its band, each times the follower."""
    lo, band, hi = split(bed, *CARVE["band_hz"])
    g = 10 ** (duck_db * env / 20)
    gc = 10 ** (CARVE["db"] * env / 20)
    return ((lo + hi) * g[:, None] + band * (g * gc)[:, None]).astype(np.float32)


def dip(pad, env):
    """The pad's dip under the voice: PAD_DIP in its band, times the follower."""
    lo, band, hi = split(pad, *PAD_DIP["band_hz"])
    return (lo + hi + band * (10 ** (PAD_DIP["db"] * env / 20))[:, None]).astype(np.float32)


def demo_ramp(bed, demos, n):
    """The bed's gain under each demo: down to LADDER['bed_under_demo_lu']
    under the demo's own level over LADDER['bed_under_demo_down_s'] from its
    first note, and back over LADDER['bed_under_demo_up_s'] from its last
    note-off. Never down to silence. Returns the gain, and each window's."""
    t = np.arange(n) / SR
    gain = np.ones(n, np.float32)
    down, up = LADDER["bed_under_demo_down_s"], LADDER["bed_under_demo_up_s"]
    want = LADDER["demo_lufs"] + LADDER["bed_under_demo_lu"]
    took = []
    for d in demos:
        t0, off = d["t0"], d["off"]
        lb = lufs(cut(bed, t0, off))
        gd = min(1.0, 10 ** ((want - lb) / 20)) if lb > -70 else 1.0
        a = (t >= t0) & (t < t0 + down)
        gain[a] *= 1 + (gd - 1) * (t[a] - t0) / down
        gain[(t >= t0 + down) & (t < off)] *= gd
        b = (t >= off) & (t < off + up)
        gain[b] *= gd + (1 - gd) * (t[b] - off) / up
        took.append(round(20 * math.log10(gd), 2))
    return gain, took


def narrated(lines, demos):
    """The stretches the bed is at rest under: first word to last, less each
    demo's slot (its line's end to the bed's return after it)."""
    if not lines:
        return []
    segs = [(lines[0]["t0"], lines[-1]["t1"])]
    for d in demos:
        a, b = d["pause"], d["off"] + LADDER["bed_under_demo_up_s"]
        segs = [s for s0, s1 in segs for s in ((s0, min(s1, a)), (max(s0, b), s1)) if s[1] > s[0]]
    return segs


def demo_tail(x, t0, off, floor_db=None, hop_s=None):
    """How long after `off` the sound in x falls `floor_db` (the grammar's
    `demo_tail_db`, -30) under its playing level: the median of the RMS of its
    mono sum over `demo_tail_hop_s` (50 ms) frames between t0 and off. The tail
    ends at the first frame after `off` under that level plus `floor_db`.
    None if it never does."""
    floor_db = sound_defaults.TIMINGS["demo_tail_db"] if floor_db is None else floor_db
    hop_s = sound_defaults.TIMINGS["demo_tail_hop_s"] if hop_s is None else hop_s
    h = int(hop_s * SR)
    m = x.mean(axis=1)
    k = len(m) // h
    e = 20 * np.log10(np.sqrt((m[: k * h].reshape(k, h) ** 2).mean(axis=1)) + 1e-12)
    tt = np.arange(k) * hop_s
    play = (tt >= t0) & (tt <= off)
    if not play.any():
        return None
    ref = float(np.median(e[play]))
    after = np.flatnonzero((tt > off) & (e < ref + floor_db))
    return round(float(tt[after[0]] - off), 3) if len(after) else None


def score_stems(score, render_dir):
    """A film score's stems by role, each laid at its section's start: the
    score example writes one per track to stems/<section>/<track>.wav."""
    spb = 60.0 / score["tempo"]
    bpb = score.get("beats_per_bar", 4)
    role = {slug(t["name"]): t.get("role") for t in score["tracks"]}
    unknown = sorted(n for n, r in role.items() if r not in ROLE_PART)
    if unknown:
        sys.exit(f"mix.py: {', '.join(unknown)} in the score have no role the mix knows "
                 f"({', '.join(ROLE_PART)}); fit_score.py --film writes one on every track")
    S, at = {}, 0.0
    for sec in score["sections"]:
        d = os.path.join(render_dir, "stems", slug(sec["name"]))
        for name, r in role.items():
            f = os.path.join(d, f"{name}.wav")
            if not os.path.exists(f):
                continue
            x = load(f)
            i = int(round(at * SR))
            cur = S.get(r, np.zeros((0, 2), np.float32))
            if len(cur) < i + len(x):
                cur = np.concatenate([cur, np.zeros((i + len(x) - len(cur), 2), np.float32)])
            cur[i : i + len(x)] += x
            S[r] = cur
        at += sec["bars"] * bpb * spb
    if not S:
        sys.exit(f"mix.py: no stems under {render_dir}/stems/ for the score's tracks")
    return S


def slug(s):
    """The score example's file name for a track or section."""
    out = re.sub(r"[^a-z0-9]+", "_", s.lower())
    return out.strip("_")


# ---- the film ---------------------------------------------------------------

def parser():
    ap = argparse.ArgumentParser()
    ap.add_argument("film")
    ap.add_argument("--voice")
    ap.add_argument("--score", help="a film score from fit_score.py --film; --music is then its render")
    ap.add_argument("--music")
    ap.add_argument("--app", help="JSON list of {file, t, gain_db}: recorded app audio under footage")
    ap.add_argument("--encode", action="store_true")
    ap.add_argument("--draft", action="store_true",
                    help="with --encode: a fast MP4 and the preview only, for review (no WebM)")
    ap.add_argument("--preview", action="store_true",
                    help="with --encode: also FILM-preview.mp4, 720p, small enough to send")
    ap.add_argument("--poster", type=float)
    ap.add_argument("--target", type=float, default=sound_defaults.LADDER["master_lufs"],
                    help="integrated loudness, LUFS (default: sound.json ladder.master_lufs)")
    # One source: www/brand/sound.json's ladder and duck, through
    # sound_defaults.py. These override them for a trial mix; a film is mixed
    # at the defaults.
    ap.add_argument("--music-db", type=float, default=sound_defaults.LADDER["bed_rest_lu"],
                    help="the bed at rest against the voice, in LU (default: sound.json ladder.bed_rest_lu)")
    ap.add_argument("--duck-db", type=float, default=sound_defaults.DUCK["broadband_db"],
                    help="the bed's broadband duck under the voice (default: sound.json duck.broadband_db)")
    return ap


def main():
    args = parser().parse_args()

    fdir = os.path.join(VIDEO, "films", args.film)
    odir = os.path.join(VIDEO, "out", args.film)
    os.makedirs(odir, exist_ok=True)
    tl = read_json(os.path.join(fdir, "timeline.json"))
    n = int(math.ceil(tl["duration"] * SR)) + SR
    lines = sorted(tl["lines"], key=lambda l: l["t0"])
    demos = tl.get("demos") or []
    marks = {k: v for k, v in (tl.get("marks") or {}).items() if k in ("entrance", "exit")}
    arr_f = os.path.join(fdir, "arrangement.json")
    arr = read_json(arr_f) if os.path.exists(arr_f) else {}

    # No cues (ADR-014): whatever the picture still asks for is not laid.
    cues_f = os.path.join(odir, "cues.json")
    cues = read_json(cues_f) if os.path.exists(cues_f) else []
    if cues:
        names = sorted({c["name"] for c in cues})
        print(f"cues: {len(cues)} in cues.json ({', '.join(names)}) not laid: the films have no cues (ADR-014)")

    def lay(track, x, t, gain=1.0):
        i = int(round(t * SR))
        if i >= n:
            return
        j = min(n, i + len(x))
        track[max(i, 0) : j] += gain * x[max(0, -i) : j - i]

    # Narration: at its level, through the chain, at its level again.
    vo = np.zeros((n, 2), np.float32)
    if args.voice:
        man = read_json(os.path.join(args.voice, "manifest.json"))
        files = {l["id"]: os.path.join(args.voice, l["file"]) for l in man["lines"]}
        for line in lines:
            if line["id"] in files:
                lay(vo, load(files[line["id"]]), line["t0"])
        target = LADDER["narration_lufs"]
        lv = lufs(vo)
        vo *= 10 ** ((target - lv) / 20)
        vo, did = voice_chain(vo)
        vo *= 10 ** ((target - lufs(vo)) / 20)
        print(f"voice: {lv:.1f} LUFS → {target:.1f}; {'; '.join(did)}")
    if not np.isfinite(vo).all():
        sys.exit("mix.py: the narration holds samples that are not numbers; nothing written")
    env = voice_env(vo) if np.any(vo) else np.zeros(n)

    # The app's own sound: each demo window to the demo's level.
    app = np.zeros((n, 2), np.float32)
    if args.app:
        for a in read_json(args.app):
            x = load(a["file"])
            # A shot is recorded from before its beat to after it; only the
            # stretch its beat shows is heard (`from`/`to`, in film time),
            # faded in and out so a cut between shots never clicks.
            if "from" in a or "to" in a:
                x = x.copy()
                s0 = max(0, int(round((a.get("from", a["t"]) - a["t"]) * SR)))
                s1 = min(len(x), int(round((a.get("to", a["t"] + len(x) / SR) - a["t"]) * SR)))
                x[:s0] = 0
                x[s1:] = 0
                fi, fo = int(0.12 * SR), int(0.25 * SR)
                if s1 - s0 > fi + fo:
                    x[s0:s0 + fi] *= np.linspace(0, 1, fi, dtype=np.float32)[:, None]
                    x[s1 - fo:s1] *= np.linspace(1, 0, fo, dtype=np.float32)[:, None]
            lay(app, x, a["t"], 10 ** (a.get("gain_db", 0) / 20))
        if demos and np.any(app):
            slots = demo_slots(demos, lines, n / SR)
            for d, (s0, s1) in zip(demos, slots):
                la = lufs(cut(app, d["t0"], d["off"]))
                if la <= SOUNDING_LUFS:
                    print(f"  app: nothing plays in the demo at {d['t0']:.2f} s ({la:.1f} LUFS); left as it is", file=sys.stderr)
                    continue
                i, j = int(round(s0 * SR)), min(n, int(round(s1 * SR)))
                app[i:j] *= 10 ** ((LADDER["demo_lufs"] - la) / 20)
            print(f"app: {len(demos)} demo window{'s' if len(demos) != 1 else ''} → {LADDER['demo_lufs']:.1f} LUFS; "
                  "elsewhere at its gain_db")
        elif np.any(app):
            # Laid out before the grammar: the app plays under the voice, so
            # it keeps the duck it had until the film is re-timed.
            app = app_under_voice(app, env)
            print(f"app: no demos (laid out before the grammar): at its gain_db, ducked "
                  f"{-BEFORE_THE_GRAMMAR['app_duck_db']:g} dB under the voice as before")

    # The music: the bed and the marks, on stems; or a bed as one sound.
    bed = np.zeros((n, 2), np.float32)
    lead = np.zeros((n, 2), np.float32)
    rest = np.zeros((n, 2), np.float32)  # the bed at rest: before the duck, the dip and the demos
    pad_raw = pad_dipped = None
    took = {"marks": [], "demos": []}
    rest_at = LADDER["narration_lufs"] + args.music_db
    if args.score and args.music:
        score = read_json(args.score)
        placed = score.get("_film")
        if not placed:
            sys.exit(f"mix.py: {args.score} is not a film's score (no `_film`): write it with fit_score.py --film")
        # The score was written to a timeline; this must be that timeline.
        for k, at in (("entrance", placed.get("t0")), ("exit", placed.get("exit"))):
            want = marks.get(k)
            if (at is None) != (want is None) or (at is not None and abs(at - want) > 0.0015):
                sys.exit(f"mix.py: the score puts the {k} mark at {at} s and the timeline at {want} s: write the score "
                         f"again from this timeline (fit_score.py --film films/{args.film} {args.score})")
        t0 = placed["t0"]
        S = {}
        for r, x in score_stems(score, args.music).items():
            if not np.isfinite(x).all():
                sys.exit(f"mix.py: the score's {r} stems hold samples that are not numbers; nothing written")
            y = np.zeros((n, 2), np.float32)
            lay(y, place(r, x), t0)
            S[r] = y
        span = (lines[0]["t0"], lines[-1]["t1"]) if lines else (0.0, n / SR)
        g = part_gains(S, span)
        static = sum(S[r] * g[r] for r in BED_ROLES if r in S)
        segs = narrated(lines, demos) or [span]
        lb = lufs(np.concatenate([cut(static, a, b) for a, b in segs]))
        kb = 10 ** ((rest_at - lb) / 20)
        g = {r: v * kb for r, v in g.items()}
        try:
            cl, cp, took["marks"] = mark_gains(S, g, n, marks)
        except ValueError as e:
            sys.exit(f"mix.py: {e}")
        if "pad" in S:
            pad_raw = S["pad"] * g["pad"]
            pad_dipped = dip(pad_raw, env)
        for r in BED_ROLES:
            if r in S:
                rest += S[r] * g[r] * (cp[:, None] if r == "mpad" else 1)
                bed += (pad_dipped if r == "pad" else S[r] * g[r] * (cp[:, None] if r == "mpad" else 1))
        if "lead" in S:
            lead = S["lead"] * cl[:, None]
        print(f"music: {len(S)} parts on stems, the bed at rest {lb:.1f} LUFS → {rest_at:.1f}; "
              + "; ".join(f"{m['mark']} {m['scale_db']:+.1f} dB" for m in took["marks"]))
    elif args.music:
        one = os.path.join(args.music, "bed.wav")
        if os.path.exists(one):
            lay(bed, load(one), 0.0)
        else:
            for sec in arr["sections"]:
                f = os.path.join(args.music, f"{sec['section']}.wav")
                if os.path.exists(f):
                    lay(bed, load(f), sec["t0"])
                else:
                    print(f"  (no {f})", file=sys.stderr)
        ml = lufs(bed)
        bed *= 10 ** ((rest_at - ml) / 20)
        rest = bed.copy()
        print(f"music: {ml:.1f} LUFS → {rest_at:.1f}")

    if np.any(bed):
        # The bed's levels (arrangement.json `levels`, from each beat's
        # bed_db): 0 dB is the bed as mixed. Each change ramps over 0.4 s;
        # -60 dB is out.
        levels = arr.get("levels")
        if levels:
            gain = np.ones(n, np.float32)
            ramp = int(0.4 * SR)
            cur = 1.0
            for at, db in sorted(levels):
                gl = 0.0 if db <= -60 else 10 ** (db / 20)
                i = max(0, min(n, int(round(at * SR))))
                j = min(n, i + ramp)
                if j > i:
                    gain[i:j] = np.linspace(cur, gl, j - i, endpoint=False, dtype=np.float32)
                gain[j:] = gl
                cur = gl
            bed *= gain[:, None]
            rest *= gain[:, None]
            print(f"music: {len(levels)} bed levels")
        if demos:
            gain, took["demos"] = demo_ramp(bed, demos, n)
            bed *= gain[:, None]
            print(f"music: under {len(demos)} demo{'s' if len(demos) != 1 else ''}, "
                  + ", ".join(f"{g:+.1f} dB" for g in took["demos"]))
        bed_unducked = bed.copy()
        bed = under_voice(bed, env, args.duck_db)
    else:
        bed_unducked = bed

    mix = vo + bed + lead + app
    end = int(tl["duration"] * SR)
    mix = mix[:end]
    # A short fade at each end, so no film starts or stops on a click.
    f = int(0.02 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-f:] *= np.linspace(1, 0, f)[:, None]
    if not np.isfinite(mix).all():
        sys.exit("mix.py: the mix has samples that are not numbers (NaN or infinite); nothing written")
    l0 = lufs(mix)
    if l0 <= -70:
        sys.exit("mix.py: the mix is silent (under the -70 LUFS gate); nothing written")
    master = 10 ** ((args.target - l0) / 20)
    mix = limiter(mix * master)
    if not np.isfinite(mix).all():
        sys.exit("mix.py: the mastered mix has samples that are not numbers; nothing written")
    l1 = lufs(mix)
    tp = true_peak_db(mix)
    write(os.path.join(odir, "mix.wav"), mix)
    print(f"mix: {l0:.1f} → {l1:.1f} LUFS, true peak {tp:.2f} dBTP, {len(mix) / SR:.2f} s")

    report = measure(dict(voice=vo[:end], bed=bed[:end], bed_unducked=bed_unducked[:end], rest=rest[:end],
                          lead=lead[:end], app=app[:end], master=mix),
                     env[:end], lines, demos, marks, took,
                     None if pad_raw is None else (pad_raw[:end], pad_dipped[:end]))
    report["master"].update(gain_db=round(20 * math.log10(master), 2))
    dump_json(report, os.path.join(odir, "ladder.json"))
    r = report["ladder"]
    def num(v, f):  # a measure the mix has none of (no voice, no bed) reads as a dash
        return "–" if v is None else format(v, f)

    print(f"ladder: voice {num(r['voice_lufs'], '.1f')} LUFS, bed at rest {num(r['bed_rest_vs_voice_lu'], '+.1f')} LU, "
          f"under the voice {num(r['duck_db'], '+.1f')} dB, {num(r['carve_db'], '+.1f')} dB more in "
          f"{CARVE['band_hz'][0]}-{CARVE['band_hz'][1]} Hz")

    # Envelopes for the picture.
    tl["env"] = {
        "music": {"rate": 60, "v": envelope((bed + lead)[:end])},
        "voice": {"rate": 60, "v": envelope(vo[:end])},
    }
    dump_json(tl, os.path.join(fdir, "timeline.json"))

    # Captions from the narration's own timing.
    vtt = ["WEBVTT", ""]
    for i, line in enumerate(tl["lines"], 1):
        for k, (a, b, text) in enumerate(split_cue(line)):
            vtt += [f"{fmt(a)} --> {fmt(b)}", text, ""]
    with open(os.path.join(odir, f"{args.film}.vtt"), "w") as f:
        f.write("\n".join(vtt))

    if args.encode:
        pic = picture_input(odir)
        ff = ffmpeg()
        mp4 = os.path.join(odir, f"{args.film}.mp4")
        webm = os.path.join(odir, f"{args.film}.webm")
        prev = os.path.join(odir, f"{args.film}-preview.mp4")
        wav = os.path.join(odir, "mix.wav")
        av = [ff, "-y", "-loglevel", "error", *pic, "-i", wav, "-map", "0:v", "-map", "1:a"]
        # The encodes run side by side: each decodes the picture itself, and
        # x264 and VP9 each leave cores idle that the other uses. One after the
        # other they took about twenty minutes for a five-minute film.
        jobs = {}
        if args.draft:
            # For review: the same picture and mix, encoded fast. Publish
            # needs the full encode (drop --draft).
            jobs[mp4] = [*av, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-tune", "animation",
                         "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-shortest", mp4]
        else:
            jobs[mp4] = [*av, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-tune", "animation", "-pix_fmt", "yuv420p",
                         "-profile:v", "high", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-shortest", mp4]
            jobs[webm] = [*av, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
                          "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "128k", "-shortest", webm]
        if args.preview or args.draft:
            # 720p: uploads for review stop at 30 MB, and an iPhone plays no WebM.
            jobs[prev] = [*av, "-vf", "scale=1280:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
                          "-tune", "animation", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k",
                          "-shortest", prev]
        procs = {out: subprocess.Popen(cmd) for out, cmd in jobs.items()}
        failed = [out for out, pr in procs.items() if pr.wait() != 0]
        if failed:
            sys.exit(f"encode failed: {', '.join(failed)}")
        for p in jobs:
            print(f"{p}: {os.path.getsize(p) / 1e6:.1f} MB")
    if args.poster is not None:
        ff = ffmpeg()
        pic = picture_input(odir)
        jpg = os.path.join(odir, f"{args.film}.jpg")
        subprocess.run([ff, "-y", "-loglevel", "error", "-ss", str(args.poster), *pic, "-frames:v", "1", "-q:v", "3", jpg], check=True)
        subprocess.run([ff, "-y", "-loglevel", "error", "-ss", str(args.poster), *pic, "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", os.path.join(odir, f"{args.film}.webp")], check=True)
        print(jpg)


def demo_slots(demos, lines, end):
    """Each demo's slot: from its line's end to the next line's start (or the
    next demo's, or the film's end). The app's gain for the demo holds over
    it, so the demo's tail rings out at the demo's level."""
    starts = sorted([l["t0"] for l in lines] + [d["pause"] for d in demos])
    out = []
    for d in demos:
        nxt = [s for s in starts if s > d["off"]]
        out.append((d["pause"], nxt[0] if nxt else end))
    return out


# ---- the mix, measured -------------------------------------------------------

def _db(a, b):
    return round(10 * math.log10((a + 1e-20) / (b + 1e-20)), 2)


def _band(x, lo, hi):
    return sosfiltfilt(_sos(MIX["band_split_order"], [lo, hi], "band"), x, axis=0)


def stem_loudness(x):
    """A stem's integrated loudness and its short-term loudness (3 s) where it
    sounds: the loudest and the median."""
    if not np.any(x):
        return None
    _, st = short_term(x)
    on = st[st > SOUNDING_LUFS]
    return {"integrated_lufs": round(lufs(x), 2),
            "short_term_max_lufs": round(float(st.max()), 2) if len(st) else None,
            "short_term_median_lufs": round(float(np.median(on)), 2) if len(on) else None}


def measure(st, env, lines, demos, marks, took, pad=None):
    """The mix against the ladder (written to out/FILM/ladder.json). Levels
    are before the master's gain unless named `master`."""
    speech = env > 0.5
    out = {"stems": {k: stem_loudness(st[k]) for k in ("voice", "bed", "lead", "app")}}
    voice = st["voice"]
    lv = lufs(voice) if np.any(voice) else None
    segs = narrated(lines, demos)
    rest = lufs(np.concatenate([cut(st["rest"], a, b) for a, b in segs])) if segs and np.any(st["rest"]) else None
    ladder = {"voice_lufs": round(lv, 2) if lv is not None else None,
              "bed_rest_lufs": round(rest, 2) if rest is not None else None,
              "bed_rest_vs_voice_lu": round(rest - lv, 2) if rest is not None and lv is not None else None,
              "duck_db": None, "carve_db": None, "pad_dip_db": None, "voice_over_bed_db": None}
    if speech.any() and np.any(st["bed"]):
        lo, band, hi = split(st["bed"], *CARVE["band_hz"])
        lo0, band0, hi0 = split(st["bed_unducked"], *CARVE["band_hz"])
        outside = _db(np.sum((lo + hi)[speech] ** 2), np.sum((lo0 + hi0)[speech] ** 2))
        ladder["duck_db"] = outside
        ladder["carve_db"] = round(_db(np.sum(band[speech] ** 2), np.sum(band0[speech] ** 2)) - outside, 2)
        if pad is not None:
            b0, b1 = (_band(p, *PAD_DIP["band_hz"]) for p in pad)
            ladder["pad_dip_db"] = _db(np.sum(b1[speech] ** 2), np.sum(b0[speech] ** 2))
        ratio = {}
        for lo_hz, hi_hz in ((125, 250), (250, 1000), (1000, 4000)):
            v, b = _band(voice, lo_hz, hi_hz), _band(st["bed"], lo_hz, hi_hz)
            ratio[f"{lo_hz}-{hi_hz}"] = _db(np.sum(v[speech] ** 2), np.sum(b[speech] ** 2))
        ratio["broadband"] = _db(np.sum(voice[speech] ** 2), np.sum(st["bed"][speech] ** 2))
        ladder["voice_over_bed_db"] = ratio
    out["ladder"] = ladder

    music = st["rest"] + st["lead"]
    out["marks"] = []
    for m in took["marks"]:
        a = m["t0"]
        out["marks"].append(dict(m, span_lufs=round(lufs(cut(music, a, a + MARKS["length_s"])), 2)))

    out["demos"] = []
    for k, d in enumerate(demos):
        t0, off = d["t0"], d["off"]
        row = {"line": d.get("line"), "t0": t0, "off": off}
        if np.any(st["app"]):
            row["demo_lufs"] = round(lufs(cut(st["app"], t0, off)), 2)
            row["tail_s"] = demo_tail(st["app"], t0, off)
            _, md = momentary(cut(st["app"], t0 + LADDER["bed_under_demo_down_s"], off))
            _, mb = momentary(cut(st["bed"], t0 + LADDER["bed_under_demo_down_s"], off))
            if len(md) and len(mb):
                row["demo_over_bed_db"] = round(float(np.median(md - mb)), 2)
                row["bed_momentary_lufs"] = [round(float(mb.min()), 2), round(float(mb.max()), 2)]
        row["bed_gain_db"] = took["demos"][k] if k < len(took["demos"]) else None
        out["demos"].append(row)

    timing = {}
    if lines and marks.get("entrance") is not None:
        timing["entrance_end_to_first_word_s"] = round(lines[0]["t0"] - marks["entrance"] - MARKS["length_s"], 3)
    if lines and marks.get("exit") is not None:
        timing["last_word_to_exit_s"] = round(marks["exit"] - lines[-1]["t1"], 3)
    for d in demos:
        timing.setdefault("demos", []).append({
            "line_end_to_demo_s": round(d["t0"] - d["pause"], 3),
            "tail_s": d.get("tail_s"),
            "off_to_next_word_s": round(d["next"] - d["off"], 3) if d.get("next") is not None else None})
    out["timing"] = timing
    out["master"] = {"integrated_lufs": round(lufs(st["master"]), 2), "true_peak_dbtp": round(float(true_peak_db(st["master"])), 2),
                     "length_s": round(len(st["master"]) / SR, 3)}
    return out


def picture_input(odir):
    """ffmpeg input arguments for the rendered picture: the parts render.mjs
    left, through their ffconcat list, or one picture.mkv (an --out render,
    or an older one)."""
    lst = os.path.join(odir, "picture.ffconcat")
    if os.path.exists(lst):
        return ["-f", "concat", "-safe", "0", "-i", lst]
    return ["-i", os.path.join(odir, "picture.mkv")]


def fmt(t):
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def split_cue(line, maxc=42):
    """A narration line as caption cues of at most two lines of `maxc` characters."""
    words = line["text"].split()
    chunks, cur = [], []
    for w in words:
        if len(" ".join(cur + [w])) > 2 * maxc or (cur and cur[-1].endswith((".", "?", "!")) and len(" ".join(cur)) > 20):
            chunks.append(cur)
            cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    total = sum(len(" ".join(c)) for c in chunks)
    t = line["t0"]
    out = []
    for c in chunks:
        text = " ".join(c)
        d = (line["t1"] - line["t0"]) * len(text) / max(total, 1)
        # Break a long cue into two balanced lines.
        if len(text) > maxc:
            best = min(range(1, len(c)), key=lambda k: abs(len(" ".join(c[:k])) - len(" ".join(c[k:]))))
            text = " ".join(c[:best]) + "\n" + " ".join(c[best:])
        out.append((t, t + max(d, 1.0), text))
        t += d
    return out


if __name__ == "__main__":
    main()
