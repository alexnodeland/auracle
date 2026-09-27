// PERFORM, in two minutes — a walkthrough over the real instrument.
//
// One recorded shot per beat (shots.json; tools/footage.mjs records them from
// apps/web with the app's own sound). The camera and the callouts are pinned to
// the narration's words and to the elements footage.mjs measured, so a
// re-timed voice or a moved control re-aims the film instead of breaking it.
import { walkthrough } from "../../stage/walk.js";

export async function build(stage) {
  await walkthrough(stage, {
    plan: [
      {
        beat: "intro",
        shot: "p-intro",
        chapter: "01 · perform",
        cam: [[0, 1.0, 0.5, 0.45], ["intro2", 1.06, 0.5, 0.35]],
        callouts: [{ at: "intro1:PERFORM", until: "intro2", mark: "tab", side: "bottom", dx: 150, dy: 110, text: "PERFORM" }],
      },
      {
        beat: "keys",
        shot: "p-keys",
        chapter: "02 · keys and MIDI",
        cam: [[0, 1.0, 0.5, 0.5], ["keys1:Play", 1.45, 0.5, 0.98], ["keys1:MIDI", 1.5, 0.92, 0.82], ["keys2+1.5", 1.2, 0.8, 0.7]],
        callouts: [
          { at: "keys1:Play+0.3", until: "keys1:MIDI", mark: "keybed", side: "top", ox: -260, dx: -60, dy: -120, text: "your computer keyboard, A to L" },
          { at: "keys1:MIDI+0.5", mark: "panel", side: "left", dx: -220, dy: -60, text: "the first eight knobs claim the controls" },
        ],
      },
      {
        beat: "named",
        shot: "p-named",
        chapter: "03 · named for what you hear",
        cam: [[0, 1.0, 0.5, 0.5], ["named1:Bright-0.4", 1.28, 0.5, 0.22], ["named2", 1.28, 0.5, 0.22], ["named2:measures", 1.12, 0.5, 0.45]],
        callouts: [{ at: "named2:measures", mark: "status", side: "right", dx: 90, dy: 30, text: "measured for this patch" }],
      },
      {
        beat: "hood",
        shot: "p-hood",
        chapter: "04 · under the hood",
        cam: [[0, 1.0, 0.5, 0.5], ["hood1:Turn", 1.18, 0.5, 0.3], ["hood1:strip", 1.35, 0.72, 0.86]],
        callouts: [{ at: "hood1:strip+0.3", mark: "hood", side: "top", ox: 180, dx: 140, dy: -70, text: "the real knobs it moves" }],
      },
      {
        beat: "amber",
        shot: "p-amber",
        cam: [[0, 1.0, 0.5, 0.5], ["hood2:amber-0.3", 1.3, 0.62, 0.22], ["hood2:anyway+1.2", 1.12, 0.6, 0.45]],
        callouts: [{ at: "hood2:amber", mark: "grit", side: "bottom", dx: 60, dy: 150, text: "this patch can't — yet", color: "b" }],
      },
      {
        beat: "xy",
        shot: "p-xy",
        chapter: "05 · the XY pad",
        cam: [[0, 1.0, 0.5, 0.5], ["xy1", 1.45, 0.22, 0.86]],
        callouts: [{ at: "xy1:two", mark: "xy", side: "right", dx: 120, dy: -40, text: "two controls, one finger" }],
      },
      {
        beat: "wander",
        shot: "p-wander",
        chapter: "06 · wander",
        cam: [[0, 1.0, 0.5, 0.5], ["wander1", 1.3, 0.9, 0.25], ["wander2:More", 1.25, 0.7, 0.8]],
        callouts: [{ at: "wander1:Wander", until: "wander2:More", mark: "wander", side: "bottom", dx: -120, dy: 140, text: "Wander" }],
      },
      {
        beat: "offer",
        shot: "p-offer",
        chapter: "07 · offers",
        cam: [[0, 1.0, 0.5, 0.5], ["offer1:Press", 1.22, 0.5, 0.55], ["offer2:Blend", 1.18, 0.75, 0.35]],
        callouts: [
          { at: "offer1:slot", until: "offer2:Blend", mark: "offer", side: "top", ox: -300, dx: 40, dy: -80, text: "B: the offer, growing" },
          { at: "offer2:Blend+0.2", mark: "blend", side: "bottom", dx: 80, dy: 140, text: "Blend" },
        ],
      },
      {
        beat: "take",
        shot: "p-take",
        cam: [[0, 1.0, 0.5, 0.5], ["take1:Take", 1.2, 0.55, 0.55], ["take2", 1.0, 0.5, 0.5]],
        callouts: [{ at: "take2+0.2", mark: "toast", side: "top", dx: -160, dy: -90, text: "either answer is a pick", color: "b" }],
      },
      {
        beat: "keep",
        shot: "p-keep",
        chapter: "08 · keep and back",
        cam: [[0, 1.0, 0.5, 0.5], ["keep1:Keep", 1.2, 0.3, 0.55]],
        callouts: [
          { at: "keep1:Keep", until: "keep1:Back", mark: "keep", side: "top", dx: 40, dy: -110, text: "Keep" },
          { at: "keep1:Back", mark: "back", side: "top", dx: 40, dy: -110, text: "Back" },
        ],
      },
      {
        beat: "outro",
        shot: "p-outro",
        cam: [[0, 1.0, 0.5, 0.5], ["outro2", 1.0, 0.5, 0.5]],
        callouts: [{ at: "outro2:PATCH", mark: "patch-tab", side: "bottom", dx: 120, dy: 110, text: "PATCH" }],
      },
    ],
  });
}
