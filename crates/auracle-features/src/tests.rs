//! The crate's shared test fixtures: the small patches several modules'
//! tests build on.

use auracle_grammar::term::{AmpEnv, AudioNode, ModNode, Uid, Waveform};
use auracle_grammar::PatchTree;

pub(crate) fn amp() -> AmpEnv {
    AmpEnv {
        attack: 0.05,
        decay: 0.3,
        sustain: 0.8,
        release: 0.3,
    }
}

pub(crate) fn vco(wave: Waveform) -> PatchTree {
    PatchTree {
        amp: amp(),
        root: AudioNode::Vco {
            uid: Uid::NEW,
            wave,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
        },
    }
}
