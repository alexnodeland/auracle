// Playing it — Auracle as an instrument, a walkthrough over the real app.
//
// One recorded shot per beat (shots.json; tools/footage.mjs records them from
// apps/web with the app's own sound). The camera and the callouts are pinned
// to the narration's words and to the elements footage.mjs measured, so a
// re-timed voice or a moved control re-aims the film instead of breaking it.
// `aim(z, x, y)` centres the camera on a point of the 1920×1080 app.
//
// Where this departs from storyboard.md, because the app does otherwise:
// - Every shot is one seeded session (shots.json `init`): the same pool and
//   the same warm-start cards. PERFORM still measures its wiring per session,
//   and the reach varies a little (Snap has reached up, down or both ways).
//   On Glass Pad, Grit is a search control in every run (turning it grows an
//   offer), so no beat turns Grit; the nudges go up and back on Motion and
//   Body, which reach upward in every run. Each shot logs its `wiring`.
// - A MIDI keyboard is plugged in through the app's `?film` port in every
//   shot; keys4 plays MIDI notes soft and hard, a bend and the sustain pedal,
//   and the midi beat maps three knobs, learns Space (not Grit, which would
//   grow an offer), then plays pressure, the mod wheel and clock at 96.
// - touch: the hood does not show per-note touch (it happens per voice, in
//   the worklet), so the callouts point at the struck key instead.
// - keep: the sound wanders out on Body and Bright, and comes back twice.
// - dock: HOLD latches before ARP opens its drawer (a click on HOLD folds the
//   drawer), the pointer rests on the drawer so the chord does not fold it,
//   and the chord lands on the score's beat (`snap`).
// - wander: Wander enters the offer zone on "Wander"; after 3.5 s of hands
//   off it asks for an idea, which takes seconds to grow, so the beat cuts
//   from "ideas" to just before it lands in B (the shot's `clips`; no cut
//   when it is quick). "More" then turns Wander on past the offer zone.
// - outro: the first chord sounds from the start to the first bar line, then
//   one chord a bar, on the score's bar lines.
import { walkthrough, aim } from "../../stage/walk.js";

export async function build(stage) {
  await walkthrough(stage, {
    plan: [
      {
        beat: "intro",
        shot: "pl-intro",
        chapter: "01 · an instrument",
        cam: [[0, 1.0, 0.5, 0.45], ["intro1:swells", ...aim(1.06, 1086, 420)]],
      },
      {
        beat: "keys",
        shot: "pl-keys",
        chapter: "02 · keys",
        cam: [[0, 1.0, 0.5, 0.5], ["keys1:rows-0.3", ...aim(1.45, 700, 830)], ["keys3:strike-0.6", ...aim(1.6, 890, 900)], ["keys4:MIDI-0.3", ...aim(1.5, 1650, 820)]],
        callouts: [
          { at: "keys1:octaves", until: "keys2", mark: "oct", side: "top", dx: 50, dy: -120, text: "z / x: octave" },
          { at: "keys2:accent", until: "keys3", mark: "keybed", side: "top", ox: -290, dx: -30, dy: -120, text: "shift: an accent" },
          { at: "keys3:strike+0.2", until: "keys3:harder", mark: "e4", side: "top", oy: 10, dx: 90, dy: -120, text: "near the top: soft" },
          { at: "keys3:harder", until: "keys4", mark: "e4", side: "bottom", oy: -8, dx: 110, dy: -190, text: "at the front edge: hard" },
          { at: "keys4:velocity", mark: "panel", side: "left", oy: -60, dx: -230, dy: -60, text: "velocity · bend · sustain" },
        ],
      },
      {
        beat: "touch",
        shot: "pl-touch",
        chapter: "03 · touch",
        cam: [[0, 1.0, 0.5, 0.5], ["touch1:touch-0.4", ...aim(1.35, 900, 750)]],
        callouts: [
          { at: "touch1:velocity", until: "touch2", mark: "touch", side: "top", ox: -120, dx: 40, dy: -100, text: "velocity → a named control" },
          { at: "touch2:soft", until: "touch2:hard", mark: "c4", side: "top", oy: 10, dx: -60, dy: -130, text: "soft: darker" },
          { at: "touch2:hard", mark: "c4", side: "bottom", oy: -8, dx: 90, dy: -190, text: "hard: brighter" },
        ],
      },
      {
        beat: "controls",
        shot: "pl-controls",
        chapter: "04 · the named controls",
        cam: [[0, 1.0, 0.5, 0.5], ["controls1:named-0.4", ...aim(1.28, 1086, 330)], ["controls3:ride-0.5", ...aim(1.12, 1086, 480)], ["controls4:press-0.2", ...aim(1.25, 1040, 400)]],
        callouts: [
          { at: "controls1:same", until: "controls2", mark: "deck", side: "bottom", ox: -300, dx: -40, dy: 110, text: "the same six names on every patch" },
          { at: "controls2:interrupts", until: "controls3", mark: "space", side: "bottom", dx: 60, dy: 130, text: "the note plays on" },
          { at: "controls3:swell", until: "controls4", mark: "hood", side: "top", ox: -150, dx: 60, dy: -80, text: "the real knobs it turns" },
          { at: "controls4:long", mark: "body", side: "bottom", dx: 80, dy: 140, text: "long press: hear it" },
        ],
      },
      {
        beat: "xy",
        shot: "pl-xy",
        chapter: "05 · the XY pad",
        cam: [[0, 1.0, 0.5, 0.5], ["xy1", ...aim(1.45, 800, 720)]],
        callouts: [
          { at: "xy1:Bright", mark: "xy", side: "right", dx: 90, dy: -40, text: "Bright →" },
          { at: "xy1:Motion", mark: "xy", side: "top", dx: 80, dy: -70, text: "Motion ↑" },
        ],
      },
      {
        beat: "wander",
        shot: "pl-wander",
        chapter: "06 · wander",
        cam: [[0, 1.0, 0.5, 0.5], ["wander1:Wander-0.4", ...aim(1.25, 1100, 300)], ["wander4:Freeze-0.4", ...aim(1.25, 1200, 380)]],
        callouts: [
          { at: "wander1:Wander", until: "wander2:More", mark: "wander", side: "bottom", dx: -120, dy: 140, text: "Wander" },
          { at: "wander2:ideas", until: "wander3", mark: "offer", side: "top", ox: -420, dx: 40, dy: -60, text: "B: ideas" },
          { at: "wander2:taste", until: "wander4", mark: "status", side: "right", dx: 90, dy: 24, text: "drifting toward your taste", color: "b" },
          { at: "wander4:Freeze", mark: "freeze", side: "top", dx: -60, dy: -90, text: "Freeze: held" },
        ],
      },
      {
        beat: "offer",
        shot: "pl-offer",
        chapter: "07 · offers",
        cam: [[0, 1.0, 0.5, 0.5], ["offer1:press-0.4", ...aim(1.22, 1086, 520)], ["offer3:Blend-0.3", ...aim(1.18, 1200, 400)], ["offer4:Take", ...aim(1.12, 1086, 560)]],
        callouts: [
          { at: "offer2:joins", until: "offer3:Blend", mark: "offer", side: "top", ox: -380, dx: 40, dy: -70, text: "B: the variant, in the chord you hold" },
          { at: "offer3:Peek", until: "offer3:Blend", mark: "peek", side: "top", dx: 40, dy: -100, text: "held: you hear B" },
          { at: "offer3:matched", until: "offer4", mark: "blend", side: "bottom", dx: 80, dy: 150, text: "Blend, at matched loudness" },
          { at: "offer4:teaches", mark: "toast", side: "top", dx: -160, dy: -90, text: "a heard answer is a pick", color: "b" },
        ],
      },
      {
        beat: "keep",
        shot: "pl-keep",
        chapter: "08 · keep and back",
        cam: [[0, 1.0, 0.5, 0.5], ["keep1:Keep-0.3", ...aim(1.2, 900, 420)], ["keep2:glides", ...aim(1.15, 1100, 520)]],
        callouts: [
          { at: "keep1:home", until: "keep2:Back", mark: "keep", side: "top", dx: 40, dy: -110, text: "home" },
          { at: "keep2:glides", mark: "back", side: "top", dx: 40, dy: -110, text: "glides back" },
        ],
      },
      {
        beat: "dock",
        shot: "pl-dock",
        chapter: "09 · the dock",
        cam: [[0, 1.0, 0.5, 0.5], ["dock1:Hold-0.4", ...aim(1.6, 400, 950)], ["dock2:Glide-0.3", ...aim(1.6, 1500, 950)], ["dock3:arpeggiator-0.2", ...aim(1.5, 420, 880)], ["dock4:Sync-0.2", ...aim(1.5, 420, 920)]],
        callouts: [
          { at: "dock1:Hold", until: "dock1:Unison", mark: "hold", side: "top", dx: 30, dy: -110, text: "hold: latched" },
          { at: "dock1:Unison", until: "dock2", mark: "uni", side: "top", dx: 50, dy: -110, text: "unison: four voices, one note" },
          { at: "dock2:Glide", until: "dock3", mark: "glide", side: "top", dx: -60, dy: -110, text: "glide" },
          { at: "dock3:up", until: "dock4", mark: "drawer", side: "top", dx: 60, dy: -70, text: "up · down · up·down" },
          { at: "dock3:tempo", until: "dock4", mark: "tempo", side: "right", dx: 80, dy: -50, text: "the tempo: 84" },
          { at: "dock4:Sync", mark: "sync", side: "top", dx: 40, dy: -110, text: "sync: steps on the tempo" },
        ],
      },
      {
        beat: "midi",
        shot: "pl-midi",
        chapter: "10 · MIDI",
        cam: [[0, 1.0, 0.5, 0.5], ["midi1:controller-0.3", ...aim(1.3, 1400, 780)]],
        callouts: [
          { at: "midi1:claim", until: "midi1:Learn", mark: "rows", side: "left", oy: -90, dx: -200, dy: -40, text: "the first eight claim the eight" },
          { at: "midi1:Learn+0.3", until: "midi2", mark: "toast", side: "top", dx: -120, dy: -80, text: "Learn: any knob, any control" },
          { at: "midi2:Pressure", until: "midi2:mod", mark: "hood", side: "top", ox: -220, dx: -40, dy: -90, text: "pressure → Bright" },
          { at: "midi2:mod", until: "midi2:clock", mark: "motion", side: "bottom", dx: 60, dy: 130, text: "mod wheel → Motion" },
          { at: "midi2:clock+0.8", mark: "clock", side: "left", dx: -170, dy: -60, text: "the tempo follows the clock" },
        ],
      },
      {
        beat: "booth",
        shot: "pl-booth",
        chapter: "11 · booth mode",
        cam: [[0, 1.0, 0.5, 0.5]],
        callouts: [
          { at: "booth1:itself", until: "booth2", mark: "attract", side: "bottom", dx: 60, dy: 110, text: "attract: it plays itself" },
          { at: "booth2:hands", mark: "deck", side: "bottom", ox: -300, dx: -40, dy: 120, text: "any key, click or touch" },
        ],
      },
      {
        beat: "outro",
        shot: "pl-outro",
        cam: [[0, 1.0, 0.5, 0.5], ["outro1", 1.04, 0.5, 0.45]],
      },
    ],
  });
}
