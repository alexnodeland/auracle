//! A sound of your own (Plan-005 task 11): a recording the player brings,
//! placed in the session's space and bred toward.
//!
//! The file is measured by `auracle_features::featurize_file`, which says
//! which coordinates of φ a recording measures (its spectral balance) and
//! masks the rest (`auracle_features::FILE_MASKED` and every structural
//! coordinate). Here those coordinates become a point in the session's
//! standardized space, the same space the pool, the taste model and the map
//! live in, and three things are read off it:
//!
//! - **Its nearest sounds:** Euclidean distance in standardized φ over the
//!   coordinates the file measures. The map is a projection of the same
//!   Euclidean space (PCA over standardized φ), so "near" means what the map
//!   draws as near, without the projection's loss. A masked coordinate is
//!   left out of the sum, not filled in: filling it with the mean would pull
//!   every distance toward the pool's center and call the average patch the
//!   nearest.
//! - **Its place on the map:** [`crate::TasteMap::own`], the map's own
//!   projection of the measured coordinates, the rest at the map's mean
//!   ([`crate::map::OWN_PLACEMENT`], chosen by measurement).
//! - **Breeding toward it:** [`Engine::refine_toward_jobs`] opens a
//!   generation whose walks sample a target tilted toward it
//!   ([`TowardFitness`]).
//!
//! The session keeps the file's measured coordinates, by name and raw (the
//! standardizer refits), never the audio: a save is the player's autosave,
//! and half a minute of samples is megabytes in it for nothing the engine
//! reads.

use std::collections::HashSet;
use std::sync::Arc;

use auracle_features::{featurize_memo, Features, FileFeatures, PhraseSpec, RenderMemo};
use auracle_taste::Standardizer;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::engine::Engine;
use crate::surrogate::QUARANTINE_FITNESS;
use crate::walk::{WalkContext, WalkJob};

/// How hard a walk bred toward a sound of your own is pulled to it: γ in
/// [`TowardFitness`]'s target, in fitness per σ² of squared distance (halved).
/// With the session's β = 2, the file reads as a measurement of the patch's
/// sound with noise `τ = 1/√(βγ)` σ on each coordinate it measures.
///
/// Chosen by census (`examples/own_census.rs`, 90 walks an arm). 4 gives
/// `τ ≈ 0.35σ` of the session's spread, the same size as a recording's own
/// error on the coordinates it measures (0.03 to 0.43σ in `auracle-features`'
/// `file_phi`); those are σ of the presets' spread, another scale, so the
/// match is of size, not a calibration of the file's error. It is the
/// smallest γ measured whose walks from the parents nearest the sound end
/// nearer than they began (−0.09 ± 0.03σ; untilted, +1.94σ), and from the
/// taste's own parents it ends nearest both the recording (0.79 ± 0.05σ) and
/// the preset it was recorded from (0.84σ): at 8 the pull is so steep that
/// [`OWN_FLOOR`] leaves farther walks unguided, and both get worse.
pub const OWN_GAMMA: f64 = 4.0;

/// The most a walk bred toward a sound of your own is charged for being far
/// from it, in fitness: the tilt is `min((γ/2)·d², OWN_FLOOR)`.
///
/// Without a floor the pull is unbounded, and a quarantined proposal (which
/// has no φ to measure, so it keeps [`QUARANTINE_FITNESS`], −50, untilted)
/// outscores any patch more than `√(100/γ)`σ from the target: 5σ at γ = 4.
/// The first census, without it, saw strongly pulled walks from the taste's
/// own parents end on patches that do not vet; with it, none did. Half the
/// quarantine's depth keeps every vetted patch above quarantine for any
/// taste above −25, and pulls out to `√(2·25/γ)` ≈ 3.5σ at γ = 4, well past
/// where a breed toward a sound starts (its parents, the members nearest the
/// sound, were 0.6σ from it on average in the census).
///
/// Read as Bayes, it is the likelihood a contaminated measurement has: the
/// recording is the patch's sound with noise τ, or, beyond the floor, a sound
/// this grammar does not make, and then distance says nothing more.
pub const OWN_FLOOR: f64 = 25.0;

/// Longest name kept for a sound of your own, in characters.
pub const OWN_NAME_MAX: usize = 32;

/// A sound of your own, as the session keeps and saves it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OwnSound {
    /// What the player calls it (the file's name), at most
    /// [`OWN_NAME_MAX`] characters.
    pub name: String,
    /// Raw φ of each coordinate the file measures, by name. By name, as the
    /// observation log stores φ: a coordinate whose name the current φ does
    /// not have (a stimulus tag bumped since) is masked on load, never
    /// misread.
    pub features: Vec<(String, f64)>,
    /// Seconds of sound measured.
    pub seconds: f64,
    /// The file ran past the measured span and was cut.
    #[serde(default)]
    pub truncated: bool,
}

impl OwnSound {
    /// The sound a measured file makes: its observed coordinates, by name.
    pub fn from_file(name: &str, file: &FileFeatures) -> Self {
        let names = Features::phi_names();
        let phi = file.phi();
        let features = auracle_features::file_observed()
            .into_iter()
            .zip(names.iter().zip(phi))
            .filter(|(observed, _)| *observed)
            .map(|(_, (n, v))| ((*n).to_string(), v))
            .collect();
        OwnSound {
            name: name.trim().chars().take(OWN_NAME_MAX).collect(),
            features,
            seconds: file.seconds,
            truncated: file.truncated,
        }
    }

    /// `(index into φ, raw value)` of each coordinate the file measures that
    /// the current φ still has, and that a file can measure today.
    pub fn observed(&self) -> Vec<(usize, f64)> {
        let names = Features::phi_names();
        let measurable = auracle_features::file_observed();
        let mut out: Vec<(usize, f64)> = self
            .features
            .iter()
            .filter(|(_, v)| v.is_finite())
            .filter_map(|(n, v)| {
                let i = names.iter().position(|m| m == n)?;
                measurable[i].then_some((i, *v))
            })
            .collect();
        out.sort_by_key(|(i, _)| *i);
        out.dedup_by_key(|(i, _)| *i);
        out
    }
}

/// A target in the session's standardized φ: what a walk is pulled toward,
/// over the coordinates it is measured on.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Toward {
    /// Indices into φ ([`Features::phi_names`]) the target is measured on.
    pub observed: Vec<usize>,
    /// The target's standardized value at each of `observed`.
    pub target: Vec<f64>,
    /// How hard to pull ([`OWN_GAMMA`]).
    pub gamma: f64,
}

impl Toward {
    /// Squared Euclidean distance from a standardized φ to the target, over
    /// the observed coordinates only.
    pub fn sq_distance(&self, phi_std: &[f64]) -> f64 {
        self.observed
            .iter()
            .zip(&self.target)
            .map(|(&j, t)| {
                let d = phi_std.get(j).copied().unwrap_or(0.0) - t;
                d * d
            })
            .sum()
    }

    /// [`Self::sq_distance`], rooted: the metric every nearest sound is
    /// ranked by, in σ of the session's spread.
    pub fn distance(&self, phi_std: &[f64]) -> f64 {
        self.sq_distance(phi_std).sqrt()
    }

    /// The same distance from a raw φ, standardized by `std` on the way.
    pub fn distance_raw(&self, phi: &[f64], std: &Standardizer) -> f64 {
        self.observed
            .iter()
            .zip(&self.target)
            .map(|(&j, t)| {
                let z = (phi.get(j).copied().unwrap_or(0.0) - std.mean[j]) / std.std[j];
                (z - t) * (z - t)
            })
            .sum::<f64>()
            .sqrt()
    }
}

/// Any fitness, tilted toward a target: a walk bred toward a sound of your
/// own samples
///
/// `π(x) ∝ p_grammar(x) · exp(β·(f(x) − min((γ/2)·d(x)², OWN_FLOOR)))`,
/// `d(x)² = Σ_{j∈O} (z_j(x) − z*_j)²`
///
/// where `f` is the taste surrogate, `z(x)` the patch's standardized φ, `z*`
/// the file's and `O` the coordinates the file measures. Read as Bayes, it
/// is the taste's target times a Gaussian likelihood `N(z*_O; z_O(x), τ²I)`,
/// `τ² = 1/(βγ)`, floored where the recording stops saying anything
/// ([`OWN_FLOOR`]): the patches you would like, weighted by how well each
/// explains the recording as a measurement of its sound. A coordinate the
/// file does not measure has no factor at all, which is that likelihood
/// marginalized over it.
///
/// The walk stays exact Metropolis–Hastings: the kernel is untouched and the
/// fitness is a deterministic function of the patch, so every acceptance is
/// the ratio of this target. Costs no render: the inner fitness featurized
/// the proposal through the same memo. A proposal that does not vet keeps
/// the quarantine score, untilted.
#[derive(Clone, Debug)]
pub struct TowardFitness<F> {
    /// The fitness being tilted ([`crate::SurrogateFitness`]).
    pub inner: F,
    /// The target.
    pub toward: Toward,
    /// The standardizer the session's φ lives under.
    pub standardizer: Arc<Standardizer>,
    /// The audition stimulus (the inner fitness's own).
    pub phrase: PhraseSpec,
    /// The featurization memo, shared with `inner`.
    pub memo: RenderMemo,
}

impl<F> fugue_evo::fitness::traits::Fitness for TowardFitness<F>
where
    F: fugue_evo::fitness::traits::Fitness<Genome = auracle_grammar::PatchTree, Value = f64>,
{
    type Genome = auracle_grammar::PatchTree;
    type Value = f64;

    fn evaluate(&self, genome: &auracle_grammar::PatchTree) -> f64 {
        let f = self.inner.evaluate(genome);
        if f <= QUARANTINE_FITNESS {
            return f;
        }
        // A genome scored above quarantine vets, so it measures; the case
        // where it would not is folded into the `map_or` (no pull toward the
        // sound) rather than given a branch of its own.
        featurize_memo(genome, &self.phrase, &self.memo, false).map_or(f, |(cf, _)| {
            let d = self
                .toward
                .distance_raw(&cf.features.phi(), &self.standardizer);
            f - (0.5 * self.toward.gamma * d * d).min(OWN_FLOOR)
        })
    }
}

/// A preset's audio φ, raw, for ranking the presets nearest a sound of your
/// own without rendering them (the app ships every preset's measurement).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PresetPhi {
    /// Its index in `auracle_grammar::preset_bank`.
    pub index: usize,
    /// Its name.
    pub name: String,
    /// Raw audio φ, in `AudioFeatures::NAMES` order.
    pub audio: Vec<f64>,
}

impl Engine {
    /// Bring a sound of your own: `file` measured, called `name`. Replaces
    /// any sound brought before.
    pub fn own_set(&mut self, name: &str, file: &FileFeatures) {
        self.own = Some(OwnSound::from_file(name, file));
    }

    /// Put the sound of your own down. Returns whether there was one.
    pub fn own_clear(&mut self) -> bool {
        self.own.take().is_some()
    }

    /// The sound of your own, if there is one.
    pub fn own_sound(&self) -> Option<&OwnSound> {
        self.own.as_ref()
    }

    /// The sound of your own as a target in this session's standardized φ,
    /// pulled at `gamma`. `None` without a sound, before the pool has a
    /// standardizer, or when none of its coordinates is measured today.
    pub fn own_toward(&self, gamma: f64) -> Option<Toward> {
        let own = self.own.as_ref()?;
        let std = self.standardizer.as_deref()?;
        let (observed, target): (Vec<usize>, Vec<f64>) = own
            .observed()
            .into_iter()
            .filter(|(j, _)| *j < std.dimension())
            .map(|(j, v)| (j, (v - std.mean[j]) / std.std[j]))
            .unzip();
        if observed.is_empty() {
            return None;
        }
        Some(Toward {
            observed,
            target,
            gamma,
        })
    }

    /// The sound of your own's standardized φ, every coordinate of
    /// [`Features::phi_names`]: `None` where the file does not measure it.
    pub fn own_z(&self) -> Option<Vec<Option<f64>>> {
        let t = self.own_toward(OWN_GAMMA)?;
        let mut z = vec![None; Features::phi_names().len()];
        for (&j, &v) in t.observed.iter().zip(&t.target) {
            z[j] = Some(v);
        }
        Some(z)
    }

    /// The `k` pool members nearest the sound of your own, nearest first:
    /// `(id, distance)`, the distance in σ over the coordinates the file
    /// measures. Empty without a sound or a standardizer.
    pub fn own_nearest(&self, k: usize) -> Vec<(u64, f64)> {
        let Some(t) = self.own_toward(OWN_GAMMA) else {
            return Vec::new();
        };
        let mut rows: Vec<(u64, f64)> = self
            .pool
            .iter()
            .filter(|c| !c.phi_std.is_empty())
            .map(|c| (c.id, t.distance(&c.phi_std)))
            .collect();
        rows.sort_by(|a, b| a.1.total_cmp(&b.1));
        rows.truncate(k);
        rows
    }

    /// The `k` presets nearest the sound of your own among `presets`,
    /// nearest first: `(index, distance)`, by the same metric as
    /// [`Self::own_nearest`]. Each preset's raw audio φ is standardized by
    /// this session's standardizer.
    pub fn own_nearest_presets(&self, k: usize, presets: &[PresetPhi]) -> Vec<(usize, f64)> {
        let (Some(t), Some(std)) = (self.own_toward(OWN_GAMMA), self.standardizer.as_deref())
        else {
            return Vec::new();
        };
        let mut rows: Vec<(usize, f64)> = presets
            .iter()
            .filter(|p| t.observed.iter().all(|&j| j < p.audio.len()))
            .map(|p| (p.index, t.distance_raw(&p.audio, std)))
            .filter(|(_, d)| d.is_finite())
            .collect();
        rows.sort_by(|a, b| a.1.total_cmp(&b.1));
        rows.truncate(k);
        rows
    }

    /// Open a generation bred toward the sound of your own, as data, exactly
    /// as [`Self::refine_jobs`] opens the taste's: one [`WalkContext`] whose
    /// `toward` tilts every walk ([`TowardFitness`], at [`OWN_GAMMA`]), and
    /// one [`WalkJob`] per parent. The parents are the
    /// [`crate::SessionConfig::refine_seeds`] pool members nearest the sound,
    /// nearest first, rather than the best ranked: breeding toward a sound
    /// starts from what is already near it.
    ///
    /// The results come back through [`Self::refine_absorb`] like any
    /// generation's, and a child is admitted by the same bar: it must please
    /// the taste more than the member it would displace. Draws one `u64` from
    /// `rng` (the caller's evolution stream). `None`, opening nothing, without
    /// a sound, a standardizer or a fitted taste.
    pub fn refine_toward_jobs<R: Rng>(
        &mut self,
        rng: &mut R,
    ) -> Option<(WalkContext, Vec<WalkJob>)> {
        self.refine_toward_jobs_at(rng, OWN_GAMMA)
    }

    /// [`Self::refine_toward_jobs`] at a stated `gamma`: the census sweeps
    /// it; everything else uses [`OWN_GAMMA`].
    pub fn refine_toward_jobs_at<R: Rng>(
        &mut self,
        rng: &mut R,
        gamma: f64,
    ) -> Option<(WalkContext, Vec<WalkJob>)> {
        // As `refine_jobs`: finish any generation still open first, so the
        // parents and the tilted prior are read off the pool it leaves.
        self.refine_finish();
        let toward = self.own_toward(gamma)?;
        let ctx = self.walk_context()?;
        let mut rows: Vec<(usize, f64)> = self
            .pool
            .iter()
            .enumerate()
            .filter(|(_, c)| !c.phi_std.is_empty())
            .map(|(i, c)| (i, toward.distance(&c.phi_std)))
            .collect();
        rows.sort_by(|a, b| a.1.total_cmp(&b.1));
        rows.truncate(self.cfg.refine_seeds);
        let ctx = WalkContext {
            toward: Some(toward),
            ..ctx
        };
        let rows = rows.into_iter().map(|(i, _)| i).collect();
        Some(self.open_jobs(rng, ctx, rows))
    }

    /// Why a breed toward the sound of your own would open nothing now, or
    /// `None` when [`Self::refine_toward_jobs`] would open a generation. A
    /// code the app words, never text: `no_sound` (none brought, or put
    /// down), `untaught` (no fitted taste yet, so nothing breeds, as EVOLVE
    /// POOL does not), or `stale_sound` (a sound saved under coordinates
    /// today's φ no longer has, so nothing of it can be measured: bring the
    /// file again).
    pub fn own_breed_blocked(&self) -> Option<&'static str> {
        if self.own.is_none() {
            return Some("no_sound");
        }
        if self.posterior.is_none() || self.standardizer.is_none() {
            return Some("untaught");
        }
        if self.own_toward(OWN_GAMMA).is_none() {
            return Some("stale_sound");
        }
        None
    }

    /// The ids of the pool members a toward generation opened now would
    /// breed from, nearest first ([`Self::refine_toward_jobs`]). Empty when
    /// it would open nothing.
    pub fn own_seeds(&self) -> Vec<u64> {
        if self.walk_context().is_none() {
            return Vec::new();
        }
        let gone: HashSet<u64> = self.retiring().into_iter().collect();
        let Some(t) = self.own_toward(OWN_GAMMA) else {
            return Vec::new();
        };
        let mut rows: Vec<(u64, f64)> = self
            .pool
            .iter()
            .filter(|c| !c.phi_std.is_empty() && !gone.contains(&c.id))
            .map(|c| (c.id, t.distance(&c.phi_std)))
            .collect();
        rows.sort_by(|a, b| a.1.total_cmp(&b.1));
        rows.into_iter()
            .take(self.cfg.refine_seeds)
            .map(|(id, _)| id)
            .collect()
    }
}

#[cfg(test)]
mod tests;
