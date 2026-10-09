use super::*;
use crate::testkit::{contrary_picks, fast, ground_truth, reload};
use crate::{SessionConfig, SessionState};
use auracle_grammar::PatchGrammarPrior;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// A short chain: these tests are about where the fit runs and what it
/// installs, not about the posterior's quality.
fn small() -> SessionConfig {
    SessionConfig {
        pool_size: 8,
        mcmc_samples: 600,
        mcmc_warmup: 200,
        ..fast()
    }
}

/// A pool of eight and `duels` picks from the synthetic listener, unfitted.
/// Deterministic in `seed`: two calls build the same engine.
fn picked(seed: u64, duels: usize) -> Engine {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();
    let mut engine = Engine::new(PatchGrammarPrior::default(), small());
    engine.begin_session();
    engine.fill_pool(&mut rng);
    for _ in 0..duels {
        let (a, b) = engine.next_duel(&mut rng).unwrap();
        let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
        engine.record_duel(a, b, chose_a);
    }
    engine
}

/// Every number of a posterior, as bits.
fn bits(p: &TastePosterior) -> Vec<u64> {
    p.samples
        .iter()
        .flat_map(|s| {
            s.theta
                .iter()
                .flatten()
                .chain(&s.tau)
                .chain(&s.cuts)
                .map(|x| x.to_bits())
                .collect::<Vec<_>>()
        })
        .chain(p.weights.iter().map(|w| w.to_bits()))
        .collect()
}

fn posterior_bits(e: &Engine) -> Vec<u64> {
    bits(e.posterior.as_deref().expect("a posterior"))
}

fn pool_bits(e: &Engine) -> Vec<u64> {
    e.pool
        .iter()
        .flat_map(|c| c.phi_std.iter().map(|x| x.to_bits()))
        .collect()
}

/// A job carried to another thread and its answer carried back, as the app
/// carries them: through JSON.
fn elsewhere(job: &FitJob, seed: u64) -> FitResult {
    let job: FitJob = serde_json::from_str(&serde_json::to_string(job).unwrap()).unwrap();
    let fit = job.run(&mut StdRng::seed_from_u64(seed));
    serde_json::from_str(&serde_json::to_string(&fit).unwrap()).unwrap()
}

#[test]
fn a_fit_run_elsewhere_from_its_job_installs_the_posterior_a_fit_here_makes() {
    // Twice: the second fit is aligned to the first and folds nothing in.
    let mut here = picked(11, 8);
    let mut there = picked(11, 8);
    for round in 0..2 {
        here.fit_posterior(&mut StdRng::seed_from_u64(round));
        let job = there.fit_job().expect("a log to fit");
        assert_eq!(job.observations, there.log.len());
        there
            .install_fit(elsewhere(&job, round))
            .expect("installed");
        assert_eq!(
            posterior_bits(&here),
            posterior_bits(&there),
            "round {round}: other draws"
        );
        assert_eq!(
            pool_bits(&here),
            pool_bits(&there),
            "round {round}: the pool on another scale"
        );
        assert_eq!(here.standardizer, there.standardizer);
        assert_eq!(
            serde_json::to_string(here.style_shares()).unwrap(),
            serde_json::to_string(there.style_shares()).unwrap()
        );
        assert_eq!(there.fitted_on(), there.log.len());
        let (a, b) = (here.pool.len() - 1, 0);
        here.record_duel(a, b, true);
        there.record_duel(a, b, true);
    }
}

#[test]
fn a_fit_job_changes_nothing_in_the_engine() {
    let engine = picked(12, 6);
    let before = serde_json::to_string(&engine.export_state()).unwrap();
    let pool = pool_bits(&engine);
    let job = engine.fit_job().expect("a log to fit");
    assert_eq!(
        serde_json::to_string(&engine.export_state()).unwrap(),
        before
    );
    assert_eq!(pool_bits(&engine), pool);
    assert!(engine.posterior.is_none());
    // What it carries: the log on the scale it is fitted on, a lens for every
    // twenty picks begun, and the configured chain.
    assert_eq!(job.rows.len(), 6);
    assert_eq!(job.absent.len(), 6);
    assert_eq!(job.taste.k_styles, 1);
    assert_eq!((job.samples, job.warmup), (600, 200));
    assert_eq!(job.standardizer.dimension(), phi_names().len());
}

#[test]
fn nothing_to_fit_makes_no_job() {
    let mut engine = Engine::new(PatchGrammarPrior::default(), small());
    assert!(engine.fit_job().is_none());
    engine.fit_posterior(&mut StdRng::seed_from_u64(1));
    assert!(engine.posterior.is_none());
}

#[test]
fn picks_recorded_while_a_fit_runs_are_folded_into_it_as_after_it() {
    // `then`: fitted, and then five picks against the model, each folded in
    // (and the weights collapsing on the way). `during`: the same picks made
    // while its fit ran elsewhere, then the fit installed.
    let mut then = picked(13, 8);
    let mut during = picked(13, 8);
    then.fit_posterior(&mut StdRng::seed_from_u64(5));
    let job = during.fit_job().unwrap();
    let fitted = elsewhere(&job, 5);
    contrary_picks(&mut then, 5);
    // The same pairs, the same answers, recorded before the fit lands.
    for o in &then.log.observations[8..] {
        let Feedback::Duel { a, b, chose_a } = &o.feedback else {
            unreachable!()
        };
        let find = |phi: &Vec<f64>| during.pool.iter().position(|c| &c.features.phi() == phi);
        during.record_duel(find(a).unwrap(), find(b).unwrap(), *chose_a);
    }
    during.install_fit(fitted).unwrap();
    assert_eq!(posterior_bits(&then), posterior_bits(&during));
    assert!(
        then.resamples_since_fit > 0,
        "no pick collapsed the weights"
    );
    assert_eq!(then.resamples_since_fit, during.resamples_since_fit);
    assert_eq!(during.fitted_on(), 8);
    assert!(during.needs_refit());
}

#[test]
fn without_folding_between_fits_a_fit_installs_as_fitted() {
    let mut engine = picked(14, 6);
    engine.cfg.sis_between_fits = false;
    let fitted = elsewhere(&engine.fit_job().unwrap(), 2);
    let draws = bits(&fitted.posterior);
    contrary_picks(&mut engine, 3);
    engine.install_fit(fitted).unwrap();
    assert_eq!(posterior_bits(&engine), draws);
}

#[test]
fn a_fit_of_a_log_since_replaced_or_not_over_this_phi_is_refused() {
    let mut engine = picked(15, 6);
    let job = engine.fit_job().unwrap();
    let fitted = elsewhere(&job, 3);
    let sz = engine.standardizer.clone();

    // Longer than the log: not this log.
    let mut long = fitted.clone();
    long.observations = engine.log.len() + 1;
    assert_eq!(engine.install_fit(long), Err(FitRefused::Stale));
    // Over another φ: its scale, or its draws.
    let mut scale = fitted.clone();
    scale.standardizer.mean.pop();
    scale.standardizer.std.pop();
    assert_eq!(engine.install_fit(scale), Err(FitRefused::Shape));
    let mut draws = fitted.clone();
    draws.posterior.cfg.n_features += 1;
    assert_eq!(engine.install_fit(draws), Err(FitRefused::Shape));
    assert!(engine.posterior.is_none(), "a refused fit was installed");
    assert_eq!(engine.standardizer, sz, "a refused fit moved the scale");

    // The log replaced (a taste file opened) while it ran.
    engine.import_profile(engine.export_profile());
    assert_eq!(engine.install_fit(fitted), Err(FitRefused::Stale));
    assert!(engine.posterior.is_none());
    // A job of the log as it is now installs.
    let now = elsewhere(&engine.fit_job().unwrap(), 3);
    assert_eq!(engine.install_fit(now), Ok(()));
}

#[test]
fn a_restore_installs_the_saved_draws_and_fits_nothing() {
    let mut engine = picked(16, 8);
    engine.fit_posterior(&mut StdRng::seed_from_u64(4));
    contrary_picks(&mut engine, 4);
    let back = reload(&engine);
    assert_eq!(posterior_bits(&back), posterior_bits(&engine));
    assert_eq!(back.fitted_on(), 8);
    assert_eq!(back.resamples_since_fit, engine.resamples_since_fit);
    assert_eq!(back.needs_refit(), engine.needs_refit());
    let ranked = |e: &Engine| {
        e.ranked()
            .iter()
            .map(|&(i, m, s)| (e.pool[i].id, m.to_bits(), s.to_bits()))
            .collect::<Vec<_>>()
    };
    assert_eq!(ranked(&back), ranked(&engine));
}

#[test]
fn a_session_saved_before_draws_were_kept_restores_unfitted_and_fits_again() {
    let mut engine = picked(17, 6);
    engine.fit_posterior(&mut StdRng::seed_from_u64(4));
    let mut state = serde_json::to_value(engine.export_state()).unwrap();
    assert!(state.get("fit").is_some());
    state.as_object_mut().unwrap().remove("fit");
    let old: SessionState = serde_json::from_value(state).unwrap();
    let mut back = crate::testkit::restore(&engine, old);
    assert!(back.posterior.is_none());
    assert_eq!(back.fitted_on(), 0);
    assert!(back.needs_refit(), "nothing says it owes a fit");
    back.fit_posterior(&mut StdRng::seed_from_u64(4));
    assert_eq!(posterior_bits(&back).len(), posterior_bits(&engine).len());
    // And an unfitted session saves none.
    let fresh = picked(17, 6);
    assert!(fresh.export_state().fit.is_none());
}

/// Each way a saved fit stops describing what came back: the restore sets it
/// aside, and the session is fitted again.
#[test]
fn a_saved_fit_that_no_longer_describes_the_restore_is_set_aside() {
    let mut engine = picked(18, 6);
    engine.fit_posterior(&mut StdRng::seed_from_u64(4));
    let state = engine.export_state();
    let d = phi_names().len();
    type Spoil = fn(&mut SessionState, usize);
    let spoils: [(&str, Spoil); 8] = [
        // A trailing session of one pick, merged into the one before.
        ("the log migrated on the way in", |s, _| {
            s.profile.log.observations.last_mut().unwrap().session += 1;
        }),
        ("a standardizer refitted on the way in", |s, _| {
            let sz = s.profile.standardizer.as_mut().unwrap();
            sz.mean.pop();
            sz.std.pop();
        }),
        ("fitted on more than the log", |s, _| {
            s.fit.as_mut().unwrap().observations = s.profile.log.observations.len() + 1;
        }),
        ("draws over another φ", |s, d| {
            s.fit.as_mut().unwrap().posterior.cfg.n_features = d + 1;
        }),
        ("no draws", |s, _| {
            let p = &mut s.fit.as_mut().unwrap().posterior;
            p.samples.clear();
            p.weights.clear();
        }),
        ("a weight short", |s, _| {
            s.fit.as_mut().unwrap().posterior.weights.pop();
        }),
        ("a coordinate short", |s, _| {
            s.fit.as_mut().unwrap().posterior.samples[0].theta[0].pop();
        }),
        ("a lens too many", |s, _| {
            let draw = &mut s.fit.as_mut().unwrap().posterior.samples[0];
            draw.theta.push(draw.theta[0].clone());
        }),
    ];
    // Unspoiled, it comes back; and with its weights uniform (empty) too.
    assert!(crate::testkit::restore(&engine, state.clone())
        .posterior
        .is_some());
    let mut uniform = state.clone();
    uniform.fit.as_mut().unwrap().posterior.weights.clear();
    assert!(crate::testkit::restore(&engine, uniform)
        .posterior
        .is_some());
    for (what, spoil) in spoils {
        let mut s = state.clone();
        spoil(&mut s, d);
        let back = crate::testkit::restore(&engine, s);
        assert!(
            back.posterior.is_none(),
            "{what}: the saved fit was installed"
        );
        assert_eq!(back.fitted_on(), 0, "{what}");
    }
}

#[test]
fn a_job_allows_a_lens_for_every_twenty_picks_begun_and_fuses_brightness() {
    let engine = picked(19, 41);
    let job = engine.fit_job().unwrap();
    assert_eq!(job.taste.k_styles, 3);
    assert_eq!(job.observations, 41);
    // The brightness cluster, by name: one group of its three coordinates.
    let names = phi_names();
    let base = |i: usize| names[i].split(':').next().unwrap().to_string();
    assert_eq!(job.taste.fused.len(), 1);
    let mut group: Vec<String> = job.taste.fused[0].iter().map(|&i| base(i)).collect();
    group.sort();
    assert_eq!(group, ["centroid_mean", "rolloff_mean", "zcr_mean"]);
    assert_eq!(job.taste.recency_half_life, engine.cfg.recency_half_life);
}

/// A log with no raw rows (a legacy, pre-standardized one) and no pool to
/// fit a scale on: the fit is on the standardizer the engine has, and with
/// none there is nothing to fit on.
#[test]
fn a_log_with_nothing_to_scale_on_fits_on_the_standardizer_it_has() {
    use auracle_taste::{Observation, Provenance, PHI_SCHEMA_STANDARDIZED};
    let d = phi_names().len();
    let mut engine = Engine::new(PatchGrammarPrior::default(), small());
    engine.log.observations.push(Observation {
        feedback: Feedback::Duel {
            a: vec![0.5; d],
            b: vec![-0.5; d],
            chose_a: true,
        },
        session: 0,
        feature_names: Vec::new(),
        schema_version: PHI_SCHEMA_STANDARDIZED,
        provenance: Provenance::Duel,
    });
    assert!(engine.fit_job().is_none(), "a job with no scale");
    let sz = Standardizer {
        mean: vec![0.0; d],
        std: vec![2.0; d],
    };
    engine.standardizer = Some(Arc::new(sz.clone()));
    let job = engine.fit_job().expect("a job on the scale it has");
    assert_eq!(job.standardizer, sz);
    // The legacy row is taken as already on the model's scale.
    let Feedback::Duel { a, .. } = &job.rows[0].0 else {
        unreachable!()
    };
    assert_eq!(a, &vec![0.5; d]);
}

fn draw(theta: Vec<Vec<f64>>) -> auracle_taste::TasteSample {
    auracle_taste::TasteSample {
        theta,
        tau: vec![0.25],
        cuts: vec![-1.0, 1.0],
    }
}

fn posterior_of(samples: Vec<auracle_taste::TasteSample>) -> TastePosterior {
    let weights = vec![1.0 / samples.len().max(1) as f64; samples.len()];
    TastePosterior {
        cfg: TasteConfig::mixture(3, 2),
        samples,
        weights,
    }
}

fn saved(posterior: TastePosterior) -> SavedFit {
    SavedFit {
        observations: 3,
        resamples: 1,
        posterior,
    }
}

#[test]
fn a_fits_draws_cross_the_wire_packed_and_exact() {
    let mut engine = picked(20, 6);
    let fitted = engine.fit_job().unwrap().run(&mut StdRng::seed_from_u64(9));
    let text = serde_json::to_string(&fitted).unwrap();
    let wire: serde_json::Value = serde_json::from_str(&text).unwrap();
    let p = &wire["posterior"];
    assert!(
        p["draws"].is_string() && p["weights"].is_string(),
        "the draws went as JSON numbers"
    );
    let d = phi_names().len();
    let s0 = &fitted.posterior.samples[0];
    assert_eq!(
        p["shape"],
        serde_json::json!([1, d, s0.tau.len(), s0.cuts.len()])
    );
    // Two thirds of the size of the same draws as JSON numbers, or less.
    let plain = serde_json::to_string(&fitted.posterior).unwrap();
    assert!(
        3 * text.len() < 2 * plain.len(),
        "{} against {}",
        text.len(),
        plain.len()
    );
    let back: FitResult = serde_json::from_str(&text).unwrap();
    assert_eq!(bits(&back.posterior), bits(&fitted.posterior));
    assert_eq!(back.posterior.cfg.n_features, d);
    engine.install_fit(back).unwrap();
}

#[test]
fn draws_not_of_one_shape_cross_as_plain_json_and_read_back() {
    let ragged = posterior_of(vec![
        draw(vec![vec![1.0, 2.0, 3.0]]),
        draw(vec![vec![1.0, 2.0]]),
    ]);
    let more_lenses = posterior_of(vec![draw(vec![vec![1.0; 3]]), draw(vec![vec![1.0; 3]; 2])]);
    let mut more_tau = posterior_of(vec![draw(vec![vec![1.0; 3]]), draw(vec![vec![1.0; 3]])]);
    more_tau.samples[1].tau.push(0.5);
    let mut more_cuts = posterior_of(vec![draw(vec![vec![1.0; 3]]), draw(vec![vec![1.0; 3]])]);
    more_cuts.samples[1].cuts.push(2.0);
    let no_coordinates = posterior_of(vec![draw(vec![Vec::new()])]);
    let no_lenses = posterior_of(vec![draw(Vec::new())]);
    let none = posterior_of(Vec::new());
    for p in [
        ragged,
        more_lenses,
        more_tau,
        more_cuts,
        no_coordinates,
        no_lenses,
        none,
    ] {
        let text = serde_json::to_string(&saved(p.clone())).unwrap();
        assert!(!text.contains("\"draws\""), "packed: {text}");
        let back: SavedFit = serde_json::from_str(&text).unwrap();
        assert_eq!(bits(&back.posterior), bits(&p));
        assert_eq!(back.posterior.samples.len(), p.samples.len());
    }
    // Of one shape, the same few draws go packed and come back whole.
    let even = posterior_of(vec![draw(vec![vec![1.5, -2.0, 0.0]; 2]); 3]);
    let text = serde_json::to_string(&saved(even.clone())).unwrap();
    assert!(text.contains("\"draws\""));
    let back: SavedFit = serde_json::from_str(&text).unwrap();
    assert_eq!(back.posterior.samples, even.samples);
    assert_eq!(bits(&back.posterior), bits(&even));
    assert_eq!((back.observations, back.resamples), (3, 1));
}

#[test]
fn packed_draws_that_do_not_unpack_are_refused() {
    let even = posterior_of(vec![draw(vec![vec![1.5, -2.0, 0.0]; 2]); 3]);
    let good: serde_json::Value = serde_json::to_value(saved(even)).unwrap();
    let eight = auracle_grammar::take::base64::encode(&1.0f64.to_le_bytes());
    let spoils: [(&str, &str, serde_json::Value); 6] = [
        ("draws not base64", "draws", serde_json::json!("@@@@")),
        ("weights not base64", "weights", serde_json::json!("@@@@")),
        (
            "bytes not whole numbers",
            "draws",
            serde_json::json!(auracle_grammar::take::base64::encode(&[1, 2, 3])),
        ),
        ("numbers not whole draws", "draws", serde_json::json!(eight)),
        ("no coordinates", "shape", serde_json::json!([2, 0, 1, 2])),
        (
            "nothing in a draw",
            "shape",
            serde_json::json!([0, 3, 0, 0]),
        ),
    ];
    for (what, field, value) in spoils {
        let mut v = good.clone();
        v["posterior"][field] = value;
        assert!(
            serde_json::from_value::<SavedFit>(v).is_err(),
            "{what}: read"
        );
    }
    let mut v = good.clone();
    v["posterior"]["shape"] = serde_json::json!([usize::MAX, 2, 0, 0]);
    assert!(
        serde_json::from_value::<SavedFit>(v).is_err(),
        "a shape past usize: read"
    );
    let mut v = good;
    v["posterior"]["shape"] = serde_json::json!([1, 1, usize::MAX, 1]);
    assert!(
        serde_json::from_value::<SavedFit>(v).is_err(),
        "a shape past usize: read"
    );
}

#[test]
fn a_saved_fit_that_cannot_be_read_costs_the_session_its_fit_and_nothing_else() {
    let mut engine = picked(21, 6);
    engine.fit_posterior(&mut StdRng::seed_from_u64(4));
    let mut state = serde_json::to_value(engine.export_state()).unwrap();
    state["fit"]["posterior"]["draws"] = serde_json::json!("not base64");
    let read: SessionState = serde_json::from_value(state).unwrap();
    assert!(read.fit.is_none());
    let back = crate::testkit::restore(&engine, read);
    assert!(back.posterior.is_none());
    assert_eq!(back.pool.len(), engine.pool.len());
    assert_eq!(back.log, engine.log);
}

#[test]
fn a_job_carries_the_lenses_it_replaces_and_its_fit_is_aligned_to_them() {
    let mut here = picked(22, 41);
    let mut there = picked(22, 41);
    assert!(
        there.fit_job().unwrap().reference.is_empty(),
        "a reference before any fit"
    );
    here.fit_posterior(&mut StdRng::seed_from_u64(1));
    there.fit_posterior(&mut StdRng::seed_from_u64(1));
    for e in [&mut here, &mut there] {
        let last = e.pool.len() - 1;
        e.record_duel(0, last, false);
    }
    let job = there.fit_job().unwrap();
    let p = there.posterior.as_deref().unwrap();
    assert_eq!(p.k_styles(), 3);
    let lenses: Vec<Vec<f64>> = (0..p.k_styles()).map(|k| p.theta_mean(k)).collect();
    assert_eq!(job.reference, lenses);
    here.fit_posterior(&mut StdRng::seed_from_u64(2));
    there.install_fit(elsewhere(&job, 2)).unwrap();
    assert_eq!(posterior_bits(&here), posterior_bits(&there));
}
