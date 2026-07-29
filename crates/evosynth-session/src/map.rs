//! The taste map: a 2D embedding of everything the user has heard, with
//! posterior utility attached — taste rendered as *territory* (islands of
//! glow across patch space) rather than a single preference vector.
//!
//! The projection is plain PCA over standardized features (top two principal
//! axes by power iteration, deterministic start), computed over the union of
//! the current pool and the observation history. Pool points carry candidate
//! ids (clickable in a frontend); history points are ghosts — patches that
//! may have been evicted, kept to show where the user has traveled.

use serde::{Deserialize, Serialize};

use crate::engine::{Engine, Origin};
use evosynth_taste::Observation;

/// One point on the map.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MapPoint {
    /// Candidate id for pool members; `None` for history ghosts.
    pub id: Option<u64>,
    /// First principal coordinate.
    pub x: f64,
    /// Second principal coordinate.
    pub y: f64,
    /// Posterior-mean mixture utility (0 with no posterior).
    pub utility: f64,
    /// Posterior utility std (0 with no posterior).
    pub utility_std: f64,
    /// Most responsible style lens (0 with no posterior or K = 1).
    pub style: usize,
    /// `"prior"`, `"refined"`, `"edited"`, or `"history"`.
    pub origin: String,
}

/// The 2D taste map.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TasteMap {
    /// All points (pool first, then history ghosts).
    pub points: Vec<MapPoint>,
    /// Fraction of total variance captured by each of the two axes.
    pub explained: [f64; 2],
}

/// Most recent history φs to include as ghost points.
const MAX_HISTORY: usize = 400;

fn mean_center(rows: &mut [Vec<f64>]) {
    if rows.is_empty() {
        return;
    }
    let d = rows[0].len();
    let n = rows.len() as f64;
    let mut mu = vec![0.0; d];
    for r in rows.iter() {
        for (m, x) in mu.iter_mut().zip(r) {
            *m += x / n;
        }
    }
    for r in rows.iter_mut() {
        for (x, m) in r.iter_mut().zip(&mu) {
            *x -= m;
        }
    }
}

/// Leading right-singular vector of the (centered) data by power iteration
/// on X'X, with a deterministic start. Returns (direction, variance).
fn leading_axis(rows: &[Vec<f64>], deflate: Option<&[f64]>) -> (Vec<f64>, f64) {
    let d = rows.first().map(|r| r.len()).unwrap_or(0);
    if d == 0 {
        return (Vec::new(), 0.0);
    }
    // Deterministic start: the coordinate axis of largest variance.
    let mut var0 = vec![0.0; d];
    for r in rows {
        for (v, x) in var0.iter_mut().zip(r) {
            *v += x * x;
        }
    }
    let start = var0
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(i, _)| i)
        .unwrap_or(0);
    let mut v = vec![0.0; d];
    v[start] = 1.0;

    let project_out = |v: &mut [f64]| {
        if let Some(u) = deflate {
            let dot: f64 = v.iter().zip(u).map(|(a, b)| a * b).sum();
            for (vi, ui) in v.iter_mut().zip(u) {
                *vi -= dot * ui;
            }
        }
    };
    project_out(&mut v);

    for _ in 0..60 {
        // w = X'(X v)
        let mut w = vec![0.0; d];
        for r in rows {
            let s: f64 = r.iter().zip(&v).map(|(a, b)| a * b).sum();
            for (wi, xi) in w.iter_mut().zip(r) {
                *wi += s * xi;
            }
        }
        project_out(&mut w);
        let norm: f64 = w.iter().map(|x| x * x).sum::<f64>().sqrt();
        if norm < 1e-12 {
            break;
        }
        for (vi, wi) in v.iter_mut().zip(&w) {
            *vi = wi / norm;
        }
    }
    let variance: f64 = rows
        .iter()
        .map(|r| {
            let s: f64 = r.iter().zip(&v).map(|(a, b)| a * b).sum();
            s * s
        })
        .sum::<f64>()
        / rows.len().max(1) as f64;
    (v, variance)
}

impl Engine {
    /// Build the taste map over the pool plus recent observation history.
    pub fn taste_map(&self) -> TasteMap {
        let mut rows: Vec<Vec<f64>> = Vec::new();
        let mut meta: Vec<(Option<u64>, String)> = Vec::new();
        for c in &self.pool {
            if c.phi_std.is_empty() {
                continue;
            }
            rows.push(c.phi_std.clone());
            let origin = match c.origin {
                Origin::Prior => "prior",
                Origin::Refined => "refined",
                Origin::Edited => "edited",
            };
            meta.push((Some(c.id), origin.into()));
        }
        let mut history: Vec<&Vec<f64>> = Vec::new();
        for o in self.log.observations.iter().rev() {
            match o {
                Observation::Duel { a, b, .. } => {
                    history.push(a);
                    history.push(b);
                }
                Observation::KeepKill { x, .. } | Observation::Stars { x, .. } => history.push(x),
            }
            if history.len() >= MAX_HISTORY {
                break;
            }
        }
        for phi in history {
            rows.push(phi.clone());
            meta.push((None, "history".into()));
        }

        if rows.len() < 3 {
            return TasteMap {
                points: Vec::new(),
                explained: [0.0, 0.0],
            };
        }

        let mut centered = rows.clone();
        mean_center(&mut centered);
        let total_var: f64 = centered
            .iter()
            .map(|r| r.iter().map(|x| x * x).sum::<f64>())
            .sum::<f64>()
            / centered.len() as f64;
        let (ax1, var1) = leading_axis(&centered, None);
        let (ax2, var2) = leading_axis(&centered, Some(&ax1));

        let points = centered
            .iter()
            .zip(rows.iter())
            .zip(meta)
            .map(|((c, phi), (id, origin))| {
                let x: f64 = c.iter().zip(&ax1).map(|(a, b)| a * b).sum();
                let y: f64 = c.iter().zip(&ax2).map(|(a, b)| a * b).sum();
                let (utility, utility_std, style) = match &self.posterior {
                    Some(p) => {
                        let (m, s) = p.utility_mix(phi);
                        let r = p.responsibilities(phi);
                        let style = r
                            .iter()
                            .enumerate()
                            .max_by(|a, b| a.1.total_cmp(b.1))
                            .map(|(i, _)| i)
                            .unwrap_or(0);
                        (m, s, style)
                    }
                    None => (0.0, 0.0, 0),
                };
                MapPoint {
                    id,
                    x,
                    y,
                    utility,
                    utility_std,
                    style,
                    origin,
                }
            })
            .collect();

        TasteMap {
            points,
            explained: [
                (var1 / total_var.max(1e-12)).min(1.0),
                (var2 / total_var.max(1e-12)).min(1.0),
            ],
        }
    }
}
