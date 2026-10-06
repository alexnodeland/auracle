use super::*;
use crate::{describe, presets, term};

// ---------- node identity ----------

/// Uids must be invisible to every system that reasons about *content*.
///
/// Three of those, and all three would break loudly: the engine's pool
/// dedup and refinement's own "did the walk move" test are both
/// `PatchTree` equality, and the render memo is a hash of the tree's JSON.
/// If a fresh identity could make two identical patches differ, evolution
/// would admit duplicates forever and every refinement step would miss a
/// cache it had just filled.
#[test]
fn uid_is_invisible_to_content() {
    let mut a = presets::presets()[0].1.clone();
    let mut b = a.clone();
    a.ensure_uids();
    b.ensure_uids();
    assert_ne!(
        a.root.uid().0,
        b.root.uid().0,
        "two settlings must mint different identities, or the test is vacuous"
    );
    assert_eq!(a, b, "patches that differ only in uid are the same patch");

    // The render memo's content address is `canonical_tree_json`, which
    // clears identities first; the half of that contract this crate can
    // state is that clearing lands both trees on the same term. The JSON
    // itself is pinned in `auracle_features::cache`, where the key lives.
    let (mut ca, mut cb) = (a.clone(), b.clone());
    ca.clear_uids();
    cb.clear_uids();
    assert!(ca.root.uid().is_new() && cb.root.uid().is_new());
    assert_eq!(ca, cb);
}

/// A restored save carries identities the mint has never issued, and the
/// mint must not issue them again.
///
/// The counter is per-process and a page reload starts it at 1, while the
/// save it restores is full of ids from the session that wrote it. Without
/// this, inserting one module into a restored patch would hand out an id
/// that patch already uses and two nodes would answer to one lock — the
/// exact confusion identities exist to end, arriving only for the returning
/// user, only after a reload.
#[test]
fn settling_pushes_the_mint_past_what_it_has_seen() {
    // Stand in for a save written by an older session: a tree whose
    // identities are far above anything this process has minted.
    let mut restored = presets::presets()[0].1.clone();
    restored.ensure_uids();
    let high = term::Uid(9_000_000);
    restored.root.set_uid(high);
    restored.ensure_uids();
    assert_eq!(
        restored.root.uid().0,
        high.0,
        "a set identity is not reissued"
    );

    let mut fresh = presets::presets()[0].1.clone();
    fresh.ensure_uids();
    assert!(
        fresh.root.uid().0 > high.0,
        "the mint reissued an identity a restored patch is already using"
    );
}

/// A duplicated subtree brings its original's identities with it in the
/// copy, and two nodes claiming one identity is worse than none: a lock on
/// either would light both. Settling breaks the tie.
#[test]
fn settling_breaks_duplicate_identities() {
    let mut inner = presets::presets()[0].1.clone();
    inner.ensure_uids();
    let mut tree = inner.clone();
    tree.root = term::AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(inner.root.clone()),
        b: Box::new(inner.root.clone()),
    };
    tree.ensure_uids();
    let d = describe::describe(&tree);
    let mut seen = std::collections::HashSet::new();
    for m in d.modules.iter().filter(|m| m.key != "amp") {
        assert_ne!(m.uid, 0, "{} was left without an identity", m.key);
        assert!(seen.insert(m.uid), "{} shares an identity", m.key);
    }
}

// ---------- what a tree says about itself ----------

use crate::mutate::{apply_struct_op, default_fragment, ModKind, NodeKind, StructOp};
use fugue_evo::genome::trace_genome::TraceGenome;

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

/// `kind` as a hand places it on a saw: a source alone, anything else
/// inserted over it.
fn over_saw(kind: NodeKind) -> PatchTree {
    let saw = voice(default_fragment(NodeKind::Vco));
    if kind.is_source() {
        return voice(default_fragment(kind));
    }
    let op = StructOp::Insert {
        key: "node".into(),
        kind,
    };
    apply_struct_op(&saw, &op).expect("an insert over a saw")
}

/// Every module a hand can place, and each with every modulation a hand
/// can set on it (on the kinds with a slot), shaped twice so the shapers
/// wrap a term: the trees the next tests read.
fn every_kind_and_modulation() -> Vec<PatchTree> {
    let mut trees = Vec::new();
    for kind in NodeKind::ALL {
        let tree = voice(default_fragment(kind));
        for mk in ModKind::ALL {
            let set = StructOp::SetMod {
                key: "node".into(),
                kind: mk,
            };
            if let Ok(once) = apply_struct_op(&tree, &set) {
                trees.push(apply_struct_op(&once, &set).unwrap_or(once.clone()));
                trees.push(once);
            }
        }
        trees.push(tree);
    }
    trees
}

/// **`site_count` is the number of choices the trace writes**, the genome's
/// dimension: for every kind of module, under every kind of modulation,
/// shapers nested, and for prior draws.
#[test]
fn site_count_is_the_number_of_sites_the_trace_writes() {
    let mut trees = every_kind_and_modulation();
    let prior = crate::PatchGrammarPrior::default();
    let mut rng = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(0x517E);
    trees.extend((0..200).map(|_| prior.sample_with_rng(&mut rng)));
    for t in &trees {
        assert_eq!(
            t.site_count(),
            t.to_trace().choices.len(),
            "{}",
            t.to_sexpr()
        );
    }
}

/// A modulation term's size is the plates the rack draws for it: one per
/// module, none for an empty slot.
#[test]
fn a_mod_terms_size_is_the_plates_the_rack_draws_for_it() {
    for t in every_kind_and_modulation() {
        let Some(m) = t.root.modulation() else {
            continue;
        };
        let plates = describe::describe(&t)
            .modules
            .iter()
            .filter(|p| p.is_mod)
            .count();
        assert_eq!(m.size(), plates, "{}", t.to_sexpr());
    }
}

/// **A hand-built modulation term is read in its canonical form**: a
/// processor over nothing is nothing, a pair with one empty side is the
/// other side, a pair of two terms stays a pair, and a one-parameter op's
/// unused parameter is pinned to 0 (the trace does not carry it).
#[test]
fn a_hand_built_mod_term_is_read_in_its_canonical_form() {
    let lfo = || ModNode::Lfo {
        uid: Uid::NEW,
        wave: Waveform::Triangle,
        rate: 0.4,
    };
    let op = |kind: ModOp, input: ModNode| ModNode::Op {
        uid: Uid::NEW,
        kind,
        p0: 0.3,
        p1: 0.7,
        input: Box::new(input),
    };
    let pair = |a: ModNode, b: ModNode| ModNode::Pair {
        uid: Uid::NEW,
        kind: PairOp::Max,
        a: Box::new(a),
        b: Box::new(b),
    };
    assert_eq!(op(ModOp::Slew, ModNode::None).normalized(), ModNode::None);
    assert_eq!(
        pair(ModNode::None, ModNode::None).normalized(),
        ModNode::None
    );
    assert_eq!(pair(lfo(), ModNode::None).normalized(), lfo());
    assert_eq!(pair(ModNode::None, lfo()).normalized(), lfo());
    assert_eq!(pair(lfo(), lfo()).normalized(), pair(lfo(), lfo()));
    // An empty side found deeper in is still found.
    assert_eq!(
        pair(op(ModOp::Slew, ModNode::None), lfo()).normalized(),
        lfo()
    );
    // Slew reads both parameters; Hold reads one, so its second goes to 0.
    assert_eq!(op(ModOp::Slew, lfo()).normalized(), op(ModOp::Slew, lfo()));
    match op(ModOp::Hold, lfo()).normalized() {
        ModNode::Op { p0, p1, .. } => assert_eq!((p0, p1), (0.3, 0.0)),
        m => panic!("{m:?}"),
    }
    assert_eq!(lfo().normalized(), lfo());
}

/// **Every module opens its s-expression with the token the app counts it
/// by.** The readout shows the s-expression, and the pool's "how often the
/// model has seen a module" counts `(<token> ` in it (`main.js`'s
/// `nbSupport`, `sx || kind`). Pinned as a literal table: the match is
/// exhaustive, so a new kind does not compile until it has its token.
#[test]
fn every_module_opens_its_sexpr_with_the_token_the_app_counts() {
    let token = |k: NodeKind| match k {
        NodeKind::Vco => "vco",
        NodeKind::Supersaw => "supersaw",
        NodeKind::Noise => "noise",
        NodeKind::Mix => "mix",
        NodeKind::Filter => "filter",
        NodeKind::Fold => "fold",
        NodeKind::Delay => "delay",
        NodeKind::Chorus => "chorus",
        NodeKind::Reverb => "reverb",
        NodeKind::Wavetable => "wavetable",
        NodeKind::Pluck => "pluck",
        NodeKind::Distortion => "dist",
        NodeKind::Bitcrush => "bitcrush",
        NodeKind::Phaser => "phaser",
        NodeKind::RingMod => "ringmod",
        NodeKind::Formant => "formant",
        NodeKind::Flanger => "flanger",
        NodeKind::Tremolo => "tremolo",
        NodeKind::Vibrato => "vibrato",
        NodeKind::Eq => "eq",
        NodeKind::Granular => "granular",
        NodeKind::Shift => "shift",
        NodeKind::Comp => "comp",
        NodeKind::Duck => "duck",
        NodeKind::Gate => "gate",
        NodeKind::Vocoder => "vocoder",
        NodeKind::Silence => "silence",
        NodeKind::AudioIn => "audioin",
        NodeKind::Track => "track",
        NodeKind::Capture => "capture",
    };
    for kind in NodeKind::ALL {
        let s = default_fragment(kind).to_sexpr();
        let head = s[1..].split([' ', ')']).next().unwrap();
        assert_eq!(head, token(kind), "{s}");
    }
    // And every modulation, by its own token, inside its owner's.
    for mk in ModKind::ALL.into_iter().filter(|k| *k != ModKind::None) {
        let tree = apply_struct_op(
            &voice(default_fragment(NodeKind::Vco)),
            &StructOp::SetMod {
                key: "node".into(),
                kind: mk,
            },
        )
        .unwrap();
        let want = format!("({} ", serde_json::to_value(mk).unwrap().as_str().unwrap());
        let s = tree.root.to_sexpr();
        assert!(s.contains(&want), "{mk:?}: {s}");
    }
}

/// The s-expression's format, pinned on one patch: the envelope, each knob
/// to two decimals, an octave with its sign, an empty slot as `nomod`, a
/// shaper over its source, both inputs of a two-input module in order, and
/// a take by its length.
#[test]
fn the_sexpr_reads_as_written() {
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.25,
            sustain: 0.5,
            release: 1.0 / 3.0,
        },
        root: AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: Box::new(AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::Ladder,
                cutoff: 0.125,
                resonance: 0.3,
                mod_depth: 0.5,
                input: Box::new(AudioNode::Vco {
                    uid: Uid::NEW,
                    wave: Waveform::Square,
                    octave: -1,
                    detune: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                }),
                modulation: ModNode::Op {
                    uid: Uid::NEW,
                    kind: ModOp::Slew,
                    p0: 0.2,
                    p1: 0.4,
                    input: Box::new(ModNode::Steps {
                        uid: Uid::NEW,
                        rate: 0.6,
                        length: 0.35,
                        slew: 0.2,
                        values: [0.0, 0.4, 1.0, 0.6, 0.5, 0.5, 0.5, 0.5],
                    }),
                },
            }),
            b: Box::new(AudioNode::Capture {
                uid: Uid::NEW,
                play: CaptureMode::Loop,
                input: Box::new(AudioNode::Silence { uid: Uid::NEW }),
                take: Take::from_samples(&[0.0; 24_000], 48_000.0).unwrap(),
            }),
        },
    };
    assert_eq!(
        tree.to_sexpr(),
        "(voice a=0.10 d=0.25 s=0.50 r=0.33 (mix 0.50 \
         (filter Ladder c=0.12 r=0.30 \
         (slew 0.20 0.40 (steps r=0.60 l=0.35 g=0.20 [0.00 0.40 1.00 0.60 0.50 0.50 0.50 0.50])) \
         (vco sqr -1 0.50 nomod)) \
         (capture loop 0.50s (silence))))"
    );
}

/// **The signature is the spine, read source first**: the default name an
/// unnamed patch shows in the bank. Each module's tag is pinned as a literal
/// table; the spine follows the signal input of every two-input module (a
/// mix's first, a vocoder's carrier, the branch a TRACK plays) and stops at
/// a CAPTURE, whose take is what is heard; past four tags, the first are
/// counted rather than named.
#[test]
fn the_signature_reads_the_spine() {
    let tag = |k: NodeKind| match k {
        NodeKind::Vco => "saw",
        NodeKind::Supersaw => "ssaw",
        NodeKind::Noise => "noiz",
        NodeKind::Wavetable => "wsaw",
        NodeKind::Pluck => "plk",
        NodeKind::Formant => "vox",
        NodeKind::Silence => "mute",
        NodeKind::AudioIn => "in",
        NodeKind::Mix => "mix",
        NodeKind::RingMod => "ring",
        NodeKind::Filter => "lp",
        NodeKind::Fold => "fold",
        NodeKind::Delay => "dly",
        NodeKind::Chorus => "cho",
        NodeKind::Reverb => "rvb",
        NodeKind::Distortion => "drv",
        NodeKind::Bitcrush => "crsh",
        NodeKind::Phaser => "phsr",
        NodeKind::Flanger => "flng",
        NodeKind::Tremolo => "trem",
        NodeKind::Vibrato => "vib",
        NodeKind::Eq => "eq",
        NodeKind::Granular => "gran",
        NodeKind::Shift => "shft",
        NodeKind::Comp => "comp",
        NodeKind::Duck => "duck",
        NodeKind::Gate => "gate",
        NodeKind::Vocoder => "voc",
        NodeKind::Track => "trk",
        NodeKind::Capture => "cap",
    };
    let saw = || default_fragment(NodeKind::Vco);
    for kind in NodeKind::ALL {
        let sig = over_saw(kind).signature();
        let want = if kind.is_source() || kind == NodeKind::Capture {
            tag(kind).to_string()
        } else {
            format!("saw·{}", tag(kind))
        };
        assert_eq!(sig, want, "{kind:?}");
    }
    // The selectors that name the module's sound.
    let filter = |kind| AudioNode::Filter {
        uid: Uid::NEW,
        kind,
        cutoff: 0.5,
        resonance: 0.2,
        mod_depth: 0.0,
        input: Box::new(saw()),
        modulation: ModNode::None,
    };
    let tags: Vec<String> = FilterKind::ALL.map(|k| voice(filter(k)).signature()).into();
    assert_eq!(tags, ["saw·lp", "saw·bp", "saw·hp", "saw·ladr"]);
    let drive = |mode| AudioNode::Distortion {
        uid: Uid::NEW,
        mode,
        drive: 0.4,
        tone: 0.5,
        mod_depth: 0.0,
        input: Box::new(saw()),
        modulation: ModNode::None,
    };
    let tags: Vec<String> = DriveMode::ALL.map(|m| voice(drive(m)).signature()).into();
    assert_eq!(tags, ["saw·drv", "saw·clip", "saw·tube"]);
    let table = |table| AudioNode::Wavetable {
        uid: Uid::NEW,
        table,
        octave: 0,
        morph: 0.3,
        mod_depth: 0.0,
        modulation: ModNode::None,
    };
    let tags: Vec<String> = TableShape::ALL.map(|t| voice(table(t)).signature()).into();
    assert_eq!(
        tags,
        ["wsin", "wtri", "wsaw", "wsqr", "wpul", "wpul", "wfmt", "wfmt"]
    );
    let wave = |wave| AudioNode::Vco {
        uid: Uid::NEW,
        wave,
        octave: 0,
        detune: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
    };
    let tags: Vec<String> = Waveform::ALL.map(|w| voice(wave(w)).signature()).into();
    assert_eq!(tags, ["sin", "tri", "saw", "sqr"]);
    // Six on the spine: the first two are counted.
    let mut deep = voice(saw());
    for kind in [
        NodeKind::Filter,
        NodeKind::Fold,
        NodeKind::Delay,
        NodeKind::Chorus,
        NodeKind::Reverb,
    ] {
        let op = StructOp::Insert {
            key: "node".into(),
            kind,
        };
        deep = apply_struct_op(&deep, &op).unwrap();
    }
    assert_eq!(deep.signature(), "2+·fold·dly·cho·rvb");
}

// ---------- takes ----------

fn capture(take: Take) -> AudioNode {
    AudioNode::Capture {
        uid: Uid::NEW,
        play: CaptureMode::Hold,
        input: Box::new(default_fragment(NodeKind::Vco)),
        take,
    }
}

fn unreadable() -> Take {
    serde_json::from_str(r#"{"format":"f32le-base64","sample_rate":48000,"length":3,"data":"!"}"#)
        .expect("an unreadable take still loads")
}

fn recorded(hz: f64) -> Take {
    let x: Vec<f32> = (0..480)
        .map(|i| (i as f64 * hz / 48_000.0).sin() as f32)
        .collect();
    Take::from_samples(&x, 48_000.0).unwrap()
}

/// Every CAPTURE's take under `n`, in walk order.
fn takes(n: &AudioNode) -> Vec<Take> {
    let mut out = Vec::new();
    if let AudioNode::Capture { take, .. } = n {
        out.push(take.clone());
    }
    for c in n.children() {
        out.extend(takes(c));
    }
    out
}

fn mix(a: AudioNode, b: AudioNode) -> AudioNode {
    AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(a),
        b: Box::new(b),
    }
}

/// **A sound whose take couldn't be read is kept safe, and can be recorded
/// again.** The first unreadable CAPTURE in walk order is the one a player
/// records again (`lost_take_key`); kept, an unreadable take is written back
/// as it was loaded, so a save loses nothing; a fresh recording fills that
/// CAPTURE and any other unreadable one is cleared to empty, and with none
/// left there is nothing to replace.
#[test]
fn a_lost_take_is_kept_and_can_be_recorded_again() {
    let mut tree = voice(mix(
        capture(recorded(330.0)),
        mix(capture(unreadable()), capture(unreadable())),
    ));
    assert_eq!(tree.lost_takes(), 2);
    assert_eq!(tree.lost_take_key().as_deref(), Some("node/1/0"));
    assert!(voice(capture(recorded(330.0))).lost_take_key().is_none());

    // Unkept, a lost take saves as nothing; kept, as what was loaded.
    assert!(!serde_json::to_string(&tree).unwrap().contains("\"!\""));
    tree.keep_unreadable_takes();
    let saved = serde_json::to_string(&tree).unwrap();
    assert_eq!(saved.matches(r#""data":"!""#).count(), 2, "{saved}");

    let fresh = recorded(440.0);
    assert!(tree.replace_lost_take(&fresh));
    assert_eq!(tree.lost_takes(), 0);
    assert_eq!(takes(&tree.root), [recorded(330.0), fresh, Take::empty()]);
    assert!(!tree.replace_lost_take(&recorded(550.0)));
}

/// **A rebuilt tree gets its recordings back**: a tree decoded from its
/// trace has every CAPTURE empty (a take is not a trace site), and
/// `inherit_takes` fills each from the CAPTURE at the same place in the
/// parent, but never over a take the tree already holds, and never into a
/// module that is not a CAPTURE there.
#[test]
fn a_rebuilt_tree_gets_its_recordings_back() {
    let parent = voice(mix(capture(recorded(330.0)), capture(recorded(220.0))));
    let mut child = PatchTree::from_trace(&parent.to_trace()).unwrap();
    assert!(!child.has_takes());
    child.inherit_takes(&parent);
    assert_eq!(child, parent);

    // A take the child already holds is newer than the parent's.
    let mut newer = voice(mix(capture(recorded(660.0)), capture(Take::empty())));
    newer.inherit_takes(&parent);
    assert_eq!(
        newer,
        voice(mix(capture(recorded(660.0)), capture(recorded(220.0))))
    );

    // Where the child has another module, nothing is carried there.
    let mut moved = voice(mix(default_fragment(NodeKind::Vco), capture(Take::empty())));
    moved.inherit_takes(&parent);
    assert_eq!(
        moved,
        voice(mix(
            default_fragment(NodeKind::Vco),
            capture(recorded(220.0))
        ))
    );
}

// ---------- identity, nested ----------

/// A filter whose slot holds a shaper over a pair of leaves: identities at
/// three depths of modulation.
fn nested(inner: ModNode) -> PatchTree {
    voice(AudioNode::Filter {
        uid: Uid::NEW,
        kind: FilterKind::SvfLp,
        cutoff: 0.5,
        resonance: 0.2,
        mod_depth: 0.4,
        input: Box::new(default_fragment(NodeKind::Vco)),
        modulation: ModNode::Op {
            uid: Uid::NEW,
            kind: ModOp::Slew,
            p0: 0.2,
            p1: 0.2,
            input: Box::new(ModNode::Pair {
                uid: Uid::NEW,
                kind: PairOp::Min,
                a: Box::new(inner),
                b: Box::new(ModNode::Env {
                    uid: Uid::NEW,
                    attack: 0.1,
                    decay: 0.4,
                }),
            }),
        },
    })
}

fn lfo() -> ModNode {
    ModNode::Lfo {
        uid: Uid::NEW,
        wave: Waveform::Sine,
        rate: 0.5,
    }
}

/// Every identity in a tree, modulation included, in walk order.
fn ids(t: &PatchTree) -> Vec<u64> {
    let mut out = Vec::new();
    crate::tests::identities(&t.root, &mut out);
    out
}

/// Clearing identities reaches every module, however deep in a modulation
/// term: the render memo's key is the cleared tree, so one identity left
/// behind would make the same sound two keys.
#[test]
fn clearing_identities_reaches_every_nested_module() {
    let mut t = nested(lfo());
    t.ensure_uids();
    assert_eq!(ids(&t).len(), 6);
    assert!(ids(&t).iter().all(|u| *u != 0));
    t.clear_uids();
    assert_eq!(ids(&t), [0; 6]);
}

/// **An identity is carried only to the same module.** Where a rebuilt
/// tree has the parent's module at the same place, it takes the parent's
/// identity, at every depth of modulation; where the module changed (an LFO
/// turned into a random source), the new one does not inherit the old one's
/// identity, so a lock on the LFO does not light the module that replaced
/// it.
#[test]
fn an_identity_is_carried_only_to_the_same_module() {
    let mut parent = nested(lfo());
    parent.ensure_uids();
    let theirs = ids(&parent);

    let mut same = parent.clone();
    same.clear_uids();
    same.inherit_uids(&parent);
    assert_eq!(ids(&same), theirs);

    let rand = ModNode::Rand {
        uid: Uid::NEW,
        rate: 0.5,
        glide: 0.1,
    };
    let mut changed = nested(rand);
    changed.inherit_uids(&parent);
    let mine = ids(&changed);
    // Walk order: filter, shaper, pair, LFO, envelope, VCO. All but the
    // LFO's place keep theirs; that place holds a new module with no
    // identity yet.
    let lfo_at = 3;
    for (i, (m, t)) in mine.iter().zip(&theirs).enumerate() {
        if i == lfo_at {
            assert_eq!(*m, 0, "the random source took the LFO's identity");
        } else {
            assert_eq!(m, t, "module {i}");
        }
    }
}
