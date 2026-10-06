use super::*;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

fn col(values: &[f64]) -> Vec<Vec<f64>> {
    values.iter().map(|v| vec![*v]).collect()
}

/// The defect, as a number. Fifty rows of a coordinate spread over [0,1]
/// plus **one** escaped `1e30`: unwinsorized, the outlier owns the mean
/// and the scale, every real patch standardizes to the same place, and the
/// column is dead — the model can never learn from an axis whose fifty
/// honest values are separated by 1e-30 of a standard deviation.
#[test]
fn one_escaped_row_cannot_kill_a_column() {
    let mut values: Vec<f64> = (0..50).map(|i| i as f64 / 49.0).collect();
    let clean = Standardizer::fit(&col(&values));
    values.push(1e30);
    let poisoned = Standardizer::fit(&col(&values));

    // The scale still describes where the real data is, to within the one
    // row's worth of extra weight at the top of the range.
    assert!(
        (poisoned.std[0] - clean.std[0]).abs() < 0.05,
        "σ moved from {} to {}",
        clean.std[0],
        poisoned.std[0]
    );
    assert!((poisoned.mean[0] - clean.mean[0]).abs() < 0.05);

    // …and the coordinate still separates two real patches, which is the
    // only thing it is for. Unwinsorized this difference was ~1e-30.
    let spread = poisoned.transform(&[1.0])[0] - poisoned.transform(&[0.0])[0];
    assert!(spread > 3.0, "the column carries no information: {spread}");
}

/// **Clean data must come out bit-identical to the unrobustified fit.**
///
/// The load-bearing property of the whole design, and the one the first
/// attempt did not have: a routine 2% clip cost the 16-seed search-health
/// climb `+1.877 → +0.204` mean gain. A fit that is the plain moments
/// unless a column is runaway cannot cost the search anything, and this is
/// what says so — over a heavy right tail, a near-constant column, a
/// bipolar one and a count, none of which may move by a ULP.
#[test]
fn clean_columns_are_bit_identical_to_the_plain_moments() {
    let plain = |v: &[f64]| {
        let n = v.len() as f64;
        let m = v.iter().sum::<f64>() / n;
        (
            m,
            (v.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / n).sqrt(),
        )
    };
    let cases: Vec<Vec<f64>> = vec![
        // A heavy right tail (log-crest shaped).
        (0..60).map(|i| (1.0 + i as f64 / 6.0).ln()).collect(),
        // Near-constant with two rare non-zeros — a module in 2 of 48.
        (0..48).map(|i| if i < 46 { 0.0 } else { 1.0 }).collect(),
        // Bipolar, symmetric.
        (0..80).map(|i| (i as f64 - 40.0) / 13.0).collect(),
        // A count column with a legitimately extreme member.
        {
            let mut v: Vec<f64> = (0..47).map(|i| (i % 4) as f64).collect();
            v.push(9.0);
            v
        },
        // Five rows: under the winsorize floor entirely.
        vec![0.1, 0.4, 0.55, 0.9, 0.2],
    ];
    for (i, values) in cases.iter().enumerate() {
        let sz = Standardizer::fit(&col(values));
        let (m, s) = plain(values);
        assert_eq!(sz.mean[0], m, "case {i}: mean moved");
        assert_eq!(
            sz.std[0],
            if s < 1e-9 { 1.0 } else { s },
            "case {i}: σ moved"
        );
    }
}

/// The tail size the detector uses when it does fire. `floor` gave zero for
/// every n below 50 — including the 48-row reference population the
/// search-health harness uses — so the rule was inert exactly where it was
/// needed.
#[test]
fn winsor_k_covers_the_sizes_this_runs_at() {
    assert_eq!(winsor_k(9), 0, "too few rows to call anything a tail");
    assert_eq!(winsor_k(10), 1);
    assert_eq!(winsor_k(48), 1, "a full pool must be able to clip a row");
    assert_eq!(winsor_k(90), 2);
    assert_eq!(winsor_k(200), 4);

    // …and the guarantee it buys: one escaped value in a 48-row column
    // cannot move the scale by more than the honest spread of the column.
    let mut values: Vec<f64> = (0..47).map(|i| i as f64 / 46.0).collect();
    let clean = Standardizer::fit(&col(&values));
    values.push(1e30);
    let poisoned = Standardizer::fit(&col(&values));
    assert!(
        (poisoned.std[0] - clean.std[0]).abs() < 0.05,
        "σ moved from {} to {}",
        clean.std[0],
        poisoned.std[0]
    );
}

/// A non-finite cell is dropped from its column rather than turning the
/// whole coordinate into NaN — which is what it used to do, silently, for
/// every patch in the pool.
#[test]
fn a_non_finite_cell_does_not_poison_its_column() {
    let sz = Standardizer::fit(&col(&[0.2, f64::NAN, 0.8, 0.5]));
    assert!(sz.mean[0].is_finite() && sz.std[0].is_finite());
    assert!(sz.transform(&[0.5])[0].is_finite());
}

/// A column whose moments overflow falls back to (0, 1) rather than
/// writing `inf` — which `serde_json` would serialize as `null` and the
/// profile would then fail to load.
#[test]
fn overflowing_moments_fall_back_to_the_degenerate_case() {
    let rows: Vec<Vec<f64>> = (0..12)
        .map(|i| vec![if i % 2 == 0 { 1e308 } else { -1e308 }, i as f64])
        .collect();
    let sz = Standardizer::fit(&rows);
    assert!(sz.mean[0].is_finite() && sz.std[0].is_finite());
    assert_eq!((sz.mean[0], sz.std[0]), (0.0, 1.0));
    assert!(sz.mean[1].is_finite() && sz.std[1] > 0.0);
    let json = serde_json::to_string(&sz).unwrap();
    assert!(
        !json.contains("null"),
        "a standardizer must round-trip: {json}"
    );
}

/// The standardizer normalizes to zero mean / unit variance and
/// round-trips dimension.
///
/// The tolerances are still exact, and that is the point: `fit` gained a
/// runaway-column detector, not a routine trim, so on clean data it is the
/// plain moments to the last bit. If this test ever needs loosening, the
/// robustification has started charging the honest columns for the
/// dishonest ones.
#[test]
fn standardizer_standardizes() {
    let mut rng = StdRng::seed_from_u64(55);
    let rows: Vec<Vec<f64>> = (0..500)
        .map(|_| vec![rng.gen::<f64>() * 100.0, 5.0, rng.gen::<f64>() - 3.0])
        .collect();
    let sz = Standardizer::fit(&rows);
    assert_eq!(sz.dimension(), 3);
    let transformed: Vec<Vec<f64>> = rows.iter().map(|r| sz.transform(r)).collect();
    for dim in [0, 2] {
        let col: Vec<f64> = transformed.iter().map(|r| r[dim]).collect();
        let mean = col.iter().sum::<f64>() / col.len() as f64;
        let var = col.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / col.len() as f64;
        assert!(mean.abs() < 1e-9, "dim {dim} is not centred: {mean}");
        assert!((var - 1.0).abs() < 1e-9, "dim {dim} scale drifted: {var}");
    }
    // Constant column: std floored, no NaN.
    assert!(transformed.iter().all(|r| r[1].abs() < 1e-9));
}
