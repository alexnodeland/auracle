//! The presets' faces the app ships (`apps/web/preset-faces.json`, written by
//! the `preset_faces` example, `make preset-faces`).
//!
//! A face is the engine's picture of a render ([`auracle_features::face`]),
//! and a preset's render is fixed: the preset, the standard phrase and, for a
//! preset with an AUDIO IN, the clip it hears. In the browser each preset's
//! face was a render of its own in the engine worker's faces lane, which
//! waits for the fill, PERFORM's measurement of the sound in hand and every
//! background measurement. On an engine slowed four times the warm start's
//! nine faces came 415 s after its cards. So each is rendered here, once,
//! natively, through the bindings the worker asks a preset's face by, and the
//! page draws it from the file without asking the engine.
//!
//! A shipped face is valid where its render is the session's: under the same
//! render namespace (the stimulus, the featurizer's `RENDER_EPOCH`, the
//! quiver version) and, for a preset that listens, the same clip. The file
//! names both ([`PresetFaces::ns`], [`PresetFaces::clip`], the reference
//! clip), and the page uses a row only when they are the session's; anything
//! else is rendered, as it always was. `tests/shipped_faces.rs` fails when
//! the file is not what [`preset_faces`] renders today.

use auracle_features::face::{FACE_FLOOR_DB, FACE_HI_HZ, FACE_LO_HZ, FACE_STEP_DB};
use auracle_features::{cache_namespace, render_key, Face, PhraseSpec, FACE_BANDS, FACE_SLICES};
use auracle_grammar::preset_bank;
use serde::{Deserialize, Serialize};

use super::{fnv, par_map, preset_source, POOL, SEED};
use crate::WasmEngine;

/// What the file says of itself.
pub const ABOUT: &str = "Every preset's face on the standard phrase and the reference clip, rendered natively by `make preset-faces` (crates/auracle-wasm/examples/preset_faces.rs). Generated: do not edit. The page draws a preset's face from this when its render namespace (and, for a preset that listens, its clip) is the session's, and renders it otherwise.";

/// One preset's face, as the file ships it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresetFace {
    /// The preset's name, as the library names it.
    pub name: String,
    /// What the face was rendered from: [`preset_source`], its name and tree.
    pub source: String,
    /// Its render key on the standard phrase ([`render_key`]). The worker
    /// files a face under `"<ns>/<key>"`, a preset asked by its tree and the
    /// same preset in the pool alike, and the page files a shipped one there
    /// too, so they are one face.
    pub key: String,
    /// Whether it has an AUDIO IN: then its face is the reference clip's, and
    /// a session that captured a clip of its own renders its own.
    pub listens: bool,
    /// The face: its bytes, in base64 ([`Face`]'s own form).
    pub face: Face,
}

/// The file: what made its faces, then one row per preset, in library order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresetFaces {
    /// What the file is, for a reader.
    pub about: String,
    /// [`faces_fingerprint`] of what the faces were measured with.
    pub fingerprint: String,
    /// The render namespace they were rendered in ([`cache_namespace`] of
    /// the standard phrase): what the worker tells the page as `ns`.
    pub ns: String,
    /// The id of the clip a preset that listens heard: the reference clip.
    pub clip: String,
    /// The presets' faces.
    pub presets: Vec<PresetFace>,
}

impl PresetFaces {
    /// The file's text: the header on its first line, then one preset per
    /// line, so a regeneration diffs by preset.
    pub fn to_text(&self) -> String {
        let head = serde_json::json!({
            "about": self.about,
            "fingerprint": self.fingerprint,
            "ns": self.ns,
            "clip": self.clip,
        })
        .to_string();
        let rows: Vec<String> = self
            .presets
            .iter()
            .map(|p| serde_json::to_string(p).unwrap_or_default())
            .collect();
        format!(
            "{},\n\"presets\": [\n{}\n]}}\n",
            &head[..head.len() - 1],
            rows.join(",\n")
        )
    }
}

/// What a face is measured with, other than the preset: the render namespace
/// (the stimulus, `RENDER_EPOCH`, the quiver version), the clip a preset that
/// listens hears, and the face's own encoding (its bands, slices, range,
/// floor and step). A change to any of them makes every shipped face stale,
/// and the currency test says which by name, rendering nothing.
pub fn faces_fingerprint(phrase: &PhraseSpec) -> String {
    let text = format!(
        "{}\n{}\n{:?}",
        cache_namespace(phrase),
        phrase.audition_clip().id(),
        (
            FACE_BANDS,
            FACE_SLICES,
            FACE_LO_HZ,
            FACE_HI_HZ,
            FACE_FLOOR_DB,
            FACE_STEP_DB
        ),
    );
    fnv(text.as_bytes())
}

/// Every preset's face on the standard phrase and the reference clip, in
/// library order: each rendered on a fresh engine (its memo empty, so the
/// face is a render of its own) through the bindings the worker asks a
/// preset's face by (`preset_tree_json`, `face_of_tree`), on up to `threads`
/// threads. A preset that does not vet has no face, and no row: the currency
/// test names it.
pub fn preset_faces(threads: usize) -> PresetFaces {
    let bank = preset_bank();
    let phrase = WasmEngine::new(SEED, POOL).engine.cfg.phrase.clone();
    let indices: Vec<usize> = (0..bank.len()).collect();
    let rows = par_map(&indices, threads, |&i| {
        let e = WasmEngine::new(SEED, POOL);
        let tree = e.preset_tree_json(i);
        let face = Face::from_bytes(e.face_of_tree(&tree, true))?;
        let p = &bank[i];
        Some(PresetFace {
            name: p.name.to_owned(),
            source: preset_source(p.name, &p.tree),
            key: render_key(&p.tree, &phrase),
            listens: p.tree.listens(),
            face,
        })
    });
    PresetFaces {
        about: ABOUT.to_owned(),
        fingerprint: faces_fingerprint(&phrase),
        ns: cache_namespace(&phrase),
        clip: phrase.audition_clip().id().to_owned(),
        presets: rows.into_iter().flatten().collect(),
    }
}

#[cfg(test)]
mod tests;
