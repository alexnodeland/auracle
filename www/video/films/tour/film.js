// A tour of Auracle — the map before the four views' deep dives, over the
// real instrument.
//
// One recorded shot per beat (shots.json; tools/footage.mjs records them from
// apps/web with the app's own sound). The camera and the callouts are pinned
// to the narration's words and to the elements footage.mjs measured, so a
// re-timed voice or a moved control re-aims the film instead of breaking it.
// `aim(z, x, y)` centres the camera on a point of the 1920×1080 app. The
// title and end cards are drawn with the kit over the footage window
// (cards.js).
//
// Every shot is one seeded session (shots.json `init`) with the three-pick
// warm start answered — the card on the films' shortlist, then the first
// bass and pad card on the grid —
// which is exactly what the first-visit beat does on camera. So PICKS reads
// 18, My patches holds those three, and TASTE has a first map, as it will for
// someone who has just picked three.
//
// Where the film does what the app makes it do:
// - open: the offer in B is grown in set-up (Offer, then wait for it). A
//   spare offer grown ahead is handed over at once only while the knobs sit
//   where it was grown, and the cold open turns a control first (the first
//   of the six that turns up: Bright, when it can); a fresh offer is ~10 s of
//   renders. While B holds it, the Offer pad reads NEXT (passes on B); Take
//   empties B and it reads Offer again.
// - views: the duel's pair is rendered and heard once in set-up, so ▶ on
//   camera sounds at once (renders are lazy).
// - bank: clicking a row opens it and switches to PATCH (the app's own
//   behaviour), so the bank beat plays out in PATCH. The row played and
//   opened is the card on the shortlist the warm start saved. Space stops its phrase as the row
//   is clicked; the row opens as it is clicked, and its chords wait for it to
//   land (no cut).
// - dock: HOLD latches the chord before ARP opens its drawer (a HOLD click
//   folds the drawer); the pointer rests on the drawer. ● rec is pressed on
//   camera and pressed again: a real take, and its toast.
// - header: a generation is breeding (pressed in set-up; it takes minutes),
//   so the job slot beside the counters shows how far along it is. The
//   counters are measured again as they are named: the slot sits beside them.
// - first: a fresh session whose set-up stops at the nine cards; the ▶ on
//   camera is the real first press. "teach it" can take seconds before
//   its result shows, so the beat cuts from the press to the "Your three taught it 18
//   learned… Your three are saved." toast (the shot's `clips`; no cut when it
//   is quick), by when PERFORM is on the first pick, its controls live (its
//   wiring came with it): one is turned under the figure on "ready to play".
import { walkthrough, aim } from "../../stage/walk.js";

export async function build(stage) {
  await walkthrough(stage, {
    plan: [
      {
        beat: "open",
        shot: "to-open",
        cam: [[0, 1.0, 0.5, 0.5], [14.0, 1.05, 0.5, 0.42]],
      },
      {
        beat: "title",
        shot: "to-map",
        cam: [[0, 1.0, 0.5, 0.5]],
        callouts: [
          { at: "title2:map", mark: "tabs", side: "bottom", dx: 70, dy: 100, text: "four views" },
          { at: "title2:everything", mark: "bank", side: "right", oy: -160, dx: 110, dy: 0, text: "the bank" },
          { at: "title2:everything+0.45", mark: "piano", side: "top", ox: -480, dx: -40, dy: -90, text: "the dock" },
          { at: "title2:for", mark: "top", side: "bottom", dx: -90, dy: 150, text: "up top" },
        ],
      },
      {
        beat: "views",
        shot: "to-views",
        chapter: "01 · the four views",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["views1-0.2", 1.0, 0.5, 0.5],
          ["views1:top", ...aim(1.7, 420, 200)],
          ["views1:views+0.55", ...aim(1.7, 420, 200)],
          ["views2:PERFORM", 1.0, 0.5, 0.5],
        ],
        callouts: [
          { at: "views2:PERFORM", until: "views3-0.1", mark: "perform", side: "bottom", dx: 60, dy: 130, text: "playing the sound" },
          { at: "views3:PATCH", until: "views4-0.1", mark: "patch", side: "bottom", dx: 60, dy: 130, text: "inside the sound" },
          { at: "views4:EVOLVE", until: "views5-0.1", mark: "evolve", side: "bottom", dx: 60, dy: 130, text: "breeding sounds you like" },
          { at: "views5:TASTE", mark: "taste", side: "bottom", dx: 60, dy: 130, text: "what it learned about you" },
        ],
      },
      {
        beat: "bank",
        shot: "to-bank",
        chapter: "02 · the bank",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["bank1-0.2", 1.0, 0.5, 0.5],
          ["bank1:bank", ...aim(1.7, 300, 380)],
          ["bank5:Click-0.1", ...aim(1.7, 300, 380)],
          ["bank5:yours-0.2", ...aim(1.15, 820, 480)],
        ],
        callouts: [
          { at: "bank3:guess", until: "bank4-0.15", mark: "pct", side: "right", dx: 90, dy: 50, text: "its guess" },
          { at: "bank5:hear", until: "bank5:Click-0.2", mark: "hear", side: "right", dx: 110, dy: 40, text: "the same phrase for every sound" },
          { at: "bank5:yours", mark: "padrow", side: "bottom", dx: 0, dy: 100, text: "open, and live" },
        ],
      },
      {
        beat: "dock",
        shot: "to-dock",
        chapter: "03 · the dock",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["dock1-0.2", 1.0, 0.5, 0.5],
          ["dock1:dock", ...aim(1.3, 960, 880)],
          ["dock3-0.6", ...aim(1.3, 960, 880)],
          ["dock3:Hold+0.15", ...aim(1.7, 330, 900)],
          ["dock4-0.5", ...aim(1.7, 330, 900)],
          ["dock4:right", ...aim(1.7, 1650, 930)],
        ],
        callouts: [
          { at: "dock2:computer", until: "dock3-0.65", mark: "c4", side: "top", dx: 40, dy: -110, text: "your computer keys: A to L" },
          { at: "dock3:Hold+0.2", until: "dock3:arpeggiator", mark: "hold", side: "top", dx: 30, dy: -110, text: "hold: latched" },
          { at: "dock3:time", until: "dock4-0.6", mark: "drawer", side: "top", dx: 60, dy: -70, text: "up and down, at 84" },
          { at: "dock4:glide", until: "dock5-0.2", mark: "glide", side: "top", dx: -60, dy: -110, text: "glide" },
          { at: "dock5:Record", until: "dock5:MIDI-0.1", mark: "rec", side: "top", dx: -90, dy: -110, text: "a take of what you play" },
          { at: "dock5:MIDI", until: "dock5:volume-0.1", mark: "midi", side: "top", dx: -60, dy: -120, text: "MIDI in" },
          { at: "dock5:volume", mark: "vol", side: "left", dx: -120, dy: -30, text: "volume" },
        ],
      },
      {
        beat: "header",
        shot: "to-header",
        chapter: "04 · up top",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["header1-0.2", 1.0, 0.5, 0.5],
          ["header1:top", ...aim(1.8, 1720, 110)],
          ["header2:question-0.3", ...aim(1.8, 1720, 110)],
          ["header2:question+0.4", 1.0, 0.5, 0.5],
          ["header3-0.5", 1.0, 0.5, 0.5],
          ["header3:dots+0.1", ...aim(1.5, 1600, 280)],
        ],
        callouts: [
          { at: "header1:PICKS", until: "header1b-0.1", mark: "picks", side: "bottom", dx: -60, dy: 110, text: "your picks so far" },
          { at: "header1:number", until: "header1b-0.1", mark: "gen", side: "bottom", dx: -30, dy: 200, text: "generations bred" },
          { at: "header1b:slot", until: "header2-0.3", mark: "slot", side: "bottom", dx: 30, dy: 130, text: "a generation, breeding" },
          { at: "header3:files", until: "header3:taste-0.1", mark: "export", side: "left", dx: -120, dy: 0, text: "patches, as files" },
          { at: "header3:taste", until: "header3:films-0.1", mark: "profile", side: "left", dx: -120, dy: 0, text: "your taste profile" },
          { at: "header3:films", mark: "films", side: "left", dx: -120, dy: 0, text: "the films" },
        ],
      },
      {
        beat: "first",
        shot: "to-first",
        chapter: "05 · your first visit",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["first1-0.2", 1.0, 0.5, 0.5],
          ["first1:open", ...aim(1.5, 960, 540)],
          // Wide on the cut itself, so the jump in the footage and the camera's
          // are one edit.
          ["first3-0.15", ...aim(1.5, 960, 540)],
          ["first3-0.15", 1.0, 0.5, 0.5],
        ],
        callouts: [
          { at: "first2:teach", until: "first3-0.3", mark: "go", side: "bottom", dx: 60, dy: 90, text: "3 picks × 6 passed = 18" },
          { at: "first3:eighteen", until: "first4-0.2", mark: "picks", side: "bottom", dx: -80, dy: 110, text: "18 picks" },
          { at: "first4:saved", mark: "mine", side: "right", dx: 90, dy: 40, text: "your three" },
        ],
      },
      {
        beat: "next",
        shot: "to-next",
        chapter: "06 · where next",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["next1-0.2", 1.0, 0.5, 0.5],
          ["next1:deeper", ...aim(1.7, 420, 250)],
        ],
        callouts: [
          { at: "next2:PERFORM", until: "next3-0.1", mark: "perform", side: "bottom", dx: 50, dy: 110, text: "playing the sound" },
          { at: "next3:PATCH", until: "next4-0.1", mark: "patch", side: "bottom", dx: 50, dy: 110, text: "inside the sound" },
          { at: "next4:EVOLVE", until: "next5-0.1", mark: "evolve", side: "bottom", dx: 50, dy: 110, text: "breeding sounds you like" },
          { at: "next5:TASTE", until: "next6-0.2", mark: "taste", side: "bottom", dx: 50, dy: 110, text: "what it learned about you" },
        ],
      },
    ],
  });
  // The title and end cards (cards.js), drawn with the kit. A stage without
  // scenes (the plan-only checks) has nothing to draw them on.
  if (typeof stage.scene === "function") (await import("./cards.js")).cards(stage);
}
