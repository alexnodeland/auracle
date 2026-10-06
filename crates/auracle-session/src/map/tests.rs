use super::*;
use crate::testkit::*;
use crate::*;
use auracle_grammar::PatchGrammarPrior;
use rand::rngs::StdRng;
use rand::SeedableRng;

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

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// **A redraw never mirrors the map.** Two pools a refit apart: the
/// leading axis turns by about a degree, and its two largest loadings,
/// of opposite sign, trade places. That is where the largest-component
/// convention flips, so on its own it mirrors the map (the first assert
/// documents that). Oriented against the axis last drawn, it does not.
#[test]
fn a_redraw_never_mirrors_the_map() {
    let unit = |v: [f64; 3]| {
        let n = v.iter().map(|x| x * x).sum::<f64>().sqrt();
        [v[0] / n, v[1] / n, v[2] / n]
    };
    let before = plane(unit([0.62, -0.60, 0.3]), unit([0.3, 0.2, -0.5]), 40);
    let after = plane(unit([0.60, -0.62, 0.3]), unit([0.3, 0.2, -0.5]), 40);
    let axis = |rows: &Vec<Vec<f64>>| {
        let mut c = rows.clone();
        mean_center(&mut c);
        leading_axis(&c, None).0
    };
    let drawn = axis(&before);
    let mut next = axis(&after);
    assert!(
        dot(&drawn, &next) < -0.9,
        "this case no longer flips under the convention alone"
    );
    orient(&mut next, &drawn);
    assert!(dot(&drawn, &next) > 0.9, "the redraw mirrored the map");
}

/// A near-tied spectrum is *reported*, not returned as though it had
/// settled. Two coordinates of almost equal variance, with a covariance that
/// turns the leading pair of axes half way between them, leave power
/// iteration closing in by a factor of about 0.998 a step, so the first axis
/// is still moving at the iteration cap and says so (the flag
/// `TasteMap::converged` carries). An exact tie would not do: every vector
/// in the tied plane is an axis, and the first step settles. The same rows
/// with a clear gap between the two settle, and either way the second axis
/// never carries more variance than the first.
#[test]
fn a_near_tied_spectrum_is_reported_rather_than_hidden() {
    let rows = |eps: f64| -> Vec<Vec<f64>> {
        let mut rows: Vec<Vec<f64>> = (0..40)
            .map(|i| {
                let t = std::f64::consts::TAU * i as f64 / 40.0;
                vec![t.cos(), t.sin() + eps * t.cos(), 0.0]
            })
            .collect();
        mean_center(&mut rows);
        rows
    };
    for (eps, settles) in [(1e-3, false), (0.5, true)] {
        let centered = rows(eps);
        let (ax1, var1, ok1) = leading_axis(&centered, None);
        let (_, var2, _) = leading_axis(&centered, Some(&ax1));
        assert_eq!(
            ok1, settles,
            "eps {eps}: the first axis reported converged = {ok1}"
        );
        assert!(var1 >= var2, "eps {eps}: {var1} < {var2}");
    }
}

/// **The direction liking rises is the map's.** A plane is recovered
/// exactly, no spread in liking is no direction, and `belief`'s direction
/// is the fit of the ratings on the map just drawn (`taste_map`'s pool
/// points, which are centred: a direction does not see the centring),
/// moving with a pick as the ratings do.
#[test]
fn the_direction_liking_rises_is_the_fit_on_the_map() {
    let plane: Vec<[f64; 3]> = (0..5)
        .flat_map(|x| {
            (0..5).map(move |y| {
                [
                    x as f64,
                    y as f64 * 2.0,
                    0.2 + 0.1 * x as f64 - 0.05 * y as f64,
                ]
            })
        })
        .collect();
    let d = liking_direction(&plane).unwrap();
    assert!(
        (d.gx - 0.1).abs() < 1e-12 && (d.gy + 0.025).abs() < 1e-12 && (d.r2 - 1.0).abs() < 1e-12
    );
    let flat: Vec<[f64; 3]> = plane.iter().map(|p| [p[0], p[1], 0.5]).collect();
    assert_eq!(
        liking_direction(&flat),
        None,
        "no spread in liking, no direction"
    );
    assert_eq!(liking_direction(&plane[..2]), None);

    let mut engine = taught(0xD1E);
    let check = |e: &Engine| {
        let map = e.taste_map();
        let b = e.belief();
        let pts: Vec<[f64; 3]> = map
            .points
            .iter()
            .filter(|pt| pt.id.is_some())
            .map(|pt| [pt.x, pt.y, 1.0 / (1.0 + (-pt.utility).exp())])
            .collect();
        let want = liking_direction(&pts).expect("a fitted pool has a direction");
        let got = b.direction.clone().expect("belief carries it");
        assert!(
            (got.gx - want.gx).abs() <= 1e-9 * (1.0 + want.gx.abs()),
            "{got:?} {want:?}"
        );
        assert!(
            (got.gy - want.gy).abs() <= 1e-9 * (1.0 + want.gy.abs()),
            "{got:?} {want:?}"
        );
        assert!((got.r2 - want.r2).abs() <= 1e-9, "{got:?} {want:?}");
        got
    };
    let before = check(&engine);
    contrary_picks(&mut engine, 4);
    let after = check(&engine);
    assert_ne!(before, after, "a pick moves the direction with the ratings");
}

/// The taste map projects every pool member plus history ghosts, with
/// finite coordinates and sane explained-variance fractions, and the axes
/// it draws on real pool data carry the sign convention (each axis's
/// largest component positive): the property
/// `axes_come_back_with_their_largest_component_positive` proves on data
/// built to violate it, here on the projection the app draws.
#[test]
fn taste_map_is_sane() {
    let mut rng = StdRng::seed_from_u64(0x3A9);
    let user = ground_truth();
    let cfg = SessionConfig {
        pool_size: 20,
        ..fast()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    engine.fill_pool(&mut rng);
    for _ in 0..10 {
        let (a, b) = engine.next_duel(&mut rng).unwrap();
        let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
        engine.record_duel(a, b, chose_a);
    }
    engine.fit_posterior(&mut rng);
    let map = engine.taste_map();
    let n_pool = engine.pool.len();
    assert_eq!(map.points.len(), n_pool + 20); // 10 duels × 2 ghosts
    assert!(map
        .points
        .iter()
        .all(|p| p.x.is_finite() && p.y.is_finite()));
    assert!(map.points[..n_pool].iter().all(|p| p.id.is_some()));
    assert!(map.points[n_pool..].iter().all(|p| p.id.is_none()));
    assert!(map.explained[0] >= map.explained[1]);
    assert!(map.explained[0] <= 1.0 + 1e-9);
    // The first axis should actually spread the points.
    let xs: Vec<f64> = map.points.iter().map(|p| p.x).collect();
    let spread =
        xs.iter().cloned().fold(f64::MIN, f64::max) - xs.iter().cloned().fold(f64::MAX, f64::min);
    assert!(spread > 1e-6);
    // Both axes are solved, not merely returned after a fixed iteration
    // count. On real pool data this converges in far fewer than the cap.
    assert_eq!(
        map.converged,
        [true, true],
        "a taste-map axis hit its iteration cap without converging"
    );
    // The first map drawn has no earlier one to keep the orientation of,
    // so its axes are the convention's.
    let drawn = engine.drawn_axes().clone();
    for (which, ax) in drawn.expect("a drawn map is remembered").iter().enumerate() {
        let pivot = (0..ax.len())
            .max_by(|&i, &j| ax[i].abs().total_cmp(&ax[j].abs()))
            .unwrap();
        assert!(
            ax[pivot] > 0.0,
            "axis {which}'s largest component is negative"
        );
    }
}

/// The map keeps the orientation it was last drawn in, across a redraw
/// and across a save and reload. The remembered axes are forced to the
/// mirror image of what the sign convention picks, so both checks fail
/// without the memory, and the reload check fails without its persistence.
#[test]
fn taste_map_keeps_its_orientation_across_redraws_and_reloads() {
    let mut rng = StdRng::seed_from_u64(0x0B1E);
    let cfg = SessionConfig {
        pool_size: 12,
        ..fast()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg.clone());
    engine.begin_session();
    engine.fill_pool(&mut rng);
    for _ in 0..4 {
        let (a, b) = engine.next_duel(&mut rng).unwrap();
        engine.record_duel(a, b, true);
    }
    let first = engine.taste_map();
    assert!(first
        .points
        .iter()
        .any(|p| p.x.abs() > 1e-6 && p.y.abs() > 1e-6));
    // As though an earlier refit had left the map drawn the other way.
    {
        let mut drawn = engine.drawn_axes();
        for axis in drawn
            .as_mut()
            .expect("the map remembers its axes")
            .iter_mut()
        {
            for v in axis.iter_mut() {
                *v = -*v;
            }
        }
    }
    let redrawn = engine.taste_map();
    assert_eq!(first.points.len(), redrawn.points.len());
    for (p, q) in first.points.iter().zip(&redrawn.points) {
        assert!(
            (p.x + q.x).abs() < 1e-9 && (p.y + q.y).abs() < 1e-9,
            "the redraw did not keep the orientation it was drawn in"
        );
    }

    let reloaded = reload(&engine).taste_map();
    assert_eq!(reloaded.points.len(), redrawn.points.len());
    for (p, q) in redrawn.points.iter().zip(&reloaded.points) {
        assert!(
            (p.x - q.x).abs() < 1e-6 && (p.y - q.y).abs() < 1e-6,
            "the reload mirrored the map"
        );
    }
}

/// **A panic that poisons the map's memory costs nothing.** The axes a map
/// was drawn on sit behind a lock, and a panic while it is held (here on
/// purpose) poisons it. They are only ever written whole, so every reader
/// takes them as they stand: the next map is the same map, facing the same
/// way, and a save still carries the axes, which a reload restores.
#[test]
fn a_panic_that_poisons_the_maps_memory_costs_nothing() {
    let mut rng = StdRng::seed_from_u64(0x9015);
    let mut engine = Engine::new(
        PatchGrammarPrior::default(),
        SessionConfig {
            pool_size: 8,
            ..fast()
        },
    );
    engine.begin_session();
    engine.fill_pool(&mut rng);
    let first = engine.taste_map();
    let drawn = engine.drawn_axes().clone();
    assert!(drawn.is_some(), "the map was not remembered");
    let held = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _axes = engine.drawn_axes();
        panic!("a panic while the map's memory is held");
    }));
    assert!(held.is_err());
    assert!(
        engine.map_axes.is_poisoned(),
        "the fixture poisoned nothing"
    );

    let again = engine.taste_map();
    assert_eq!(again.points.len(), first.points.len());
    for (p, q) in first.points.iter().zip(&again.points) {
        assert!((p.x - q.x).abs() < 1e-12 && (p.y - q.y).abs() < 1e-12);
    }
    let state = engine.export_state();
    assert_eq!(state.map_axes, drawn, "the save lost the axes");
    assert_eq!(*restore(&engine, state).drawn_axes(), drawn);
}

/// **No rows have no axes, and a line has one.** The center of no rows is
/// empty and so are its axes, which is settled (there is nothing to
/// converge to). Rows on a single line leave the second axis nothing to
/// carry: it is reported settled with no variance, not as an axis.
#[test]
fn no_rows_have_no_axes_and_a_line_has_one() {
    let mut none: Vec<Vec<f64>> = Vec::new();
    assert!(mean_center(&mut none).is_empty());
    assert_eq!(
        leading_axis(&[vec![], vec![]], None),
        (Vec::new(), 0.0, true)
    );

    let mut line: Vec<Vec<f64>> = (0..20)
        .map(|i| {
            let a = i as f64 - 9.5;
            vec![a, a, 0.0]
        })
        .collect();
    mean_center(&mut line);
    let (ax1, var1, ok1) = leading_axis(&line, None);
    let (_, var2, ok2) = leading_axis(&line, Some(&ax1));
    assert!(ok1 && ok2);
    assert!(var1 > 1.0, "the line's own axis carries its spread");
    assert!(var2 < 1e-12, "a second axis carried {var2}");
}

/// The frame a sound of your own is placed on: rows spread along the first
/// two coordinates, axes along them, and the variance each carries.
fn frame(total_var: f64, variance: [f64; 2]) -> MapFrame {
    MapFrame {
        rows: Vec::new(),
        meta: Vec::new(),
        centered: Vec::new(),
        mean: vec![0.0; 4],
        axes: [vec![1.0, 0.0, 0.0, 0.0], vec![0.0, 1.0, 0.0, 0.0]],
        variance,
        total_var,
        converged: [true, true],
    }
}

/// **A sound of your own measured on part of φ is placed by projection, or
/// fitted.** `Imputed` (the shipped placement) projects its offset on the
/// coordinates it has. `Fit` takes probabilistic PCA's posterior mean, which
/// pulls each axis toward the center by the noise the axes leave over
/// against that axis's variance; and where nothing it measured loads on the
/// axes (the system is all but singular) it places the sound at the center
/// rather than dividing by nearly nothing.
#[test]
fn a_partial_measurement_is_projected_or_fitted() {
    let toward = |observed: Vec<usize>, target: Vec<f64>| crate::own::Toward {
        observed,
        target,
        gamma: crate::own::OWN_GAMMA,
    };
    let t = toward(vec![0, 1, 3], vec![2.0, -1.0, 5.0]);
    let f = frame(6.0, [4.0, 1.0]);
    let imputed = place(&t, &f, Placement::Imputed);
    assert_eq!((imputed.x, imputed.y, imputed.observed), (2.0, -1.0, 3));
    // Noise per left-over coordinate: (6 − 4 − 1) / (4 − 2) = 0.5.
    let fit = place(&t, &f, Placement::Fit);
    assert!((fit.x - 2.0 / (1.0 + 0.5 / 4.0)).abs() < 1e-12);
    assert!((fit.y + 1.0 / (1.0 + 0.5 / 1.0)).abs() < 1e-12);

    let off_axis = toward(vec![2, 3], vec![3.0, 3.0]);
    let wide = frame(2.0e3, [1.0e3, 1.0e3]);
    let p = place(&off_axis, &wide, Placement::Fit);
    assert_eq!((p.x, p.y, p.observed), (0.0, 0.0, 2));
}

/// **A map of fewer than three sounds is empty, and says nothing
/// converged** rather than reporting a solve that never ran.
#[test]
fn a_map_of_fewer_than_three_sounds_is_empty_and_unsolved() {
    let mut engine = Engine::new(
        PatchGrammarPrior::default(),
        SessionConfig {
            pool_size: 2,
            ..fast()
        },
    );
    engine.fill_pool(&mut StdRng::seed_from_u64(0x3A2));
    let map = engine.taste_map();
    assert!(map.points.is_empty());
    assert_eq!(map.converged, [false, false]);
    assert!(engine.drawn_axes().is_none(), "an empty map was remembered");
}

/// **A map saved under another φ is drawn afresh.** Axes remembered at
/// another width cannot place today's φ, so until the map is drawn again
/// the liking direction has nothing to read and says nothing; the redraw
/// cannot face them, takes the sign convention, and is remembered.
#[test]
fn a_map_saved_under_another_phi_is_drawn_afresh() {
    let engine = taught(0xA0F);
    let mut state = engine.export_state();
    state.map_axes = Some([vec![1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0]]);
    let mut back = restore(&engine, state);
    back.fit_posterior(&mut StdRng::seed_from_u64(0xA10));
    assert_eq!(back.belief().direction, None, "read today's φ on old axes");
    let map = back.taste_map();
    let drawn = back
        .drawn_axes()
        .clone()
        .expect("the redraw was remembered");
    for (k, ax) in drawn.iter().enumerate() {
        assert_eq!(ax.len(), phi_names().len());
        let pivot = (0..ax.len())
            .max_by(|&i, &j| ax[i].abs().total_cmp(&ax[j].abs()))
            .unwrap();
        assert!(ax[pivot] > 0.0, "axis {k} does not take the convention");
    }
    assert!(map
        .points
        .iter()
        .all(|p| p.x.is_finite() && p.y.is_finite()));
    assert!(back.belief().direction.is_some());
}

/// **Each point on the map says where its sound came from**, by the
/// spelling the page colors it by: a literal table, since the page reads
/// these words. A member with no standardized φ has no place on the map:
/// the engine holds such members while a fill is short of the pool, before
/// the standardizer fits (`push_prior`), and here one sits beside
/// standardized members, a mix built by hand.
#[test]
fn map_points_say_where_each_sound_came_from() {
    const WIRE: [(Origin, &str); 4] = [
        (Origin::Prior, "prior"),
        (Origin::Refined, "refined"),
        (Origin::Edited, "edited"),
        (Origin::Preset, "preset"),
    ];
    let mut engine = Engine::new(
        PatchGrammarPrior::default(),
        SessionConfig {
            pool_size: 6,
            ..fast()
        },
    );
    engine.fill_pool(&mut StdRng::seed_from_u64(0x0F1));
    for (k, (origin, _)) in WIRE.iter().enumerate() {
        engine.pool[k].origin = *origin;
    }
    engine.pool[5].phi_std.clear();
    let map = engine.taste_map();
    assert_eq!(map.points.len(), 5, "an unstandardized member was drawn");
    for (k, (_, word)) in WIRE.iter().enumerate() {
        let p = map.points.iter().find(|p| p.id == Some(engine.pool[k].id));
        assert_eq!(p.expect("a member left off the map").origin, *word);
    }
}

/// **The map's history is the newest votes, at most `MAX_HISTORY` of
/// them**, each a ghost on the pool's scale; a vote logged before raw φ
/// (already on a scale) is drawn as stored.
#[test]
fn the_maps_history_is_the_newest_votes_up_to_its_cap() {
    let mut engine = Engine::new(
        PatchGrammarPrior::default(),
        SessionConfig {
            pool_size: 4,
            ..fast()
        },
    );
    engine.fill_pool(&mut StdRng::seed_from_u64(0x415));
    let mut legacy = auracle_taste::Observation::new(
        auracle_taste::Feedback::KeepKill {
            x: vec![0.25; phi_names().len()],
            kept: true,
        },
        0,
        &phi_names(),
    );
    legacy.schema_version = 0;
    engine.log.push(legacy);
    let map = engine.taste_map();
    let ghosts: Vec<&MapPoint> = map.points.iter().filter(|p| p.id.is_none()).collect();
    assert_eq!(ghosts.len(), 1);
    // Drawn from the stored vector, not standardized again: its offset from
    // a pool point is the stored vector's offset, on the drawn axes.
    let first = &map.points[0];
    let c = &engine.pool[engine.find(first.id.unwrap()).unwrap()];
    let stored: Vec<f64> = vec![0.25; phi_names().len()];
    let offset: Vec<f64> = stored.iter().zip(&c.phi_std).map(|(a, b)| a - b).collect();
    let (dx, dy) = engine.map_coordinates(&offset).unwrap();
    assert!((ghosts[0].x - first.x - dx).abs() < 1e-9);
    assert!((ghosts[0].y - first.y - dy).abs() < 1e-9);

    for _ in 0..(MAX_HISTORY / 2 + 3) {
        engine.record_duel(0, 1, true);
    }
    let map = engine.taste_map();
    assert_eq!(
        map.points.len(),
        4 + MAX_HISTORY,
        "the history was not capped"
    );
}
