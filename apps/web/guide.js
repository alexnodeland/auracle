// The guide pill (Plan-008 §1, "First-visit guide"; ADR-009's one onboarding
// surface): bottom left of the stage, one step at a time, with pips for how
// far along the steps are and × to stop showing them. A step ticks off when
// it happens, not when it is read. Each level shows its own steps: PERFORM's
// five (play, turn a control, ask for an offer; then the levels' two, zoom
// out to TASTE and hold ⌥ for the model view, Plan-008 C3), and PATCH's
// (play it, turn a knob, lock what you love, ⚡; Plan-008 C2a). A step may
// belong to more than one level. A step the sound in hand gives no way to do
// is left out while it is in hand (its `skip`: PERFORM's turn on a sound none
// of the controls reach, #480), pip and all, and comes back with a sound that
// has one. A level's closing line is said once: when the steps it shows are
// done, and not again when a step left out comes back and is done.
//
// What has been done is the player's, kept in localStorage as
// `auracle-guide` ({done: [ids], closed: [levels], ended: [levels]}),
// JS-owned. × stops one level's steps: PERFORM's × leaves PATCH's to show.
// `ended` is the levels whose closing line has been said, kept with the rest
// so a reload doesn't say it again. A `closed: true` from before the levels
// had their own (C1, when PERFORM's were the only steps) reads as PERFORM's.
// A record from before `ended` reads as no line said: whoever heard one then
// had done every step it closed, and hears it again only after steps added
// since (C3's two, as Plan-008 meant). The first steps kept their ticks as
// `auracle-perform-steps` (an array of ids) before the pill: read once into
// the new key and removed (`readGuide`).

export const GUIDE_KEY = "auracle-guide";
export const OLD_STEPS_KEY = "auracle-perform-steps";

/** What has been done, from storage: `get(key)` returns the stored string or
 *  null. The new key first; else the first steps' old array, migrated
 *  (`migrated` true: the caller writes the new key and removes the old).
 *  Anything unreadable is a fresh start. Pure, for the unit tests. */
export function readGuide(get) {
  const fresh = { done: [], closed: [], ended: [], migrated: false };
  const levels = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string"))] : []);
  let raw = null;
  try {
    raw = get(GUIDE_KEY);
  } catch {
    return fresh;
  }
  if (raw != null) {
    try {
      const v = JSON.parse(raw);
      const done = Array.isArray(v?.done) ? v.done.filter((x) => typeof x === "string") : [];
      const closed = v?.closed === true ? ["perform"] : levels(v?.closed);
      return { done: [...new Set(done)], closed, ended: levels(v?.ended), migrated: false };
    } catch {
      return fresh;
    }
  }
  let old = null;
  try {
    old = get(OLD_STEPS_KEY);
  } catch {
    return fresh;
  }
  if (old == null) return fresh;
  try {
    const v = JSON.parse(old);
    const done = Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    return { done: [...new Set(done)], closed: [], ended: [], migrated: true };
  } catch {
    return { ...fresh, migrated: true };
  }
}

/** The steps `level` shows now, in order, and the one up next: its own
 *  (`levels`, PERFORM's when none) less those whose `skip()` says the sound
 *  in hand gives no way to do them. `now` is the first not in `done` (a Set
 *  of ids), or null when every step shown is. Pure, for the unit tests. */
export function stepsShown(steps, level, done) {
  const here = steps.filter((s) => (s.levels || ["perform"]).includes(level) && !s.skip?.());
  return { here, now: here.find((s) => !done.has(s.id)) || null };
}

/** The pill. `el` is its slot (`#guide`, in the stage). Steps are added in
 *  order with `add({id, text, levels, skip})`, `text()` giving the step's
 *  words now (a step may name what this sound can do), `levels` the levels
 *  it shows on (PERFORM's when none), and `skip()`, when given, true while
 *  the sound in hand gives no way to do it (`stepsShown`). `setLevel(level)`
 *  says which level is up; `done(id)` ticks one off; `refresh()` draws the
 *  pill again when what a step says or skips may have changed; `ends` is
 *  each level's closing line, said once, when the last step it shows is
 *  done: a level whose line was said (`ended`) doesn't say it again when a
 *  step left out comes back and is done. */
export function createGuide({ el, ends = {} }) {
  const steps = [];
  let level = "perform";
  let ending = 0; // the closing line's timer
  const st = readGuide((k) => localStorage.getItem(k));
  const done = new Set(st.done);
  const closed = new Set(st.closed); // the levels whose × was pressed
  const ended = new Set(st.ended); // the levels whose closing line was said
  const save = () => {
    try {
      localStorage.setItem(GUIDE_KEY, JSON.stringify({ done: [...done], closed: [...closed], ended: [...ended] }));
    } catch {
      /* a per-viewer convenience; in memory is enough for this visit */
    }
  };
  if (st.migrated) {
    save();
    try {
      localStorage.removeItem(OLD_STEPS_KEY);
    } catch {
      /* private window */
    }
  }
  const make = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const allDoneOn = (l) => {
    const { here, now } = stepsShown(steps, l, done);
    return here.length > 0 && !now;
  };
  // The pill: pips, the step, ×. A status, so a screen reader hears each new
  // step once.
  function render() {
    if (ending) return;
    el.innerHTML = "";
    const { here, now } = stepsShown(steps, level, done);
    el.dataset.level = level;
    if (closed.has(level) || !now) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    const pill = make("div", "next pf-steps");
    pill.setAttribute("role", "status");
    const pips = make("span", "pips");
    pips.setAttribute("aria-hidden", "true");
    for (const s of here) pips.append(make("i", done.has(s.id) ? "done" : ""));
    const i = here.indexOf(now);
    const text = make("span", "pf-step now", now.text());
    text.dataset.step = now.id;
    // The whole step where a narrow pill cuts it, and how far along it is.
    text.title = `${now.text()} (step ${i + 1} of ${here.length})`;
    const x = make("button", "x", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Stop showing these");
    x.title = "Stop showing these";
    // This level's steps stop; another level's still show there.
    const at = level;
    x.onclick = () => {
      closed.add(at);
      save();
      render();
    };
    pill.append(pips, text, x);
    el.append(pill);
  }
  return {
    /** Which level is up: the pill shows that level's steps. */
    setLevel(l) {
      if (level === l) return;
      level = l;
      render();
    },
    /** Ticks off what was done before these steps existed (a walkthrough the
     *  player already dismissed), without a word. */
    markDone(ids) {
      let changed = false;
      for (const id of ids) if (!done.has(id)) { done.add(id); changed = true; }
      if (changed) { save(); render(); }
    },
    add(step) {
      if (!steps.some((s) => s.id === step.id)) steps.push(step);
      render();
    },
    done(id) {
      if (done.has(id) || !steps.some((s) => s.id === id)) return;
      const wasOpen = !closed.has(level) && !allDoneOn(level);
      done.add(id);
      // The level's last step, and its line not said yet (a step left out
      // that came back after it, the turn, ends with no second line).
      const closing = allDoneOn(level) && wasOpen && ends[level] && !ended.has(level);
      if (closing) ended.add(level);
      save();
      if (!closing) return render();
      // Its pip fills and one line says what the loop was, for a few
      // seconds, then the pill goes.
      el.innerHTML = "";
      el.classList.remove("hidden");
      const pill = make("div", "next pf-steps");
      pill.setAttribute("role", "status");
      const pips = make("span", "pips");
      pips.setAttribute("aria-hidden", "true");
      for (const s of stepsShown(steps, level, done).here) pips.append(make("i", "done"));
      pill.append(pips, make("span", "pf-step done all", ends[level]));
      el.append(pill);
      ending = setTimeout(() => {
        ending = 0;
        render();
      }, 7000);
    },
    // A step's words follow the sound (PERFORM's "Turn BRIGHT…").
    refresh() {
      render();
    },
    isDone: (id) => done.has(id),
  };
}
