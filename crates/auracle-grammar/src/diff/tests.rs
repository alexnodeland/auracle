use super::*;
use crate::describe::{
    band_options, channel_options, drive_mode_options, filter_options, input_options,
    noise_options, play_options, table_options, waveform_options,
};
use crate::prior::{N_MODS, N_OP_KINDS, N_SOURCES};
use crate::term::{
    AmpEnv, AudioNode, CaptureMode, DriveMode, FilterKind, InputChannel, ModNode, NoiseColor,
    PitchBand, TableShape, Uid, Waveform, INPUT_SLOTS,
};
use crate::NodeKind;

/// Every categorical a player turns is named in the lineage log and the
/// offer strips (which read this diff) as the rack's selector names it, at
/// every index its type has. The sets come from the types' `ALL`, so a new
/// waveform, filter kind or capture mode with no label here fails, naming
/// the site, rather than showing as a bare number. The three structural
/// categoricals are labeled from `crate::prior`'s tables, sized by their
/// arity constants; they are checked at every index too, and a few labels
/// are pinned as copy.
#[test]
fn every_categorical_index_is_named_as_the_rack_names_it() {
    let u = ChoiceValue::Usize;
    let sites: [(&str, usize, Vec<String>); 8] = [
        ("wave", Waveform::ALL.len(), waveform_options()),
        ("color", NoiseColor::ALL.len(), noise_options()),
        ("fkind", FilterKind::ALL.len(), filter_options()),
        ("table", TableShape::ALL.len(), table_options()),
        ("dmode", DriveMode::ALL.len(), drive_mode_options()),
        ("channel", InputChannel::ALL.len(), channel_options()),
        ("band", PitchBand::ALL.len(), band_options()),
        ("play", CaptureMode::ALL.len(), play_options()),
    ];
    for (site, n, rack) in &sites {
        assert_eq!(rack.len(), *n, "the rack's `{site}` selector");
        for (i, name) in rack.iter().enumerate() {
            let shown = display_value(site, &u(i));
            assert_ne!(shown, i.to_string(), "`{site}` {i} shows as a bare index");
            assert_eq!(&shown, name, "`{site}` {i}");
        }
        // One past the end degrades to the index rather than panicking.
        assert_eq!(display_value(site, &u(*n)), n.to_string());
    }
    // An AUDIO IN's input is numbered from one, as the rack's selector shows
    // it.
    assert_eq!(input_options().len(), INPUT_SLOTS);
    for (i, name) in input_options().iter().enumerate() {
        assert_eq!(&display_value("input", &u(i)), name);
    }
    // Every audio kind sits at one `#src` or `#op` index, and each has a name.
    assert_eq!(N_SOURCES + N_OP_KINDS, NodeKind::ALL.len());
    for (site, n) in [("src", N_SOURCES), ("op", N_OP_KINDS), ("mod", N_MODS)] {
        for i in 0..n {
            assert_ne!(display_value(site, &u(i)), i.to_string(), "`{site}` {i}");
        }
        assert_eq!(display_value(site, &u(n)), n.to_string());
    }
    // Pinned copy: the newest production of each, and the octave's sign.
    assert_eq!(display_value("src", &u(N_SOURCES - 1)), "audio in");
    assert_eq!(display_value("src", &u(6)), "silence");
    assert_eq!(display_value("op", &u(19)), "vocoder");
    assert_eq!(display_value("op", &u(N_OP_KINDS - 1)), "capture");
    assert_eq!(display_value("op", &u(15)), "shift");
    assert_eq!(display_value("mod", &u(N_MODS - 1)), "steps");
    assert_eq!(display_value("mod", &u(7)), "pair");
    assert_eq!(display_value("mod", &u(5)), "euclid");
    assert_eq!(display_value("oct", &u(0)), "-2");
    assert_eq!(display_value("oct", &u(2)), "+0");
    assert_eq!(display_value("oct", &u(4)), "+2");
    // A categorical site the table does not know shows its index.
    assert_eq!(display_value("fshift", &u(3)), "3");
}

/// A knob shows to two decimals; a choice the trace codec never writes
/// (an integer draw) still shows, as itself, rather than failing the strip.
#[test]
fn a_value_shows_as_its_knob_reads() {
    assert_eq!(display_value("cut", &ChoiceValue::F64(0.456)), "0.46");
    assert_eq!(display_value("cut", &ChoiceValue::I64(-3)), "I64(-3)");
}

fn vco() -> AudioNode {
    AudioNode::Vco {
        uid: Uid::NEW,
        wave: Waveform::Saw,
        octave: 1,
        detune: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }
}

fn voice(root: AudioNode) -> PatchTree {
    PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.7,
            release: 0.4,
        },
        root,
    }
}

/// Putting a filter over the root reads, in the lineage log, as the root
/// turning from a source into a processor: the source's sites at `node`
/// removed, the filter's added, and the oscillator arriving one level down,
/// at `node/0`.
/// Nothing that did not change is listed, and the list is in address order.
#[test]
fn a_structural_edit_reads_as_the_sites_it_removed_and_added() {
    let before = voice(vco());
    let after = voice(AudioNode::Filter {
        uid: Uid::NEW,
        kind: FilterKind::Ladder,
        cutoff: 0.5,
        resonance: 0.2,
        mod_depth: 0.0,
        input: Box::new(vco()),
        modulation: ModNode::None,
    });
    let diff = tree_diff(&before, &after);
    let entry = |addr: &str| {
        diff.iter()
            .find(|e| e.addr == addr)
            .map(|e| (e.before.as_deref(), e.after.as_deref()))
    };
    assert_eq!(
        entry("node#leaf"),
        Some((Some("source"), Some("processor")))
    );
    assert_eq!(entry("node#src"), Some((Some("vco"), None)));
    assert_eq!(entry("node#wave"), Some((Some("saw"), None)));
    assert_eq!(entry("node#op"), Some((None, Some("filter"))));
    assert_eq!(entry("node#fkind"), Some((None, Some("ladder"))));
    assert_eq!(entry("node/0#src"), Some((None, Some("vco"))));
    assert_eq!(entry("node/0#oct"), Some((None, Some("+1"))));
    // Both roots have a modulation depth of 0: the same site at the same
    // value, so not a change.
    assert_eq!(entry("node#mdepth"), None);
    assert!(diff.iter().all(|e| !e.addr.starts_with("amp#")), "{diff:?}");
    assert!(diff.windows(2).all(|w| w[0].addr < w[1].addr), "{diff:?}");
    // Read the other way, the same edit lists the same sites, each flipped.
    let back = tree_diff(&after, &before);
    assert_eq!(back.len(), diff.len());
    for (b, d) in back.iter().zip(&diff) {
        assert_eq!(
            (&b.addr, &b.before, &b.after),
            (&d.addr, &d.after, &d.before)
        );
    }
    assert!(tree_diff(&after, &after).is_empty());
}
