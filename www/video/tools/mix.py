#!/usr/bin/env python3
"""Lay a film's sound in, mix it, and encode the film for the web.

usage: mix.py FILM [--voice DIR] [--music DIR] [--sfx DIR] [--encode] [--poster T]

Reads www/video/films/FILM/timeline.json (tools/timeline.py) and
www/video/out/FILM/cues.json (render.mjs --cues), and writes to
www/video/out/FILM/:

  mix.wav        48 kHz stereo, -16 LUFS integrated, true peak under -1 dBTP
  FILM.mp4       H.264 + AAC, faststart          (with --encode)
  FILM.webm      VP9 + Opus                      (with --encode)
  FILM.vtt       captions, from the narration's own timing
  FILM.jpg/.webp the poster frame                (with --poster, seconds)

and writes the music's envelope back into timeline.json (`env.music`,
`env.voice`, 60 Hz), so a scene can pulse with the sound it sits on. Render
the picture again after the first mix and the glows land on the beat.

Sources:
  --voice DIR   voice/tts.py output: manifest.json and one WAV per line
  --music DIR   either bed.wav (the whole film), or one WAV per section named
                as in arrangement.json (`<section>.wav`, bar-aligned, each
                starting at its section's t0)
  --sfx DIR     one WAV per cue name in cues.json (whoosh.wav, blip.wav, …)

The mix is plain arithmetic, so it is repeatable: narration at a fixed level,
the music ducked under it by an envelope follower (80 ms attack, 450 ms
release, -9 dB), effects on top, then one gain to the loudness target and a
look-ahead peak limiter. Loudness is ITU-R BS.1770-4 (K-weighted, gated),
computed here rather than trusted to a filter's defaults.
"""
import argparse
import json
import math
import os
import subprocess
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import lfilter, resample_poly

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


# ---- loudness (ITU-R BS.1770-4) ------------------------------------------

def k_weight(x, sr=SR):
    # Stage 1: high shelf; stage 2: RLB highpass (coefficients for 48 kHz).
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
    a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, -1.99004745483398, 0.99007225036621]
    return lfilter(b2, a2, lfilter(b1, a1, x, axis=0), axis=0)


def lufs(x):
    y = k_weight(x)
    blk = int(0.4 * SR)
    hop = int(0.1 * SR)
    if len(y) < blk:
        return -70.0
    ms = []
    for i in range(0, len(y) - blk + 1, hop):
        seg = y[i : i + blk]
        ms.append(float(np.sum(np.mean(seg**2, axis=0))))
    ms = np.array(ms)
    l = -0.691 + 10 * np.log10(ms + 1e-12)
    g = ms[l > -70]
    if not len(g):
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(g)) - 10
    g2 = ms[(l > -70) & (l > rel)]
    return float(-0.691 + 10 * np.log10(np.mean(g2)))


def true_peak_db(x):
    up = resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.max(np.abs(up)) + 1e-12)


def limiter(x, ceiling_db=-1.2, look_ms=5.0, release_ms=80.0):
    """A look-ahead peak limiter on 4x-oversampled (inter-sample) peaks."""
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


def follower(mask, attack_ms=80, release_ms=450):
    a = math.exp(-1.0 / (attack_ms * SR / 1000))
    r = math.exp(-1.0 / (release_ms * SR / 1000))
    out = np.empty_like(mask)
    cur = 0.0
    for i, m in enumerate(mask):
        k = a if m > cur else r
        cur = m + (cur - m) * k
        out[i] = cur
    return out


# ---- the film ---------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("film")
    ap.add_argument("--voice")
    ap.add_argument("--music")
    ap.add_argument("--sfx")
    ap.add_argument("--app", help="JSON list of {file, t, gain_db}: recorded app audio under footage")
    ap.add_argument("--encode", action="store_true")
    ap.add_argument("--poster", type=float)
    ap.add_argument("--target", type=float, default=-16.0, help="integrated loudness, LUFS")
    ap.add_argument("--music-db", type=float, default=-9.0, help="music level relative to the voice, before ducking")
    ap.add_argument("--duck-db", type=float, default=-8.0)
    args = ap.parse_args()

    fdir = os.path.join(VIDEO, "films", args.film)
    odir = os.path.join(VIDEO, "out", args.film)
    os.makedirs(odir, exist_ok=True)
    tl = json.load(open(os.path.join(fdir, "timeline.json")))
    n = int(math.ceil(tl["duration"] * SR)) + SR
    vo = np.zeros((n, 2), np.float32)
    music = np.zeros((n, 2), np.float32)
    fx = np.zeros((n, 2), np.float32)

    def lay(track, x, t, gain=1.0):
        i = int(round(t * SR))
        if i >= n:
            return
        j = min(n, i + len(x))
        track[max(i, 0) : j] += gain * x[max(0, -i) : j - i]

    # Narration.
    if args.voice:
        man = json.load(open(os.path.join(args.voice, "manifest.json")))
        files = {l["id"]: os.path.join(args.voice, l["file"]) for l in man["lines"]}
        for line in tl["lines"]:
            if line["id"] in files:
                lay(vo, load(files[line["id"]]), line["t0"])
        # Speech sits at -18 LUFS before the mix is normalised.
        lv = lufs(vo)
        vo *= 10 ** ((-18 - lv) / 20)
        print(f"voice: {lv:.1f} LUFS → -18.0")

    # Music: one bed, or the arrangement's sections.
    if args.music:
        bed = os.path.join(args.music, "bed.wav")
        if os.path.exists(bed):
            lay(music, load(bed), 0.0)
        else:
            arr = json.load(open(os.path.join(fdir, "arrangement.json")))
            for sec in arr["sections"]:
                f = os.path.join(args.music, f"{sec['section']}.wav")
                if os.path.exists(f):
                    lay(music, load(f), sec["t0"])
                else:
                    print(f"  (no {f})", file=sys.stderr)
        ml = lufs(music)
        music *= 10 ** ((-18 + args.music_db - ml) / 20)
        print(f"music: {ml:.1f} LUFS → {-18 + args.music_db:.1f}")

    # Effects, at the times the picture shows them.
    cues_f = os.path.join(odir, "cues.json")
    if args.sfx and os.path.exists(cues_f):
        cache = {}
        for c in json.load(open(cues_f)):
            f = os.path.join(args.sfx, f"{c['name']}.wav")
            if not os.path.exists(f):
                continue
            if f not in cache:
                x = load(f)
                cache[f] = x * 10 ** ((-24 - lufs(x)) / 20) if len(x) > 0.4 * SR else x * (0.25 / (np.max(np.abs(x)) + 1e-9))
            lay(fx, cache[f], c["t"], 10 ** (c.get("gain", 0) / 20))

    app = np.zeros((n, 2), np.float32)
    if args.app:
        for a in json.load(open(args.app)):
            lay(app, load(a["file"]), a["t"], 10 ** (a.get("gain_db", 0) / 20))

    # Duck the music (and the app's own sound) under the narration.
    if args.voice and np.any(vo):
        hop = 240
        m = np.sqrt(np.mean(vo[: len(vo) // hop * hop].reshape(-1, hop, 2) ** 2, axis=(1, 2)))
        mask = (20 * np.log10(m + 1e-9) > -45).astype(np.float64)
        mask = np.repeat(mask, hop)
        mask = np.concatenate([mask, np.zeros(n - len(mask))])
        env = follower(mask)
        duck = 10 ** (args.duck_db * env / 20)
        music *= duck[:, None].astype(np.float32)
        app *= (10 ** (0.5 * args.duck_db * env / 20))[:, None].astype(np.float32)

    mix = vo + music + fx + app
    end = int(tl["duration"] * SR)
    mix = mix[:end]
    # A short fade at each end, so no film starts or stops on a click.
    f = int(0.02 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-f:] *= np.linspace(1, 0, f)[:, None]
    l0 = lufs(mix)
    mix *= 10 ** ((args.target - l0) / 20)
    mix = limiter(mix)
    l1 = lufs(mix)
    tp = true_peak_db(mix)
    write(os.path.join(odir, "mix.wav"), mix)
    print(f"mix: {l0:.1f} → {l1:.1f} LUFS, true peak {tp:.2f} dBTP, {len(mix) / SR:.2f} s")

    # Envelopes for the picture.
    tl["env"] = {
        "music": {"rate": 60, "v": envelope(music[:end])},
        "voice": {"rate": 60, "v": envelope(vo[:end])},
    }
    json.dump(tl, open(os.path.join(fdir, "timeline.json"), "w"), indent=1, ensure_ascii=False)

    # Captions from the narration's own timing.
    vtt = ["WEBVTT", ""]
    for i, line in enumerate(tl["lines"], 1):
        for k, (a, b, text) in enumerate(split_cue(line)):
            vtt += [f"{fmt(a)} --> {fmt(b)}", text, ""]
    open(os.path.join(odir, f"{args.film}.vtt"), "w").write("\n".join(vtt))

    if args.encode:
        pic = os.path.join(odir, "picture.mkv")
        ff = ffmpeg()
        mp4 = os.path.join(odir, f"{args.film}.mp4")
        webm = os.path.join(odir, f"{args.film}.webm")
        wav = os.path.join(odir, "mix.wav")
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", pic, "-i", wav, "-map", "0:v", "-map", "1:a",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-tune", "animation", "-pix_fmt", "yuv420p",
                        "-profile:v", "high", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-shortest", mp4], check=True)
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", pic, "-i", wav, "-map", "0:v", "-map", "1:a",
                        "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
                        "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "128k", "-shortest", webm], check=True)
        for p in (mp4, webm):
            print(f"{p}: {os.path.getsize(p) / 1e6:.1f} MB")
    if args.poster is not None:
        ff = ffmpeg()
        pic = os.path.join(odir, "picture.mkv")
        jpg = os.path.join(odir, f"{args.film}.jpg")
        subprocess.run([ff, "-y", "-loglevel", "error", "-ss", str(args.poster), "-i", pic, "-frames:v", "1", "-q:v", "3", jpg], check=True)
        subprocess.run([ff, "-y", "-loglevel", "error", "-ss", str(args.poster), "-i", pic, "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", os.path.join(odir, f"{args.film}.webp")], check=True)
        print(jpg)


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
