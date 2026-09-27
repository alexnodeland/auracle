#!/usr/bin/env python3
"""Measure every WAV the score renderer wrote: loudness, peaks, DC, band balance
and, for loops, the seam.

usage: analyze.py DIR [DIR ...] [--md OUT.md] [--json OUT.json]

DIR is one score's output folder (e.g. .../sound/signal); its mixes and every
stem under stems/ are measured. Needs numpy, scipy and pyloudnorm.

Columns
  LUFS      integrated loudness, ITU-R BS.1770-4 (pyloudnorm). Files shorter
            than one 400 ms gating block are measured zero-padded to 400 ms.
  M max     loudest momentary (400 ms) loudness, LUFS.
  peak      sample peak, dBFS.   TP  true peak, dBTP (4x oversampled).
  DC        largest channel mean, dBFS.
  low/mid/high  share of signal energy below 120 Hz, 120 Hz-4 kHz, above 4 kHz.

Loops (a file listed as `loop` in manifest.json) also get a seam check: the jump
from the last sample to the first, set against the file's own distribution of
sample-to-sample steps. A seam is clean when the jump is an ordinary step.
"""
import json
import math
import os
import struct
import sys

import numpy as np
import pyloudnorm
from scipy.signal import resample_poly


def read_wav(path):
    b = open(path, "rb").read()
    assert b[:4] == b"RIFF" and b[8:12] == b"WAVE", path
    i, fmt, data = 12, None, None
    while i < len(b):
        cid, sz = b[i:i + 4], struct.unpack("<I", b[i + 4:i + 8])[0]
        body = b[i + 8:i + 8 + sz]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
        elif cid == b"data":
            data = body
        i += 8 + sz + (sz & 1)
    _, ch, sr, _, _, bits = fmt
    assert bits == 24, f"{path}: {bits}-bit"
    a = np.frombuffer(data, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
    v = a[:, 0] | (a[:, 1] << 8) | (a[:, 2] << 16)
    v = np.where(v >= 1 << 23, v - (1 << 24), v)
    return (v.astype(np.float64) / 8388608.0).reshape(-1, ch), sr


def db(x):
    return 20 * math.log10(x) if x > 0 else float("-inf")


def measure(x, sr):
    meter = pyloudnorm.Meter(sr)
    y = x if len(x) >= int(0.4 * sr) else np.vstack([x, np.zeros((int(0.4 * sr) - len(x), x.shape[1]))])
    with np.errstate(divide="ignore"):
        lufs = meter.integrated_loudness(y)
    # Momentary: 400 ms windows, 100 ms hop.
    hop, win = int(0.1 * sr), int(0.4 * sr)
    mmax = float("-inf")
    # pyloudnorm's own K-weighting stages, one channel at a time.
    kw = y.copy()
    for f in meter._filters.values():
        for j in range(kw.shape[1]):
            kw[:, j] = f.apply_filter(kw[:, j])
    p = (kw ** 2).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    for s in range(0, max(1, len(p) - win + 1), hop):
        e = (c[s + win] - c[s]) / win
        if e > 0:
            mmax = max(mmax, -0.691 + 10 * math.log10(e))
    peak = float(np.abs(x).max())
    tp = max(float(np.abs(resample_poly(x[:, j], 4, 1)).max()) for j in range(x.shape[1]))
    dc = float(np.abs(x.mean(axis=0)).max())
    spec = np.zeros(len(x) // 2 + 1)
    for j in range(x.shape[1]):
        spec += np.abs(np.fft.rfft(x[:, j])) ** 2
    f = np.fft.rfftfreq(len(x), 1 / sr)
    tot = spec.sum() or 1e-30
    bands = (spec[f < 120].sum() / tot, spec[(f >= 120) & (f < 4000)].sum() / tot, spec[f >= 4000].sum() / tot)
    return {
        "seconds": len(x) / sr,
        "lufs": lufs,
        "momentary_max": mmax,
        "peak_dbfs": db(peak),
        "true_peak_dbtp": db(max(tp, peak)),
        "dc_dbfs": db(dc),
        "finite": bool(np.isfinite(x).all()),
        "low": bands[0],
        "mid": bands[1],
        "high": bands[2],
    }


def seam(x):
    """The wrap from the last sample to the first, against the file's steps."""
    d = np.abs(np.diff(x, axis=0)).max(axis=1)
    wrap = float(np.abs(x[0] - x[-1]).max())
    # Second difference (curvature) across the seam, against the same inside.
    d2 = np.abs(x[2:] - 2 * x[1:-1] + x[:-2]).max(axis=1)
    w2 = float(max(np.abs(x[1] - 2 * x[0] + x[-1]).max(), np.abs(x[0] - 2 * x[-1] + x[-2]).max()))
    # Level either side of the seam, 50 ms windows.
    n = 2400
    rms_end = float(np.sqrt(np.mean(x[-n:] ** 2)))
    rms_start = float(np.sqrt(np.mean(x[:n] ** 2)))
    return {
        "wrap_step": wrap,
        "median_step": float(np.median(d)),
        "p99_step": float(np.percentile(d, 99)),
        "max_step": float(d.max()),
        "wrap_percentile": float((d < wrap).mean() * 100),
        "wrap_curvature": w2,
        "p99_curvature": float(np.percentile(d2, 99)),
        "rms_last_50ms_dbfs": db(rms_end),
        "rms_first_50ms_dbfs": db(rms_start),
    }


def main():
    args = sys.argv[1:]
    md_out = js_out = None
    dirs = []
    while args:
        a = args.pop(0)
        if a == "--md":
            md_out = args.pop(0)
        elif a == "--json":
            js_out = args.pop(0)
        else:
            dirs.append(a)
    rows, seams = [], []
    for d in dirs:
        man = json.load(open(os.path.join(d, "manifest.json")))
        for f in man["files"]:
            files = [(f["file"], "mix")] + [(s["file"], s["track"]) for s in f["stems"]]
            for rel, what in files:
                x, sr = read_wav(os.path.join(d, rel))
                m = measure(x, sr)
                m.update(score=man["title"], file=f"{os.path.basename(d)}/{rel}", window=f["window"], kind=what)
                rows.append(m)
                if f["loop"]:
                    s = seam(x)
                    s.update(file=f"{os.path.basename(d)}/{rel}", kind=what)
                    seams.append(s)
    fmt = lambda v: "-inf" if v == float("-inf") else f"{v:.1f}"
    lines = ["| file | s | LUFS | M max | peak dBFS | TP dBTP | DC dBFS | low % | mid % | high % |",
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for r in rows:
        lines.append(f"| {r['file']} | {r['seconds']:.2f} | {fmt(r['lufs'])} | {fmt(r['momentary_max'])} | "
                     f"{fmt(r['peak_dbfs'])} | {fmt(r['true_peak_dbtp'])} | {fmt(r['dc_dbfs'])} | "
                     f"{r['low'] * 100:.1f} | {r['mid'] * 100:.1f} | {r['high'] * 100:.1f} |")
    if seams:
        lines += ["", "| loop file | wrap step | median step | p99 step | max step | wrap pctile | wrap curvature | p99 curvature | last 50 ms | first 50 ms |",
                  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for s in seams:
            lines.append(f"| {s['file']} | {s['wrap_step']:.2e} | {s['median_step']:.2e} | {s['p99_step']:.2e} | "
                         f"{s['max_step']:.2e} | {s['wrap_percentile']:.1f} | {s['wrap_curvature']:.2e} | "
                         f"{s['p99_curvature']:.2e} | {fmt(s['rms_last_50ms_dbfs'])} | {fmt(s['rms_first_50ms_dbfs'])} |")
    bad = [r for r in rows if r["true_peak_dbtp"] > -1.0 or not r["finite"] or r["dc_dbfs"] > -60]
    lines += ["", f"{len(rows)} files; over -1 dBTP, non-finite or DC above -60 dBFS: {len(bad)}"]
    lines += [f"  {r['file']}: TP {r['true_peak_dbtp']:.2f}, DC {r['dc_dbfs']:.1f}" for r in bad]
    text = "\n".join(lines)
    print(text)
    if md_out:
        open(md_out, "w").write(text + "\n")
    if js_out:
        json.dump({"files": rows, "seams": seams}, open(js_out, "w"), indent=1)


if __name__ == "__main__":
    main()
