use super::*;
use crate::testkit::fast;

/// An engine whose fill has folded `n` members of the stream seeded `seed`,
/// toward a pool of `size`, standardized as the app's `standardize_now`
/// leaves a pool it hands over (`standardized: false` leaves it as the fill
/// does, short of its size).
fn filled_as(seed: u64, size: usize, n: usize, standardized: bool) -> Engine {
    let mut rng = StdRng::seed_from_u64(seed);
    let cfg = SessionConfig {
        pool_size: size,
        ..fast()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    while engine.pool.len() < n {
        let want = n - engine.pool.len();
        assert!(
            engine.fill_pool_step(&mut rng, want) > 0,
            "the fill ran dry"
        );
    }
    if standardized {
        engine.standardize_now();
    }
    engine
}

fn filled(seed: u64, size: usize, n: usize) -> Engine {
    filled_as(seed, size, n, true)
}

/// The pair `deal_duel_scheduled` deals from a copy of `rng` and `sched`, as
/// ids (sorted), and the schedule after it.
fn deal_ids(
    engine: &mut Engine,
    rng: &StdRng,
    exclude: &[u64],
    sched: &DealSchedule,
) -> (Option<[u64; 2]>, DealSchedule) {
    let mut rng = rng.clone();
    let mut sched = *sched;
    let ids = engine
        .deal_duel_scheduled(&mut rng, exclude, &mut sched)
        .map(|d| {
            let mut p = [engine.pool[d.a].id, engine.pool[d.b].id];
            p.sort_unstable();
            p
        });
    (ids, sched)
}

const fn nth(dealt: u64) -> DealSchedule {
    DealSchedule { step: 8, dealt }
}

#[test]
fn the_schedule_reaches_eight_more_sounds_a_deal_until_the_whole_pool() {
    let s = DealSchedule::new(8);
    assert_eq!(s, nth(0));
    assert_eq!(s.reach(0, 40), Some(8));
    assert_eq!(s.reach(3, 40), Some(32));
    assert_eq!(s.reach(4, 40), None, "40 of 40 is the whole pool");
    assert_eq!(s.need(1, 40), 16);
    assert_eq!(s.need(4, 40), 40, "a deal from the whole pool waits for it");
    assert_eq!(s.need(9, 40), 40);
    assert_eq!(DealSchedule::default().reach(0, 40), None);
    assert_eq!(
        DealSchedule::default().need(0, 40),
        0,
        "no schedule waits for nothing"
    );
}

/// The k-th deal draws only from the first 8·(k+1) members, in pool order,
/// and each deal drawn moves the schedule on by one. The third reaches the
/// whole pool of 24, and over forty seeds some deal reaches past 16 there.
#[test]
fn the_kth_deal_draws_from_the_first_sounds_the_schedule_names() {
    let mut engine = filled(0xDEA1, 24, 24);
    let mut past = false;
    for seed in 0..40 {
        let mut rng = StdRng::seed_from_u64(seed);
        let mut sched = DealSchedule::new(8);
        for k in 0..3usize {
            let d = engine
                .deal_duel_scheduled(&mut rng, &[], &mut sched)
                .expect("a pair");
            let reach = (8 * (k + 1)).min(24);
            assert!(
                d.a < reach && d.b < reach,
                "deal {k} reached past {reach}: {} {}",
                d.a,
                d.b
            );
            assert_eq!(sched.dealt, k as u64 + 1);
            past |= k == 2 && d.a.max(d.b) >= 16;
        }
    }
    assert!(
        past,
        "the third deal never reached past the second's sounds"
    );
}

/// The heart of #211: a deal drawn over a pool of 16 and one drawn over the
/// same fill grown to 20 are the same pair when the schedule names 16.
/// Without a schedule they part, which is what the schedule is for.
#[test]
fn a_deal_is_the_same_however_far_the_fill_had_got() {
    let mut short = filled(0xF111, 24, 16);
    let mut long = filled(0xF111, 24, 20);
    let ids = |e: &Engine| e.pool.iter().map(|c| c.id).collect::<Vec<_>>();
    assert_eq!(
        ids(&short),
        ids(&long)[..16],
        "fixture: one fill, two lengths"
    );
    let mut parted = false;
    for seed in 0..30 {
        let rng = StdRng::seed_from_u64(seed);
        assert_eq!(short.deal_need(&rng, &[], &nth(1)), 0);
        assert_eq!(
            deal_ids(&mut short, &rng, &[], &nth(1)),
            deal_ids(&mut long, &rng, &[], &nth(1)),
            "seed {seed}: the second deal moved with the fill"
        );
        parted |= deal_ids(&mut short, &rng, &[], &DealSchedule::default()).0
            != deal_ids(&mut long, &rng, &[], &DealSchedule::default()).0;
    }
    assert!(
        parted,
        "unscheduled deals never moved with the fill: the test proves nothing"
    );
}

/// A deal waits for the members its schedule names, and for the members of
/// the deal after it when it is thrown away for a cut sound.
#[test]
fn a_deal_waits_for_the_sounds_its_schedule_names() {
    let mut engine = filled(0x3A17, 24, 10);
    let rng = StdRng::seed_from_u64(7);
    assert_eq!(
        engine.deal_need(&rng, &[], &nth(0)),
        0,
        "the first deal reaches 8 of 10"
    );
    assert_eq!(engine.deal_need(&rng, &[], &nth(1)), 16);
    assert_eq!(
        engine.deal_need(&rng, &[], &nth(2)),
        24,
        "the third reaches the whole pool"
    );
    // The first deal holds a sound now cut: it is thrown away, and the deal
    // after it, which reaches 16, waits for them.
    let (pair, _) = deal_ids(&mut engine, &rng, &[], &nth(0));
    let [x, _] = pair.expect("a pair");
    assert_eq!(engine.deal_need(&rng, &[x], &nth(0)), 16);
    // Planning draws nothing: the deal is still there to draw.
    assert_eq!(deal_ids(&mut engine, &rng, &[], &nth(0)).0, pair);
}

/// A cut anywhere else leaves the deal as it was. It used to draw over the
/// sounds not cut, by index, so every cut moved it.
#[test]
fn a_cut_elsewhere_does_not_change_the_deal() {
    let mut engine = filled(0xC0DE, 24, 24);
    for step in [0, 8] {
        for seed in 0..20 {
            let rng = StdRng::seed_from_u64(seed);
            let sched = DealSchedule::new(step);
            let (pair, after) = deal_ids(&mut engine, &rng, &[], &sched);
            let pair = pair.expect("a pair");
            let elsewhere: Vec<u64> = engine.pool[..8]
                .iter()
                .map(|c| c.id)
                .filter(|id| !pair.contains(id))
                .take(3)
                .collect();
            assert_eq!(
                deal_ids(&mut engine, &rng, &elsewhere, &sched),
                (Some(pair), after),
                "seed {seed}, step {step}: a cut of {elsewhere:?} moved the deal {pair:?}"
            );
        }
    }
}

/// A deal that draws a cut sound becomes the deal after it: the pair the app
/// gets when it refuses that answer and asks again. So a cut made before a
/// deal is asked for and one made while it is out end on the same pair, with
/// the stream and the schedule in the same place.
#[test]
fn a_deal_holding_a_cut_sound_is_the_deal_after_it() {
    let mut engine = filled(0xBEEF, 24, 24);
    for step in [0, 8] {
        for seed in 0..20 {
            let rng = StdRng::seed_from_u64(seed);
            let sched = DealSchedule::new(step);
            // Asked for before the cut: the answer holds the sound, and the
            // app refuses it and asks again.
            let mut stream = rng.clone();
            let mut s = sched;
            let first = engine
                .deal_duel_scheduled(&mut stream, &[], &mut s)
                .expect("a pair");
            let x = engine.pool[first.a].id;
            let (again, after) = deal_ids(&mut engine, &stream, &[x], &s);
            // Asked for after it.
            let (cut_first, cut_after) = deal_ids(&mut engine, &rng, &[x], &sched);
            assert_eq!(cut_first, again, "seed {seed}, step {step}");
            assert_eq!(
                cut_after, after,
                "seed {seed}, step {step}: the schedule parted"
            );
            assert!(!again.expect("a pair").contains(&x));
        }
    }
}

/// Cut all but one of the sounds the first deal reaches and it reaches
/// further, rather than saying there is nothing to pair; cut all but one of
/// the pool and there is nothing to pair.
#[test]
fn a_reach_cut_down_to_one_sound_reaches_further() {
    let mut engine = filled(0x0DD, 24, 24);
    let cut: Vec<u64> = engine.pool[..7].iter().map(|c| c.id).collect();
    for seed in 0..20 {
        let rng = StdRng::seed_from_u64(seed);
        let (pair, after) = deal_ids(&mut engine, &rng, &cut, &nth(0));
        let pair = pair.expect("nothing to pair, with 17 sounds uncut");
        assert!(pair.iter().all(|id| !cut.contains(id)));
        assert!(after.dealt >= 2, "the first deal could not have dealt it");
    }
    // Every sound but two cut: those two, wherever they are.
    let two = [engine.pool[3].id, engine.pool[20].id];
    let but_two: Vec<u64> = engine
        .pool
        .iter()
        .map(|c| c.id)
        .filter(|id| !two.contains(id))
        .collect();
    let rng = StdRng::seed_from_u64(2);
    let (pair, _) = deal_ids(&mut engine, &rng, &but_two, &nth(0));
    let mut want = two;
    want.sort_unstable();
    assert_eq!(pair, Some(want), "the last two sounds left uncut");
    let all: Vec<u64> = engine.pool[1..].iter().map(|c| c.id).collect();
    let rng = StdRng::seed_from_u64(1);
    let (pair, after) = deal_ids(&mut engine, &rng, &all, &nth(0));
    assert_eq!(pair, None);
    assert!(
        after.dealt >= 3,
        "nothing to pair before the whole pool was reached"
    );
}

/// A deal drawn now, with fewer members joined than its reach names (the
/// app does so once the fill is over and the pool stopped short), draws
/// over those that have.
#[test]
fn a_deal_drawn_before_its_sounds_have_joined_draws_from_those_that_have() {
    let mut engine = filled(0x5A0, 24, 10);
    for seed in 0..10 {
        let rng = StdRng::seed_from_u64(seed);
        let mut stream = rng.clone();
        let mut sched = nth(1);
        let d = engine
            .deal_duel_scheduled(&mut stream, &[], &mut sched)
            .expect("a pair from the ten that joined");
        assert!(d.a < 10 && d.b < 10 && d.a != d.b);
        assert_eq!(sched.dealt, 2);
        assert_eq!(
            engine.deal_need(&rng, &[], &nth(1)),
            16,
            "a patient deal waits"
        );
    }
}

/// The engine remembers the last eight pairs it dealt and nobody has shown
/// (`DEALT_UNSHOWN`): the oldest of eight can still be put on the table,
/// and counts as shown; the oldest of nine is forgotten, and does not.
#[test]
fn the_engine_remembers_eight_deals_not_shown() {
    let dealt = |n: usize| {
        let mut engine = filled(0xDE7, 24, 24);
        let mut rng = StdRng::seed_from_u64(9);
        let keys: Vec<(u64, u64)> = (0..n)
            .map(|_| {
                let d = engine.deal_duel_except(&mut rng, &[]).expect("a pair");
                pair_key(engine.pool[d.a].id, engine.pool[d.b].id)
            })
            .collect();
        (engine, keys)
    };
    let (mut eight, keys) = dealt(DEALT_UNSHOWN);
    let (mut nine, more) = dealt(DEALT_UNSHOWN + 1);
    assert_eq!(keys[..], more[..DEALT_UNSHOWN], "fixture: one stream");
    assert!(
        !more[1..].contains(&more[0]),
        "fixture: the first pair is dealt once"
    );
    let (a, b) = keys[0];
    assert!(eight.duel_shown(a, b), "the oldest of eight was forgotten");
    assert!(!nine.duel_shown(a, b), "the oldest of nine was remembered");
}

/// A pool the fill has not yet standardized deals nothing, under a schedule
/// too, as `next_duel` refuses it without one.
#[test]
fn an_unstandardized_pool_deals_nothing_under_a_schedule() {
    let mut engine = filled_as(0x5EED, 24, 10, false);
    let rng = StdRng::seed_from_u64(3);
    let (pair, after) = deal_ids(&mut engine, &rng, &[], &nth(0));
    assert_eq!(pair, None);
    assert_eq!(after.dealt, 2, "the first deal's 8, then the second's 10");
}

/// Under a choosing rule the deal is scored over the sounds the schedule
/// names and not cut, by the rule itself: no pair has been shown yet, so
/// none is a scheduled check.
#[test]
fn a_choosing_rule_scores_the_sounds_the_schedule_names() {
    for (acquisition, method) in [
        (Acquisition::Thompson, "thompson"),
        (Acquisition::Bald, "bald"),
    ] {
        let mut engine = filled(0xB01D, 24, 24);
        engine.cfg.acquisition = acquisition;
        let mut rng = StdRng::seed_from_u64(11);
        for (a, b) in [(0, 1), (2, 3), (4, 5), (6, 7)] {
            engine.record_duel(a, b, true);
        }
        engine.fit_posterior(&mut rng);
        let cut: Vec<u64> = engine.pool[..7].iter().map(|c| c.id).collect();
        let mut sched = nth(0);
        let d = engine
            .deal_duel_scheduled(&mut rng, &cut, &mut sched)
            .expect("a pair");
        assert_eq!(d.method, method);
        assert!(
            d.a < 16 && d.b < 16 && d.a >= 7 && d.b >= 7 && d.a != d.b,
            "{acquisition:?}: {} {}",
            d.a,
            d.b
        );
        assert_eq!(
            sched.dealt, 2,
            "{acquisition:?}: one sound left in the first's 8"
        );
    }
}
