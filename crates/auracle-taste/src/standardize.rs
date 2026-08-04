//! Feature standardization.
//!
//! Raw `φ` scales vary wildly (counts 0–5, log-octave axes ~0–1, log crest
//! 0–4); a Gaussian prior over θ only makes sense on a common scale. The
//! standardizer is re-fit at every posterior fit, over the union of the
//! observation log and the live pool, and **persisted with the taste
//! profile** — θ is only meaningful relative to the standardization that
//! produced it, so a profile carries both or neither.
//!
//! It is a view of the data, not the data: the log stores raw φ, so a
//! re-fit standardizer simply re-expresses the same evidence on a scale that
//! still matches where the pool actually is.

use serde::{Deserialize, Serialize};

/// Per-dimension affine standardization: `(x - mean) / std`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Standardizer {
    /// Per-dimension means.
    pub mean: Vec<f64>,
    /// Per-dimension standard deviations (floored to 1.0 where degenerate).
    pub std: Vec<f64>,
}

/// Fraction of each tail pulled in when a column turns out to be runaway.
///
/// 2% is "one or two of the most extreme rows" at the size this actually runs
/// on — the live pool plus the evicted rows of the log, 40–120 rows.
const WINSOR_TAIL: f64 = 0.02;

/// Below this many usable rows in a column, nothing is winsorized.
///
/// With a handful of values the min and max *are* the spread, and pulling them
/// in throws away the only information about it. Ten is where one row per tail
/// stops being a fifth of the sample.
const WINSOR_MIN_ROWS: usize = 10;

/// How many times bigger the plain σ has to be than the winsorized one before
/// a column is judged **led by its tail rather than described by it**.
///
/// This threshold is the whole design, and both the shape of the rule and the
/// size of the number were arrived at by measurement rather than by argument.
///
/// **Routine winsorizing was written first and thrown out.** Clipping 2% of
/// each tail and always using those moments took a 16-seed
/// `search_health --climb` from `+1.877 ± 0.362` mean gain, climbing on 15/16,
/// to `+0.204 ± 1.347` on 11/16, with one seed at **−18.2**. Trimming a real
/// tail is not free, and a data-hygiene fix that costs the search a standard
/// deviation is not a fix. So the clip became a **fault detector**: the plain
/// moments unless the column is provably runaway, which on clean data is a
/// no-op *by construction* rather than by luck.
///
/// **Then the threshold itself was measured**, because the first guess at it
/// (8×, on the reasoning that clean columns differ "by a factor of order one")
/// was wrong and the paired run said so — 15 of 16 seeds came back bit-identical
/// and the sixteenth went from `+0.12` to `−40.5`. `cargo run -p
/// auracle-features --example winsor_ratio --release -- 150` fits 150 clean
/// 48-patch pools and reports the largest plain/winsorized σ ratio per column:
/// over 6 000 column-fits the maximum is **14.6** (`rms_std:p2`), with
/// `chord_flatness_delta:p2` at 13.9 — and it is still climbing with the sample,
/// because a log-scale audio descriptor over a pool that happens to contain one
/// near-silent patch genuinely has a tail.
///
/// A single `1e30` in a column whose real values live in [0,1] gives a ratio
/// near 2×10²⁹. `1e6` sits five orders above anything clean φ has been observed
/// to produce and twenty-three below the fault, which is as far from both edges
/// as this quantity allows anyone to be.
const RUNAWAY_RATIO: f64 = 1e6;

/// How many rows are pulled in at each end of a column of `n` usable values.
///
/// `ceil`, and floored at one above [`WINSOR_MIN_ROWS`] — not `floor`, which is
/// how the first version of this was written and which made the whole thing
/// inert exactly where it was needed. The reference population is a 48-patch
/// pool and `floor(48 × 0.02)` is **0**, so nothing was clipped at the size the
/// app actually fits at; the pre/post measurement came back bit-identical and
/// said so.
fn winsor_k(n: usize) -> usize {
    if n < WINSOR_MIN_ROWS {
        return 0;
    }
    // `2k < n` by construction at n ≥ 10 for any tail under 0.5, but the cap
    // is written down rather than reasoned about: `col[k]` and `col[n-1-k]`
    // crossing would silently collapse the column onto one value.
    (((n as f64) * WINSOR_TAIL).ceil() as usize).clamp(1, (n - 1) / 2)
}

/// Mean and (population) standard deviation of `col`, optionally with every
/// value pulled into `[lo, hi]` first.
fn moments(col: &[f64], clip: Option<(f64, f64)>) -> (f64, f64) {
    let at = |x: &f64| match clip {
        Some((lo, hi)) => x.clamp(lo, hi),
        None => *x,
    };
    let n = col.len() as f64;
    let m = col.iter().map(at).sum::<f64>() / n;
    let var = col
        .iter()
        .map(|x| {
            let d = at(x) - m;
            d * d
        })
        .sum::<f64>()
        / n;
    (m, var.sqrt())
}

impl Standardizer {
    /// Fit on a reference sample (rows are feature vectors).
    ///
    /// **Robust against a runaway column, and otherwise exactly the plain
    /// moments.** The unrobustified version is what turned one bad row into a
    /// dead coordinate: six cells of `1e30` in fifty stored observations gave
    /// `amp_sustain` a mean of ~1.2e29 and a σ of ~5.5e29, which standardizes
    /// every real patch in the pool to −0.2 ± 1e-30 — a column with no variance
    /// left in it, that the model can never learn from and the belief line still
    /// prints a contribution for.
    ///
    /// Per column: take the plain moments and the moments with the extreme 2%
    /// of each tail pulled in, and use the second **only** when the first is
    /// more than [`RUNAWAY_RATIO`] times wider. That threshold, rather than
    /// winsorizing unconditionally, is deliberate and measured — see
    /// [`RUNAWAY_RATIO`] for what unconditional cost the search. The fault that
    /// produced the row is fixed upstream of here (`PatchTree::clamp_domains`,
    /// the featurizer's quarantine, the load-time repair); this is the line
    /// that means the *next* one costs a coordinate's precision rather than the
    /// coordinate.
    ///
    /// Winsorizing rather than trimming, when it does fire: the rows are not
    /// independent draws from a nuisance distribution — they are the patches
    /// the player has actually met, and a real extreme patch is evidence about
    /// where the pool is. Pulling it in keeps its vote and takes away only its
    /// leverage on the units.
    ///
    /// Non-finite cells are dropped from the column they appear in rather than
    /// poisoning it; a column that is *entirely* non-finite falls back to the
    /// degenerate case (mean 0, σ 1), which standardizes everything to itself
    /// and is the honest reading of "no usable evidence on this axis".
    ///
    /// # Panics
    /// Panics if `rows` is empty or ragged.
    pub fn fit(rows: &[Vec<f64>]) -> Self {
        assert!(!rows.is_empty(), "cannot fit a standardizer on no data");
        let d = rows[0].len();
        for r in rows {
            assert_eq!(r.len(), d, "ragged feature rows");
        }
        let (mut mean, mut std) = (vec![0.0; d], vec![1.0; d]);
        let mut col: Vec<f64> = Vec::with_capacity(rows.len());
        let mut sorted: Vec<f64> = Vec::with_capacity(rows.len());
        for j in 0..d {
            col.clear();
            col.extend(rows.iter().map(|r| r[j]).filter(|x| x.is_finite()));
            if col.is_empty() {
                continue; // mean 0 / σ 1: no usable evidence on this axis
            }
            // `col` stays in **row order** and the quantiles come off a copy.
            // Floating-point addition is not associative, so summing the sorted
            // column would move the mean by a ULP on clean data — and the whole
            // claim below is that clean data comes out bit-identical.
            let (mut m, mut s) = moments(&col, None);
            let k = winsor_k(col.len());
            if k > 0 {
                sorted.clear();
                sorted.extend_from_slice(&col);
                sorted.sort_by(|a, b| a.partial_cmp(b).expect("finite by construction"));
                let (lo, hi) = (sorted[k], sorted[sorted.len() - 1 - k]);
                // `hi > lo` is the guard that keeps a legitimately rare column
                // intact: when 96% of the rows are the same value — a module
                // that appears in two patches out of forty-eight — the tail
                // *is* the column's only information, and clipping it would
                // flatten a real coordinate to nothing in the name of
                // robustness.
                if hi > lo {
                    let (mw, sw) = moments(&col, Some((lo, hi)));
                    if s > RUNAWAY_RATIO * sw {
                        m = mw;
                        s = sw;
                    }
                }
            }
            mean[j] = m;
            std[j] = if s < 1e-9 { 1.0 } else { s };
        }
        Self { mean, std }
    }

    /// Standardize one feature vector.
    pub fn transform(&self, x: &[f64]) -> Vec<f64> {
        x.iter()
            .zip(&self.mean)
            .zip(&self.std)
            .map(|((x, m), s)| (x - m) / s)
            .collect()
    }

    /// Undo [`Self::transform`] — recover raw values from z-scores. The
    /// migration path for logs written before raw-φ logging depends on this:
    /// a legacy log plus the standardizer it was written under *is* the raw
    /// data, just encoded.
    pub fn inverse(&self, z: &[f64]) -> Vec<f64> {
        z.iter()
            .zip(&self.mean)
            .zip(&self.std)
            .map(|((z, m), s)| z * s + m)
            .collect()
    }

    /// Dimension this standardizer was fit for.
    pub fn dimension(&self) -> usize {
        self.mean.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn col(values: &[f64]) -> Vec<Vec<f64>> {
        values.iter().map(|v| vec![*v]).collect()
    }

    /// The defect, as a number. Fifty rows of a coordinate spread over [0,1]
    /// plus **one** escaped `1e30`: unwinsorized, the outlier owns the mean
    /// and the scale, every real patch standardizes to the same place, and the
    /// column is dead — the model can never learn from an axis whose fifty
    /// honest values are separated by 1e-30 of a standard deviation.
    #[test]
    fn one_escaped_row_cannot_kill_a_column() {
        let mut values: Vec<f64> = (0..50).map(|i| i as f64 / 49.0).collect();
        let clean = Standardizer::fit(&col(&values));
        values.push(1e30);
        let poisoned = Standardizer::fit(&col(&values));

        // The scale still describes where the real data is, to within the one
        // row's worth of extra weight at the top of the range.
        assert!(
            (poisoned.std[0] - clean.std[0]).abs() < 0.05,
            "σ moved from {} to {}",
            clean.std[0],
            poisoned.std[0]
        );
        assert!((poisoned.mean[0] - clean.mean[0]).abs() < 0.05);

        // …and the coordinate still separates two real patches, which is the
        // only thing it is for. Unwinsorized this difference was ~1e-30.
        let spread = poisoned.transform(&[1.0])[0] - poisoned.transform(&[0.0])[0];
        assert!(spread > 3.0, "the column carries no information: {spread}");
    }

    /// **Clean data must come out bit-identical to the unrobustified fit.**
    ///
    /// The load-bearing property of the whole design, and the one the first
    /// attempt did not have: a routine 2% clip cost the 16-seed search-health
    /// climb `+1.877 → +0.204` mean gain. A fit that is the plain moments
    /// unless a column is runaway cannot cost the search anything, and this is
    /// what says so — over a heavy right tail, a near-constant column, a
    /// bipolar one and a count, none of which may move by a ULP.
    #[test]
    fn clean_columns_are_bit_identical_to_the_plain_moments() {
        let plain = |v: &[f64]| {
            let n = v.len() as f64;
            let m = v.iter().sum::<f64>() / n;
            (
                m,
                (v.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / n).sqrt(),
            )
        };
        let cases: Vec<Vec<f64>> = vec![
            // A heavy right tail (log-crest shaped).
            (0..60).map(|i| (1.0 + i as f64 / 6.0).ln()).collect(),
            // Near-constant with two rare non-zeros — a module in 2 of 48.
            (0..48).map(|i| if i < 46 { 0.0 } else { 1.0 }).collect(),
            // Bipolar, symmetric.
            (0..80).map(|i| (i as f64 - 40.0) / 13.0).collect(),
            // A count column with a legitimately extreme member.
            {
                let mut v: Vec<f64> = (0..47).map(|i| (i % 4) as f64).collect();
                v.push(9.0);
                v
            },
            // Five rows: under the winsorize floor entirely.
            vec![0.1, 0.4, 0.55, 0.9, 0.2],
        ];
        for (i, values) in cases.iter().enumerate() {
            let sz = Standardizer::fit(&col(values));
            let (m, s) = plain(values);
            assert_eq!(sz.mean[0], m, "case {i}: mean moved");
            assert_eq!(
                sz.std[0],
                if s < 1e-9 { 1.0 } else { s },
                "case {i}: σ moved"
            );
        }
    }

    /// The tail size the detector uses when it does fire. `floor` gave zero for
    /// every n below 50 — including the 48-row reference population the
    /// search-health harness uses — so the rule was inert exactly where it was
    /// needed.
    #[test]
    fn winsor_k_covers_the_sizes_this_runs_at() {
        assert_eq!(winsor_k(9), 0, "too few rows to call anything a tail");
        assert_eq!(winsor_k(10), 1);
        assert_eq!(winsor_k(48), 1, "a full pool must be able to clip a row");
        assert_eq!(winsor_k(90), 2);
        assert_eq!(winsor_k(200), 4);

        // …and the guarantee it buys: one escaped value in a 48-row column
        // cannot move the scale by more than the honest spread of the column.
        let mut values: Vec<f64> = (0..47).map(|i| i as f64 / 46.0).collect();
        let clean = Standardizer::fit(&col(&values));
        values.push(1e30);
        let poisoned = Standardizer::fit(&col(&values));
        assert!(
            (poisoned.std[0] - clean.std[0]).abs() < 0.05,
            "σ moved from {} to {}",
            clean.std[0],
            poisoned.std[0]
        );
    }

    /// A non-finite cell is dropped from its column rather than turning the
    /// whole coordinate into NaN — which is what it used to do, silently, for
    /// every patch in the pool.
    #[test]
    fn a_non_finite_cell_does_not_poison_its_column() {
        let sz = Standardizer::fit(&col(&[0.2, f64::NAN, 0.8, 0.5]));
        assert!(sz.mean[0].is_finite() && sz.std[0].is_finite());
        assert!(sz.transform(&[0.5])[0].is_finite());
    }
}
