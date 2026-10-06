//! The taste map: a 2D embedding of everything the user has heard, with
//! posterior utility attached — taste rendered as *territory* (islands of
//! glow across patch space) rather than a single preference vector.
//!
//! The projection is plain PCA over standardized features (top two principal
//! axes by power iteration, deterministic start), computed over the union of
//! the current pool and the observation history. Pool points carry candidate
//! ids (clickable in a frontend); history points are ghosts — patches that
//! may have been evicted, kept to show where the user has traveled.

use auracle_taste::TastePosterior;
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
    /// Where a sound of your own sits on this map ([`crate::own`]), if the
    /// session has one. Placed on the map's axes, never one of the points the
    /// axes were fitted to: bringing a sound does not move the map.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub own: Option<OwnPoint>,
}

/// A sound of your own's place on the map.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct OwnPoint {
    /// First principal coordinate, on the map's own scale.
    pub x: f64,
    /// Second principal coordinate.
    pub y: f64,
    /// How many coordinates of φ placed it (the ones the file measures).
    pub observed: usize,
}

/// How a point measured on only some coordinates of φ is put on the map.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    /// The map point most probable given the measured coordinates, under the
    /// map read as probabilistic PCA: a prior on the point of the two axes'
    /// variances, and on each coordinate the variance the two axes leave
    /// unexplained. With every coordinate measured this is the projection
    /// every other point gets (shrunk by its noise); with few, it leans on
    /// the axes' spread rather than on coordinates it does not have.
    Fit,
    /// The map's own projection with every unmeasured coordinate at the
    /// map's mean: a projection is linear, so a coordinate at the mean adds
    /// exactly nothing, the rule for anything linear in φ.
    Imputed,
}

/// How a sound of your own is placed ([`TasteMap::own`]). Chosen by
/// measurement (`examples/own_census.rs` places 18 presets from recordings
/// of them against where the map draws each preset itself): `Imputed` was
/// off by 0.37 ± 0.05 of the map's spread, `Fit` by 0.41 ± 0.04, and the
/// centroid of the three nearest pool members (the prototype's way) by
/// 0.53 ± 0.07. The shrinkage `Fit` adds costs more than it saves here.
pub const OWN_PLACEMENT: Placement = Placement::Imputed;

/// What a map is drawn on: the rows, their center, and the two axes.
struct MapFrame {
    rows: Vec<Vec<f64>>,
    meta: Vec<(Option<u64>, String)>,
    centered: Vec<Vec<f64>>,
    mean: Vec<f64>,
    axes: [Vec<f64>; 2],
    variance: [f64; 2],
    total_var: f64,
    converged: [bool; 2],
}

/// Most recent history φs to include as ghost points.
const MAX_HISTORY: usize = 400;

/// Which way liking rises across the map: a summary fit, by least squares, of
/// each pool member's liking (the logistic of its posterior-mean utility, the
/// bank's percentage) on its two map coordinates. `gx` and `gy` are liking per
/// unit of each axis; `r2` is how much of liking's spread across the pool
/// that plane explains (0 to 1). LEARNING draws it as an arrow. It is a
/// description of the ratings on the map, not part of the model.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LikingDirection {
    /// Liking per unit of the map's first axis.
    pub gx: f64,
    /// Liking per unit of the map's second axis.
    pub gy: f64,
    /// The share of liking's spread the plane explains.
    pub r2: f64,
}

/// Least squares of `like` on `(x, y)` over `points` (`[x, y, like]`).
/// `None` with fewer than three points, no spread in liking (no fit yet:
/// every rating 0), or points that do not span both axes. Translating the
/// coordinates changes nothing, so map coordinates with or without the map's
/// centring give the same direction.
pub fn liking_direction(points: &[[f64; 3]]) -> Option<LikingDirection> {
    let ps: Vec<&[f64; 3]> = points
        .iter()
        .filter(|p| p.iter().all(|v| v.is_finite()))
        .collect();
    let n = ps.len();
    if n < 3 {
        return None;
    }
    let nf = n as f64;
    let (mx, my, ml) = ps.iter().fold((0.0, 0.0, 0.0), |(a, b, c), p| {
        (a + p[0] / nf, b + p[1] / nf, c + p[2] / nf)
    });
    let (mut cxx, mut cyy, mut cxy, mut cxl, mut cyl, mut sst) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for p in &ps {
        let (dx, dy, dl) = (p[0] - mx, p[1] - my, p[2] - ml);
        cxx += dx * dx;
        cyy += dy * dy;
        cxy += dx * dy;
        cxl += dx * dl;
        cyl += dy * dl;
        sst += dl * dl;
    }
    let det = cxx * cyy - cxy * cxy;
    // Every input is finite (filtered above), so these sums are too.
    if sst <= 1e-12 || det <= 1e-9 * (cxx * cyy).max(1e-12) {
        return None;
    }
    let gx = (cyy * cxl - cxy * cyl) / det;
    let gy = (cxx * cyl - cxy * cxl) / det;
    let sse: f64 = ps
        .iter()
        .map(|p| {
            let fit = ml + gx * (p[0] - mx) + gy * (p[1] - my);
            (p[2] - fit).powi(2)
        })
        .sum();
    Some(LikingDirection {
        gx,
        gy,
        r2: (1.0 - sse / sst).max(0.0),
    })
}

impl Engine {
    /// A standardized φ on the last map's two axes, uncentred (so up to the
    /// map's translation, which a direction does not see). `None` before a
    /// map has been drawn.
    pub(crate) fn map_coordinates(&self, phi: &[f64]) -> Option<(f64, f64)> {
        let drawn = self.map_axes.lock().unwrap_or_else(|e| e.into_inner());
        let [a1, a2] = drawn.as_ref()?;
        if a1.len() != phi.len() {
            return None;
        }
        let x: f64 = phi.iter().zip(a1).map(|(a, b)| a * b).sum();
        let y: f64 = phi.iter().zip(a2).map(|(a, b)| a * b).sum();
        Some((x, y))
    }
}

fn mean_center(rows: &mut [Vec<f64>]) -> Vec<f64> {
    if rows.is_empty() {
        return Vec::new();
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
    mu
}

/// Put a target measured on `t.observed` on a frame's axes (see
/// [`Placement`]).
fn place(t: &crate::own::Toward, f: &MapFrame, how: Placement) -> OwnPoint {
    // The target's offset from the map's center, on the coordinates it has.
    let c: Vec<(usize, f64)> = t
        .observed
        .iter()
        .zip(&t.target)
        .filter(|(&j, _)| j < f.mean.len())
        .map(|(&j, &v)| (j, v - f.mean[j]))
        .collect();
    let a = |k: usize, j: usize| f.axes[k].get(j).copied().unwrap_or(0.0);
    let atc = [0, 1].map(|k| c.iter().map(|&(j, v)| a(k, j) * v).sum::<f64>());
    let [x, y] = match how {
        Placement::Imputed => atc,
        Placement::Fit => {
            // Probabilistic PCA's posterior mean for a partly observed row:
            // (AᵀA + σ²Λ⁻¹)⁻¹ Aᵀc over the observed rows of A = [a₁ a₂], with
            // Λ the axes' variances and σ² the variance per coordinate the
            // two axes leave over.
            let d = f.mean.len().max(3) as f64;
            let noise = ((f.total_var - f.variance[0] - f.variance[1]) / (d - 2.0)).max(1e-6);
            let mut m = [[0.0; 2]; 2];
            for (k, row) in m.iter_mut().enumerate() {
                for (l, cell) in row.iter_mut().enumerate() {
                    *cell = c.iter().map(|&(j, _)| a(k, j) * a(l, j)).sum::<f64>();
                }
                row[k] += noise / f.variance[k].max(1e-9);
            }
            let det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
            if det.abs() < 1e-12 {
                [0.0, 0.0]
            } else {
                [
                    (m[1][1] * atc[0] - m[0][1] * atc[1]) / det,
                    (m[0][0] * atc[1] - m[1][0] * atc[0]) / det,
                ]
            }
        }
    };
    OwnPoint {
        x,
        y,
        observed: c.len(),
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
/// magnitude is made positive. It is stateless, so it decides only the *first*
/// map's orientation; every map after that faces the way the last one was
/// drawn ([`orient`]). The convention alone was not enough: as the axis turns
/// between refits, which loading is largest changes hands, and when the new
/// largest has the other sign the whole map mirrors. With φ's near-equal
/// brightness loadings that is routine, not a tie at a single point — a taught
/// session measured x before and after one refit at a correlation of −0.98.
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

/// The lens a point is colored by: the style most responsible for `phi`
/// under the weighted draws ([`TastePosterior::responsibilities`]).
fn lens_of(p: &TastePosterior, phi: &[f64]) -> usize {
    most_responsible(&p.responsibilities(phi))
}

/// The index of the largest responsibility, the last of equals. The map and
/// [`Engine::belief`] both color a pool member by it, so a dot's color is
/// the same number from either.
pub(crate) fn most_responsible(responsibilities: &[f64]) -> usize {
    responsibilities
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(i, _)| i)
        .unwrap_or(0)
}

/// Turn `axis` to face the way `drawn` did, if it has flipped: the sign that
/// keeps somewhere you recognise where you left it. An axis that has turned
/// through a right angle has no such sign, and whichever it keeps is as good.
fn orient(axis: &mut [f64], drawn: &[f64]) {
    if axis.len() != drawn.len() {
        return;
    }
    let dot: f64 = axis.iter().zip(drawn).map(|(a, b)| a * b).sum();
    if dot < 0.0 {
        for a in axis.iter_mut() {
            *a = -*a;
        }
    }
}

impl Engine {
    /// Build the taste map over the pool plus recent observation history.
    ///
    /// Each axis faces the way the last map drawn by this session did (the
    /// first takes the sign convention in [`leading_axis`]), so a refit turns
    /// the map rather than mirroring it.
    pub fn taste_map(&self) -> TasteMap {
        let Some(f) = self.map_frame(true) else {
            return TasteMap {
                points: Vec::new(),
                explained: [0.0, 0.0],
                // Nothing was solved, so nothing converged. Reported as such
                // rather than as a vacuous success.
                converged: [false, false],
                own: None,
            };
        };
        let [ax1, ax2] = &f.axes;
        let points = f
            .centered
            .iter()
            .zip(f.rows.iter())
            .zip(f.meta.iter().cloned())
            .map(|((c, phi), (id, origin))| {
                let x: f64 = c.iter().zip(ax1).map(|(a, b)| a * b).sum();
                let y: f64 = c.iter().zip(ax2).map(|(a, b)| a * b).sum();
                let (utility, utility_std, style) = match &self.posterior {
                    Some(p) => {
                        let (m, s) = p.utility_mix(phi);
                        (m, s, lens_of(p, phi))
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
                (f.variance[0] / f.total_var.max(1e-12)).min(1.0),
                (f.variance[1] / f.total_var.max(1e-12)).min(1.0),
            ],
            converged: f.converged,
            own: self
                .own_toward(crate::own::OWN_GAMMA)
                .map(|t| place(&t, &f, OWN_PLACEMENT)),
        }
    }

    /// Where the sound of your own sits on the map as it would be drawn now,
    /// placed `how`, without drawing it: no utilities are computed and the
    /// map's remembered orientation is read, not written. `None` without a
    /// sound, a standardizer, or a map (fewer than three points).
    pub fn own_on_map(&self, how: Placement) -> Option<OwnPoint> {
        let t = self.own_toward(crate::own::OWN_GAMMA)?;
        let f = self.map_frame(false)?;
        Some(place(&t, &f, how))
    }

    /// The rows the map is drawn from (the pool, then recent history, all
    /// standardized), their center and the two axes, each facing the way the
    /// last drawn map's did. `remember` records these axes as the last drawn
    /// (drawing the map does; placing a point on it does not). `None` below
    /// three rows.
    fn map_frame(&self, remember: bool) -> Option<MapFrame> {
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
            return None;
        }

        let mut centered = rows.clone();
        let mean = mean_center(&mut centered);
        let total_var: f64 = centered
            .iter()
            .map(|r| r.iter().map(|x| x * x).sum::<f64>())
            .sum::<f64>()
            / centered.len() as f64;
        let (mut ax1, var1, ok1) = leading_axis(&centered, None);
        let (mut ax2, var2, ok2) = leading_axis(&centered, Some(&ax1));
        {
            let mut drawn = self.map_axes.lock().unwrap_or_else(|e| e.into_inner());
            if let Some([d1, d2]) = drawn.as_ref() {
                orient(&mut ax1, d1);
                orient(&mut ax2, d2);
            }
            if remember {
                *drawn = Some([ax1.clone(), ax2.clone()]);
            }
        }
        Some(MapFrame {
            rows,
            meta,
            centered,
            mean,
            axes: [ax1, ax2],
            variance: [var1, var2],
            total_var,
            converged: [ok1, ok2],
        })
    }
}

#[cfg(test)]
mod tests;
