// Composing with it — growing a palette for a piece, a walkthrough over the
// real app.
//
// One recorded shot per beat (shots.json; tools/footage.mjs). The camera and
// the callouts are pinned to the narration's words and to the elements
// footage.mjs measured. The evolve beat cuts inside itself (the shot's
// `clips`): the press, then the generation it bred, tens of seconds later.
// `aim(z, x, y)` centres the camera on a point of the 1920×1080 app.
//
// Where this departs from storyboard.md, because the app does otherwise:
// - Every shot is one seeded session (shots.json `init`), so the warm start
//   always deals the same nine cards; this film picks Acid Line, Sea Change
//   and Glass Rain by name (a bass, a pad, a moving texture). The warm start
//   also saves its three picks, so the keep beat's save is 4 of 10.
// - direction: "teach it" takes seconds and then switches to PERFORM, so the
//   beat cuts from the press to when it has taught, then votes.
// - evolve: the generation runs on camera; the beat cuts from the press to
//   the bred generation (no generation is run off camera first).
// - steps: a mod socket is keyed by its owner (`.jack[data-modkey='node/1']`
//   on Sub & Sparkle's high-pass), not by the slot's path.
// - clock: the clock runs at the bed's 84 BPM (not 96), with Start on the bar
//   line nearest "start", so the arpeggio and the steps land on the music.
// - parts (scenes): not taught, so My Patches holds just the three saved
//   (First Bass, Loom, Glass Pad), and Glass Pad, the last, is played: `[`
//   steps back to Loom, then to First Bass. A step lands once the engine has
//   opened the patch (seconds on a busy machine), so the second `[` waits
//   for the first to land.
// - record: ● rec is not pressed on camera (the shot's capture is the same
//   recorder). The part is played, then the capture itself is stopped
//   (`rec`), so the take's real "saved … take" toast is the result shown.
// - share: both exports are real clicks now (their downloads are not the
//   shot's sound); the drop is a fixture picture of First Bass, so the rack
//   visibly changes to the dropped patch.
import { walkthrough, aim } from "../../stage/walk.js";

export async function build(stage) {
  await walkthrough(stage, {
    plan: [
      {
        beat: "intro",
        shot: "co-intro",
        chapter: "01 · a palette",
        cam: [[0, 1.0, 0.5, 0.45], ["intro2", ...aim(1.06, 900, 520)]],
        callouts: [
          { at: "intro1:bass", until: "intro1:pad", mark: "subject", side: "right", dx: 80, dy: 24, text: "a bass" },
          { at: "intro1:pad+0.2", until: "intro1:texture", mark: "subject", side: "right", dx: 80, dy: 24, text: "a pad" },
          { at: "intro1:texture+0.2", mark: "subject", side: "right", dx: 80, dy: 24, text: "a moving texture" },
        ],
      },
      {
        beat: "direction",
        shot: "co-direction",
        chapter: "02 · point it",
        cam: [[0, 1.0, 0.5, 0.5], ["direction1-0.2", 1.15, 0.5, 0.5], ["direction3:duels", 1.0, 0.5, 0.5]],
        callouts: [
          { at: "direction1:nine", until: "direction2", mark: "grid", side: "top", ox: -200, dx: 40, dy: -60, text: "one per family, then filled" },
          { at: "direction2:eighteen", until: "direction3", mark: "go", side: "top", dx: -80, dy: -90, text: "3 picks × 6 passed = 18" },
          { at: "direction3:data", mark: "mid", side: "bottom", dx: 60, dy: 110, text: "the forecast, then your pick", color: "b" },
        ],
      },
      {
        beat: "evolve",
        shot: "co-evolve",
        chapter: "03 · evolve",
        cam: [[0, 1.0, 0.5, 0.5], ["evolve1:Press-0.4", ...aim(1.3, 1500, 300)], ["evolve2", ...aim(1.25, 1100, 800)], ["evolve3", ...aim(1.25, 500, 500)]],
        callouts: [
          { at: "evolve1:ten", until: "evolve2", mark: "btn", side: "bottom", dx: -80, dy: 110, text: "breeds from its ten best" },
          { at: "evolve2:resemble", until: "evolve3", mark: "lineage", side: "top", ox: -300, dx: 40, dy: -80, text: "what each child changed", color: "b" },
          { at: "evolve3:weakest", mark: "fresh", side: "right", dx: 90, dy: -40, text: "new; the lowest guesses left" },
        ],
      },
      {
        beat: "keep",
        shot: "co-keep",
        chapter: "04 · keep it",
        cam: [[0, 1.0, 0.5, 0.5], ["keep1:save-0.4", ...aim(1.35, 520, 480)]],
        callouts: [
          { at: "keep2:never", until: "keep3", mark: "budget", side: "bottom", dx: 60, dy: 100, text: "never replaced · at most a quarter of the pool" },
          { at: "keep3:teach", until: "keep3:name", mark: "stars", side: "right", dx: 90, dy: 30, text: "a rating teaches; a save does not", color: "b" },
          { at: "keep3:part", mark: "row", side: "right", dx: 90, dy: -30, text: "named for its part" },
        ],
      },
      {
        beat: "steps",
        shot: "co-steps",
        chapter: "05 · steps",
        cam: [[0, 1.0, 0.5, 0.5], ["steps1:Steps-0.3", 1.1, 0.7, 0.4], ["steps2", 1.4, 0.45, 0.62], ["steps3:Sync-0.2", ...aim(1.3, 700, 760)]],
        callouts: [
          { at: "steps1:Steps+0.2", until: "steps1:filter", mark: "steps", side: "left", dx: -120, dy: -40, text: "Steps, in your hand" },
          { at: "steps2:eight", until: "steps3", mark: "lane", side: "top", dx: 60, dy: -80, text: "up to eight; length picks how many play" },
          { at: "steps3:division", until: "steps4", mark: "bpm", side: "top", dx: 40, dy: -90, text: "the tempo: 84" },
          { at: "steps4:first", mark: "lane", side: "top", dx: -60, dy: -80, text: "from step one" },
        ],
      },
      {
        beat: "arp",
        shot: "co-arp",
        chapter: "06 · the arpeggiator",
        cam: [[0, 1.0, 0.5, 0.5], ["arp1-0.2", ...aim(1.4, 420, 860)], ["arp2:shape-0.3", ...aim(1.25, 800, 520)]],
        callouts: [
          { at: "arp1:tempo", until: "arp2", mark: "tempo", side: "right", dx: 80, dy: -50, text: "84 bpm, 1/16" },
          { at: "arp2:Hold", until: "arp2:shape", mark: "hold", side: "top", dx: 40, dy: -110, text: "latched" },
          { at: "arp2:shape", mark: "cut", side: "top", dx: 60, dy: -90, text: "shaped while it plays" },
        ],
      },
      {
        beat: "clock",
        shot: "co-clock",
        chapter: "07 · MIDI clock",
        cam: [[0, 1.0, 0.5, 0.5], ["clock1-0.2", ...aim(1.2, 1150, 640)]],
        callouts: [
          { at: "clock1:tempo", until: "clock2", mark: "foot", side: "left", dx: -150, dy: -60, text: "the sequencer's tempo" },
          { at: "clock2:downbeat", mark: "lane", side: "top", dx: 60, dy: -80, text: "in on the downbeat" },
        ],
      },
      {
        beat: "scenes",
        shot: "co-scenes",
        chapter: "08 · parts",
        cam: [[0, 1.0, 0.5, 0.5], ["scenes1:Keep-0.3", ...aim(1.2, 900, 420)], ["scenes2-0.2", 1.0, 0.5, 0.5]],
        callouts: [
          { at: "scenes1:home", until: "scenes1:glides", mark: "keep", side: "top", dx: 40, dy: -110, text: "home" },
          { at: "scenes1:glides", until: "scenes2", mark: "back", side: "top", dx: 40, dy: -110, text: "glides back" },
          { at: "scenes2:bracket", until: "scenes3", mark: "rail", side: "right", oy: -220, dx: 90, dy: -40, text: "[ previous · ] next" },
          { at: "scenes3:carry", mark: "name", side: "right", dx: 90, dy: 24, text: "held notes carried, no new attack" },
        ],
      },
      {
        beat: "record",
        shot: "co-record",
        chapter: "09 · takes",
        cam: [[0, 1.0, 0.5, 0.5], ["record1-0.2", ...aim(1.3, 1250, 760)]],
        callouts: [
          { at: "record1:record", until: "record2", mark: "rec", side: "top", dx: -60, dy: -110, text: "● rec, then ◼ stop" },
          { at: "record2:output", mark: "toast", side: "top", dx: -120, dy: -80, text: "post-limiter · the session's sample rate" },
        ],
      },
      {
        beat: "share",
        shot: "co-share",
        chapter: "10 · files",
        cam: [[0, 1.0, 0.5, 0.5], ["share1:export-0.6", ...aim(1.3, 1500, 300)], ["share3:Drop-0.2", 1.0, 0.5, 0.5]],
        callouts: [
          { at: "share1:patch", until: "share2", mark: "menu", side: "left", dx: -120, dy: 40, text: ".auracle.json" },
          { at: "share2:inside", until: "share3", mark: "note", side: "left", dx: -140, dy: 30, text: "the patch rides inside the picture" },
          { at: "share3:opens", mark: "subject", side: "right", dx: 80, dy: 30, text: "the dropped picture, open as a patch" },
        ],
      },
      {
        beat: "outro",
        shot: "co-outro",
        cam: [[0, 1.0, 0.5, 0.5], ["outro1", 1.04, 0.6, 0.35]],
        callouts: [{ at: "outro1:profile", mark: "export", side: "left", dx: -140, dy: 30, text: "Save taste profile" }],
      },
    ],
  });
}
