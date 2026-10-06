use super::*;

/// The default stimulus keeps its advertised shape — each clause here is
/// one of the four blind spots the v2 phrase exists to remove, so a
/// "harmless" retiming that reopens one fails loudly.
#[test]
fn the_default_phrase_keeps_its_advertised_shape() {
    let spec = PhraseSpec::default();
    let first = &spec.notes[0];
    assert!(
        first.on_s >= 1.5,
        "held note too short to reveal slow attacks / sub-Hz motion"
    );
    assert!(
        spec.notes.iter().any(|n| n.voct >= 1.0),
        "no note above the old Eb4 ceiling"
    );
    assert!(
        spec.notes.iter().any(|n| !n.chord.is_empty()),
        "no polyphonic segment"
    );
    let last = spec.notes.last().unwrap();
    assert!(
        last.chord.is_empty() && last.off_s >= 1.0,
        "tail window must stay last, long, and mono"
    );
    assert!(
        spec.total_seconds() <= 5.5,
        "stimulus creep: {:.2}s — the render budget was ~2× v1",
        spec.total_seconds()
    );
}
