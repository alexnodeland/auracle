use super::*;
use crate::tests::{captured, patch, tone, SR};
use crate::{compile, term, PatchTree};
use quiver::prelude::GraphModule;

/// Samples whose bits a lossy codec would move: a tone plus values at the
/// edges of `f32` (the smallest subnormal, the largest finite, negative
/// zero).
fn awkward(n: usize) -> Vec<f32> {
    let mut x: Vec<f32> = (0..n).map(|i| (i as f32 * 0.013).sin() * 0.7).collect();
    x[1] = f32::from_bits(1);
    x[2] = f32::MAX;
    x[3] = -0.0;
    x
}

#[test]
fn a_take_round_trips_bit_exactly_through_its_saved_form() {
    let x = awkward(4_801);
    let take = Take::from_samples(&x, 48_000.0).unwrap();
    let text = serde_json::to_string(&take).unwrap();
    // The saved form is quiver's: the four fields, in that order.
    assert!(text
        .starts_with(r#"{"format":"f32le-base64","sample_rate":48000.0,"length":4801,"data":""#));
    let back: Take = serde_json::from_str(&text).unwrap();
    assert_eq!(back, take);
    assert!(back.unreadable().is_none());
    let bits = |s: &[f32]| s.iter().map(|v| v.to_bits()).collect::<Vec<_>>();
    assert_eq!(bits(back.samples()), bits(&x));
    assert_eq!(back.sample_rate(), Some(48_000.0));
}

/// What a compiled quiver `Capture` saves reads straight in, `capacity`
/// and all, and is the recording.
#[test]
fn quivers_own_capture_state_reads_as_a_take() {
    let mut cap = quiver::prelude::Capture::new(44_100.0);
    let x = awkward(1_000);
    cap.set_recording(&x, 44_100.0);
    let state = cap.serialize_state().expect("a recording saves");
    let saved: SavedTake = serde_json::from_value(state).unwrap();
    let take = Take::from_saved(&saved).unwrap();
    assert_eq!(take.samples(), cap.recording());
    // And back: quiver loads what a take saves.
    let mut fresh = quiver::prelude::Capture::new(44_100.0);
    let mut v = serde_json::to_value(take.to_saved().unwrap()).unwrap();
    v["capacity"] = (x.len() as u64).into();
    fresh.deserialize_state(&v).unwrap();
    assert_eq!(fresh.recording(), take.samples());
}

#[test]
fn the_empty_take_saves_as_nothing_and_loads_from_null() {
    assert_eq!(serde_json::to_string(&Take::empty()).unwrap(), "null");
    let back: Take = serde_json::from_str("null").unwrap();
    assert!(back.is_empty() && back.unreadable().is_none());
    assert!(Take::from_samples(&[], 48_000.0).unwrap().is_empty());
}

/// Every way a saved take can be wrong loads the empty take and says why,
/// and none of them fails the deserialize (the sound around it must load).
#[test]
fn a_saved_take_is_held_to_its_bound() {
    let good = serde_json::to_value(Take::from_samples(&awkward(300), 48_000.0).unwrap()).unwrap();
    let bad = |edit: &dyn Fn(&mut serde_json::Value)| {
        let mut v = good.clone();
        edit(&mut v);
        let t: Take = serde_json::from_value(v).expect("a bad take never fails the load");
        assert!(t.is_empty());
        t.unreadable().expect("and it says why").to_string()
    };
    assert!(bad(&|v| v["format"] = "s16le-base64".into()).contains("format"));
    assert!(bad(&|v| v["sample_rate"] = 0.0.into()).contains("rate"));
    assert!(bad(&|v| v["sample_rate"] = (MAX_TAKE_RATE * 2.0).into()).contains("rate"));
    // Longer than the bound at its rate, refused before anything decodes.
    let long = (TAKE_SECONDS * 48_000.0) as usize + 1;
    assert!(bad(&|v| v["length"] = long.into()).contains("longer"));
    assert!(bad(&|v| v["length"] = 1_000_000_000_000u64.into()).contains("longer"));
    // A length that disagrees with the data, and data that is not base64.
    assert!(bad(&|v| v["length"] = 299.into()).contains("data"));
    assert!(bad(&|v| {
        let s = v["data"].as_str().unwrap().replace('A', "*");
        v["data"] = s.into();
    })
    .contains("data"));
    // A non-finite sample, encoded honestly.
    let nan = {
        let mut x = awkward(300);
        x[7] = f32::NAN;
        let mut bytes = Vec::new();
        for s in &x {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        base64::encode(&bytes)
    };
    assert!(bad(&|v| v["data"] = nan.clone().into()).contains("finite"));
    // Not a take at all.
    assert!(bad(&|v| *v = 5.into()).contains("not a saved take"));
    assert!(
        bad(&|v| *v = serde_json::json!({"format": "f32le-base64"})).contains("not a saved take")
    );
}

#[test]
fn made_takes_are_held_to_the_same_bound() {
    assert_eq!(
        Take::from_samples(&[0.1, f32::INFINITY], 48_000.0),
        Err(TakeError::NonFinite)
    );
    assert!(matches!(
        Take::from_samples(&[0.1], f64::NAN),
        Err(TakeError::Rate(_))
    ));
    let long = vec![0.0f32; (TAKE_SECONDS * 8_000.0) as usize + 1];
    assert!(matches!(
        Take::from_samples(&long, 8_000.0),
        Err(TakeError::TooLong { .. })
    ));
}

#[test]
fn equality_is_content() {
    let a = Take::from_samples(&awkward(64), 48_000.0).unwrap();
    let b = Take::from_samples(&awkward(64), 48_000.0).unwrap();
    assert_eq!(a, b);
    assert_ne!(a, Take::from_samples(&awkward(64), 44_100.0).unwrap());
    let mut y = awkward(64);
    y[10] = -y[10];
    assert_ne!(a, Take::from_samples(&y, 48_000.0).unwrap());
    assert_ne!(a, Take::empty());
    // Unreadable is bookkeeping, not content.
    let lost: Take = serde_json::from_str("7").unwrap();
    assert_eq!(lost, Take::empty());
}

/// An unreadable take writes nothing, unless it is kept for writing back,
/// and then it writes exactly what was loaded, which loads as the same
/// unreadable take again.
#[test]
fn a_kept_unreadable_take_writes_back_what_was_loaded() {
    let text = r#"{"format":"f32le-base64","sample_rate":48000.0,"length":9,"data":"AAAA"}"#;
    let lost: Take = serde_json::from_str(text).unwrap();
    assert!(lost.unreadable().is_some() && lost.saves_nothing());
    let kept = lost.kept();
    assert!(!kept.saves_nothing());
    let back = serde_json::to_string(&kept).unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&back).unwrap(),
        serde_json::from_str::<serde_json::Value>(text).unwrap()
    );
    let again: Take = serde_json::from_str(&back).unwrap();
    assert!(again.unreadable().is_some());
    // A readable or empty take is not changed by keeping it.
    assert!(Take::empty().kept().saves_nothing());
    let t = Take::from_samples(&[0.1, 0.2], 48_000.0).unwrap();
    assert_eq!(
        serde_json::to_string(&t.kept()).unwrap(),
        serde_json::to_string(&t).unwrap()
    );
}

/// A corrupt take in a saved sound costs the sound its take and nothing
/// else: the patch loads, the capture is empty, and the term says why.
#[test]
fn a_corrupt_take_loads_the_patch_with_the_take_empty() {
    let take = Take::from_samples(&tone(1_000, 330.0), SR).unwrap();
    let tree = patch(captured(term::CaptureMode::Hold, take));
    let mut v = serde_json::to_value(&tree).unwrap();
    v["root"]["Capture"]["take"]["length"] = 999.into();
    let back: PatchTree = serde_json::from_value(v).expect("the patch still loads");
    assert_eq!(back.lost_takes(), 1);
    match &back.root {
        term::AudioNode::Capture { take, play, .. } => {
            assert!(take.is_empty());
            assert_eq!(*play, term::CaptureMode::Hold);
        }
        n => panic!("{n:?}"),
    }
    // Saved again, it holds no take (and no garbage).
    assert!(!serde_json::to_string(&back).unwrap().contains("\"take\""));
    assert!(compile(&back, SR).is_ok());
}
