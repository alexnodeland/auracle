#!/usr/bin/env python3
"""Round-trip check for a narration render: does the WAV say what the script says?

    python www/video/voice/asr_check.py OUT_DIR [OUT_DIR ...] [--pitch]

Nobody on this project can listen to the narration, so it is measured. For each
OUT_DIR written by tts.py (manifest.json plus one WAV per line) this

  1. transcribes every line WAV with faster-whisper (small.en, CPU, int8). The
     decoder gets no prompt and no vocabulary: a prompt would teach it the
     script's spellings and hide exactly the mispronunciations this is for;
  2. normalizes script and transcript the same way (case, punctuation, numbers
     to words, "φ" to "phi", "Auracle" to its homophone "oracle") and scores
     word error rate per line;
  3. measures the speaking rate, the leading and trailing silence, the peak and
     any clipped samples, and with --pitch the F0 variability (standard
     deviation in semitones over voiced frames, librosa.pyin) as a proxy for
     monotony;
  4. prints the aligned diff for every line over --max-wer (0.10).

It also writes each line's word start times into manifest.json as `words`
(one per whitespace-separated word of the script text, seconds from the start
of the line's WAV): faster-whisper's word timestamps, DP-aligned to the script.
A word Whisper missed, or placed more than 150 ms from Kokoro's own alignment,
takes Kokoro's time instead (see word_starts() for the measurement behind that).
The films pin kinetic type and on-screen actions to them.

It writes asr_report.json into each OUT_DIR and, given several, ends with one
summary row per render (a voice comparison). Exit code 1 if any line fails:
WER over the limit, a clipped sample, or a missing file. So it can gate a render:

    python tts.py script.json -o out && python asr_check.py out && make-the-film

Known blind spot: Whisper writes what it thinks was *meant*. A word it would
spell the same however it is said (say, "Jacobian" read with the wrong stress)
passes. Read manifest.json's per-line `phonemes` for those.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np

ASR_SR = 16_000
TARGET_WPM = 160

# Spoken names for symbols a narration script might contain.
_GREEK = {
    "φ": "phi", "ϕ": "phi", "Φ": "phi", "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta",
    "Δ": "delta", "ε": "epsilon", "θ": "theta", "λ": "lambda", "μ": "mu", "π": "pi", "σ": "sigma",
    "Σ": "sigma", "τ": "tau", "ω": "omega", "Ω": "omega",
}
_SYMBOLS = {"&": " and ", "%": " percent ", "+": " plus ", "=": " equals ", "@": " at "}
# Spellings Whisper may pick that are not errors.
_SPELLING = {
    "synthesiser": "synthesizer", "synthesisers": "synthesizers", "okay": "ok",
    "colour": "color", "modelling": "modeling", "behaviour": "behavior",
}
# Homophones the script intends. "Auracle" is pronounced exactly like "oracle",
# so an unprompted recognizer writing "Oracle" is the pass condition.
DEFAULT_ALIASES = {"auracle": "oracle", "auracles": "oracles"}


def default_models_dir() -> Path:
    env = os.environ.get("AURACLE_VOICE_MODELS")
    return Path(env) if env else Path.home() / ".cache" / "auracle-voice"


# ─── text ────────────────────────────────────────────────────────────────────


def _number(tok: str) -> str:
    from num2words import num2words

    tok = tok.replace(",", "")
    try:
        return num2words(float(tok) if "." in tok else int(tok))
    except (ValueError, OverflowError):
        return tok


def normalize(text: str, aliases: dict[str, str]) -> list[str]:
    from num2words import num2words

    s = unicodedata.normalize("NFKC", text)
    for k, v in _GREEK.items():
        s = s.replace(k, f" {v} ")
    for k, v in _SYMBOLS.items():
        s = s.replace(k, v)
    s = s.replace("’", "'").replace("‘", "'").lower()
    s = re.sub(r"(\d+)(st|nd|rd|th)\b", lambda m: f" {num2words(int(m.group(1)), to='ordinal')} ", s)
    s = re.sub(r"\d[\d,]*(?:\.\d+)?", lambda m: f" {_number(m.group(0))} ", s)
    # A sibilant's possessive is spoken like its plural: patch's = patches.
    s = re.sub(r"\b(\w+?(?:s|x|z|ch|sh))'s\b", r"\1es", s)
    s = s.replace("'", "")  # that's -> thats, on both sides
    # Everything else is a separator, so "W.A.S.M." and "W-A-S-M" come out as
    # four words and fail against "wasm", as a spelled-out acronym should.
    s = re.sub(r"[^a-z0-9]+", " ", s)
    out: list[str] = []
    for w in s.split():
        w = _SPELLING.get(w, w)
        out.extend(aliases.get(w, w).split())
    return out


def align(ref: list[str], hyp: list[str]) -> list[tuple[str, int | None, int | None]]:
    """Levenshtein alignment: (op, ref_index, hyp_index), op in = S D I."""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]), d[i - 1, j] + 1, d[i, j - 1] + 1)
    ops = []
    i, j = n, m
    while i or j:
        if i and j and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            ops.append(("=" if ref[i - 1] == hyp[j - 1] else "S", i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i and d[i, j] == d[i - 1, j] + 1:
            ops.append(("D", i - 1, None))
            i -= 1
        else:
            ops.append(("I", None, j - 1))
            j -= 1
    return ops[::-1]


def diff_rows(ops, ref: list[str], hyp: list[str], width: int = 96) -> list[str]:
    """REF / HYP / marker rows, column-aligned and wrapped at `width`."""
    cols = []
    for op, i, j in ops:
        r = ref[i] if i is not None else None
        h = hyp[j] if j is not None else None
        r, h = r or "*" * len(h), h or "*" * len(r)
        w = max(len(r), len(h))
        cols.append((r.ljust(w), h.ljust(w), ("" if op == "=" else op).ljust(w)))
    rows, cur, size = [], [], 0
    for c in cols:
        if cur and size + len(c[0]) + 1 > width:
            rows.append(cur)
            cur, size = [], 0
        cur.append(c)
        size += len(c[0]) + 1
    if cur:
        rows.append(cur)
    out = []
    for chunk in rows:
        out.append("REF: " + " ".join(c[0] for c in chunk))
        out.append("HYP: " + " ".join(c[1] for c in chunk))
        out.append("     " + " ".join(c[2] for c in chunk).rstrip())
    return out


def word_starts(text: str, asr_words, aliases: dict[str, str], onset: float, offset: float,
                tts: list[float] | None = None, tolerance: float = 0.15):
    """Start time of every whitespace-separated word of `text`.

    Script words and Whisper's words are normalized to the same tokens
    ("44-dimensional" -> forty four dimensional) and aligned with the same DP as
    the WER. A script word takes the time of its first token that lines up with
    a recognized one (a substitution still marks the right place).

    `tts` is Kokoro's own alignment (manifest `tts_word_times`), which is what
    actually drove the synthesis. Whisper's cross-attention timings are unbiased
    but have outliers: measured against the energy onset of 64 words that follow
    a pause, across six voices, Whisper alone was off by 58 ms median, 244 ms at
    p90 and 388 ms at worst, while Kokoro's were never more than 97 ms out, though
    consistently early. So a Whisper time more than `tolerance` from Kokoro's
    (shifted by the line's median Whisper-minus-Kokoro offset) is an outlier, and
    it and any unmatched word take that shifted Kokoro time instead (the same
    benchmark: 48 ms median, 81 ms p90, 116 ms worst). Without `tts`, unmatched
    words are interpolated between their neighbours by length, with the audio's
    speech onset and end as the outer anchors. Returns the times and the number
    of words that did not come from Whisper.
    """
    script = text.split()
    ref, owner = [], []
    for k, w in enumerate(script):
        for t in normalize(w, aliases):
            ref.append(t)
            owner.append(k)
    hyp, times = [], []
    for w, a, b in asr_words:
        toks = normalize(w, aliases)
        for q, t in enumerate(toks):
            hyp.append(t)
            times.append(a + (b - a) * q / len(toks))
    starts: list[float | None] = [None] * len(script)
    for op, i, j in align(ref, hyp):
        if op in "=S" and starts[owner[i]] is None:
            starts[owner[i]] = times[j]
    if tts is not None and len(tts) == len(script):
        pairs = [s - k for s, k in zip(starts, tts) if s is not None]
        shift = float(np.median(pairs)) if pairs else 0.0
        for k, s in enumerate(starts):
            if s is None or abs(s - (tts[k] + shift)) > tolerance:
                starts[k] = None
        fallback = [k + shift for k in tts]
    else:
        fallback = None
    replaced = sum(1 for t in starts if t is None)
    if fallback is not None:
        starts = [f if s is None else s for s, f in zip(starts, fallback)]
    else:
        weight = [len(w) + 1 for w in script]
        anchors = [(-1, onset)] + [(k, t) for k, t in enumerate(starts) if t is not None]
        anchors.append((len(script), offset))
        for (k0, t0), (k1, t1) in zip(anchors, anchors[1:]):
            # Words k0 .. k1-1 fill the time from t0 (k0's start, or the onset)
            # to t1 (k1's start, or the end of speech); each unknown one starts
            # after the words before it in proportion to their length.
            lo = max(k0, 0)
            span = sum(weight[lo:k1])
            for k in range(k0 + 1, k1):
                starts[k] = t0 + (t1 - t0) * sum(weight[lo:k]) / max(span, 1)
    out = [min(max(float(t), onset), offset) for t in starts]
    for k in range(1, len(out)):  # never earlier than the word before
        out[k] = max(out[k], out[k - 1])
    return out, replaced


# ─── audio ───────────────────────────────────────────────────────────────────


def silence_ms(x: np.ndarray, sr: int, rel_db: float = 55.0, floor_db: float = -80.0):
    """Leading and trailing silence: time outside the frames that are within
    rel_db of the loudest 5 ms frame (the same rule tts.py trims by)."""
    win, hop = int(0.005 * sr), int(0.001 * sr)
    if len(x) < win:
        return len(x) / sr * 1000, 0.0
    n = 1 + (len(x) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    db = 10 * np.log10(np.mean(np.square(x[idx], dtype=np.float64), axis=1) + 1e-20)
    on = np.flatnonzero(db > max(db.max() - rel_db, floor_db))
    if not len(on):
        return len(x) / sr * 1000, 0.0
    return on[0] * hop / sr * 1000, (len(x) - (on[-1] * hop + win)) / sr * 1000


def f0_semitones(x16: np.ndarray) -> np.ndarray:
    """F0 of voiced frames, in semitones re 100 Hz (librosa.pyin, 10 ms hop)."""
    import librosa

    f0, voiced, _ = librosa.pyin(
        x16, fmin=60.0, fmax=500.0, sr=ASR_SR, frame_length=1024, hop_length=160
    )
    f = f0[voiced & np.isfinite(f0)]
    return 12 * np.log2(f / 100.0)


# ─── main ────────────────────────────────────────────────────────────────────

_WORD = re.compile(r"[\w’']+(?:[-–][\w’']+)*")


def check_dir(out: Path, model, args) -> dict:
    import soundfile as sf
    import soxr

    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    aliases = dict(DEFAULT_ALIASES)
    for k, v in (manifest.get("asr_aliases") or {}).items():
        aliases[" ".join(normalize(k, {}))] = " ".join(normalize(v, {}))
    label = f"{manifest.get('voice', out.name)} @ {manifest.get('speed', '?')}"
    print(f"\n== {label}  ({out})")
    print(f"  {'id':<6}{'WER':>6}{'wpm':>7}{'lead':>6}{'tail':>6}{'peak':>7}{'clip':>6}"
          f"{'F0sd' if args.pitch else '':>6}  transcript")
    rows, flagged, st_all, deltas = [], [], [], []
    for line in manifest["lines"]:
        path = out / line["file"]
        row = {"id": line["id"], "text": line["text"], "file": line["file"]}
        if not path.exists():
            row.update(fail=True, error="missing file")
            rows.append(row)
            print(f"  {line['id']:<6} MISSING {path}")
            continue
        x, sr = sf.read(path, dtype="float32", always_2d=True)
        x = x.mean(axis=1)
        x16 = soxr.resample(x, sr, ASR_SR).astype(np.float32)
        segments, _ = model.transcribe(
            x16, language="en", beam_size=args.beam_size, temperature=0.0,
            condition_on_previous_text=False, vad_filter=False, word_timestamps=True,
        )
        segments = list(segments)
        hyp_text = " ".join(s.text.strip() for s in segments).strip()
        asr_words = [(w.word, w.start, w.end) for s in segments for w in (s.words or [])]
        ref, hyp = normalize(line["text"], aliases), normalize(hyp_text, aliases)
        ops = align(ref, hyp)
        errs = {k: sum(1 for o in ops if o[0] == k) for k in "SDI"}
        wer = (errs["S"] + errs["D"] + errs["I"]) / max(1, len(ref))
        lead, tail = silence_ms(x, sr)
        dur = len(x) / sr
        tts_times = [t[1] for t in line.get("tts_word_times") or []] or None
        starts, n_interp = word_starts(
            line["text"], asr_words, aliases, lead / 1000, dur - tail / 1000, tts=tts_times
        )
        line["words"] = [round(t, 3) for t in starts]
        if tts_times and len(tts_times) == len(starts):
            deltas.extend(abs(a - b) for a, b in zip(starts, tts_times))
        n_words = len(_WORD.findall(line["text"]))
        wpm = 60 * n_words / max(dur - (lead + tail) / 1000, 1e-3)
        peak = 20 * math.log10(max(float(np.abs(x).max()), 1e-12))
        clipped = int(np.count_nonzero(np.abs(x) >= 0.999))
        row.update(
            transcript=hyp_text, wer=round(wer, 4), errors=errs, ref_words=len(ref),
            words=line["words"], words_interpolated=n_interp,
            duration_s=round(dur, 3), word_count=n_words, wpm=round(wpm, 1),
            lead_ms=round(lead, 1), tail_ms=round(tail, 1), peak_dbfs=round(peak, 2), clipped=clipped,
        )
        if args.pitch:
            st = f0_semitones(x16)
            st_all.append(st)
            row.update(
                f0_sd_st=round(float(np.std(st)), 2) if len(st) else None,
                f0_median_hz=round(float(100 * 2 ** (np.median(st) / 12)), 1) if len(st) else None,
            )
        row["fail"] = wer > args.max_wer or clipped > 0
        if wer > args.max_wer:
            row["diff"] = diff_rows(ops, ref, hyp)
            flagged.append(row)
        rows.append(row)
        sd = row.get("f0_sd_st")
        print(f"  {line['id']:<6}{wer:>6.2f}{wpm:>7.1f}{lead:>6.0f}{tail:>6.0f}{peak:>7.1f}{clipped:>6}"
              f"{'' if sd is None else f'{sd:.1f}':>6}  {'!! ' if row['fail'] else ''}{hyp_text}")
    for row in flagged:
        e = row["errors"]
        print(f"\n  FLAGGED {row['id']}  WER {row['wer']:.2f}  "
              f"(S={e['S']} D={e['D']} I={e['I']} of {row['ref_words']} words)")
        for r in row["diff"]:
            print("    " + r)

    ok = [r for r in rows if "wer" in r]
    speech = sum(r["duration_s"] - (r["lead_ms"] + r["tail_ms"]) / 1000 for r in ok)
    wpm = 60 * sum(r["word_count"] for r in ok) / max(speech, 1e-3)
    worst = max(ok, key=lambda r: r["wer"]) if ok else None
    speed = manifest.get("speed")
    summary = {
        "label": label,
        "voice": manifest.get("voice"),
        "speed": speed,
        "lines": len(rows),
        "failed": sum(1 for r in rows if r["fail"]),
        "mean_wer": round(float(np.mean([r["wer"] for r in ok])), 4) if ok else None,
        "worst": {"id": worst["id"], "wer": worst["wer"]} if worst else None,
        "wpm": round(wpm, 1),
        f"speed_for_{TARGET_WPM}_wpm": round(speed * TARGET_WPM / wpm, 3) if speed and wpm else None,
        "lead_ms_mean": round(float(np.mean([r["lead_ms"] for r in ok])), 1) if ok else None,
        "tail_ms_mean": round(float(np.mean([r["tail_ms"] for r in ok])), 1) if ok else None,
        "clipped": sum(r.get("clipped", 0) for r in ok),
    }
    if args.pitch and st_all:
        st = np.concatenate(st_all)
        summary["f0_sd_st"] = round(float(np.std(st)), 2)
        summary["f0_median_hz"] = round(float(100 * 2 ** (np.median(st) / 12)), 1)
    summary["words_interpolated"] = sum(r.get("words_interpolated", 0) for r in ok)
    if deltas:
        summary["word_start_vs_tts_ms"] = {
            "median": round(1000 * float(np.median(deltas)), 1),
            "p90": round(1000 * float(np.percentile(deltas, 90)), 1),
            "max": round(1000 * float(np.max(deltas)), 1),
        }
    # The films pin kinetic type to these; see word_starts() for how they are made.
    manifest["words_source"] = (
        f"faster-whisper {args.model} word timestamps, DP-aligned to the script; words it missed or "
        f"placed >150 ms from Kokoro's own alignment take that alignment, shifted to agree"
    )
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8")
    report = {"summary": summary, "asr_model": args.model, "max_wer": args.max_wer, "lines": rows}
    (out / "asr_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                         encoding="utf-8")
    print(f"  -> mean WER {summary['mean_wer']}, worst {worst['id'] if worst else '-'} "
          f"{worst['wer'] if worst else ''}, {summary['wpm']} wpm, {summary['failed']} failed")
    if deltas:
        d = summary["word_start_vs_tts_ms"]
        print(f"  -> word starts written to manifest.json ({summary['words_interpolated']} not from Whisper); "
              f"|whisper - kokoro| median {d['median']} ms, p90 {d['p90']} ms, max {d['max']} ms")
    return summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("dirs", nargs="+", type=Path, help="tts.py output directories")
    ap.add_argument("--model", default="small.en", help="faster-whisper model (small.en, distil-small.en)")
    ap.add_argument("--models-dir", type=Path, default=None,
                    help="model cache (default: $AURACLE_VOICE_MODELS or ~/.cache/auracle-voice)")
    ap.add_argument("--max-wer", type=float, default=0.10)
    ap.add_argument("--beam-size", type=int, default=5)
    ap.add_argument("--pitch", action="store_true", help="also measure F0 variability (librosa.pyin)")
    ap.add_argument("--threads", type=int, default=int(os.environ.get("OMP_NUM_THREADS") or 0) or None,
                    help="CPU threads for Whisper (default: $OMP_NUM_THREADS, else every core)")
    args = ap.parse_args(argv)

    models_dir = (args.models_dir or default_models_dir()).expanduser().resolve()
    models_dir.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HUB_CACHE"] = str(models_dir)
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8",
                         cpu_threads=args.threads or os.cpu_count() or 4, download_root=str(models_dir))
    summaries = [check_dir(d, model, args) for d in args.dirs]

    if len(summaries) > 1:
        k = f"speed_for_{TARGET_WPM}_wpm"
        print(f"\n| render | mean WER | worst line | wpm | speed for {TARGET_WPM} wpm |"
              + (" F0 SD (st) | F0 median (Hz) |" if args.pitch else "") + " lead/tail ms | failed |")
        print("|---|---|---|---|---|" + ("---|---|" if args.pitch else "") + "---|---|")
        for s in summaries:
            w = s["worst"] or {}
            print(f"| {s['label']} | {s['mean_wer']:.3f} | {w.get('id')} ({w.get('wer', 0):.2f}) | "
                  f"{s['wpm']:.0f} | {s[k]} |"
                  + (f" {s.get('f0_sd_st')} | {s.get('f0_median_hz')} |" if args.pitch else "")
                  + f" {s['lead_ms_mean']:.0f}/{s['tail_ms_mean']:.0f} | {s['failed']}/{s['lines']} |")
    failed = sum(s["failed"] for s in summaries)
    print(f"\n{'FAIL' if failed else 'PASS'}: {failed} line(s) over WER {args.max_wer} or clipped")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
