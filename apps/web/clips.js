// Each input's audition clip, as the page hears of it (#147, Plan-007 task 3).
// The engine measures a sound with an AUDIO IN through a clip on each input
// slot it reads (`PhraseSpec::slot_clip`): the slot's own, captured from that
// input, else the clip every slot hears, which is the built-in reference
// unless a session saved before inputs had clips of their own brought its one
// clip back. The engine worker says which clip each slot hears on `ready` and
// in every `audition_clip` (`clips`, one status per slot,
// `WasmEngine::input_clip`), and which clip every slot hears on `ready` and a
// restore's (`clip`). Pure, so it is unit-tested (tests/clips.test.mjs):
// audio-in.js holds one (`createClips`) and asks it which input a first
// listen captures, and main.js keys what a listening sound's clips change by
// it (PERFORM's wiring and lean, `clipTag`; a preset's shipped face,
// `sharedClip`).

/** `INPUT_SLOTS` in auracle-grammar: how many inputs a node can name. */
export const INPUT_SLOTS = 8;

/** The input slots a tree's AUDIO INs read (`PatchTree::input_slots`),
 *  ascending, each once; a slot past the last counts as the last, the slot
 *  it reads (`input_slot`). Empty for a tree that does not listen, and for
 *  anything that is not a tree's JSON (a key already composed). */
export function inputSlots(json) {
  if (typeof json !== "string" || !json.includes('"AudioIn"')) return [];
  let tree;
  try {
    tree = JSON.parse(json);
  } catch {
    return [];
  }
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === "AudioIn" && x && typeof x === "object") {
        const n = Number(x.input);
        seen.add(Math.min(Number.isInteger(n) && n > 0 ? n : 0, INPUT_SLOTS - 1));
      }
      walk(x);
    }
  };
  walk(tree);
  return [...seen].sort((a, b) => a - b);
}

/** The part of a key that names the clips a sound reading input `slots` is
 *  measured through, as the engine's render key names them
 *  (`render_key`): when every slot it reads hears one clip, that clip's id,
 *  which is the key it had before an input could have a clip of its own;
 *  when they differ, each slot with its clip's id, in order
 *  (`0:<id>+1:<id>`). Null for a sound that reads no input, or while the
 *  engine has not said which clip one of its slots hears (`idOf` gives
 *  nothing). */
export function clipKey(slots, idOf) {
  if (!slots.length) return null;
  const ids = slots.map(idOf);
  if (ids.some((id) => typeof id !== "string" || !id)) return null;
  if (ids.every((id) => id === ids[0])) return ids[0];
  return slots.map((s, i) => `${s}:${ids[i]}`).join("+");
}

/** A clip's status as the engine reports it, kept to what the page reads:
 *  `{source: "reference" | "captured", id}`, or null for anything else. */
function statusOf(c) {
  return c && typeof c.source === "string" && typeof c.id === "string" && c.id ? { source: c.source, id: c.id } : null;
}

/** Each input's clip as the engine worker last said, and the inputs whose
 *  last capture the engine refused. */
export function createClips() {
  // Slot → its clip's status, from the worker's `clips`.
  let slots = [];
  // The clip every slot hears unless it has its own (`audition_clip`), from
  // the worker's `clip` on `ready` and a restore's word; never from a
  // capture's reply, whose `clip` is that slot's own. An engine too old to
  // name a slot's says only this (its word carries `clip` and no `clips`).
  let every = null;
  // Slots whose last capture the engine refused (silent, or unusable), this
  // page: no capture of them again by itself until NEW CLIP.
  const refused = new Set();

  /** Which clip input `slot` is heard through: `{source, id}`, or null
   *  before the engine has said. */
  const of = (slot) => (slots.length ? slots[slot] || null : every);
  /** Is input `slot` heard through a clip captured from it? Its clip is
   *  captured, and is not the clip every input hears: the app never sets
   *  that one (`set_audition_clip`), so a captured one is a session's saved
   *  before inputs had clips of their own, captured from whichever input the
   *  keys played then (#147), and an input that hears it has no clip of its
   *  own yet. */
  const own = (slot) => {
    const c = of(slot);
    return c?.source === "captured" && !(slots.length && every?.source === "captured" && c.id === every.id);
  };

  return {
    /** The engine worker's word on the clips: `ready`, a restore's
     *  `audition_clip`, or the reply to a capture of input `slot` (`ok` is
     *  there only then). */
    heard(m) {
      if (!m || typeof m !== "object") return;
      // A capture's reply names its slot, and its `clip` is that slot's.
      const shared = Number.isInteger(m.slot) ? null : statusOf(m.clip);
      if (shared) every = shared;
      if (Array.isArray(m.clips)) slots = m.clips.slice(0, INPUT_SLOTS).map(statusOf);
      else if (shared) slots = [];
      if (Number.isInteger(m.slot) && typeof m.ok === "boolean") {
        if (m.ok) refused.delete(m.slot);
        else refused.add(m.slot);
      }
    },
    of,
    /** Does a first listen on input `slot` capture it by itself? Only while
     *  that input has no clip captured from it (it hears the reference, or
     *  an older session's one clip: `own`), and the engine has not refused a
     *  capture of it since. */
    firstListen: (slot) => !!of(slot) && !own(slot) && !refused.has(slot),
    /** NEW CLIP on input `slot`: a refusal stands in its way no longer. */
    retry: (slot) => {
      refused.delete(slot);
    },
    /** The clips a tree (its JSON) is measured through, as `clipKey` names
     *  them: PERFORM's `clipTag`. */
    key: (json) => clipKey(inputSlots(json), (s) => of(s)?.id),
    /** The clip every input hears, when they all hear one: its id; null when
     *  they differ, or before the engine has said. */
    shared() {
      const ids = slots.length ? slots.map((c) => c?.id) : [every?.id];
      return ids.every((id) => typeof id === "string" && id && id === ids[0]) ? ids[0] : null;
    },
    /** Each input's clip source, by slot (`"reference"`, `"captured"`, or
     *  null before the engine has said): the debugging handle's. */
    sources: () => Array.from({ length: INPUT_SLOTS }, (_, s) => of(s)?.source ?? null),
  };
}
