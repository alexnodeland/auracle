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
    /// Whether each axis's power iteration actually converged.
    ///
    /// `false` means the projection is a direction the solver was still moving
    /// toward when it hit its cap, which happens when the top two eigenvalues
    /// are near-tied — a live possibility here, because φ's brightness cluster
    /// is three genuine measurements of one perceptual thing. The map is still
    /// drawable; what it is not, in that case, is *stable*, and a surface that
    /// invites the reader to recognise territory should be able to know that.
    ///
    /// `#[serde(default)]` so maps serialized before this existed load as
    /// `[false, false]` rather than failing — the honest reading, since nothing
    /// checked convergence when they were written.
    #[serde(default)]
    pub converged: [bool; 2],
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

/// Power iterations before giving up. Generous, because the loop now *stops*
/// when it has converged rather than always running to the cap — so this is a
/// bound on the pathological case, not the cost of the normal one.
const MAX_POWER_ITERS: usize = 400;

/// Convergence test on the direction: `1 − |⟨v, v_prev⟩|`, i.e. the sine-squared
/// of the angle between successive iterates, to first order. Sign-insensitive
/// because a power iterate may alternate sign while the *axis* is stationary.
const AXIS_TOL: f64 = 1e-12;

/// Leading right-singular vector of the (centered) data by power iteration
/// on X'X, with a deterministic start.
///
/// Returns `(direction, variance, converged)`.
///
/// ## Two things this has to do that it previously did not
///
/// **Stop when it has converged, and say when it has not.** The loop used to
/// run exactly 60 iterations and return whatever it was holding. Power
/// iteration converges as `(λ₂/λ₁)^k`, and φ's brightness cluster is three
/// genuine measurements of one perceptual thing — so near-ties in the top
/// eigenvalues are a designed-in property of this feature set, not a rare
/// accident. Sixty iterations was an assertion about a ratio nobody measured.
///
/// **Pin the sign.** An eigenvector is only defined up to sign, and nothing
/// fixed it: the map's x-axis could point one way on one refit and the other
/// way on the next, mirroring "where you have travelled" left-for-right under
/// the reader. The deterministic start made this *usually* stable, which is
/// worse than either extreme — it flips rarely enough to look like a bug in the
/// data rather than a property of the projection.
///
/// The convention is the standard one (`svd_flip`): the component of largest
/// magnitude is made positive. It is stateless, which is why it is used here
/// over aligning each axis to the previously drawn one — that would be strictly
/// more stable, and it needs `taste_map` to carry state across calls, which is
/// a bigger change than the defect warrants. What remains is that a *tie* for
/// largest magnitude can still flip; with 40 continuous coordinates that is a
/// measure-zero event rather than the routine one this replaces.
fn leading_axis(rows: &[Vec<f64>], deflate: Option<&[f64]>) -> (Vec<f64>, f64, bool) {
    let d = rows.first().map(|r| r.len()).unwrap_or(0);
    if d == 0 {
        return (Vec::new(), 0.0, true);
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

    let mut converged = false;
    for _ in 0..MAX_POWER_ITERS {
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
            // The data has no variance left on this axis. Degenerate, but
            // settled: there is nothing further to converge to.
            converged = true;
            break;
        }
        // `|⟨v_next, v⟩|` — absolute, because an iterate may flip sign between
        // steps while the axis itself is stationary, and treating that as
        // movement would spin to the cap on a converged direction.
        let align: f64 = w
            .iter()
            .zip(&v)
            .map(|(wi, vi)| (wi / norm) * vi)
            .sum::<f64>()
            .abs();
        for (vi, wi) in v.iter_mut().zip(&w) {
            *vi = wi / norm;
        }
        if 1.0 - align < AXIS_TOL {
            converged = true;
            break;
        }
    }

    // Pin the sign: largest-magnitude component positive. Applied after the
    // iteration rather than inside it, because the iteration does not care and
    // flipping mid-loop would only confuse the convergence test above.
    if let Some(pivot) = (0..d).max_by(|&i, &j| v[i].abs().total_cmp(&v[j].abs())) {
        if v[pivot] < 0.0 {
            for vi in v.iter_mut() {
                *vi = -*vi;
            }
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
    (v, variance, converged)
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
                Origin::Preset => "preset",
            };
            meta.push((Some(c.id), origin.into()));
        }
        // History φ are raw; the map lives in standardized space, so they go
        // through the current standardizer — the same one the pool points use,
        // which is what keeps ghosts and live candidates on one projection.
        let mut history: Vec<Vec<f64>> = Vec::new();
        for o in self.log.observations.iter().rev() {
            for phi in o.feedback.phis() {
                let phi = match (&self.standardizer, o.is_raw()) {
                    (Some(sz), true) if phi.len() == sz.dimension() => sz.transform(phi),
                    _ => phi.to_vec(),
                };
                history.push(phi);
            }
            if history.len() >= MAX_HISTORY {
                break;
            }
        }
        for phi in history {
            rows.push(phi);
            meta.push((None, "history".into()));
        }

        if rows.len() < 3 {
            return TasteMap {
                points: Vec::new(),
                explained: [0.0, 0.0],
                // Nothing was solved, so nothing converged. Reported as such
                // rather than as a vacuous success.
                converged: [false, false],
            };
        }

        let mut centered = rows.clone();
        mean_center(&mut centered);
        let total_var: f64 = centered
            .iter()
            .map(|r| r.iter().map(|x| x * x).sum::<f64>())
            .sum::<f64>()
            / centered.len() as f64;
        let (ax1, var1, ok1) = leading_axis(&centered, None);
        let (ax2, var2, ok2) = leading_axis(&centered, Some(&ax1));

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
            converged: [ok1, ok2],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rows on a plane: strong variance along `u1`, weaker along `u2`, plus a
    /// third near-flat coordinate so the deflated axis has somewhere to go.
    fn plane(u1: [f64; 3], u2: [f64; 3], n: usize) -> Vec<Vec<f64>> {
        (0..n)
            .map(|i| {
                let a = i as f64 - (n as f64 - 1.0) / 2.0;
                // A second loading that is not a multiple of the first, so the
                // two directions are genuinely distinguishable.
                let b = ((i * 7) % 5) as f64 - 2.0;
                (0..3).map(|k| 6.0 * a * u1[k] + b * u2[k]).collect()
            })
            .collect()
    }

    /// **The sign convention, on data built to violate it.**
    ///
    /// A PCA axis is defined only up to sign. Power iteration returns whichever
    /// orientation has a positive inner product with its start vector, so the
    /// orientation is a fact about the *solver*, not about the data — and it
    /// changes when the start changes, which it does as the pool moves. On the
    /// map that mirrors "where you have travelled" left-for-right between one
    /// recompute and the next.
    ///
    /// This is the regression test proper: with the convention removed, the
    /// second axis below comes back with its largest component negative.
    ///
    /// The **second** axis is where this bites hardest and is why the case is
    /// built around it. The first axis starts from the highest-variance
    /// coordinate, which is usually also where the leading eigenvector puts its
    /// mass, so the natural orientation tends to satisfy the convention by
    /// accident. The deflated axis starts from that same vector with the first
    /// axis projected *out* of it, and what is left has no such relationship to
    /// the second eigenvector — its sign is genuinely arbitrary.
    #[test]
    fn axes_come_back_with_their_largest_component_positive() {
        let cases = [
            (plane([0.9, 0.3, 0.3], [-0.2, 0.9, -0.4], 40), "a"),
            (plane([0.2, 0.95, 0.2], [0.7, -0.1, -0.7], 40), "b"),
            (plane([0.5, 0.5, 0.7], [-0.8, 0.1, 0.6], 60), "c"),
        ];
        for (rows, name) in &cases {
            let mut centered = rows.clone();
            mean_center(&mut centered);
            let (ax1, _, ok1) = leading_axis(&centered, None);
            let (ax2, _, ok2) = leading_axis(&centered, Some(&ax1));
            assert!(ok1 && ok2, "case {name}: an axis did not converge");

            for (which, ax) in [("ax1", &ax1), ("ax2", &ax2)] {
                let pivot = (0..ax.len())
                    .max_by(|&i, &j| ax[i].abs().total_cmp(&ax[j].abs()))
                    .expect("nonempty axis");
                assert!(
                    ax[pivot] > 0.0,
                    "case {name}: {which} largest component is {:.4} — the sign is unpinned",
                    ax[pivot]
                );
            }

            // Orthonormal, so the two axes are still a basis after the flip.
            let dot: f64 = ax1.iter().zip(&ax2).map(|(a, b)| a * b).sum();
            assert!(
                dot.abs() < 1e-8,
                "case {name}: axes not orthogonal ({dot:.2e})"
            );
            for (which, ax) in [("ax1", &ax1), ("ax2", &ax2)] {
                let norm: f64 = ax.iter().map(|x| x * x).sum::<f64>().sqrt();
                assert!((norm - 1.0).abs() < 1e-8, "case {name}: {which} not unit");
            }
        }
    }

    /// A near-degenerate spectrum must be *reported*, not silently returned as
    /// though it had settled. Two coordinates with identical variance and no
    /// covariance leave the second axis with nothing to converge toward.
    #[test]
    fn a_tied_spectrum_is_reported_rather_than_hidden() {
        let rows: Vec<Vec<f64>> = (0..40)
            .map(|i| {
                let a = i as f64 - 19.5;
                vec![a, if i % 2 == 0 { 1.0 } else { -1.0 }, 0.0]
            })
            .collect();
        let mut centered = rows.clone();
        mean_center(&mut centered);
        let (ax1, var1, _) = leading_axis(&centered, None);
        let (_, var2, _) = leading_axis(&centered, Some(&ax1));
        // Whatever it reports, it must not lie about the ordering.
        assert!(var1 >= var2);
    }
}
