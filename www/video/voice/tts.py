#!/usr/bin/env python3
"""Narration for Auracle's films: offline neural TTS with Kokoro-82M.

    python www/video/voice/tts.py SCRIPT.json -o OUT_DIR [--voice af_heart] [--speed 1.0]

A script is JSON:

    {"voice": "af_heart", "speed": 1.0,
     "lexicon": {"Auracle": "ˈɔɹəkᵊl", "WASM": {"us": "wˈæzəm", "gb": "wˈazəm"}},
     "lines": [{"id": "l01", "text": "Auracle is ...", "pause_after": 0.4}]}

and OUT_DIR receives

    <id>.wav        one per line: 48 kHz, mono, 24-bit PCM, with the leading and
                    trailing silence trimmed to --pad-ms (40 ms) each side
    narration.wav   every line in order, each followed by its pause_after
    manifest.json   per line: id, text, file, duration_s, start_s (in
                    narration.wav), wpm, peak_dbfs, lufs, the phonemes the model
                    actually spoke, and `words`: the start time of each
                    whitespace-separated word of the text, in seconds from the
                    start of the line's WAV. tts.py fills `words` from Kokoro's
                    duration predictor; asr_check.py replaces it with
                    faster-whisper word timestamps aligned to the script
                    (`words_source` says which)
    captions.vtt    WebVTT cues from those timings; long lines are split at
                    phrase boundaries into cues of at most 2 lines x 42 characters
                    and 1.0 to ~6 s on screen

Nothing leaves the machine but the model download: Kokoro-82M (Apache-2.0) and
its voice packs come from Hugging Face `hexgrad/Kokoro-82M` on first use and are
cached under --models-dir (or $AURACLE_VOICE_MODELS). The script text is only
ever seen by the local process.

Why kokoro + misaki on CPU torch, not kokoro-onnx + espeak-ng
-------------------------------------------------------------
Pronunciation is decided by the grapheme-to-phoneme front end, not by the
acoustic model; kokoro-onnx runs the same Kokoro-82M weights. The two routes
differ in the G2P:

* `kokoro` uses misaki, the G2P Kokoro-82M v1.0 was trained on: a ~90k-word
  US/GB dictionary with POS-tagged heteronyms, number/ordinal expansion, and its
  own phoneme alphabet (single tokens for diphthongs and affricates: A I O W Y Q
  ʤ ʧ). espeak-ng is used only as the fallback for words the dictionary lacks.
* `kokoro-onnx` phonemizes every word with raw espeak-ng. Its output uses a
  different alphabet (aɪ, oʊ, dʒ as two symbols) and different vowel choices,
  so the model is fed sequences it did not see in training.

Measured on this repo's test script with the same weights and voice (af_heart),
misaki gave a lower Whisper word error rate than espeak-ng; see the numbers in
the change that introduced this file. misaki also yields per-word timestamps
from the duration predictor, which the caption splitter below uses. The cost is
CPU-only torch (~0.9 GB installed; never the CUDA wheels, see requirements.txt).

Pronunciation control
---------------------
`lexicon` maps a word (whole-word, case-insensitive) to phonemes. Each entry is
spliced into the text as misaki inline markup, `[Auracle](/ˈɔɹəkᵊl/)`, so it
bypasses the dictionary, the espeak fallback and the POS tagger entirely.
Values may be a string (every accent) or {"us": ..., "gb": ...}, because the
British voices speak misaki's GB alphabet (ɒ, ː, a for æ, Q for əʊ).
Dictionary-style IPA is accepted and folded into misaki's alphabet (dʒ→ʤ,
eɪ→A, aɪ→I, oʊ→O, r→ɹ, stress mark moved onto the vowel); any symbol the
voice cannot speak is reported, because Kokoro silently drops it.
Check the result in manifest.json's `lexicon` and per-line `phonemes`, and with
asr_check.py.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import unicodedata
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np

REPO_ID = "hexgrad/Kokoro-82M"
MODEL_SR = 24_000
OUT_SR = 48_000

# Captions: the common broadcast/streaming limits.
CUE_WIDTH = 42
CUE_LINES = 2
CUE_MIN_S = 1.0
CUE_MAX_S = 6.0
# A caption may stay up this long into the pause after its line. When the pause
# is shorter than this the cue simply runs on to the next line's first cue,
# which reads better than a caption blinking off for half a second.
CUE_HOLD_S = 0.6


def default_models_dir() -> Path:
    env = os.environ.get("AURACLE_VOICE_MODELS")
    return Path(env) if env else Path.home() / ".cache" / "auracle-voice"


# ─── script ──────────────────────────────────────────────────────────────────


@dataclass
class Line:
    id: str
    text: str
    pause_after: float


def load_script(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    lines = data.get("lines")
    if not isinstance(lines, list) or not lines:
        sys.exit(f"{path}: 'lines' must be a non-empty list")
    seen: set[str] = set()
    parsed = []
    for i, raw in enumerate(lines, 1):
        lid = str(raw.get("id") or f"l{i:02d}")
        text = str(raw.get("text", "")).strip()
        if not text:
            sys.exit(f"{path}: line {lid} has no text")
        if lid in seen:
            sys.exit(f"{path}: duplicate line id {lid}")
        if not re.fullmatch(r"[\w.-]+", lid):
            sys.exit(f"{path}: line id {lid!r} must be usable as a file name")
        seen.add(lid)
        parsed.append(Line(lid, text, float(raw.get("pause_after", 0.5))))
    data["lines"] = parsed
    return data


def is_british(voice: str) -> bool:
    # Kokoro voice ids start with the language code: a = American, b = British.
    first = voice.split(",")[0].strip()
    if first[:1] not in "ab":
        sys.exit(f"voice {voice!r}: only the English voices (af_*, am_*, bf_*, bm_*) are supported")
    return first.startswith("b")


# ─── lexicon ─────────────────────────────────────────────────────────────────

# misaki's vowel symbols, including its one-letter diphthongs.
_VOWELS = "AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻᵊɐ"


def to_misaki(ipa: str, british: bool) -> str:
    """Fold dictionary-style IPA into misaki's phoneme alphabet."""
    s = unicodedata.normalize("NFC", ipa.strip()).strip("/[]")
    s = s.replace("'", "ˈ").replace("͡", "").replace("‿", "").replace(".", "")
    s = s.replace("dʒ", "ʤ").replace("tʃ", "ʧ")
    s = s.replace("r", "ɹ").replace("g", "ɡ").replace("ɫ", "l").replace(":", "ː")
    if british:
        s = s.replace("ɝ", "ɜː").replace("ɚ", "ə")
    else:
        s = s.replace("ɝ", "ɜɹ").replace("ɚ", "əɹ")
    for a, b in (("eɪ", "A"), ("aɪ", "I"), ("aʊ", "W"), ("ɔɪ", "Y")):
        s = s.replace(a, b)
    o = "Q" if british else "O"
    s = s.replace("oʊ", o).replace("əʊ", o)
    s = s.replace("e", "ɛ")
    if british:
        s = s.replace("æ", "a")
    else:
        # The US alphabet has no length marks and no bare /a/ or /ɒ/.
        s = s.replace("ɜː", "ɜɹ").replace("ː", "").replace("ɒ", "ɑ").replace("a", "æ")
    # misaki puts the stress mark immediately before the stressed vowel
    # ("kwˈɪvəɹ"), not at the syllable onset as dictionaries do ("ˈkwɪvər").
    s = re.sub(rf"([ˈˌ])([^ˈˌ\s{_VOWELS}]+)(?=[{_VOWELS}])", r"\2\1", s)
    return s


def build_lexicon(raw: dict, british: bool) -> dict[str, str]:
    from misaki.en import GB_VOCAB, US_VOCAB

    vocab = set(GB_VOCAB if british else US_VOCAB) | {" ", "ɐ"}
    if not british:
        vocab |= {"T"}  # misaki's flap token
    accent = "gb" if british else "us"
    out = {}
    for word, value in (raw or {}).items():
        if isinstance(value, dict):
            value = value.get(accent) or value.get("en-" + accent) or next(iter(value.values()))
        ps = to_misaki(str(value), british)
        bad = sorted({c for c in ps if c not in vocab and c not in "ˈˌ"})
        if bad:
            print(
                f"warning: lexicon {word!r} -> /{ps}/ uses {''.join(bad)!r}, which the "
                f"{accent.upper()} voices were not trained on (Kokoro may drop or garble it)",
                file=sys.stderr,
            )
        out[word] = ps
    return out


_MARKUP = re.compile(r"\[[^\]]+\]\([^)]*\)")


def apply_lexicon(text: str, lexicon: dict[str, str]) -> str:
    """Wrap every lexicon word in misaki's `[word](/phonemes/)` markup.

    Whole words only, case-insensitive, longest key first, and never inside
    markup the script already contains.
    """
    if not lexicon:
        return text
    by_lower = {k.lower(): v for k, v in lexicon.items()}
    keys = sorted(lexicon, key=len, reverse=True)
    word = re.compile(
        r"(?<![\w\[])(" + "|".join(re.escape(k) for k in keys) + r")(?![\w\]])", re.IGNORECASE
    )

    def wrap(seg: str) -> str:
        return word.sub(lambda m: f"[{m.group(1)}](/{by_lower[m.group(1).lower()]}/)", seg)

    out, pos = [], 0
    for m in _MARKUP.finditer(text):
        out.append(wrap(text[pos : m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(wrap(text[pos:]))
    return "".join(out)


# ─── synthesis ───────────────────────────────────────────────────────────────


@dataclass
class Word:
    text: str
    start: float  # seconds from the start of the line's own WAV
    end: float


@dataclass
class Rendered:
    audio: np.ndarray  # float32 at MODEL_SR, untrimmed
    phonemes: str
    words: list[Word]  # timed against the untrimmed audio


class Engine:
    def __init__(self, voice: str, british: bool, models_dir: Path, seed: int):
        # Point the Hugging Face cache at models_dir before anything imports
        # huggingface_hub, which reads its paths at import time.
        models_dir.mkdir(parents=True, exist_ok=True)
        os.environ["HF_HUB_CACHE"] = str(models_dir)
        os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
        warnings.filterwarnings("ignore", category=UserWarning)
        warnings.filterwarnings("ignore", category=FutureWarning)
        from loguru import logger

        logger.remove()
        logger.add(sys.stderr, level="WARNING")

        import torch
        from kokoro import KModel, KPipeline

        self.torch = torch
        self.seed = seed
        self.voice = voice
        self.model = KModel(repo_id=REPO_ID).eval()
        self.pipeline = KPipeline(lang_code="b" if british else "a", repo_id=REPO_ID, model=self.model)
        self.pipeline.load_voice(voice)

    def render(self, text: str, speed: float) -> Rendered:
        torch = self.torch
        # Kokoro's vocoder injects noise; a fixed seed per line makes a re-render
        # bit-identical, so a diff in a WAV always means the script changed.
        torch.manual_seed(self.seed)
        chunks, phonemes, words = [], [], []
        offset = 0.0
        cur: list = []  # tokens of the word being assembled

        def flush():
            if not cur:
                return
            text_ = "".join(t.text + t.whitespace for t in cur).strip()
            timed = [
                t
                for t in cur
                if any(c.isalnum() for c in t.text) and t.start_ts is not None and t.end_ts is not None
            ]
            if text_:
                if timed:
                    words.append(Word(text_, offset + timed[0].start_ts, offset + timed[-1].end_ts))
                else:
                    words.append(Word(text_, math.nan, math.nan))
            cur.clear()

        with torch.inference_mode():
            # split_pattern=None: a line is one utterance; misaki itself chunks
            # anything over the model's 510-phoneme window at punctuation.
            for result in self.pipeline(text, voice=self.voice, speed=speed, split_pattern=None):
                if result.audio is None:
                    continue
                audio = result.audio.detach().cpu().numpy().astype(np.float32)
                for tok in result.tokens or []:
                    cur.append(tok)
                    if tok.whitespace:
                        flush()
                flush()
                chunks.append(audio)
                phonemes.append(result.phonemes)
                offset += len(audio) / MODEL_SR
        if not chunks:
            sys.exit(f"Kokoro produced no audio for: {text!r}")
        return Rendered(np.concatenate(chunks), " ".join(phonemes), fill_missing_times(words))


def fill_missing_times(words: list[Word]) -> list[Word]:
    """Interpolate by character count for any word the duration predictor missed."""
    if all(not math.isnan(w.start) for w in words):
        return words
    known = [i for i, w in enumerate(words) if not math.isnan(w.start)]
    if not known:
        return words  # handled by the caller's proportional fallback
    for i, w in enumerate(words):
        if not math.isnan(w.start):
            continue
        prev = max((k for k in known if k < i), default=None)
        nxt = min((k for k in known if k > i), default=None)
        a = words[prev].end if prev is not None else 0.0
        b = words[nxt].start if nxt is not None else a + 0.08 * len(w.text)
        w.start, w.end = a, b
    return words


# ─── audio ───────────────────────────────────────────────────────────────────


def frame_db(x: np.ndarray, sr: int, win_s: float = 0.005, hop_s: float = 0.0025):
    win, hop = max(1, int(win_s * sr)), max(1, int(hop_s * sr))
    if len(x) < win:
        x = np.pad(x, (0, win - len(x)))
    n = 1 + (len(x) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    rms = np.sqrt(np.mean(np.square(x[idx], dtype=np.float64), axis=1) + 1e-20)
    return 20 * np.log10(rms), win, hop


def speech_bounds(x: np.ndarray, sr: int, rel_db: float = 55.0, floor_db: float = -80.0):
    """First and last sample of sound: frames within rel_db of the loudest frame.

    Kokoro's silence is digital (below -140 dBFS), while a word's release decays
    through -60..-75 dB relative to the loudest frame for a few tens of ms. At
    55 dB down the cut lands in that decay, below audibility, and the pad then
    keeps 40 ms beyond it.
    """
    db, win, hop = frame_db(x, sr)
    thr = max(db.max() - rel_db, floor_db)
    on = np.flatnonzero(db > thr)
    if not len(on):
        return 0, len(x)
    return int(on[0] * hop), int(min(len(x), on[-1] * hop + win))


def trim(x: np.ndarray, sr: int, pad_s: float):
    """Cut to the sound plus exactly pad_s each side (zero-filled if the model
    left less). Returns the audio and the time shift to apply to word timings."""
    s, e = speech_bounds(x, sr)
    pad = int(round(pad_s * sr))
    a, b = max(0, s - pad), min(len(x), e + pad)
    pre, post = pad - (s - a), pad - (b - e)
    y = np.concatenate([np.zeros(pre, np.float32), x[a:b], np.zeros(post, np.float32)])
    fade = min(int(0.005 * sr), pad)  # 5 ms raised-cosine at the file edges
    if fade > 1:
        ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fade, dtype=np.float32))
        y[:fade] *= ramp
        y[-fade:] *= ramp[::-1]
    shift = (pre - a) / sr  # new_time = old_time + shift
    return y, shift


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    import soxr

    return soxr.resample(x, sr_in, sr_out, quality="VHQ").astype(np.float32)


def true_peak_db(x: np.ndarray, sr: int) -> float:
    """Inter-sample peak via 4x oversampling (BS.1770-4 annex 2, approximately)."""
    up = resample(x, sr, sr * 4)
    return 20 * math.log10(max(float(np.abs(up).max()), 1e-12))


def peak_db(x: np.ndarray) -> float:
    return 20 * math.log10(max(float(np.abs(x).max()), 1e-12))


def loudness(meter, x: np.ndarray, sr: int) -> float | None:
    if len(x) < int(0.4 * sr):  # BS.1770 needs one 400 ms block
        return None
    v = meter.integrated_loudness(x.astype(np.float64))
    return None if not math.isfinite(v) else float(v)


# ─── captions ────────────────────────────────────────────────────────────────

_ENDS = {".": 3.0, "!": 3.0, "?": 3.0, "…": 3.0, ":": 2.5, ";": 2.5, "—": 2.5, "–": 2.2, ",": 2.0}
_CONJ = set("and but or nor so yet because while when where which who whom whose that then if "
            "until unless as though although since".split())
_PREP = set("to in on at by for from with of into onto toward towards over under through across "
            "about between without within against not".split())
# Words a caption line should not end on: they belong with what follows.
_CLINGY = set("a an the to of in on at by for from with and or but nor your my our their its his "
              "her this these those is are was were be as into than".split())
_CLOSERS = "\"'”’)]"


def _bare(w: str) -> str:
    return re.sub(r"[^\w']", "", w.lower().replace("’", "'"))


def boundary(left: str, right: str) -> float:
    """How natural a break between two words is: 3 = sentence end ... <0 = bad."""
    end = left.rstrip(_CLOSERS)[-1:]
    s = _ENDS.get(end, 0.0)
    if s == 0.0:
        r = _bare(right)
        s = 1.2 if r in _CONJ else 0.8 if r in _PREP else 0.0
        if _bare(left) in _CLINGY:
            s -= 1.5
    return s


def wrap(words: list[str], width: int = CUE_WIDTH) -> tuple[list[str], float] | None:
    """Lay a cue out on one line, or two balanced ones broken at the best phrase
    boundary. Returns the lines and that break's boundary score (3.0 for one
    line), or None if the words cannot fit in two lines of `width`."""
    text = " ".join(words)
    if len(text) <= width:
        return [text], 3.0
    best = None
    for k in range(1, len(words)):
        a, b = " ".join(words[:k]), " ".join(words[k:])
        if len(a) > width or len(b) > width:
            continue
        strength = boundary(words[k - 1], words[k])
        balance = 1 - abs(len(a) - len(b)) / max(len(a), len(b))
        score = strength + 1.5 * balance
        if best is None or score > best[0]:
            best = (score, [a, b], strength)
    return (best[1], best[2]) if best else None


def segment(words: list[Word], t_first: float, t_last: float) -> list[tuple[float, float, list[str]]]:
    """Split one narration line into caption cues.

    Dynamic programming over split points. Each cue must fit 2 x 42; it costs 1
    (1.5 if its only layout ends a line on a word like "in" or "the": less than
    the gap between a comma split and a preposition split), plus heavy
    penalties outside 1.0-6.0 s on screen, plus 1.2 for each sentence
    end it swallows (so sentences get their own cue when timing allows), plus a
    reading-speed penalty above 17 characters/second. Each split costs by how
    weak its boundary is. Cues run back to back: a cue stays up until the next
    one starts, the last until t_last.
    """
    n = len(words)
    texts = [w.text for w in words]

    def t0(i):
        return t_first if i == 0 else words[i].start

    def t1(j):
        return t_last if j == n else words[j].start

    def cost(i, j):
        laid = wrap(texts[i:j])
        if laid is None:
            return math.inf, None
        lines, strength = laid
        d = t1(j) - t0(i)
        c = 1.0 if strength >= 0 else 1.5  # a line ending on "in", "a", "the" ...
        if d < CUE_MIN_S:
            c += 10 + 20 * (CUE_MIN_S - d)
        if d > CUE_MAX_S:
            c += 10 + 20 * (d - CUE_MAX_S)
        c += 1.2 * sum(1 for t in texts[i : j - 1] if t.rstrip(_CLOSERS)[-1:] in ".!?…")
        cps = len(" ".join(texts[i:j])) / max(d, 1e-3)
        if cps > 17:
            c += 0.2 * (cps - 17)
        return c, lines

    best = [math.inf] * (n + 1)
    back: list = [None] * (n + 1)
    best[0] = 0.0
    for j in range(1, n + 1):
        for i in range(j):
            if best[i] == math.inf:
                continue
            c, lines = cost(i, j)
            if lines is None:
                continue
            split = 0.0 if i == 0 else 0.5 * (3.0 - boundary(texts[i - 1], texts[i]))
            if best[i] + c + split < best[j]:
                best[j], back[j] = best[i] + c + split, (i, lines)
    if back[n] is None:  # a single word wider than two lines: hard-wrap it
        return [(t_first, t_last, [" ".join(texts)[:CUE_WIDTH], " ".join(texts)[CUE_WIDTH:]])]
    cues, j = [], n
    while j > 0:
        i, lines = back[j]
        cues.append((t0(i), t1(j), lines))
        j = i
    return cues[::-1]


def vtt_time(t: float) -> str:
    ms = int(round(max(t, 0.0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def vtt_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ─── main ────────────────────────────────────────────────────────────────────

_WORD = re.compile(r"[\w’']+(?:[-–][\w’']+)*")


def count_words(text: str) -> int:
    return len(_WORD.findall(text))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("script", type=Path, help="script JSON")
    ap.add_argument("-o", "--out", type=Path, required=True, help="output directory")
    ap.add_argument("--voice", help="override the script's voice (e.g. af_heart, bm_george)")
    ap.add_argument("--speed", type=float, help="override the script's speed (1.0 = model default)")
    ap.add_argument("--no-lexicon", action="store_true", help="ignore the script's lexicon (A/B checks)")
    ap.add_argument("--models-dir", type=Path, default=None,
                    help="model cache (default: $AURACLE_VOICE_MODELS or ~/.cache/auracle-voice)")
    ap.add_argument("--pad-ms", type=float, default=40.0, help="silence kept before/after each line")
    ap.add_argument("--lufs", type=float, default=-23.0,
                    help="integrated loudness of the whole narration, one gain for every line "
                         "(default -23, EBU R128: a stem the film's master raises after mixing)")
    ap.add_argument("--ceiling", type=float, default=-1.0, help="true-peak ceiling, dBTP")
    ap.add_argument("--no-normalize", action="store_true", help="leave Kokoro's own level")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    import pyloudnorm
    import soundfile as sf

    script = load_script(args.script)
    voice = args.voice or script.get("voice") or "af_heart"
    speed = args.speed if args.speed is not None else float(script.get("speed", 1.0))
    british = is_british(voice)
    lexicon = {} if args.no_lexicon else build_lexicon(script.get("lexicon") or {}, british)
    models_dir = (args.models_dir or default_models_dir()).expanduser().resolve()
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    pad_s = args.pad_ms / 1000

    t_start = time.time()
    engine = Engine(voice, british, models_dir, args.seed)
    t_loaded = time.time()

    rendered = []
    for line in script["lines"]:
        spoken = apply_lexicon(line.text, lexicon)
        r = engine.render(spoken, speed)
        y, shift = trim(r.audio, MODEL_SR, pad_s)
        y = resample(y, MODEL_SR, OUT_SR)
        words = [Word(w.text, w.start + shift, w.end + shift) for w in r.words]
        dur = len(y) / OUT_SR
        # One timed entry per whitespace-separated script word is the contract
        # (manifest `words`, and the captions). misaki's tokens rebuild the text,
        # so this matches by position, ignoring case and punctuation in case the
        # G2P normalizes a quote mark, and then carries the script's own words.
        script_words = line.text.split()
        key = lambda s: re.sub(r"\W", "", s.lower())  # noqa: E731
        if (
            len(words) == len(script_words)
            and all(key(w.text) == key(s) for w, s in zip(words, script_words))
            and not any(math.isnan(w.start) for w in words)
        ):
            words = [Word(s, w.start, w.end) for s, w in zip(script_words, words)]
        else:
            print(f"note: {line.id}: no one-to-one word timing from Kokoro; spreading "
                  f"the words over the line (asr_check.py replaces these)", file=sys.stderr)
            total = sum(len(t) + 1 for t in script_words)
            span, acc, words = dur - 2 * pad_s, 0, []
            for t in script_words:
                a = pad_s + span * acc / total
                acc += len(t) + 1
                words.append(Word(t, a, pad_s + span * acc / total))
        for w in words:
            w.start = min(max(w.start, 0.0), dur)
            w.end = min(max(w.end, w.start), dur)
        rendered.append((line, spoken, r.phonemes, y, words))
        print(f"  {line.id}  {dur:5.2f}s  {r.phonemes}", file=sys.stderr)
    t_synth = time.time()

    # One gain for the whole narration, so the lines keep their relative level
    # and every voice is compared at the same loudness. BS.1770's gate ignores
    # the pauses. The true-peak ceiling wins over the loudness target: Kokoro's
    # glottal onsets put isolated peaks 16-21 dB over the programme loudness,
    # so -23 LUFS fits under -1 dBTP with no limiter and louder targets would
    # need one. No dynamics processing happens here; that belongs to the mix.
    meter = pyloudnorm.Meter(OUT_SR)
    joined = np.concatenate([y for *_, y, _ in rendered])
    measured = loudness(meter, joined, OUT_SR)
    tp = true_peak_db(joined, OUT_SR)
    gain_db = 0.0
    if not args.no_normalize and measured is not None:
        gain_db = min(args.lufs - measured, args.ceiling - tp)
    g = np.float32(10 ** (gain_db / 20))
    if measured is not None and not args.no_normalize and gain_db < args.lufs - measured - 0.05:
        print(f"note: the {args.ceiling} dBTP ceiling holds the narration at "
              f"{measured + gain_db:.1f} LUFS, under the {args.lufs} target", file=sys.stderr)

    lines_out, parts, cues = [], [], []
    t = 0.0
    for k, (line, spoken, phonemes, y, words) in enumerate(rendered):
        y = y * g
        fname = f"{line.id}.wav"
        sf.write(out / fname, y, OUT_SR, subtype="PCM_24")
        dur = len(y) / OUT_SR
        n_words = count_words(line.text)
        speech = max(dur - 2 * pad_s, 1e-3)
        lines_out.append({
            "id": line.id,
            "text": line.text,
            "file": fname,
            "duration_s": round(dur, 4),
            "start_s": round(t, 4),
            "pause_after": line.pause_after,
            "word_count": n_words,
            "wpm": round(60 * n_words / speech, 1),
            "peak_dbfs": round(peak_db(y), 2),
            "lufs": None if (v := loudness(meter, y, OUT_SR)) is None else round(v, 2),
            "spoken": spoken if spoken != line.text else None,
            "phonemes": phonemes,
            # Start of each whitespace-separated word of `text`, seconds from the
            # start of this WAV. Provisional (Kokoro's duration predictor) until
            # asr_check.py replaces it with faster-whisper's word timestamps.
            "words": [round(w.start, 3) for w in words],
            "tts_word_times": [[w.text, round(w.start, 3), round(w.end, 3)] for w in words],
        })
        # Captions show the script's text, not the respelled one.
        nxt = t + dur + line.pause_after
        last = nxt if k + 1 < len(rendered) and line.pause_after <= CUE_HOLD_S else t + dur + min(
            line.pause_after, CUE_HOLD_S)
        timed = [Word(w.text, t + w.start, t + w.end) for w in words]
        for i, (a, b, text_lines) in enumerate(segment(timed, t, last), 1):
            cues.append((f"{line.id}.{i}", a, b, text_lines))
        parts.append(y)
        parts.append(np.zeros(int(round(line.pause_after * OUT_SR)), np.float32))
        t += dur + line.pause_after

    narration = np.concatenate(parts)
    sf.write(out / "narration.wav", narration, OUT_SR, subtype="PCM_24")

    with open(out / "captions.vtt", "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for cid, a, b, text_lines in cues:
            f.write(f"{cid}\n{vtt_time(a)} --> {vtt_time(b)}\n")
            f.write("\n".join(vtt_escape(s) for s in text_lines) + "\n\n")

    from importlib.metadata import version

    speech_total = sum(max(l["duration_s"] - 2 * pad_s, 0) for l in lines_out)
    words_total = sum(l["word_count"] for l in lines_out)
    manifest = {
        "script": str(args.script),
        "voice": voice,
        "speed": speed,
        "accent": "en-gb" if british else "en-us",
        "seed": args.seed,
        "engine": {
            "model": REPO_ID,
            "kokoro": version("kokoro"),
            "misaki": version("misaki"),
            "torch": version("torch"),
        },
        "format": {"sample_rate": OUT_SR, "channels": 1, "bits": 24, "pad_ms": args.pad_ms},
        "loudness": {
            "target_lufs": None if args.no_normalize else args.lufs,
            "gain_db": round(gain_db, 2),
            "integrated_lufs": None if (v := loudness(meter, narration, OUT_SR)) is None else round(v, 2),
            "true_peak_dbtp": round(true_peak_db(narration, OUT_SR), 2),
        },
        "lexicon": lexicon,
        "asr_aliases": script.get("asr_aliases") or {},
        "narration": {"file": "narration.wav", "duration_s": round(len(narration) / OUT_SR, 4)},
        "captions": {"file": "captions.vtt", "cues": len(cues)},
        "words_source": "kokoro-durations",
        "wpm": round(60 * words_total / max(speech_total, 1e-3), 1),
        "lines": lines_out,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8")
    print(
        f"{voice} @ {speed}: {len(lines_out)} lines, {manifest['narration']['duration_s']:.1f}s, "
        f"{manifest['wpm']} wpm, {manifest['loudness']['integrated_lufs']} LUFS, "
        f"{manifest['loudness']['true_peak_dbtp']} dBTP, {len(cues)} cues -> {out}  "
        f"(load {t_loaded - t_start:.0f}s, synth {t_synth - t_loaded:.0f}s)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
