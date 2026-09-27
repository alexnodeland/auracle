//! How does the preset bank actually sound, in numbers? Level and tonal
//! balance of every built-in preset, measured on the exact buffer audition
//! plays (vetted, loudness-normalized, peak-capped).
//!
//! ```bash
//! cargo run -p auracle-features --example preset_audit --release
//! ```
//!
//! ## Why this exists
//!
//! The presets are the first thing anyone hears and the warm start's whole
//! cold-start evidence, and they were written by ear against maps (see the
//! table at the top of `auracle_grammar::presets`). This is the instrument
//! that checks the ear. Its first run found:
//!
//! * **Infrasound in the pink noise source.** Quiver's 16-row Voss generator
//!   put 22 % of its energy below 20 Hz; behind a lowpass, `Noise Wash`
//!   measured 77 % sub-40 Hz with a 77 Hz centroid. Fixed at the source in
//!   `compile.rs` (a 20 Hz highpass on pink).
//! * **A dark bank.** At C4, most leads put under 1 % of their energy above
//!   2 kHz — a lead is supposed to be the thing that cuts.
//!
//! ## Columns
//!
//! Band shares are of energy in the phrase's active frames (within 40 dB of
//! the loudest frame), so a long release tail does not dilute them.
//!
//! * `cut` — makeup gain given up to the peak ceiling, dB. Above ~4 dB the
//!   patch auditions audibly quieter than its neighbours.
//! * `sub` < 40 Hz · `low` 40–200 · `mid` 200–2k · `pres` 2–6k · `air` > 6k.
//! * `spk` — share in 200 Hz–5 kHz, roughly what a laptop or booth monitor
//!   reproduces. A bass with almost none of it vanishes on small speakers.
//! * `cent` — spectral centroid, Hz.
//!
//! Flags are heuristics to look at, not failures: `RUMBLE` (sub > 10 %),
//! `QUIET` (cut > 4 dB), `DULL` (a lead or keys patch with pres + air
//! < 1 %), `SMALL` (spk < 20 %: disappears on small speakers).

use auracle_features::{featurize, PhraseSpec};
use auracle_grammar::preset_bank;
use rustfft::{num_complex::Complex, FftPlanner};

const N: usize = 2048;
const HOP: usize = 1024;

struct Tone {
    shares: [f64; 5],
    speaker: f64,
    centroid: f64,
}

fn tone(x: &[f64], sr: f64) -> Tone {
    let fft = FftPlanner::new().plan_fft_forward(N);
    let win: Vec<f64> = (0..N)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / N as f64).cos())
        .collect();
    let frames: Vec<&[f64]> = (0..x.len().saturating_sub(N))
        .step_by(HOP)
        .map(|i| &x[i..i + N])
        .collect();
    let energy: Vec<f64> = frames
        .iter()
        .map(|f| f.iter().map(|s| s * s).sum())
        .collect();
    let loudest = energy.iter().cloned().fold(0.0, f64::max);
    let mut power = vec![0.0; N / 2 + 1];
    for (f, e) in frames.iter().zip(&energy) {
        if *e < loudest * 1e-4 {
            continue; // more than 40 dB down: tail, not tone
        }
        let mut buf: Vec<Complex<f64>> = f
            .iter()
            .zip(&win)
            .map(|(s, w)| Complex::new(s * w, 0.0))
            .collect();
        fft.process(&mut buf);
        for (p, c) in power.iter_mut().zip(&buf) {
            *p += c.norm_sqr();
        }
    }
    let hz = |k: usize| k as f64 * sr / N as f64;
    let total: f64 = power.iter().sum::<f64>().max(1e-30);
    let band = |lo: f64, hi: f64| {
        power
            .iter()
            .enumerate()
            .filter(|(k, _)| hz(*k) >= lo && hz(*k) < hi)
            .map(|(_, p)| p)
            .sum::<f64>()
            / total
    };
    Tone {
        shares: [
            band(0.0, 40.0),
            band(40.0, 200.0),
            band(200.0, 2000.0),
            band(2000.0, 6000.0),
            band(6000.0, f64::INFINITY),
        ],
        speaker: band(200.0, 5000.0),
        centroid: power
            .iter()
            .enumerate()
            .map(|(k, p)| hz(k) * p)
            .sum::<f64>()
            / total,
    }
}

fn main() {
    let spec = PhraseSpec::default();
    println!(
        "{:<18} {:<8} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>6}  flags",
        "preset", "family", "cut", "sub%", "low%", "mid%", "pres%", "air%", "spk%", "cent"
    );
    let mut flagged = 0;
    for p in preset_bank() {
        let v = match featurize(&p.tree, &spec) {
            Ok(v) => v,
            Err(e) => {
                println!("{:<18} FAILED: {e}", p.name);
                flagged += 1;
                continue;
            }
        };
        let t = tone(&v.render.samples, spec.sample_rate);
        let cut = v.features.peak_reduction_db;
        let family = p.category;
        let mut flags = Vec::new();
        if t.shares[0] > 0.10 {
            flags.push("RUMBLE");
        }
        if cut > 4.0 {
            flags.push("QUIET");
        }
        if matches!(family, "lead" | "keys") && t.shares[3] + t.shares[4] < 0.01 {
            flags.push("DULL");
        }
        if t.speaker < 0.20 {
            flags.push("SMALL");
        }
        flagged += usize::from(!flags.is_empty());
        let pct = |x: f64| x * 100.0;
        println!(
            "{:<18} {:<8} {:>5.1} {:>5.1} {:>5.1} {:>5.1} {:>5.1} {:>5.1} {:>5.1} {:>6.0}  {}",
            p.name,
            family,
            cut,
            pct(t.shares[0]),
            pct(t.shares[1]),
            pct(t.shares[2]),
            pct(t.shares[3]),
            pct(t.shares[4]),
            pct(t.speaker),
            t.centroid,
            flags.join(" ")
        );
    }
    println!("\n{flagged} preset(s) flagged");
}
