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
        match featurize_memo(genome, &self.phrase, &self.memo, false) {
            Ok((cf, _)) => {
                let d = self
                    .toward
                    .distance_raw(&cf.features.phi(), &self.standardizer);
                f - (0.5 * self.toward.gamma * d * d).min(OWN_FLOOR)
            }
            Err(_) => f,
        }
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
mod tests {
    use super::*;
    use crate::{run_walk, SessionConfig};
    use auracle_features::{file::recording_stimuli, render::render_phrase, AudioFeatures};
    use auracle_grammar::{preset_bank, PatchGrammarPrior};
    use auracle_taste::SyntheticUser;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    /// The listener the generation tests teach (the crate's `ground_truth`).
    fn listener() -> SyntheticUser {
        let names = Features::phi_names();
        let mut theta = vec![0.0; names.len()];
        let mut set = |name: &str, w: f64| {
            let i = names
                .iter()
                .position(|n| n.split(':').next() == Some(name))
                .unwrap();
            theta[i] = w;
        };
        set("centroid_mean", 2.0);
        set("flatness_mean", -1.5);
        set("attack_s", -1.5);
        set("bass_fraction", 1.0);
        set("n_filter", 0.8);
        set("tail_ratio", 0.6);
        SyntheticUser {
            theta,
            tau: 0.0,
            cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
        }
    }

    /// A pool of 16, 30 duels taught, one fit: the generation tests' engine.
    fn taught(seed: u64) -> Engine {
        let mut rng = StdRng::seed_from_u64(seed);
        let cfg = SessionConfig {
            pool_size: 16,
            refine_steps: 12,
            refine_seeds: 5,
            mcmc_samples: 6_000,
            mcmc_warmup: 2_000,
            ..Default::default()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let user = listener();
        for _ in 0..30 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
        engine
    }

    /// A preset recorded on the melody and measured as a file.
    fn recording(name: &str) -> FileFeatures {
        let p = preset_bank()
            .into_iter()
            .find(|p| p.name == name)
            .expect("a preset by that name");
        let (_, spec) = recording_stimuli().remove(0);
        let r = render_phrase(&p.tree, &spec).unwrap();
        let pcm: Vec<f32> = r.samples.iter().map(|&s| s as f32).collect();
        auracle_features::featurize_file(&pcm, spec.sample_rate).unwrap()
    }

    /// A file measured as this, with every audio coordinate set: what the
    /// session keeps is still only the ones a file measures.
    fn file_of(audio: AudioFeatures) -> FileFeatures {
        FileFeatures {
            audio,
            seconds: 2.0,
            truncated: false,
            lufs_before: -20.0,
            gain_db: 2.0,
        }
    }

    /// The session keeps the measured coordinates, by name, and nothing
    /// masked; a coordinate whose name the current φ lacks is masked on the
    /// way back in rather than misread, and the name is cut to its limit.
    #[test]
    fn a_sound_keeps_only_what_its_file_measures() {
        let f = recording("Glass Pad");
        let own = OwnSound::from_file(&"x".repeat(80), &f);
        assert_eq!(own.name.chars().count(), OWN_NAME_MAX);
        let observed = auracle_features::file_observed();
        assert_eq!(own.features.len(), observed.iter().filter(|o| **o).count());
        for (n, _) in &own.features {
            assert!(
                !auracle_features::FILE_MASKED.contains(&n.as_str()),
                "{n} kept"
            );
        }
        let mut renamed = own.clone();
        renamed.features[0].0 = "centroid_mean:p1".into();
        assert_eq!(renamed.observed().len(), own.observed().len() - 1);
    }

    /// The tilt is the taste minus `(γ/2)·d²` over the measured coordinates
    /// exactly, a coordinate the file does not measure moves nothing, and a
    /// proposal that does not vet keeps its quarantine score.
    #[test]
    fn the_tilt_is_half_gamma_times_the_squared_distance() {
        use fugue_evo::fitness::traits::Fitness;
        let spec = PhraseSpec::default();
        let memo = RenderMemo::default();
        let trees: Vec<_> = preset_bank().into_iter().take(6).map(|p| p.tree).collect();
        let rows: Vec<Vec<f64>> = trees
            .iter()
            .map(|t| {
                featurize_memo(t, &spec, &memo, false)
                    .unwrap()
                    .0
                    .features
                    .phi()
            })
            .collect();
        let std = Arc::new(Standardizer::fit(&rows));
        let toward = Toward {
            observed: vec![0, 3],
            target: vec![0.5, -1.0],
            gamma: 2.0,
        };
        let fit = TowardFitness {
            inner: crate::perform::VetOnlyFitness {
                phrase: spec.clone(),
                memo: memo.clone(),
            },
            toward: toward.clone(),
            standardizer: Arc::clone(&std),
            phrase: spec.clone(),
            memo: memo.clone(),
        };
        for (t, phi) in trees.iter().zip(&rows) {
            let z = std.transform(phi);
            let d2 = (z[0] - 0.5).powi(2) + (z[3] + 1.0).powi(2);
            assert!((fit.evaluate(t) - (-d2)).abs() < 1e-9);
            let mut moved = z.clone();
            moved[1] += 3.0;
            moved[20] -= 2.0;
            assert_eq!(toward.sq_distance(&moved), toward.sq_distance(&z));
        }
        // However far a vetted patch is from the target, it scores above a
        // proposal that does not vet: the pull is floored at OWN_FLOOR.
        let far = TowardFitness {
            toward: Toward {
                target: vec![40.0, -40.0],
                ..toward.clone()
            },
            ..fit.clone()
        };
        for t in &trees {
            assert_eq!(far.evaluate(t), -OWN_FLOOR);
            assert!(far.evaluate(t) > QUARANTINE_FITNESS);
        }
        let silent = auracle_grammar::PatchTree {
            amp: trees[0].amp.clone(),
            root: auracle_grammar::term::AudioNode::Silence {
                uid: auracle_grammar::term::Uid::NEW,
            },
        };
        assert_eq!(fit.evaluate(&silent), QUARANTINE_FITNESS);
    }

    /// **Untilted walks are untouched.** A context without a target
    /// serializes without the key (the farm's JSON is what it was) and one
    /// written before the key existed parses; and at γ = 0 the tilted walk is
    /// the untilted one bit for bit, so wrapping the fitness consumes no
    /// randomness and moves no acceptance. Then, from the same jobs, a walk
    /// at a real γ ends nearer the target on average than the untilted one.
    #[test]
    fn breeding_toward_a_sound_tilts_only_its_own_walks() {
        let mut engine = taught(0x0A1D);
        assert!(
            engine
                .refine_toward_jobs(&mut StdRng::seed_from_u64(1))
                .is_none(),
            "no sound, no generation"
        );
        assert_eq!(engine.own_breed_blocked(), Some("no_sound"));
        let mut untaught = Engine::new(PatchGrammarPrior::default(), SessionConfig::default());
        untaught.own_set("Glass Pad", &recording("Glass Pad"));
        assert_eq!(untaught.own_breed_blocked(), Some("untaught"));
        let mut stale = OwnSound::from_file("Old", &recording("Glass Pad"));
        for (name, _) in &mut stale.features {
            *name = name.replace(":p2", ":p1");
        }
        engine.own = Some(stale);
        assert_eq!(engine.own_breed_blocked(), Some("stale_sound"));
        assert!(engine
            .refine_toward_jobs(&mut StdRng::seed_from_u64(1))
            .is_none());
        engine.own_set("Glass Pad", &recording("Glass Pad"));
        assert_eq!(engine.own_breed_blocked(), None);
        let parents = engine.own_seeds();
        let (ctx, jobs) = engine
            .refine_toward_jobs(&mut StdRng::seed_from_u64(1))
            .expect("taught, with a sound");
        assert_eq!(
            jobs.iter().map(|j| j.parent_id).collect::<Vec<_>>(),
            parents,
            "own_seeds names the parents"
        );
        let toward = ctx.toward.clone().expect("tilted");
        let plain = WalkContext {
            toward: None,
            ..ctx.clone()
        };
        let json = serde_json::to_value(&plain).unwrap();
        assert!(json.get("toward").is_none());
        let back: WalkContext = serde_json::from_value(json).unwrap();
        assert!(back.toward.is_none());

        let flat = WalkContext {
            toward: Some(Toward {
                gamma: 0.0,
                ..toward.clone()
            }),
            ..ctx.clone()
        };
        let memo = engine.memo().clone();
        let walk = |c: &WalkContext| -> Vec<Option<auracle_grammar::PatchTree>> {
            std::thread::scope(|s| {
                let hs: Vec<_> = jobs
                    .iter()
                    .map(|j| {
                        let memo = &memo;
                        s.spawn(move || run_walk(c, j, memo).child)
                    })
                    .collect();
                hs.into_iter().map(|h| h.join().unwrap()).collect()
            })
        };
        let untilted = walk(&plain);
        assert_eq!(walk(&flat), untilted, "γ = 0 moved a walk");

        let strong = WalkContext {
            toward: Some(Toward {
                gamma: 4.0,
                ..toward.clone()
            }),
            ..ctx.clone()
        };
        let tilted = walk(&strong);
        let std = engine.standardizer().unwrap().clone();
        let dist = |ends: &[Option<auracle_grammar::PatchTree>]| -> f64 {
            ends.iter()
                .zip(&jobs)
                .map(|(e, j)| {
                    let t = e.as_ref().unwrap_or(&j.seed);
                    let (cf, _) = featurize_memo(t, &engine.cfg.phrase, &memo, false).unwrap();
                    toward.distance_raw(&cf.features.phi(), &std)
                })
                .sum::<f64>()
                / jobs.len() as f64
        };
        let (t, u) = (dist(&tilted), dist(&untilted));
        assert!(t < u, "tilted walks ended {t:.3}σ away, untilted {u:.3}σ");
    }

    /// The nearest sounds are ranked by the distance over the measured
    /// coordinates; the map places the sound without moving the map; and
    /// the sound, features only, survives a save.
    #[test]
    fn nearest_map_and_save() {
        let mut engine = taught(0x5A7E);
        assert!(engine.own_nearest(3).is_empty());
        assert!(engine.taste_map().own.is_none());
        let before = serde_json::to_string(&engine.taste_map().points).unwrap();
        // A file that measures exactly what pool member 0 measures.
        let (c0_id, c0_audio) = (engine.pool[0].id, engine.pool[0].features.audio);
        engine.own_set("Mine", &file_of(c0_audio));
        let near = engine.own_nearest(3);
        assert_eq!(near[0].0, c0_id, "a member is nearest itself");
        assert!(near[0].1 < 1e-9);
        assert!(near.windows(2).all(|w| w[0].1 <= w[1].1));
        let t = engine.own_toward(OWN_GAMMA).unwrap();
        for (id, d) in &near {
            let c = &engine.pool[engine.find(*id).unwrap()];
            assert!((t.distance(&c.phi_std) - d).abs() < 1e-12);
        }
        let z = engine.own_z().unwrap();
        assert_eq!(z.len(), Features::phi_names().len());
        assert_eq!(z.iter().filter(|v| v.is_some()).count(), t.observed.len());

        let map = engine.taste_map();
        assert_eq!(
            serde_json::to_string(&map.points).unwrap(),
            before,
            "bringing a sound moved the map"
        );
        let own = map.own.expect("placed");
        assert_eq!(own.observed, t.observed.len());
        assert_eq!(engine.own_on_map(crate::map::OWN_PLACEMENT), Some(own));

        let presets = vec![PresetPhi {
            index: 7,
            name: "Copy".into(),
            audio: c0_audio.to_vec(),
        }];
        assert_eq!(engine.own_nearest_presets(1, &presets)[0].0, 7);

        let saved = serde_json::to_string(&engine.export_state()).unwrap();
        assert!(saved.contains("own_sound"));
        let state: crate::SessionState = serde_json::from_str(&saved).unwrap();
        assert_eq!(state.own_sound.as_ref(), engine.own_sound());
        let mut v: serde_json::Value = serde_json::from_str(&saved).unwrap();
        v.as_object_mut().unwrap().remove("own_sound");
        let old: crate::SessionState = serde_json::from_value(v).unwrap();
        assert!(old.own_sound.is_none(), "a session saved before loads");
        assert!(engine.own_clear());
        assert!(!serde_json::to_string(&engine.export_state())
            .unwrap()
            .contains("own_sound"));
    }

    /// The direction liking rises on the map is fitted over pool sounds
    /// only: the sound of your own is placed on the map but has no liking,
    /// so bringing one leaves `belief().direction` exactly as it was.
    #[test]
    fn the_direction_ignores_the_sound_of_your_own() {
        let mut engine = taught(0xD1E0);
        let _ = engine.taste_map();
        let without = engine.belief().direction.expect("a fitted pool");
        engine.own_set("Mine", &file_of(engine.pool[3].features.audio));
        let map = engine.taste_map();
        assert!(map.own.is_some(), "the sound is placed");
        let pool: Vec<[f64; 3]> = map
            .points
            .iter()
            .filter(|pt| pt.id.is_some())
            .map(|pt| [pt.x, pt.y, 1.0 / (1.0 + (-pt.utility).exp())])
            .collect();
        let with = engine.belief().direction.expect("still fitted");
        assert_eq!(with, without, "bringing a sound moved the direction");
        let fit = crate::map::liking_direction(&pool).unwrap();
        assert!((with.gx - fit.gx).abs() <= 1e-9 * (1.0 + fit.gx.abs()));
        assert!((with.gy - fit.gy).abs() <= 1e-9 * (1.0 + fit.gy.abs()));
    }
}
