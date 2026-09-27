// Open the circuit — a walkthrough of PATCH over the real instrument.
//
// One recorded shot per beat (shots.json; tools/footage.mjs). Callouts are
// pinned to the narration's words and to the elements footage.mjs measured.
import { walkthrough } from "../../stage/walk.js";

export async function build(stage) {
  await walkthrough(stage, {
    plan: [
      {
        beat: "intro",
        shot: "c-intro",
        chapter: "01 · the circuit",
        cam: [[0, 1.0, 0.5, 0.45], ["intro1:wired", 1.08, 0.5, 0.42]],
      },
      {
        beat: "rack",
        shot: "c-rack",
        chapter: "02 · the rack",
        cam: [[0, 1.0, 0.5, 0.45], ["rack1:true", 1.3, 0.5, 0.42], ["rack2", 1.3, 0.5, 0.42]],
        callouts: [
          { at: "rack1:hertz", until: "rack2", mark: "hertz", side: "bottom", dx: -60, dy: 130, text: "hertz" },
          { at: "rack1:seconds", until: "rack2", mark: "seconds", side: "top", dx: 40, dy: -110, text: "seconds" },
          { at: "rack1:decibels", until: "rack2", mark: "decibels", side: "bottom", dx: 60, dy: 120, text: "decibels" },
          { at: "rack2:Green", until: "rack2:pulses", mark: "cable", side: "top", dx: 40, dy: -110, text: "sound" },
          { at: "rack2:pulses", mark: "modulated", side: "top", dx: -80, dy: -120, text: "modulated: it pulses", color: "b" },
        ],
      },
      {
        beat: "edit",
        shot: "c-edit",
        chapter: "03 · every knob is an address",
        cam: [[0, 1.0, 0.5, 0.45], ["edit1:Turn-0.3", 1.45, 0.45, 0.42]],
        callouts: [{ at: "edit2:Lock", mark: "knob", side: "top", dx: 80, dy: -120, text: "locked: evolution leaves it", color: "b" }],
      },
      {
        beat: "bank",
        shot: "c-bank",
        chapter: "04 · the node bank",
        cam: [[0, 1.0, 0.5, 0.5], ["bank1:Hover", 1.25, 0.85, 0.55], ["bank1:Click", 1.05, 0.55, 0.5]],
        callouts: [{ at: "bank1:Hover+0.4", until: "bank1:Click", mark: "dock", side: "top", ox: -200, dx: -60, dy: -90, text: "what it does" }],
      },
      {
        beat: "steps",
        shot: "c-steps",
        chapter: "05 · steps",
        cam: [[0, 1.0, 0.5, 0.5], ["steps1:sequencer", 1.4, 0.5, 0.45]],
        callouts: [{ at: "steps1:eight", mark: "steps", side: "top", dx: 60, dy: -90, text: "eight steps, any knob" }],
      },
      {
        beat: "performed",
        shot: "c-performed",
        chapter: "06 · what PERFORM is turning",
        cam: [[0, 1.0, 0.5, 0.5], ["performed1:amber", 1.4, 0.5, 0.45]],
        callouts: [{ at: "performed1:amber", mark: "ghost", side: "top", dx: 90, dy: -110, text: "the value you hear", color: "b" }],
      },
      {
        beat: "evolve",
        shot: "c-evolve",
        chapter: "07 · the lineage",
        cam: [[0, 1.0, 0.5, 0.5], ["evolve1:lineage", 1.3, 0.5, 0.85]],
        callouts: [{ at: "evolve1:plain", mark: "lineage", side: "top", ox: -200, dx: 40, dy: -90, text: "what each generation changed", color: "b" }],
      },
      {
        beat: "outro",
        shot: "c-outro",
        cam: [[0, 1.08, 0.5, 0.45], ["outro1:Nothing", 1.0, 0.5, 0.5]],
      },
    ],
  });
}
