//! What it costs to tell the app the belief after every pick (Plan-005 task
//! 9, RFC-006 Open 3), measured before the worker posted it.
//!
//! ```bash
//! cargo run -p auracle-wasm --example pick_belief --release -- [picks] [threads]
//! ```
//!
//! Boots the app's pool of 40 (`shipped::boot`), then plays `picks` duels
//! (default 30) through the `WasmEngine` surface the worker drives, refitting
//! every sixth pick as the app does (`FIT_EVERY` in `main.js`). Each pick is
//! decided by the model's own forecast and a seeded coin, so the weights
//! concentrate as a consistent player's do. After each pick it times, one call
//! at a time:
//!
//! * `record`: `record_duel`, which folds the pick into the posterior by
//!   importance reweighting (no refit);
//! * `belief`: what the worker now posts with every pick: each member's
//!   mean, std and lens, the next generation's seeds and what it may replace;
//! * `ranked`: the ranked list a refit posts (names and terms included);
//! * `map`: the whole TASTE map (pool, history ghosts, projection);
//! * `styles`: the lenses' θ means and stds.
//!
//! The cost of all of these is the posterior's draws (500) × lenses (K) × φ
//! (44) per point, so it is a function of K, which grows by one for every 20
//! picks up to five, and, for the map, of the history it projects (two φ per
//! pick, up to 400). Then it prints the median of each per K.
//!
//! The same loop in the browser's speed class: the built package
//! (`make wasm`) driven from node, whose V8 is Chrome's, with the same seed and
//! the same coin. That script is not kept; the loop above is all it does.
//!
//! ## Measured (2026-10-01, an Apple M3 Max, medians per K over 100 picks)
//!
//! | K (picks) | record | belief | ranked | map | styles | refit |
//! |---|---|---|---|---|---|---|
//! | 1 (7–24), wasm | 0.16 | 0.46 | 0.56 | 1.4 | 0.44 | 0.18 s |
//! | 2 (25–42), wasm | 0.23 | **0.82** | 0.89 | 4.7 | 1.72 | 0.40 s |
//! | 3 (43–60), wasm | 0.27 | 1.09 | 1.15 | 10.6 | 3.03 | 0.62 s |
//! | 4 (61–84), wasm | 0.34 | 1.41 | 1.55 | 19.9 | 4.35 | 0.90 s |
//! | 5 (85–100), wasm | 0.39 | **1.78** | 1.84 | 30.1 | 5.77 | 1.19 s |
//! | 1, native | 0.10 | 0.33 | 0.39 | 0.8 | 0.32 | 0.13 s |
//! | 2, native | 0.15 | 0.58 | 0.65 | 3.2 | 1.17 | 0.28 s |
//! | 5, native | 0.28 | 1.37 | 1.42 | 24.2 | 4.61 | 0.91 s |
//!
//! Milliseconds unless marked; a refit is filed under the K it fitted. wasm
//! runs the belief 1.3 to 1.4 times slower than native here. A session of 30
//! picks is at K = 2: under a millisecond per pick for the belief, and under
//! 2 ms at K = 5, so a machine five times slower stays under 10 ms. The belief
//! is 2.9 KB of JSON against 13 KB for the ranked list, which carries every
//! name and term.
//!
//! The first `belief` took the summaries from the calls that already existed
//! (`ranked`, the map's `responsibilities`, two eviction orders): 7.9 ms
//! native at K = 5. It is one pass over the draws per member now
//! (`TastePosterior::utility_mix_and_responsibilities`), with the seeds and
//! the eviction order read off those scores.
//!
//! So the belief is posted with every pick. The whole map is not: its history
//! ghosts and its projection cost 30 ms in wasm by 100 picks and grow with the
//! history to 400 φ, so they wait for a refit, as they always have.

use std::collections::BTreeMap;
use std::time::Instant;

use auracle_wasm::shipped;

/// `FIT_EVERY` in `apps/web/main.js`.
const FIT_EVERY: usize = 6;

/// A deterministic coin (xorshift64*), so the picks are the same every run.
struct Coin(u64);
impl Coin {
    fn unit(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn ms(f: impl FnOnce() -> usize) -> (f64, usize) {
    let t = Instant::now();
    let bytes = f();
    (t.elapsed().as_secs_f64() * 1e3, bytes)
}

fn median(xs: &mut [f64]) -> f64 {
    xs.sort_by(f64::total_cmp);
    xs[xs.len() / 2]
}

fn main() {
    let args: Vec<usize> = std::env::args()
        .skip(1)
        .filter_map(|a| a.parse().ok())
        .collect();
    let picks = args.first().copied().unwrap_or(30);
    let threads = args.get(1).copied().unwrap_or(8);

    let t0 = Instant::now();
    let mut e = shipped::boot(threads);
    eprintln!("booted a pool of 40 in {:.1} s", t0.elapsed().as_secs_f64());

    let mut coin = Coin(0x9E37_79B9_7F4A_7C15);
    // Per K: record, belief, ranked, map, styles (ms), and the refits.
    let mut by_k: BTreeMap<usize, [Vec<f64>; 5]> = BTreeMap::new();
    let mut fits: BTreeMap<usize, Vec<f64>> = BTreeMap::new();
    println!(
        "pick  K  ess   record  belief  ranked    map  styles   (ms; bytes: belief, ranked, map)"
    );
    for pick in 1..=picks {
        let pair: Option<[u64; 2]> = serde_json::from_str(&e.next_duel()).unwrap();
        let [a, b] = pair.expect("a duel");
        // The model's own forecast once there is one, so the picks are
        // consistent and the weights concentrate as a real session's do.
        let p = e.duel_pred(a as u32, b as u32);
        let chose_a = if p >= 0.0 {
            coin.unit() < p
        } else {
            (a * 7 + b) % 3 != 0
        };
        let (rec, _) = ms(|| e.record_duel(a as u32, b as u32, chose_a) as usize);
        let (bl, bl_b) = ms(|| e.belief().len());
        let (rk, rk_b) = ms(|| e.ranked().len());
        let (mp, mp_b) = ms(|| e.taste_map().len());
        let (st, _) = ms(|| e.styles().len());
        let status: serde_json::Value = serde_json::from_str(&e.status()).unwrap();
        let k = serde_json::from_str::<Option<Vec<serde_json::Value>>>(&e.styles())
            .unwrap()
            .map(|s| s.len())
            .unwrap_or(0);
        println!(
            "{pick:>4} {k:>2} {:>4.0}  {rec:>6.2}  {bl:>6.2}  {rk:>6.2}  {mp:>5.2}  {st:>6.2}   {bl_b} {rk_b} {mp_b}",
            status["ess"].as_f64().unwrap_or(0.0)
        );
        if k > 0 {
            let cols = by_k.entry(k).or_default();
            for (col, v) in cols.iter_mut().zip([rec, bl, rk, mp, st]) {
                col.push(v);
            }
        }
        if pick % FIT_EVERY == 0 {
            let (fit, _) = ms(|| {
                e.fit();
                0
            });
            // Filed under the K it fitted, which a growing log can raise.
            let k = serde_json::from_str::<Option<Vec<serde_json::Value>>>(&e.styles())
                .unwrap()
                .map(|s| s.len())
                .unwrap_or(0);
            fits.entry(k).or_default().push(fit);
            println!("      refit {fit:.0} ms (K {k})");
        }
    }
    println!("\nmedians (ms)\n  K  picks  record  belief  ranked    map  styles   refit");
    for (k, cols) in &mut by_k {
        let n = cols[0].len();
        let [rec, bl, rk, mp, st] = cols.each_mut().map(|c| median(c));
        let fit = fits.get_mut(k).map(|f| median(f)).unwrap_or(f64::NAN);
        println!(
            "  {k}  {n:>5}  {rec:>6.2}  {bl:>6.2}  {rk:>6.2}  {mp:>5.1}  {st:>6.2}  {fit:>6.0}"
        );
    }
}
