// PATCH: inside the sound — the deep dive into PATCH, over the real app.
//
// A cold open (an acid line at 84, its filter swept on the rack), the title
// over the bed, then nine chapters, each opened by a one-bar card over the bed
// (cards.js) and played over one recorded shot (shots.json; tools/footage.mjs):
// read the circuit, hear it properly, change it, add a module, chains, Steps,
// locks and ⚡ evolve, commit, files. Then everything at once on the acid line,
// and the outro, which points on to EVOLVE.
//
// The camera and the callouts are pinned to the narration's words and to the
// elements footage.mjs measured (marks). `aim(z, x, y)` centres the camera on
// a point of the 1920×1080 app. The camera moves only between callouts, and
// each chapter opens wide before it frames the part being discussed. The lock
// chapter cuts inside itself (the shot's `clips`): the ⚡ press, then the child
// it benched tens of seconds later.
//
// Under the demos the app is the music: the bed is out (each beat's `bed_db`
// in script.json), and in under the title, the chapter cards and the outro.
import { walkthrough, aim } from "../../stage/walk.js";

export async function build(stage) {
  await walkthrough(stage, {
    plan: [
      {
        beat: "cold",
        shot: "vp-cold",
        // No words: the acid line runs, and the camera leans into the ladder
        // as its cutoff opens, then eases back as it closes.
        cam: [[0, 1.02, 0.5, 0.5], [2.3, 1.0, 0.5, 0.5], [5.4, ...aim(1.5, 1005, 390)], [8.2, ...aim(1.5, 1005, 390)], [11.3, ...aim(1.1, 940, 450)]],
      },
      {
        beat: "read",
        shot: "vp-read",
        chapter: "01 · reading the circuit",
        // Wide, then the chain; the camera itself reads it left to right as
        // each module is named (no callouts while it moves); then the LFO's
        // amber cable, then the knobs' units.
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["read2-0.6", 1.0, 0.5, 0.5],
          ["read2:flows", ...aim(1.25, 940, 400)],
          ["read2:ones+0.35", ...aim(1.25, 940, 400)],
          ["read3:saws+0.1", ...aim(1.6, 560, 345)],
          ["read3:filter+0.1", ...aim(1.6, 860, 345)],
          ["read3:chorus+0.1", ...aim(1.6, 1165, 345)],
          ["read4:envelope+0.1", ...aim(1.6, 1415, 345)],
          ["read5-0.3", ...aim(1.6, 1415, 345)],
          ["read5:movement+0.2", ...aim(1.55, 720, 480)],
          ["read6-0.3", ...aim(1.55, 720, 480)],
          ["read6:sits+0.3", ...aim(1.3, 1150, 400)],
        ],
        callouts: [
          { at: "read2:green", until: "read2:ones+0.3", mark: "wire2", side: "bottom", dx: -20, dy: 150, text: "sound, left to right" },
          { at: "read5:LFO", until: "read6-0.35", mark: "modwire", side: "bottom", dx: 150, dy: 90, text: "a slow LFO, moving the cutoff", color: "b" },
          { at: "read6:hertz", mark: "cut", side: "bottom", dx: 80, dy: 245, text: "hertz" },
          { at: "read6:milliseconds", mark: "release", side: "bottom", dx: 0, dy: 120, text: "milliseconds" },
          { at: "read6:decibels", mark: "sustain", side: "bottom", dx: -110, dy: 190, text: "decibels" },
        ],
      },
      {
        beat: "hear",
        shot: "vp-hear",
        chapter: "02 · hearing it properly",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["hear1:play", ...aim(1.45, 560, 170)],
          ["hear2:judge", ...aim(1.45, 560, 170)],
          ["hear2:play", 1.0, 0.5, 0.5],
          ["hear3-0.2", 1.0, 0.5, 0.5],
          ["hear3:model", ...aim(1.45, 620, 180)],
          ["hear4-0.3", ...aim(1.45, 620, 180)],
          ["hear4:module", ...aim(1.12, 1060, 640)],
        ],
        callouts: [
          { at: "hear1:button", until: "hear2:play-0.3", mark: "play", side: "right", dx: 70, dy: 70, text: "the standard sample: 5 s, the same for every patch" },
          { at: "hear3:guesses", until: "hear4-0.35", mark: "belief", side: "bottom", ox: -180, dx: 30, dy: 90, text: "the model's guess, and what moves it", color: "b" },
          { at: "hear4:does", until: "hear4:can't", mark: "blurb", side: "top", dx: 40, dy: -70, text: "what it does" },
          { at: "hear4:can't", mark: "heard", side: "bottom", dx: 60, dy: 70, text: "what the model can't hear", color: "b" },
        ],
      },
      {
        beat: "change",
        shot: "vp-change",
        chapter: "03 · changing it",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["change1:knob-0.3", ...aim(1.45, 860, 330)],
          ["change2-0.6", ...aim(1.45, 860, 330)],
          ["change2:Bypass+0.2", ...aim(1.15, 960, 560)],
        ],
        callouts: [
          { at: "change1:play", until: "change2-0.65", mark: "cut", side: "top", dx: 60, dy: -120, text: "live: the voices follow at once" },
          { at: "change2:steps", until: "change3", mark: "held1", side: "top", dx: 40, dy: -80, text: "bypassed, and held" },
          { at: "change3:quiet", until: "change4", mark: "jack", side: "left", dx: -120, dy: 60, text: "an empty socket: silence" },
          { at: "change3:HELD", until: "change4", mark: "held2", side: "top", dx: 40, dy: -80, text: "held, with its settings" },
          { at: "change4:Command", mark: "saw2", side: "top", dx: 40, dy: -70, text: "⌘Z: back in, and heard" },
        ],
      },
      {
        beat: "add",
        shot: "vp-add",
        chapter: "04 · adding a module",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["add1:bank", ...aim(1.35, 1480, 470)],
          ["add2-0.4", ...aim(1.35, 1480, 470)],
          ["add2:hand+0.3", 1.0, 0.5, 0.5],
          ["add3-0.2", 1.0, 0.5, 0.5],
          ["add3:socket", ...aim(1.3, 960, 760)],
          ["add4-0.3", ...aim(1.3, 960, 760)],
          ["add4:socket", ...aim(1.12, 960, 470)],
        ],
        callouts: [
          { at: "add1:forty", until: "add2-0.45", mark: "count", side: "left", dx: -110, dy: 40, text: "42 modules" },
          { at: "add1:ordered", until: "add2-0.45", mark: "groups", side: "left", oy: -160, dx: -120, dy: 0, text: "sources → shape → filter → space → …" },
          { at: "add2:lights", until: "add3-0.25", mark: "lit", side: "top", dx: -40, dy: -90, text: "every socket it fits" },
          { at: "add2:says", until: "add3-0.25", mark: "status", side: "top", dx: -60, dy: -70, text: "green: insert delay after filter" },
          { at: "add3:play", until: "add4-0.35", mark: "pv", side: "top", dx: 50, dy: -80, text: "a preview: nothing is placed" },
          { at: "add4:in", until: "add5-0.3", mark: "placed", side: "top", dx: 50, dy: -70, text: "placed, as one undo step" },
          { at: "add5:amber", mark: "amber", side: "top", dx: -60, dy: -100, text: "amber: replaces the supersaw", color: "b" },
        ],
      },
      {
        beat: "move",
        shot: "vp-move",
        chapter: "05 · modulation chains",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["move1:chain", ...aim(1.3, 720, 440)],
          ["move3-0.2", ...aim(1.3, 720, 440)],
          ["move3:key", 1.0, 0.5, 0.5],
          ["move4-0.2", 1.0, 0.5, 0.5],
          ["move4:shaper", ...aim(1.3, 1100, 470)],
        ],
        callouts: [
          { at: "move2:random", until: "move3-0.25", mark: "rand", side: "bottom", dx: 0, dy: 90, text: "random values" },
          { at: "move2:quantizer", until: "move3-0.25", mark: "quantize", side: "bottom", dx: 20, dy: 160, text: "snapped to A minor" },
          { at: "move2:slew", until: "move3-0.25", mark: "slew", side: "bottom", dx: 30, dy: 90, text: "glides" },
          { at: "move3:key+0.3", until: "move4-0.25", mark: "key", side: "top", dx: 70, dy: -90, text: "one key, held" },
          { at: "move4:busy", until: "move4:wraps", mark: "slot", side: "right", dx: 90, dy: 60, text: "already moved by a mod env", color: "b" },
          { at: "move4:wraps+0.6", mark: "wrapped", side: "bottom", dx: 60, dy: 110, text: "mod env → slew → cutoff", color: "b" },
        ],
      },
      {
        beat: "steps",
        shot: "vp-steps",
        chapter: "06 · steps",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["steps1:sequencer", ...aim(1.5, 820, 610)],
          ["steps3-0.3", ...aim(1.5, 820, 610)],
          ["steps3:locks", ...aim(1.2, 600, 820)],
        ],
        callouts: [
          { at: "steps1:filter", until: "steps2-0.2", mark: "modwire", side: "right", dx: 90, dy: 40, text: "steps → the ladder's cutoff", color: "b" },
          { at: "steps2:bars", until: "steps3-0.35", mark: "lane", side: "bottom", dx: 40, dy: 80, text: "one bar per step, up to eight" },
          { at: "steps3:Sync", until: "steps3:84", mark: "sync", side: "top", dx: 40, dy: -80, text: "SYNC" },
          { at: "steps3:84", mark: "bpm", side: "top", dx: 60, dy: -80, text: "on the tempo: 84" },
        ],
      },
      {
        beat: "lock",
        shot: "vp-lock",
        chapter: "07 · locks and ⚡ evolve",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["lock1:Lock-0.4", ...aim(1.35, 1050, 330)],
          ["lock2-0.35", ...aim(1.35, 1050, 330)],
          ["lock2:press", ...aim(1.5, 1600, 200)],
          ["lock3", ...aim(1.12, 950, 400)],
        ],
        callouts: [
          { at: "lock1:dot", until: "lock2-0.4", mark: "dot", side: "center", dx: 50, dy: 280, text: "one knob, by its dot" },
          { at: "lock1:square", until: "lock2-0.4", mark: "square", side: "right", dx: 80, dy: -60, text: "a whole module, by its ▢" },
          { at: "lock2:Evolve", until: "lock3-0.1", mark: "evolve", side: "bottom", dx: -80, dy: 110, text: "⚡ evolve from this" },
          { at: "lock3:unlocked", until: "lock3:new", mark: "chorus2", side: "bottom", dx: 60, dy: 130, text: "locked: unchanged" },
          { at: "lock3:change", until: "lock3:new", mark: "source", side: "bottom", dx: -40, dy: 150, text: "unlocked: free to change", color: "b" },
        ],
      },
      {
        beat: "keep",
        shot: "vp-keep",
        chapter: "08 · commit",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["keep1:changes", ...aim(1.4, 760, 150)],
          ["keep2-0.2", ...aim(1.4, 760, 150)],
          ["keep2:plays", 1.0, 0.5, 0.5],
          ["keep4-0.2", 1.0, 0.5, 0.5],
          ["keep4:sure", ...aim(1.45, 1000, 200)],
        ],
        callouts: [
          { at: "keep2:random", until: "keep2:better+0.3", mark: "card", side: "top", dx: 60, dy: -60, text: "sides shuffled" },
          { at: "keep2:better+0.35", until: "keep2:better+2.7", mark: "orig", side: "bottom", dx: 40, dy: 90, text: "▶ the original" },
          { at: "keep2:better+2.75", until: "keep3", mark: "edit", side: "bottom", dx: 40, dy: 90, text: "▶ your edit" },
          { at: "keep3:teaches", until: "keep4-0.25", mark: "toast", side: "top", dx: -100, dy: -80, text: "heard, and taught", color: "b" },
          { at: "keep4:Tick", until: "keep4:claim", mark: "tick", side: "left", dx: -30, dy: 0, text: "my edit is better" },
          { at: "keep4:claim", mark: "tick", side: "left", dx: -30, dy: 0, text: "a claim, scored apart from what you heard", color: "b" },
        ],
      },
      {
        beat: "take",
        shot: "vp-take",
        chapter: "09 · taking it with you",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["take1:file-0.8", ...aim(1.4, 1500, 280)],
          ["take2:Drop-0.4", ...aim(1.4, 1500, 280)],
          ["take2:either", 1.0, 0.5, 0.5],
          ["take3-0.1", 1.0, 0.5, 0.5],
          ["take3:lineage", ...aim(1.6, 1100, 880)],
        ],
        callouts: [
          { at: "take1:file", until: "take1:picture-0.1", mark: "export", side: "left", dx: -110, dy: 30, text: "a .auracle.json file" },
          { at: "take1:picture+0.4", until: "take2:inside", mark: "panel", side: "left", dx: -110, dy: 0, text: "a picture: PNG or SVG" },
          { at: "take2:inside", until: "take2:Drop-0.45", mark: "note", side: "left", dx: -120, dy: 30, text: "the patch rides inside the picture" },
          { at: "take3:changed-0.6", mark: "lin1", side: "top", ox: -240, dx: 30, dy: -40, text: "what changed, in words", color: "b" },
        ],
      },
      {
        beat: "together",
        shot: "vp-together",
        chapter: "putting it together",
        cam: [
          [0, 1.0, 0.5, 0.5],
          ["together2:Shape-0.2", 1.0, 0.5, 0.5],
          ["together2:filter", ...aim(1.45, 1005, 390)],
          ["together3-0.5", ...aim(1.45, 1005, 390)],
          ["together3:Add", 1.0, 0.5, 0.5],
          ["together4-0.4", 1.0, 0.5, 0.5],
          ["together4:filter", ...aim(1.3, 1000, 260)],
        ],
        callouts: [
          { at: "together3:grit", until: "together4-0.45", mark: "q", side: "left", dx: -100, dy: 40, text: "search by sound" },
          { at: "together4:Lock+0.3", until: "together4:commit", mark: "square", side: "right", dx: 80, dy: -50, text: "locked" },
          { at: "together4:commit", mark: "tick", side: "left", dx: -30, dy: 0, text: "my edit is better · commit" },
        ],
      },
    ],
  });
  // The kit's cards (title, chapter turns, outro) need the real stage; the
  // scratch validators build this plan against a stub and stop here.
  if (!stage.tl) return;
  const defs = {};
  try {
    const r = await fetch("shots.json", { cache: "no-store" });
    if (r.ok) for (const s of (await r.json()).shots || []) defs[s.id] = s;
  } catch {
    /* no shots.json: the cards fall back to their default lead-in */
  }
  const { cards } = await import("./cards.js");
  cards(stage, defs);
}
