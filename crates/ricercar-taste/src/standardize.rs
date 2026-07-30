//! Feature standardization.
//!
//! Raw `φ` scales vary wildly (counts 0–5, centroid 0–1, crest 1–40+); a
//! Gaussian prior over θ only makes sense on a common scale. The standardizer
//! is fit on a reference sample of candidates (the session layer's pool, or
//! the synthetic pool in tests) and **persisted with the taste profile** — θ
//! is only meaningful relative to the standardization that produced its
//! observations.

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

    /// Dimension this standardizer was fit for.
    pub fn dimension(&self) -> usize {
        self.mean.len()
    }
}
