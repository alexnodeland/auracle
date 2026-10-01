# Generated from www/brand/sound.json by www/brand/sound.py (make sound); do not edit.
# `make dev-check` fails when this file differs from what sound.json makes.
"""The films' sound as the mix reads it: www/brand/sound.json, generated.

ADR-014; the values are docs/notes/sound-2026-09/SPEC.md's. Their prose (what each
value is for, and where it was measured) stays in sound.json.
"""

# The bed's tempo and cycle; the marks are written at marks_bpm and placed by time.
TEMPO = {
    "bpm": 66,
    "beats_per_bar": 4,
    "beat_s": 0.909091,
    "bar_s": 3.636364,
    "marks_bpm": 60,
    "cycle_bars": 8,
    "bars_per_chord": 2,
}

# The generated scores (repo-relative), and their titles: the score example renders each into <out>/<slug(title)>/.
SCORES = {
    "bloom": {
        "score": "www/video/sound/bloom.json",
        "title": "Bloom",
    },
    "reach": {
        "score": "www/video/sound/reach.json",
        "title": "Reach",
    },
    "bed": {
        "score": "www/video/sound/n3.json",
        "title": "N3",
    },
}

# The loudness ladder (SPEC section 7). bed_rest_lu is against the narration, bed_under_demo_lu against the demo.
LADDER = {
    "narration_lufs": -18,
    "bed_rest_lu": -3,
    "demo_lufs": -18,
    "bed_under_demo_lu": -9,
    "bed_under_demo_down_s": 0.5,
    "bed_under_demo_up_s": 1.0,
    "marks_lufs": -18,
    "master_lufs": -16,
    "limiter": {
        "ceiling_dbtp": -1.2,
        "lookahead_ms": 5,
        "release_ms": 80,
    },
}

# The narration's chain, in order, before it is normalized to LADDER['narration_lufs'] (SPEC section 6).
VOICE_CHAIN = [
    {
        "type": "highpass",
        "hz": 85,
        "order": 2,
        "when": "always",
    },
    {
        "type": "peaking",
        "hz": 315,
        "gain_db": -2,
        "q": 1.2,
        "when": {
            "band_hz": [250, 400],
            "over_band_hz": [500, 800],
            "by_db": 3,
        },
    },
    {
        "type": "peaking",
        "hz": 4000,
        "gain_db": 2,
        "q": 0.9,
        "when": "always",
    },
    {
        "type": "deesser",
        "above_hz": 5000,
        "split_order": 4,
        "detector_rms_ms": 5,
        "threshold_dbfs": -26,
        "ratio": 3,
        "max_cut_db": 3,
        "attack_ms": 1,
        "release_ms": 60,
        "when": "always",
    },
]

# The bed under the voice (SPEC section 8): the detector, the follower all three moves share, and the broadband duck.
DUCK = {
    "detector": {
        "rms_ms": 5,
        "above_dbfs": -45,
    },
    "follower": {
        "attack_ms": 80,
        "release_ms": 450,
    },
    "broadband_db": -2,
}

# A further cut on the whole bed in band_hz, times the follower.
CARVE = {
    "band_hz": [1000, 4000],
    "db": -3,
    "on": "the whole bed",
}

# A further cut on the pad only in band_hz, times the follower.
PAD_DIP = {
    "band_hz": [300, 600],
    "db": -2,
    "on": "the pad",
}

# The marks' own balance (SPEC section 3), and how Bloom meets the bed and the bed hands over to Reach;
# LADDER['marks_lufs'] is their level in a film.
MARKS = {
    "length_s": 4.5,
    "lead_over_pad_db": 6,
    "drone_under_pad_lu": 6,
    "drone_fade_in": {
        "from_db": -12,
        "over_s": 1.5,
    },
    "into_the_bed": {
        "bed_bar_1_at_s": 1.5,
        "bed_e4_at_s": 4.5,
        "burble_enters_bar": 2,
        "pad_to_bed_level_s": 4.0,
    },
    "passing_chord_beats": [1, 2],
}

# The presets a film casts from, by role, and the measured limits they were shortlisted by (RFC-007).
SHORTLIST = {
    "roles": {
        "pads_and_textures": ["Cathedral", "Long Room", "Rotor", "Morph Pad", "Tidal", "Slow Weather"],
        "soft_leads": ["Wobble Board", "Falling Sign", "Solo Flight", "Telegraph", "Choirboy", "Fifth Wheel"],
        "low_and_burbling": ["Held Under", "Heartbeat", "Ceiling", "Dub Echo"],
    },
    "criteria": {
        "noise_share_max": 0.02,
        "roughness_max": 6,
    },
}

# The one room: Cathedral's reverb at its stock settings. No part turns these, and no outside reverb is added.
ROOM = {
    "preset": "Cathedral",
    "stock": {
        "node#rsize": 0.85,
        "node#rdamp": 0.35,
        "node#rmix": 0.5,
    },
}

# Each part's EQ, pan and level on stems (SPEC section 5). A level is against the pad unless it names LUFS.
PARTS = {
    "drone": {
        "eq": {
            "lowpass_hz": 200,
        },
        "stereo": "mono",
        "pan": 0,
        "level": {
            "vs": "pad",
            "lu": -6,
        },
    },
    "pad": {
        "parts": ["bed_pad", "marks_pad"],
        "eq": {
            "highpass_hz": 165,
        },
        "stereo": {
            "side_above_hz": 150,
            "side_gain": 1.25,
        },
        "pan": 0,
        "level": "reference",
        "under_speech": "The pad dip (`duck.pad_dip`).",
    },
    "burble": {
        "eq": {
            "band_hz": [110, 400],
        },
        "pan": -0.2,
        "level": {
            "vs": "pad",
            "lu": -12,
        },
    },
    "melody": {
        "eq": {
            "highpass_hz": 220,
        },
        "pan": 0.15,
        "level": {
            "vs": "pad",
            "db": -4,
            "while": "it sounds",
        },
    },
    "marks_lead": {
        "eq": {
            "highpass_hz": 220,
        },
        "pan": 0,
        "level": {
            "vs": "pad",
            "db": 6,
            "while": "it sounds",
        },
    },
    "demo": {
        "eq": None,
        "pan": 0,
        "level": {
            "lufs": -18,
            "over": "its window",
        },
    },
    "narration": {
        "eq": "voice_chain",
        "stereo": "mono",
        "pan": 0,
        "level": {
            "lufs": -18,
        },
    },
}

# Filter orders, and the frequency below which every stem's side signal is removed.
MIX = {
    "filter_order": 2,
    "band_split_order": 4,
    "center_below_hz": 150,
}

# The grammar's timings, in seconds and dB (SPEC section 9).
TIMINGS = {
    "first_word_after_entrance_s": {
        "min": 1.5,
        "max": 2.0,
        "reel": 1.75,
    },
    "demo_after_line_s": 0.7,
    "demo_tail_db": -30,
    "voice_after_tail_s": 0.8,
    "exit_after_last_word_s": {
        "min": 1.5,
        "max": 2.0,
        "reel": 1.75,
    },
    "exit_ring_out_s": 2.6,
}
