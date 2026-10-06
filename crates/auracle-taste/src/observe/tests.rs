use super::*;
use crate::standardize::Standardizer;
use crate::testkit::{ground_truth, random_phi, scratch_file, D};
use rand::rngs::StdRng;
use rand::SeedableRng;

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

/// A row that will not parse costs that row, but a file that is not a log
/// at all is an error, never an empty log that the next save would write
/// over the profile.
#[test]
fn a_file_that_is_not_a_log_does_not_load() {
    let missing = scratch_file("missing.json");
    assert_eq!(
        ObservationLog::load(&missing).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    for (name, text) in [
        ("garbage.json", "not json"),
        ("not-a-list.json", r#"{"observations":3}"#),
    ] {
        let path = scratch_file(name);
        std::fs::write(&path, text).unwrap();
        let loaded = ObservationLog::load(&path);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            loaded.unwrap_err().kind(),
            std::io::ErrorKind::InvalidData,
            "{name}"
        );
    }
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

    // Only that old, externally tagged form is standardized: a row in the
    // current form that carries no `schema_version` reads as raw.
    let current = r#"{"observations":[
        {"feedback":{"Duel":{"a":[1.0],"b":[3.0],"chose_a":true}},"session":0}
    ]}"#;
    let log: ObservationLog = serde_json::from_str(current).unwrap();
    assert!(log.observations[0].is_raw());
    assert_eq!(log.observations[0].schema_version, PHI_SCHEMA);
}

/// The point of raw-φ logging: the feature set can change and old votes
/// still land on the right axes. A renamed/reordered/extended feature set
/// must re-project by name, and a coordinate the vote predates is imputed
/// at the standardizer mean — which standardizes to exactly zero, i.e.
/// "this vote says nothing about that axis".
///
/// Every modality re-projects, and each row says which coordinates it
/// imputed: the likelihood attenuates a keep or a rating by them.
#[test]
fn observations_reproject_by_name() {
    let names = |n: &[&str]| -> Vec<String> { n.iter().map(|s| s.to_string()).collect() };
    let names_then = names(&["bright", "noisy"]);
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
    log.push(Observation::new(
        Feedback::KeepKill {
            x: vec![3.0, 15.0],
            kept: false,
        },
        1,
        &names(&["warm", "bright"]),
    ));
    log.push(Observation::new(
        Feedback::Stars {
            x: vec![0.0],
            rating: 4,
        },
        1,
        &names(&["bright"]),
    ));
    // The feature set later gains a coordinate and swaps the order.
    let names_now = names(&["noisy", "warm", "bright"]);
    let sz = Standardizer {
        mean: vec![2.0, 7.0, 5.0],
        std: vec![1.0, 2.0, 5.0],
    };
    let fit = FitSet::build(&log, &names_now, &sz);
    assert_eq!(fit.len(), 3);
    // noisy: (1−2)/1, warm: absent ⇒ 0, bright: (10−5)/5.
    assert_eq!(
        fit.rows[0],
        (
            Feedback::Duel {
                a: vec![-1.0, 0.0, 1.0],
                b: vec![1.0, 0.0, -1.0],
                chose_a: true,
            },
            0
        )
    );
    // noisy: absent, warm: (3−7)/2, bright: (15−5)/5.
    assert_eq!(
        fit.rows[1],
        (
            Feedback::KeepKill {
                x: vec![0.0, -2.0, 2.0],
                kept: false,
            },
            1
        )
    );
    // Only bright was measured: (0−5)/5.
    assert_eq!(
        fit.rows[2],
        (
            Feedback::Stars {
                x: vec![0.0, 0.0, -1.0],
                rating: 4,
            },
            1
        )
    );
    assert_eq!(fit.absent, vec![vec![1], vec![0], vec![0, 1]]);
    assert_eq!(log.raw_rows(&names_then).len(), 2, "raw rows are fittable");
}

/// A legacy log has no names and holds z-scores already: it is read
/// positionally and taken as it is, and a coordinate it is too short for is
/// imputed like any other. A nameless row in the current schema (what the
/// synthetic users write) is positional too, but raw, so it is standardized.
#[test]
fn a_nameless_log_projects_by_position() {
    let legacy = r#"{"observations":[
        {"Duel":{"a":[1.0,2.0],"b":[3.0,4.0],"chose_a":true,"session":0}},
        {"Stars":{"x":[0.5],"rating":2,"session":1}}
    ]}"#;
    let mut log: ObservationLog = serde_json::from_str(legacy).unwrap();
    log.push(Observation::new(
        Feedback::KeepKill {
            x: vec![12.0, 14.0],
            kept: true,
        },
        1,
        &[],
    ));
    let names: Vec<String> = vec!["p".into(), "q".into()];
    let sz = Standardizer {
        mean: vec![10.0, 10.0],
        std: vec![2.0, 2.0],
    };
    let fit = FitSet::build(&log, &names, &sz);
    let rows: Vec<Feedback> = fit.rows.iter().map(|(f, _)| f.clone()).collect();
    assert_eq!(
        rows,
        vec![
            Feedback::Duel {
                a: vec![1.0, 2.0],
                b: vec![3.0, 4.0],
                chose_a: true,
            },
            Feedback::Stars {
                x: vec![0.5, 0.0],
                rating: 2,
            },
            Feedback::KeepKill {
                x: vec![1.0, 2.0],
                kept: true,
            },
        ]
    );
    assert_eq!(fit.absent, vec![vec![], vec![1], vec![]]);

    // An empty log is an empty view of it.
    assert!(FitSet::build(&ObservationLog::new(), &names, &sz).is_empty());
}

/// A standardizer of another dimension than φ is refused by name: the two
/// are one coordinate system or nothing built from them is a measurement.
#[test]
#[should_panic(expected = "standardizer is 2-dimensional but φ has 3 coordinates")]
fn a_standardizer_of_another_dimension_is_refused() {
    let names: Vec<String> = vec!["p".into(), "q".into(), "r".into()];
    let sz = Standardizer {
        mean: vec![0.0; 2],
        std: vec![1.0; 2],
    };
    FitSet::build(&ObservationLog::new(), &names, &sz);
}

/// Every provenance's name, `as_str`, is the name it is stored under. The
/// session layer reports calibration per stream by `as_str` and the app
/// looks each stream up by it (`PROVENANCE_NAME` in `apps/web/main.js`),
/// while the log stores the serialized form: they must be one name.
#[test]
fn every_provenance_is_named_as_it_is_stored() {
    for (i, p) in Provenance::ALL.into_iter().enumerate() {
        // A new variant stops this compiling: add it here and to `ALL`.
        let declared = match p {
            Provenance::Duel => 0,
            Provenance::HeardEdit => 1,
            Provenance::SelfReport => 2,
            Provenance::PerformOffer => 3,
        };
        assert_eq!(declared, i, "ALL is in declaration order");
        let wire = format!("\"{}\"", p.as_str());
        assert_eq!(serde_json::to_string(&p).unwrap(), wire);
        assert_eq!(serde_json::from_str::<Provenance>(&wire).unwrap(), p);
    }
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
