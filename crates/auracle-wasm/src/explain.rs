//! Explain anything (Plan-005 task 10, RFC-006 §9): the data each control's
//! figure draws, and the lesson on filters, rendered from the sound in hand.
//!
//! A PERFORM control is a direction in φ wired onto this patch's knobs, so
//! what it does is measured, not drawn from a recipe: the page sends the
//! performed state twice (the control at its centre and turned, each as knob
//! `overrides`), and [`WasmEngine::explain_render`] renders each and posts its
//! portrait ([`auracle_features::explain`]) and where it measures along the
//! control. The lesson puts a lowpass from the grammar on the sound in hand
//! ([`WasmEngine::lesson_filter`]): the filtered render, its portrait, and the
//! filter's own response, from quiver's filter as the compiler wires it.
//! Nothing here touches the pool, the bench or the log.

use auracle_features::{
    audio_features, explain, featurize, normalize_to, vet, AudioFeatures, RenderedPhrase,
    VetConfig, VetFailure, TARGET_LUFS,
};
use auracle_grammar::term::FilterKind;
use auracle_grammar::{cutoff_hz, lowpass_apply, lowpass_response, AudioNode, ModNode, Uid};
use auracle_session::perform::{direction, insert_at_output, standardized_audio, PALETTE};
use wasm_bindgen::prelude::*;

use crate::level::audition_pcm;
use crate::{is_silent, performed_tree, WasmEngine};

/// The lesson filter's resonance knob: 0.345 is a damping of 1.41 on quiver's
/// filter (`2 − 2 · 0.85 · x`), a Butterworth lowpass, flat below its cutoff
/// and 3 dB down at it: "the cutoff is where the cutting starts" is then true
/// of the curve the lesson draws.
pub const LESSON_RESONANCE: f64 = 0.345;
/// Samples of the filter's impulse response: 0.19 s at 44.1 kHz, long enough
/// for the lowest cutoff's response to ring out.
const RESPONSE_LEN: usize = 8192;

/// A render for the page: its JSON, and its audition to play.
#[wasm_bindgen]
pub struct ExplainRender {
    json: String,
    samples: Vec<f32>,
}

#[wasm_bindgen]
impl ExplainRender {
    /// The reply as JSON (see [`WasmEngine::lesson_filter`]).
    #[wasm_bindgen(getter)]
    pub fn json(&self) -> String {
        self.json.clone()
    }

    /// The audition at the app's level policy (`audition_pcm`), emptying the
    /// render so it can be transferred.
    pub fn take_samples(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.samples)
    }
}

fn reason(e: &auracle_features::FeaturizeError) -> &'static str {
    if is_silent(e) {
        "silent"
    } else {
        "vet"
    }
}

#[wasm_bindgen]
impl WasmEngine {
    /// The performed state (`tree` plus knob `overrides`, as for
    /// `perform_wire`) rendered and measured for a figure: `{portrait,
    /// along}`, where `portrait` is [`auracle_features::explain::Portrait`]
    /// and `along` is where it measures on palette control `k`'s direction in
    /// σ (the same number as a wiring's `position`), or `null` with no `k` or
    /// before the session has a standardizer. `{error}` when it does not
    /// render: `no_tree`, `silent` or `vet`. One render.
    pub fn explain_render(&self, tree_json: &str, overrides_json: &str, k: Option<u32>) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return serde_json::json!({ "error": "no_tree" }).to_string();
        };
        match featurize(&tree, &self.engine.cfg.phrase) {
            Err(e) => serde_json::json!({ "error": reason(&e) }).to_string(),
            Ok(v) => {
                let along = k
                    .and_then(|k| PALETTE.get(k as usize))
                    .zip(self.engine.standardizer())
                    .map(|(c, std)| {
                        let names: Vec<String> =
                            AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
                        let z = standardized_audio(&v.features, std);
                        direction(c, &names)
                            .iter()
                            .zip(&z)
                            .map(|(a, b)| a * b)
                            .sum::<f64>()
                    });
                serde_json::json!({
                    "portrait": explain::portrait(&v.render, &v.features.audio),
                    "along": along,
                })
                .to_string()
            }
        }
    }

    /// The lesson on filters: the performed state with a lowpass from the
    /// grammar (`Filter` `SvfLp`, resonance [`LESSON_RESONANCE`]) at `cutoff`
    /// (its knob, 0–1) put on its output, below any stereo effect that ends
    /// the chain; with no `cutoff`, the performed state as it is (the
    /// lesson's first step, and what the filtered one is drawn against).
    ///
    /// A patch with no room for one more module (the grammar's size
    /// ceilings: one in nine pool draws, none of the presets) still gets its
    /// lesson: the filter then follows the whole voice
    /// ([`auracle_grammar::lowpass_apply`] on the rendered phrase), at the
    /// corner the knob sets on the held note for every note, since nothing
    /// keytracks it there, and the result is normalized again as every
    /// render is. `placement` says which: `inside` the patch, or `after` it.
    ///
    /// Its JSON is `{cutoff, cutoff_hz, response, placement, portrait}`: the
    /// knob, its corner on the held note in Hz, the filter's gain in each of
    /// the portrait's bands (dB, from its impulse response), where it went,
    /// and the render's portrait; the first four `null` with no filter. When
    /// the sound does not render, `error` (`no_tree`, `silent`, `vet`) stands
    /// for the portrait. Its samples are the render's audition, at the level
    /// every audition plays at (normalized to −18 LUFS: a filtered sound is
    /// darker, not quieter). One render; the patch itself is not changed.
    pub fn lesson_filter(
        &self,
        tree_json: &str,
        overrides_json: &str,
        cutoff: Option<f64>,
    ) -> ExplainRender {
        let cutoff = cutoff.map(|c| {
            if c.is_finite() {
                c.clamp(0.0, 1.0)
            } else {
                0.5
            }
        });
        let phrase = &self.engine.cfg.phrase;
        let sr = phrase.sample_rate;
        let response = cutoff.map(|c| {
            explain::response_bands(&lowpass_response(c, LESSON_RESONANCE, sr, RESPONSE_LEN), sr)
        });
        let head = |extra: serde_json::Value| {
            let mut j = serde_json::json!({
                "cutoff": cutoff,
                "cutoff_hz": cutoff.map(cutoff_hz),
                "response": response,
            });
            if let (Some(o), Some(e)) = (j.as_object_mut(), extra.as_object()) {
                o.extend(e.clone());
            }
            j.to_string()
        };
        let fail = |why: &str| ExplainRender {
            json: head(serde_json::json!({ "error": why })),
            samples: Vec::new(),
        };
        let done =
            |r: &RenderedPhrase, phi: &AudioFeatures, placement: Option<&str>| ExplainRender {
                json: head(serde_json::json!({
                    "placement": placement,
                    "portrait": explain::portrait(r, phi),
                })),
                samples: audition_pcm(&r.to_audition()),
            };
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return fail("no_tree");
        };
        let Some(cutoff) = cutoff else {
            return match featurize(&tree, phrase) {
                Err(e) => fail(reason(&e)),
                Ok(v) => done(&v.render, &v.features.audio, None),
            };
        };
        let filter = AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff,
            resonance: LESSON_RESONANCE,
            mod_depth: 0.0,
            input: Box::new(AudioNode::Silence { uid: Uid::NEW }),
            modulation: ModNode::None,
        };
        if let Some(filtered) = insert_at_output(&tree, filter) {
            return match featurize(&filtered, phrase) {
                Err(e) => fail(reason(&e)),
                Ok(v) => done(&v.render, &v.features.audio, Some("inside")),
            };
        }
        // No room for one more module: the filter follows the whole voice.
        match featurize(&tree, phrase) {
            Err(e) => fail(reason(&e)),
            Ok(v) => {
                let mut r = v.render;
                lowpass_apply(&mut r.samples, cutoff, LESSON_RESONANCE, sr);
                if let Err(e) = vet(&r.samples, &VetConfig::for_spec(phrase)) {
                    return fail(if matches!(e, VetFailure::Silent { .. }) {
                        "silent"
                    } else {
                        "vet"
                    });
                }
                if normalize_to(&mut r.samples, sr, TARGET_LUFS).is_none() {
                    return fail("silent");
                }
                let phi = audio_features(&r);
                done(&r, &phi, Some("after"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine_with_patch() -> (WasmEngine, String) {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        let tree = engine.tree_json_of(id);
        (engine, tree)
    }

    /// A figure's render is the performed state's: its portrait is the
    /// portrait of that state's own featurization, and `along` is where it
    /// measures on the control, as a wiring's `position` is computed.
    #[test]
    fn a_figure_measures_the_performed_state() {
        let (engine, tree) = engine_with_patch();
        let reply: serde_json::Value =
            serde_json::from_str(&engine.explain_render(&tree, "[]", Some(0))).unwrap();
        let t: auracle_grammar::PatchTree = serde_json::from_str(&tree).unwrap();
        let v = featurize(&t, &engine.engine.cfg.phrase).unwrap();
        let want = serde_json::to_value(explain::portrait(&v.render, &v.features.audio)).unwrap();
        assert_eq!(reply["portrait"], want);
        let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
        let z = standardized_audio(&v.features, engine.engine.standardizer().unwrap());
        let along: f64 = direction(&PALETTE[0], &names)
            .iter()
            .zip(&z)
            .map(|(a, b)| a * b)
            .sum();
        assert!((reply["along"].as_f64().unwrap() - along).abs() < 1e-12);
        assert_eq!(
            reply["portrait"]["bands"].as_array().unwrap().len(),
            explain::BANDS
        );
        let none: serde_json::Value =
            serde_json::from_str(&engine.explain_render(&tree, "[]", None)).unwrap();
        assert!(none["along"].is_null());
        let bad: serde_json::Value =
            serde_json::from_str(&engine.explain_render("{", "[]", Some(0))).unwrap();
        assert_eq!(bad["error"], "no_tree");
    }

    /// The lesson's filter cuts what is above its cutoff, on the sound in
    /// hand: a lower cutoff leaves the top bands lower against the lows, and
    /// its response is the grammar's lowpass, a Butterworth.
    #[test]
    fn the_lesson_filter_darkens_the_sound_in_hand() {
        let (engine, tree) = engine_with_patch();
        let mut open = engine.lesson_filter(&tree, "[]", Some(0.95));
        let mut shut = engine.lesson_filter(&tree, "[]", Some(0.45));
        let (a, b): (serde_json::Value, serde_json::Value) = (
            serde_json::from_str(&open.json()).unwrap(),
            serde_json::from_str(&shut.json()).unwrap(),
        );
        assert!(a["error"].is_null() && b["error"].is_null(), "{a} {b}");
        assert!((b["cutoff_hz"].as_f64().unwrap() - cutoff_hz(0.45)).abs() < 1e-9);
        let top = |j: &serde_json::Value| -> f64 {
            let bands = j["portrait"]["bands"].as_array().unwrap();
            bands[34..].iter().map(|d| d.as_f64().unwrap()).sum::<f64>() / 6.0
        };
        assert!(top(&b) < top(&a) - 6.0, "{} vs {}", top(&b), top(&a));
        let want = explain::response_bands(
            &lowpass_response(0.45, LESSON_RESONANCE, 44_100.0, RESPONSE_LEN),
            44_100.0,
        );
        let got: Vec<f64> = b["response"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d.as_f64().unwrap())
            .collect();
        assert_eq!(got, want);
        // Butterworth: flat below the cutoff, about 3 dB down at it.
        let edges = explain::band_edges_hz();
        let at = |hz: f64| {
            (0..explain::BANDS)
                .find(|&k| edges[k] <= hz && hz < edges[k + 1])
                .unwrap()
        };
        let fc = cutoff_hz(0.45);
        assert!(want[at(fc / 8.0)].abs() < 0.5, "{want:?}");
        assert!((want[at(fc)] + 3.0).abs() < 1.5, "{want:?}");
        assert!(want[at(fc * 4.0)] < -20.0, "{want:?}");
        assert!(!open.take_samples().is_empty());
        assert!(!shut.take_samples().is_empty());
        // With no filter, it is the sound in hand as it is: the same render
        // a figure measures, and the same audition.
        let mut plain = engine.lesson_filter(&tree, "[]", None);
        let p: serde_json::Value = serde_json::from_str(&plain.json()).unwrap();
        let fig: serde_json::Value =
            serde_json::from_str(&engine.explain_render(&tree, "[]", None)).unwrap();
        assert!(p["cutoff"].is_null() && p["response"].is_null());
        assert!(p["placement"].is_null());
        assert_eq!(p["portrait"], fig["portrait"]);
        assert!(!plain.take_samples().is_empty());
        assert_eq!(b["placement"], "inside");
    }

    /// A patch with no room for one more module still gets its lesson: the
    /// filter follows the whole voice (`placement: "after"`), and still
    /// darkens it, as it would inside.
    #[test]
    fn a_patch_with_no_room_gets_the_filter_after_it() {
        let mut engine = WasmEngine::new(20_260_928, 60);
        while engine.fill_step(8) > 0 {}
        let ids: Vec<u32> = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked())
            .unwrap()
            .iter()
            .map(|r| r["id"].as_u64().unwrap() as u32)
            .collect();
        let full = ids
            .iter()
            .map(|&id| engine.tree_json_of(id))
            .find(|t| {
                let tree: auracle_grammar::PatchTree = serde_json::from_str(t).unwrap();
                let probe = AudioNode::Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfLp,
                    cutoff: 0.5,
                    resonance: LESSON_RESONANCE,
                    mod_depth: 0.0,
                    input: Box::new(AudioNode::Silence { uid: Uid::NEW }),
                    modulation: ModNode::None,
                };
                insert_at_output(&tree, probe).is_none()
            })
            .expect("a pool of 60 holds a patch at the size ceilings");
        let plain: serde_json::Value =
            serde_json::from_str(&engine.lesson_filter(&full, "[]", None).json()).unwrap();
        let mut r = engine.lesson_filter(&full, "[]", Some(0.4));
        let f: serde_json::Value = serde_json::from_str(&r.json()).unwrap();
        assert!(f["error"].is_null(), "{f}");
        assert_eq!(f["placement"], "after");
        assert!(!r.take_samples().is_empty());
        let centre =
            |j: &serde_json::Value| j["portrait"]["facts"]["centroid_hz"].as_f64().unwrap();
        assert!(
            centre(&f) < centre(&plain),
            "{} vs {}",
            centre(&f),
            centre(&plain)
        );
    }
}
