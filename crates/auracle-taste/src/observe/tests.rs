use super::*;
use crate::standardize::Standardizer;
use crate::synthetic::SyntheticUser;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

const D: usize = 16;

fn random_phi<R: Rng>(rng: &mut R) -> Vec<f64> {
    // Standardized feature space: unit normals.
    (0..D)
        .map(|_| {
            let (u1, u2): (f64, f64) = (rng.gen(), rng.gen());
            (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
        })
        .collect()
}

fn ground_truth() -> SyntheticUser {
    // A sparse, interpretable taste: likes dims 0/3 strongly, dislikes 1/7.
    let mut theta = vec![0.0; D];
    theta[0] = 1.8;
    theta[1] = -1.2;
    theta[3] = 1.0;
    theta[7] = -0.8;
    theta[10] = 0.5;
    SyntheticUser {
        theta,
        tau: 0.4,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    }
}

/// One unreadable row must cost one vote, not the profile.
///
/// The regression this exists for is not hypothetical: a `null` where a φ
/// coordinate should be made `Profile` — and therefore `SessionState`, and
/// therefore the bank, the lineage, the pins and every vote — fail to
/// deserialize, and the app booted as if it had never been used.
#[test]
fn an_unreadable_row_does_not_take_the_log_with_it() {
    let json = r#"{"observations":[
      {"feedback":{"Duel":{"a":[1.0,2.0],"b":[0.5,0.25],"chose_a":true}},
       "session":0,"feature_names":["x","y"],"schema_version":2},
      {"feedback":{"Duel":{"a":[1.0,null],"b":[0.5,0.25],"chose_a":true}},
       "session":0,"feature_names":["x","y"],"schema_version":2},
      {"feedback":{"KeepKill":{"x":[0.2,0.3],"kept":false}},
       "session":1,"feature_names":["x","y"],"schema_version":2}
    ]}"#;
    let log: ObservationLog = serde_json::from_str(json).expect("the log must still load");
    assert_eq!(log.observations.len(), 2, "the readable rows must survive");
    assert_eq!(log.observations[1].session, 1, "and keep their order");
}

/// …and a log with nothing wrong with it is unaffected, including the
/// legacy and pre-provenance forms the untagged fallback sits in front of.
#[test]
fn tolerance_does_not_change_a_clean_log() {
    let json = r#"{"observations":[
      {"feedback":{"Stars":{"x":[0.1],"rating":3}},"session":2,
       "feature_names":["x"],"schema_version":2,"provenance":"self_report"},
      {"Duel":{"a":[0.4],"b":[0.9],"chose_a":false,"session":0}}
    ]}"#;
    let log: ObservationLog = serde_json::from_str(json).expect("loads");
    assert_eq!(log.observations.len(), 2);
    assert_eq!(log.observations[0].provenance, Provenance::SelfReport);
    assert!(!log.observations[1].is_raw(), "legacy row must stay legacy");
}

/// A file of this process's own, so that test runs in several worktrees at
/// once never read each other's half-written files.
fn scratch_file(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("auracle-taste-{}-{name}", std::process::id()))
}

/// An observation log round-trips through its file bit for bit: the
/// profile's source of truth must survive persistence, every modality and
/// every field of it, full-precision floats included.
#[test]
fn a_log_round_trips_through_its_file() {
    let mut rng = StdRng::seed_from_u64(44);
    let user = ground_truth();
    let names: Vec<String> = (0..D).map(|i| format!("f{i}")).collect();
    let mut log = ObservationLog::new();
    assert!(log.is_empty());
    for s in 0..3 {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, s));
    }
    let x = random_phi(&mut rng);
    let kept = user.keep(&mut rng, &x);
    log.push(Observation::tagged(
        Feedback::KeepKill { x, kept },
        1,
        &names,
        Provenance::HeardEdit,
    ));
    let x = random_phi(&mut rng);
    let rating = user.stars(&mut rng, &x);
    log.push(Observation::new(Feedback::Stars { x, rating }, 2, &names));
    assert!(!log.is_empty());

    let path = scratch_file("log.json");
    log.save(&path).unwrap();
    let back = ObservationLog::load(&path);
    std::fs::remove_file(&path).unwrap();
    let back = back.unwrap();
    assert_eq!(back, log);
    assert_eq!(back.n_sessions(), 3);
}

/// A log written before raw-φ logging still loads, and is recognizable
/// as legacy — silently reading its standardized vectors as raw values
/// would corrupt the profile it was meant to preserve.
#[test]
fn legacy_logs_still_load() {
    let json = r#"{"observations":[
        {"Duel":{"a":[1.0,2.0],"b":[3.0,4.0],"chose_a":true,"session":0}},
        {"KeepKill":{"x":[0.5,0.25],"kept":false,"session":1}},
        {"Stars":{"x":[0.1,0.2],"rating":3,"session":1}}
    ]}"#;
    let log: ObservationLog = serde_json::from_str(json).unwrap();
    assert_eq!(log.len(), 3);
    assert_eq!(log.n_sessions(), 2);
    assert!(
        log.observations.iter().all(|o| !o.is_raw()),
        "legacy observations must not claim to be raw"
    );
    // …and they contribute nothing to a standardizer fit over raw values.
    assert!(log
        .raw_rows(&[String::from("a"), String::from("b")])
        .is_empty());
}

/// The point of raw-φ logging: the feature set can change and old votes
/// still land on the right axes. A renamed/reordered/extended feature set
/// must re-project by name, and a coordinate the vote predates is imputed
/// at the standardizer mean — which standardizes to exactly zero, i.e.
/// "this vote says nothing about that axis".
#[test]
fn observations_reproject_by_name() {
    let names_then: Vec<String> = ["bright", "noisy"].iter().map(|s| s.to_string()).collect();
    let mut log = ObservationLog::new();
    log.push(Observation::new(
        Feedback::Duel {
            a: vec![10.0, 1.0],
            b: vec![0.0, 3.0],
            chose_a: true,
        },
        0,
        &names_then,
    ));
    // The feature set later gains a coordinate and swaps the order.
    let names_now: Vec<String> = ["noisy", "warm", "bright"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let sz = Standardizer {
        mean: vec![2.0, 7.0, 5.0],
        std: vec![1.0, 2.0, 5.0],
    };
    let fit = FitSet::build(&log, &names_now, &sz);
    let Feedback::Duel { a, b, chose_a } = &fit.rows[0].0 else {
        panic!("modality changed");
    };
    assert!(chose_a);
    // noisy: (1−2)/1, warm: absent ⇒ 0, bright: (10−5)/5.
    assert_eq!(a, &vec![-1.0, 0.0, 1.0]);
    assert_eq!(b, &vec![1.0, 0.0, -1.0]);
    assert_eq!(log.raw_rows(&names_then).len(), 2, "raw rows are fittable");
}

/// A log written before provenance existed still loads, and every row in
/// it reads as the thing it was: a dealt duel. The observation log is one
/// IndexedDB blob with no schema version, so compatibility is by
/// construction or it is nothing — and the alternative to a default here
/// is a saved profile that fails to parse and takes a user's whole taste
/// history with it.
#[test]
fn a_log_written_before_provenance_still_loads() {
    let old = r#"{"observations":[
        {"feedback":{"Duel":{"a":[0.5],"b":[0.25],"chose_a":true}},
         "session":0,"feature_names":["x"],"schema_version":2},
        {"KeepKill":{"x":[0.1],"kept":true,"session":1}}
    ]}"#;
    let log: ObservationLog = serde_json::from_str(old).expect("an old log parses");
    assert_eq!(log.len(), 2);
    assert!(log
        .observations
        .iter()
        .all(|o| o.provenance == Provenance::Duel));
    assert_eq!(log.n_with(Provenance::Duel), 2);
    assert_eq!(log.n_with(Provenance::SelfReport), 0);

    // And the tag round-trips when it is not the default, while a default
    // one stays off the wire — an old reader sees exactly what it saw.
    let mut log = log;
    log.push(Observation::tagged(
        Feedback::KeepKill {
            x: vec![0.7],
            kept: false,
        },
        2,
        &["x".to_string()],
        Provenance::SelfReport,
    ));
    let json = serde_json::to_string(&log).unwrap();
    assert!(json.contains("self_report"));
    assert_eq!(
        json.matches("provenance").count(),
        1,
        "the default was serialized"
    );
    let back: ObservationLog = serde_json::from_str(&json).unwrap();
    assert_eq!(back, log);
}
