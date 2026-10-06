use super::*;
use crate::engine::{Engine, SessionConfig};
use crate::perform::{continuous_knobs, AIM_GAMMA};
use crate::testkit::taught;
use auracle_grammar::{preset_bank, set_param, AudioNode, ParamValue, Uid};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::sync::Arc;

fn folded_lead() -> PatchTree {
    preset_bank()
        .into_iter()
        .find(|p| p.name == "Folded Lead")
        .expect("a preset")
        .tree
}

/// **A drift reflects its proposals into each knob's range, and stops at
/// its steps.** Two knobs at the edges of their range, drifted in wide
/// steps on a taught target: whatever the proposals, every knob stays in
/// its range. Stepped past its end the drift takes no step and draws
/// nothing.
#[test]
fn a_drift_stays_in_range_and_stops_at_its_steps() {
    let engine = taught(0xD71);
    let mut tree = folded_lead();
    for (addr, v) in [("amp#sustain", 0.999), ("amp#attack", 0.001)] {
        tree = set_param(&tree, addr, ParamValue::Continuous(v)).unwrap();
    }
    let fitness = crate::SurrogateFitness {
        posterior: Arc::clone(engine.posterior.as_ref().unwrap()),
        standardizer: Arc::clone(engine.standardizer.as_ref().unwrap()),
        phrase: engine.cfg.phrase.clone(),
        memo: engine.memo().clone(),
    };
    let free = vec!["amp#sustain".to_string(), "amp#attack".to_string()];
    let start = drifter(
        engine.biased_prior(),
        engine.cfg.beta,
        fitness,
        free,
        40,
        0.5,
    );
    let mut run = start(&tree).expect("a preset is in the prior's support");
    let mut rng = StdRng::seed_from_u64(5);
    while run.left() > 0 {
        run.step(&mut rng);
    }
    let mut untouched = rng.clone();
    run.step(&mut rng);
    assert_eq!(
        rng.gen::<u64>(),
        untouched.gen::<u64>(),
        "a finished drift drew"
    );
    let end = run.finish().expect("forty wide steps moved nothing");
    for (addr, v) in continuous_knobs(&end) {
        assert!((0.0..=1.0).contains(&v), "{addr} left its range: {v}");
    }
}

/// **A drift of no steps comes back as no move; one of several moves.**
/// Before any taste, on the vetted prior.
#[test]
fn a_drift_of_no_steps_is_no_move() {
    let engine = Engine::new(PatchGrammarPrior::default(), SessionConfig::default());
    let tree = folded_lead();
    let none = engine.drift(&mut StdRng::seed_from_u64(1), &tree, &[], 0, 0.2);
    assert_eq!(none, Err(RefineOutcome::NoMove));
    let moved = engine.drift(&mut StdRng::seed_from_u64(1), &tree, &[], 8, 0.3);
    assert!(moved.is_ok(), "eight drift steps moved nothing: {moved:?}");
}

/// **An aimed offer that has not gone the asked way walks again, up to
/// its walks.** Walks of no steps never move, so the job walks every walk it
/// was given and comes back as no move.
#[test]
fn an_aimed_offer_that_has_not_moved_walks_again_up_to_its_walks() {
    let engine = taught(0xA1A);
    let mut job = engine
        .offer_aimed_job(&folded_lead(), &[], 0, 0, 1.0, AIM_GAMMA, 2)
        .unwrap();
    while job.step(&mut StdRng::seed_from_u64(2), 1) {}
    assert_eq!(job.walks(), 2);
    assert_eq!(job.finish(), Err(RefineOutcome::NoMove));
}

/// **An aimed offer from a sound that does not vet reports no movement.**
/// The walk can still find a sound that vets, but its home has no place on
/// the control's axis, so there is nothing to measure the move from.
#[test]
fn an_aimed_offer_from_a_sound_that_does_not_vet_reports_no_movement() {
    let engine = taught(0xA1B);
    let silent = PatchTree {
        amp: folded_lead().amp,
        root: AudioNode::Silence { uid: Uid::NEW },
    };
    let (child, moved) = (0..12u64)
        .find_map(|seed| {
            let mut job = engine
                .offer_aimed_job(&silent, &[], 6, 0, 1.0, AIM_GAMMA, 1)
                .unwrap();
            while job.step(&mut StdRng::seed_from_u64(seed), 4) {}
            match job.finish_moved() {
                (Ok(t), moved) => Some((t, moved)),
                _ => None,
            }
        })
        .expect("no walk from silence found a sound");
    assert_eq!(moved, None);
    assert!(engine.moved_along(&silent, &child, 0).is_none());
}

/// **A drift's proposal is reflected back into the knob's range, not
/// clamped onto its edge.** The walk is Metropolis with a symmetric
/// proposal only if a step past an edge folds back by as much as it
/// overshot: a knob at 0.999 stepped up by σ·z lands at
/// `2·PARAM_MAX − (v + σ·z)`, and one at 0.001 stepped down lands at
/// `−(v + σ·z)`. Clamping instead would pile the proposals on the edge.
/// The proposal's draws are replayed here from the same seed: the knob,
/// then the two uniforms of one Box–Muller normal.
#[test]
fn a_drift_proposal_is_reflected_into_range() {
    use auracle_grammar::PARAM_MAX;
    let engine = Engine::new(PatchGrammarPrior::default(), SessionConfig::default());
    let fitness = crate::perform::VetOnlyFitness {
        phrase: engine.cfg.phrase.clone(),
        memo: engine.memo().clone(),
    };
    let model = EvolutionModel::new(engine.biased_prior(), fitness).with_beta(engine.cfg.beta);
    let sigma = 0.5;
    let mut checked = [false, false];
    for (side, v, up) in [(0, 0.999, true), (1, 0.001, false)] {
        let tree = set_param(&folded_lead(), "amp#sustain", ParamValue::Continuous(v)).unwrap();
        let run = DriftRun {
            model: model.clone(),
            seed: tree.clone(),
            cur: tree,
            w: 0.0,
            free: vec!["amp#sustain".to_string()],
            sigma,
            left: 1,
        };
        for seed in 0..64u64 {
            let mut replay = StdRng::seed_from_u64(seed);
            auracle_grammar::rng::gen_index(&mut replay, 1);
            let (u1, u2): (f64, f64) = (replay.gen::<f64>().max(1e-300), replay.gen());
            let step = sigma * (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos();
            let past = v + step;
            let (over, want) = if up {
                (
                    past > PARAM_MAX && past < 2.0 * PARAM_MAX,
                    2.0 * PARAM_MAX - past,
                )
            } else {
                (past < 0.0 && past > -PARAM_MAX, -past)
            };
            if !over {
                continue;
            }
            let cand = run
                .propose(&mut StdRng::seed_from_u64(seed))
                .expect("a free knob is proposed");
            let landed = continuous_knobs(&cand)
                .into_iter()
                .find(|(a, _)| a == "amp#sustain")
                .unwrap()
                .1;
            assert_eq!(landed, want, "seed {seed}: {past} was not reflected");
            checked[side] = true;
            break;
        }
    }
    assert_eq!(checked, [true, true], "no proposal crossed an edge");
}
