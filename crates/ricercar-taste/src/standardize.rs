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

impl Standardizer {
    /// Fit on a reference sample (rows are feature vectors).
    ///
    /// # Panics
    /// Panics if `rows` is empty or ragged.
    pub fn fit(rows: &[Vec<f64>]) -> Self {
        assert!(!rows.is_empty(), "cannot fit a standardizer on no data");
        let d = rows[0].len();
        let n = rows.len() as f64;
        let mut mean = vec![0.0; d];
        for r in rows {
            assert_eq!(r.len(), d, "ragged feature rows");
            for (m, x) in mean.iter_mut().zip(r) {
                *m += x;
            }
        }
        for m in &mut mean {
            *m /= n;
        }
        let mut var = vec![0.0; d];
        for r in rows {
            for ((v, x), m) in var.iter_mut().zip(r).zip(&mean) {
                *v += (x - m) * (x - m);
            }
        }
        let std = var
            .into_iter()
            .map(|v| {
                let s = (v / n).sqrt();
                if s < 1e-9 {
                    1.0
                } else {
                    s
                }
            })
            .collect();
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
