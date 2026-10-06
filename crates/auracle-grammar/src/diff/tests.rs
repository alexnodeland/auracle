use super::*;
use crate::prior::{N_MODS, N_OPS, N_SOURCES};

/// The newest production of every categorical has a name in the diff
/// view, and the last index of each table is the last kind. This is the
/// test that was missing both times the tables went stale.
#[test]
fn every_categorical_index_has_a_label() {
    let u = |i: usize| ChoiceValue::Usize(i);
    assert_eq!(display_value("src", &u(N_SOURCES - 1)), "audio in");
    assert_eq!(display_value("src", &u(6)), "silence");
    assert_eq!(display_value("input", &u(0)), "1");
    assert_eq!(display_value("channel", &u(2)), "both");
    assert_eq!(display_value("op", &u(N_OPS - 1)), "vocoder");
    assert_eq!(display_value("op", &u(15)), "shift");
    assert_eq!(display_value("mod", &u(N_MODS - 1)), "steps");
    assert_eq!(display_value("mod", &u(7)), "pair");
    assert_eq!(display_value("mod", &u(5)), "euclid");
    // One past the end still degrades to the index rather than panicking.
    assert_eq!(display_value("src", &u(N_SOURCES)), N_SOURCES.to_string());
}
