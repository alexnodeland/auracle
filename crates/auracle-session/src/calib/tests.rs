use super::*;

/// The calibration export is a *proper* score. A confident-and-right
/// forecaster must beat a hedging one, which is precisely what the
/// running hit rate it replaces cannot tell you.
#[test]
fn brier_rewards_sharpness_that_hit_rate_cannot() {
    let confident: Vec<Forecast> = (0..20)
        .map(|_| Forecast {
            p_a: 0.95,
            chose_a: true,
            random_check: false,
            provenance: Provenance::Duel,
        })
        .collect();
    let hedging: Vec<Forecast> = (0..20)
        .map(|_| Forecast {
            p_a: 0.55,
            chose_a: true,
            random_check: false,
            provenance: Provenance::Duel,
        })
        .collect();
    let (c, h) = (calibration(&confident), calibration(&hedging));
    assert_eq!(c.hit_rate, h.hit_rate, "hit rate cannot tell these apart");
    assert!(
        c.skill > h.skill,
        "Brier skill must: {} vs {}",
        c.skill,
        h.skill
    );
    assert!(c.skill > 0.9 && h.skill < 0.2);

    // Reliability bins: a well-calibrated stream lands on the diagonal.
    let mixed: Vec<Forecast> = (0..100)
        .map(|i| Forecast {
            p_a: 0.1,
            chose_a: i % 10 == 0,
            random_check: i % 10 == 0,
            provenance: Provenance::Duel,
        })
        .collect();
    let m = calibration(&mixed);
    let bin = m.bins.iter().find(|b| b.n > 0).unwrap();
    assert!((bin.predicted - bin.observed).abs() < 0.05, "{bin:?}");
    assert_eq!(m.check_n, 10, "check duels counted separately");
    assert_eq!(m.by_provenance.len(), 1, "one stream, one row");
    assert_eq!(m.by_provenance[0].provenance, "duel");
}

/// Self-report and heard comparison are scored apart, because there is no
/// reason to believe a checkbox and a heard A/B are equally reliable and
/// the only way to find out is to keep the two streams separable. The
/// aggregate still covers everything — this splits the score, it does not
/// hide any of it.
#[test]
fn calibration_scores_a_checkbox_apart_from_a_heard_comparison() {
    let f = |p: f64, won: bool, prov| Forecast {
        p_a: p,
        chose_a: won,
        random_check: false,
        provenance: prov,
    };
    let mut fs: Vec<Forecast> = (0..10)
        .map(|_| f(0.9, true, Provenance::HeardEdit))
        .collect();
    // The self-reports contradict a model that is right about the heard
    // ones — precisely the asymmetry this split exists to make visible.
    fs.extend((0..10).map(|_| f(0.9, false, Provenance::SelfReport)));
    let c = calibration(&fs);
    assert_eq!(c.n, 20, "the aggregate still sees every forecast");
    let row = |name: &str| {
        c.by_provenance
            .iter()
            .find(|r| r.provenance == name)
            .unwrap_or_else(|| panic!("{name} missing"))
    };
    assert_eq!(row("heard_edit").n, 10);
    assert_eq!(row("self_report").n, 10);
    assert!(
        row("heard_edit").skill > row("self_report").skill,
        "the split scored nothing: {:?}",
        c.by_provenance
    );
    assert!(c.by_provenance.iter().all(|r| r.provenance != "duel"));
}
