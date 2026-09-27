// Sound design with it — from a preset to a sound of your own, a walkthrough
// over the real app.
//
// One recorded shot per beat (shots.json; tools/footage.mjs). The camera and
// the callouts are pinned to the narration's words and to the elements
// footage.mjs measured. The evolve beat cuts inside itself (the shot's
// `clips`): the ⚡ press, then the child it benched tens of seconds later.
// `aim(z, x, y)` centres the camera on a point of the 1920×1080 app.
//
// Where this departs from storyboard.md, because the app does otherwise:
// - Every shot is one seeded, taught session (shots.json `init` and set-up).
// - evolve: the ⚡ press is on camera; the beat cuts to the benched child.
// - The spec card fills the strip under the rack (#spec-dock), not #nb-spec.
// - chains: Ask The Dice's filter slot is `.jack[data-modkey='node']` (a mod
//   socket is keyed by its owner); the slew is dropped on it, where the mod
//   env already is, and the callout points at the slew that now holds it.
// - open3 turns the resonance on "updates", so the guess moves on camera.
// - commit: ▶ plays "the original" and "your edit" by name (the sides are
//   shuffled); auditions are not in the recorded sound (see footage.mjs).
// - undo: the held chorus is dragged back onto a socket at the end.
import { walkthrough, aim } from "../../stage/walk.js";

export async function build(stage) {
  await walkthrough(stage, {
    plan: [
      {
        beat: "intro",
        shot: "sd-intro",
        chapter: "01 · from a preset",
        cam: [[0, 1.0, 0.5, 0.45], ["intro1:end", ...aim(1.06, 940, 450)]],
        callouts: [{ at: "intro1:preset", until: "intro1:end", mark: "subject", side: "right", dx: 80, dy: 24, text: "a preset: Glass Pad" }],
      },
      {
        beat: "open",
        shot: "sd-open",
        chapter: "02 · the circuit",
        cam: [[0, 1.0, 0.5, 0.5], ["open1:edit-0.4", ...aim(1.4, 1000, 400)], ["open3-0.2", ...aim(1.2, 900, 330)]],
        callouts: [
          { at: "open2:hertz", until: "open3", mark: "hz", side: "bottom", dx: -60, dy: 130, text: "hertz" },
          { at: "open2:milliseconds", until: "open3", mark: "ms", side: "bottom", dx: 60, dy: 120, text: "milliseconds" },
          { at: "open2:decibels", until: "open3", mark: "db", side: "top", dx: -40, dy: -110, text: "decibels" },
          { at: "open3:guess", mark: "belief", side: "bottom", ox: -300, dx: 40, dy: 90, text: "recomputed from the bench as you edit", color: "b" },
        ],
      },
      {
        beat: "lock",
        shot: "sd-lock",
        chapter: "03 · locks",
        cam: [[0, 1.0, 0.5, 0.5], ["lock1:dot-0.8", ...aim(1.35, 1000, 380)], ["lock2-0.3", ...aim(1.3, 1450, 300)]],
        callouts: [
          { at: "lock1:dot", until: "lock1:square", mark: "cut", side: "top", ox: 28, oy: 8, dx: 50, dy: -100, text: "one knob, by its dot" },
          { at: "lock1:square", until: "lock2", mark: "square", side: "top", dx: 60, dy: -100, text: "the whole module, by its ▢" },
          { at: "lock2:knob", mark: "knobs", side: "bottom", dx: -80, dy: 110, text: "every knob · all the wiring" },
        ],
      },
      {
        beat: "evolve",
        shot: "sd-evolve",
        chapter: "04 · ⚡ evolve from this",
        cam: [[0, 1.0, 0.5, 0.5], ["evolve1-0.2", ...aim(1.4, 1500, 260)], ["evolve2", ...aim(1.15, 1000, 400)]],
        callouts: [
          { at: "evolve1:Evolve", until: "evolve2", mark: "evolve", side: "bottom", dx: -80, dy: 110, text: "⚡ evolve from this" },
          { at: "evolve2:unlocked", mark: "chorus", side: "top", dx: 60, dy: -90, text: "locked: unchanged" },
          { at: "evolve2:bench", mark: "subject", side: "bottom", dx: 80, dy: 110, text: "one child, on the bench", color: "b" },
        ],
      },
      {
        beat: "bank",
        shot: "sd-bank",
        chapter: "05 · the node bank",
        cam: [[0, 1.0, 0.5, 0.5], ["bank1:click-0.4", ...aim(1.2, 1250, 480)], ["bank3-0.3", ...aim(1.35, 950, 420)], ["bank4:play-0.3", ...aim(1.3, 900, 700)]],
        callouts: [
          { at: "bank2:hand", until: "bank3", mark: "delay", side: "left", dx: -140, dy: -40, text: "in your hand" },
          { at: "bank2:lights", until: "bank3", mark: "status", side: "top", dx: -60, dy: -70, text: "every socket it fits" },
          { at: "bank3:Green", until: "bank3:Amber", mark: "green", side: "top", dx: 40, dy: -110, text: "green: inserts after" },
          { at: "bank3:Amber+0.5", until: "bank4:play", mark: "amber", side: "top", dx: -40, dy: -110, text: "amber: replaces", color: "b" },
          { at: "bank4:play", mark: "play", side: "top", dx: 60, dy: -90, text: "a preview, not a placement" },
        ],
      },
      {
        beat: "spec",
        shot: "sd-spec",
        chapter: "06 · the card",
        cam: [[0, 1.0, 0.5, 0.5], ["spec1:card-0.3", ...aim(1.5, 950, 780)]],
        callouts: [
          { at: "spec1:does", until: "spec1:arrives", mark: "blurb", side: "top", dx: 40, dy: -80, text: "what it does" },
          { at: "spec1:arrives", until: "spec2", mark: "params", side: "bottom", dx: 40, dy: 80, text: "what it arrives set to" },
          { at: "spec2:believes", until: "spec3", mark: "model", side: "top", dx: -40, dy: -90, text: "what the model believes", color: "b" },
          { at: "spec3:cannot", mark: "heard", side: "bottom", dx: 60, dy: 80, text: "what it cannot hear", color: "b" },
        ],
      },
      {
        beat: "chains",
        shot: "sd-chains",
        chapter: "07 · modulation chains",
        cam: [[0, 1.0, 0.5, 0.5], ["chains2-0.3", ...aim(1.4, 700, 560)], ["chains4-0.3", ...aim(1.25, 900, 420)]],
        callouts: [
          { at: "chains2:sample", until: "chains3", mark: "rand", side: "bottom", dx: -40, dy: 110, text: "sample and hold" },
          { at: "chains2:quantizer", until: "chains3", mark: "quantize", side: "bottom", dx: 40, dy: 110, text: "quantize: root A · minor" },
          { at: "chains2:slew", until: "chains3", mark: "slew", side: "top", dx: 40, dy: -90, text: "slew" },
          { at: "chains4:wraps+0.2", mark: "wrapped", side: "top", dx: 60, dy: -90, text: "wrapped, not replaced" },
        ],
      },
      {
        beat: "commit",
        shot: "sd-commit",
        chapter: "08 · commit",
        cam: [[0, 1.0, 0.5, 0.5], ["commit3-0.2", ...aim(1.4, 1100, 250)]],
        callouts: [
          { at: "commit1:random", until: "commit2", mark: "card", side: "top", dx: 60, dy: -60, text: "sides shuffled" },
          { at: "commit2:Either+0.4", until: "commit3", mark: "toast", side: "top", dx: -120, dy: -80, text: "heard, and taught" },
          { at: "commit3:tick", until: "commit4", mark: "tick", side: "bottom", dx: -60, dy: 110, text: "my edit is better" },
          { at: "commit4:claim", mark: "tick", side: "bottom", dx: -60, dy: 110, text: "filed as a claim · scored apart in TRUST", color: "b" },
        ],
      },
      {
        beat: "undo",
        shot: "sd-undo",
        chapter: "09 · undo, and held",
        cam: [[0, 1.0, 0.5, 0.5], ["undo1-0.2", ...aim(1.4, 1000, 380)], ["undo2:bypass-0.2", ...aim(1.2, 1000, 620)]],
        callouts: [
          { at: "undo1:undo", until: "undo2", mark: "res", side: "top", dx: 50, dy: -100, text: "⌘Z: back one step" },
          { at: "undo2:held", until: "undo2:reload", mark: "item", side: "top", dx: 60, dy: -90, text: "held, with its settings" },
          { at: "undo2:reload", mark: "tray", side: "top", ox: 200, dx: 60, dy: -90, text: "kept across a reload" },
        ],
      },
      {
        beat: "lineage",
        shot: "sd-lineage",
        chapter: "10 · the lineage",
        cam: [[0, 1.0, 0.5, 0.5], ["lineage1-0.2", ...aim(1.5, 1000, 900)]],
        callouts: [
          { at: "lineage1:edits", until: "lineage2", mark: "lineage", side: "top", ox: -300, dx: 40, dy: -80, text: "✎ your edits · ⚡ evolution's steps" },
          { at: "lineage2:estimate", mark: "lineage", side: "top", ox: 200, dx: 40, dy: -80, text: "Δtaste: how far the estimate moved", color: "b" },
        ],
      },
      {
        beat: "outro",
        shot: "sd-outro",
        cam: [[0, 1.0, 0.5, 0.5], ["outro1", 1.05, 0.5, 0.42]],
      },
    ],
  });
}
