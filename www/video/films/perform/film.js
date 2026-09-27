// PERFORM, in two minutes — a walkthrough over the real instrument.
//
// A scaffold: the one beat below plays the pipeline's test shot
// (shots.json → test-bright). The full plan is written against footage of the
// polished app, one shot per beat of script.json.
import { walkthrough } from "../../stage/walk.js";

export async function build(stage) {
  walkthrough(stage, {
    plan: [
      {
        beat: "hood",
        shot: "test-bright",
        pre: 1.0,
        chapter: "03 · under the hood",
        cam: [[0, 1, 0.5, 0.5], ["hood1:Turn", 1.35, 0.52, 0.3], ["hood2", 1.0, 0.5, 0.5]],
        callouts: [{ at: "hood1:Turn", x: 640, y: 270, tx: 380, ty: 200, text: "Bright" }],
      },
    ],
  });
}
