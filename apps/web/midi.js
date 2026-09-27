// MIDI: a controller plugged in should make the instrument better, not just
// louder. Three things it does beyond notes:
//
// 1. "Plug in and just turn." The first eight distinct CCs that move claim
//    PERFORM's eight controls, in the order they move, each announced. Learn
//    remaps any of them. The map is per device and remembered.
// 2. Knobs that behave. Relative encoders are recognised from the values they
//    send; absolute pots get soft takeover (pickup), which matters twice here
//    because a drifting patch moves the controls under a pot that has not.
// 3. Clock in. 0xF8 ticks set the tempo by least squares over the last two
//    beats, so the arpeggiator follows the room.
//
// Expression defaults follow the instruments that do this well: channel
// pressure opens Bright (press harder, brighter), the mod wheel drives Motion.
//
// The pure parts (parse, relativeDelta, detectRelative, Pickup, ClockTempo)
// are exported for tests/midi.test.mjs.

export const CC_MOD = 1;
export const CC_SUSTAIN = 64;
// Controllers with a meaning of their own in the MIDI spec, never claimed as
// knobs: bank select (0, 32), data entry and (N)RPN (6, 38, 96–101), the
// pedals (64 sustain, 66 sostenuto, 67 soft) and the channel-mode messages
// (120–127). A keyboard that sends a program change with bank select, or an
// RPN to set its bend range, would otherwise have those grab PERFORM's
// controls on the first auto-map.
const RESERVED = new Set([0, 6, 32, 38, 96, 97, 98, 99, 100, 101, CC_SUSTAIN, 66, 67, 120, 121, 122, 123, 124, 125, 126, 127]);
const SLOTS = 8;
const STORE = "auracle-midi-map";

/** Decode one message. `data` is the Uint8Array Web MIDI hands over. */
export function parse(data) {
  const st = data[0];
  if (st === 0xf8) return { kind: "clock" };
  if (st === 0xfa) return { kind: "start" };
  if (st === 0xfb) return { kind: "continue" };
  if (st === 0xfc) return { kind: "stop" };
  const kind = st & 0xf0;
  const ch = st & 0x0f;
  const a = data[1] | 0;
  const b = data[2] | 0;
  switch (kind) {
    case 0x90:
      return b > 0 ? { kind: "on", ch, note: a, vel: b / 127 } : { kind: "off", ch, note: a };
    case 0x80:
      return { kind: "off", ch, note: a };
    case 0xb0:
      return { kind: "cc", ch, cc: a, value: b };
    case 0xe0:
      return { kind: "bend", ch, value: ((b << 7) | a) - 8192 };
    case 0xd0:
      return { kind: "pressure", ch, value: a / 127 };
    case 0xc0:
      return { kind: "program", ch, program: a };
    default:
      return { kind: "other" };
  }
}

/**
 * The step a relative encoder sent, in encoder ticks.
 * - "twos": two's complement, 1..63 up and 127..65 down (the common default)
 * - "offset": binary offset around 64
 */
export function relativeDelta(value, mode) {
  if (mode === "twos") return value < 64 ? value : value - 128;
  if (mode === "offset") return value - 64;
  return 0;
}

/**
 * Guess a CC's encoding from its recent raw values. An absolute pot sweeps;
 * a relative encoder sends a handful of values clustered at the ends (two's
 * complement) or around 64 (offset). Needs a few samples, and says "abs"
 * whenever it is not sure: a wrong "relative" makes a pot unusable, while a
 * wrong "absolute" merely makes an encoder jumpy until it is noticed.
 */
export function detectRelative(values) {
  if (values.length < 6) return "abs";
  // The tell is repetition. An absolute pot only sends when its value
  // changes, so consecutive duplicates are rare even in a slow sweep; an
  // encoder sends the same small tick (1, or 127) again and again. A pot swept
  // to its bottom stop also sends only values <= 7 — and it would read as an
  // encoder on range alone — but it never repeats, and it reaches 0, which
  // two's complement never sends.
  let repeats = 0;
  for (let i = 1; i < values.length; i++) if (values[i] === values[i - 1]) repeats++;
  const repetitive = repeats / (values.length - 1) >= 0.4;
  if (!repetitive) return "abs";
  const end = (v) => (v >= 1 && v <= 7) || v >= 121;
  const mid = (v) => v >= 57 && v <= 71 && v !== 64;
  if (values.every(end)) return "twos";
  if (values.every(mid)) return "offset";
  return "abs";
}

/**
 * Soft takeover for an absolute pot. The pot does nothing until it passes
 * through the control's current value (within `tol`), then follows it. Without
 * this a pot left at 3 o'clock snaps a control the patch drifted to 9 o'clock.
 */
export class Pickup {
  constructor(tol = 0.04) {
    this.tol = tol;
    this.engaged = false;
    this.last = null;
  }
  /** Returns true when `incoming` (0..1) should drive a control now at `current`. */
  offer(current, incoming) {
    if (this.engaged) {
      this.last = incoming;
      return true;
    }
    const crossed =
      Math.abs(incoming - current) <= this.tol ||
      (this.last != null && (this.last - current) * (incoming - current) <= 0);
    this.last = incoming;
    if (crossed) this.engaged = true;
    return this.engaged;
  }
  /** The control moved without the pot (drift, mouse): pick up again. */
  release() {
    this.engaged = false;
  }
}

/**
 * Tempo from MIDI clock: 24 ticks per quarter note. A least-squares line
 * through the last two beats of tick times, so one late tick moves the
 * estimate by a fraction of its lateness rather than all of it.
 */
export class ClockTempo {
  constructor(window = 48) {
    this.window = window;
    this.times = [];
  }
  tick(ms) {
    const t = this.times;
    // A gap of over a second is a stop/restart, not a very slow tempo.
    if (t.length && ms - t[t.length - 1] > 1000) t.length = 0;
    t.push(ms);
    if (t.length > this.window) t.shift();
  }
  /** Beats per minute, or null until a full beat of ticks has arrived. */
  get bpm() {
    const t = this.times;
    const n = t.length;
    if (n < 25) return null;
    const mx = (n - 1) / 2;
    const my = t.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (i - mx) * (t[i] - my);
      sxx += (i - mx) * (i - mx);
    }
    const msPerTick = sxy / sxx;
    return msPerTick > 0 ? 60000 / (24 * msPerTick) : null;
  }
}

export function createMidi(host) {
  const state = {
    access: null,
    inputs: [],
    device: "",
    // `${ch}:${cc}` -> {slot, mode}
    map: new Map(),
    raw: new Map(), // `${ch}:${cc}` -> recent raw values (encoding detection)
    pickups: new Map(),
    learning: null, // slot waiting for a CC
    auto: true,
    bendRange: 2,
    clock: new ClockTempo(),
    lastBpm: null,
    ticks: null, // clock ticks since the last Start; null when stopped
    pressureSlot: 0, // Bright
    modSlot: 2, // Motion
  };

  function load() {
    try {
      const all = JSON.parse(localStorage.getItem(STORE) || "{}");
      const mine = all[state.device] || {};
      state.map = new Map(Object.entries(mine.map || {}));
      state.auto = mine.auto !== false;
      state.bendRange = mine.bendRange || 2;
    } catch (_) {
      state.map = new Map();
    }
  }
  function save() {
    try {
      const all = JSON.parse(localStorage.getItem(STORE) || "{}");
      all[state.device] = {
        map: Object.fromEntries(state.map),
        auto: state.auto,
        bendRange: state.bendRange,
      };
      localStorage.setItem(STORE, JSON.stringify(all));
    } catch (_) {
      /* private mode: the map lasts the session */
    }
  }

  const slotName = (i) => (host.controlNames()[i] || `control ${i + 1}`);
  const usedSlots = () => new Set([...state.map.values()].map((m) => m.slot));

  function assign(key, slot, why) {
    for (const [k, m] of state.map) if (m.slot === slot) state.map.delete(k);
    state.map.set(key, { slot, mode: "abs" });
    state.pickups.delete(key);
    save();
    host.note(`${why}: CC ${key.split(":")[1]} → ${slotName(slot)}`);
    renderPanel();
  }

  function onCc(ch, cc, value) {
    const key = `${ch}:${cc}`;
    const hist = state.raw.get(key) || [];
    hist.push(value);
    if (hist.length > 12) hist.shift();
    state.raw.set(key, hist);
    if (state.learning != null) {
      assign(key, state.learning, "learned");
      state.learning = null;
      renderPanel();
      return;
    }
    let m = state.map.get(key);
    if (!m && state.auto && cc !== CC_MOD) {
      const used = usedSlots();
      const free = [...Array(SLOTS).keys()].find((i) => !used.has(i));
      if (free != null) {
        assign(key, free, "mapped");
        m = state.map.get(key);
      }
    }
    // The mod wheel, unmapped, is expression: at rest it adds nothing, and
    // pushing it adds Motion on top of wherever the control is.
    if (cc === CC_MOD && !m) {
      host.perform()?.setExpression("mod", state.modSlot, value / 127);
      return;
    }
    if (!m) return;
    if (m.mode === "abs" && hist.length >= 6) {
      const guess = detectRelative(hist);
      if (guess !== "abs") {
        m.mode = guess;
        save();
        host.note(`CC ${cc} is an endless encoder — following it relatively`);
      }
    }
    if (m.mode === "abs") drive(key, m.slot, value / 127, "abs");
    else {
      const cur = host.perform()?.getControl(m.slot) ?? 0.5;
      host.perform()?.setControl(m.slot, Math.min(1, Math.max(0, cur + relativeDelta(value, m.mode) / 100)));
    }
  }

  function drive(key, slot, v01, mode) {
    const pf = host.perform();
    if (!pf) return;
    if (mode === "abs") {
      let p = state.pickups.get(key);
      if (!p) {
        p = new Pickup();
        state.pickups.set(key, p);
      }
      if (!p.offer(pf.getControl(slot), v01)) return;
    }
    pf.setControl(slot, v01);
  }

  function onMessage(ev) {
    const m = parse(ev.data);
    switch (m.kind) {
      case "on":
        host.noteOn(m.note, m.vel);
        break;
      case "off":
        host.noteOff(m.note);
        break;
      case "bend":
        host.bend((m.value / 8192) * state.bendRange);
        break;
      case "pressure":
        // Press harder, brighter — an offset under the player's own turn, so
        // letting go returns exactly to where the control was.
        host.perform()?.setExpression("pressure", state.pressureSlot, m.value);
        break;
      case "cc":
        if (m.cc === CC_SUSTAIN) host.sustain(m.value >= 64);
        else if (m.cc === 123 || m.cc === 120) host.panic();
        else if (m.cc === 121) host.perform()?.setExpression(null);
        else if (!RESERVED.has(m.cc)) onCc(m.ch, m.cc, m.value);
        break;
      case "clock": {
        state.clock.tick(ev.timeStamp || performance.now());
        // Phase lock: after a Start, every 24th tick is a beat of the room's
        // transport, and the synced sequencers are pulled onto it. Between
        // beats they run on the estimated tempo; without this, a 0.3% tempo
        // estimate error walks them a 16th off the room every ~20 s.
        if (state.ticks != null) {
          // The first tick after Start *is* position 0, so beat n is tick
          // 24n + 1.
          state.ticks += 1;
          if ((state.ticks - 1) % 24 === 0) host.transportBeats?.((state.ticks - 1) / 24);
        }
        const bpm = state.clock.bpm;
        if (bpm && bpm >= 30 && bpm <= 300 && (state.lastBpm == null || Math.abs(bpm - state.lastBpm) > 0.4)) {
          state.lastBpm = bpm;
          host.setBpm(Math.round(bpm * 10) / 10);
          renderPanel();
        }
        break;
      }
      case "program":
        host.program?.(m.program);
        break;
      // Start restarts the tempo-sync transport, so step sequencers land on
      // the room's downbeat rather than on the first key.
      case "start":
        state.ticks = 0;
        host.transportStart?.();
        break;
      case "stop":
        state.ticks = null;
        break;
      default:
        break;
    }
  }

  // Drift or a mouse moved a control: every pot bound to it has to pick up
  // again before it takes over.
  function controlMovedElsewhere(slot) {
    for (const [k, m] of state.map) if (m.slot === slot) state.pickups.get(k)?.release();
  }

  // ---------- the panel ----------
  let panel = null;
  function renderPanel() {
    if (!panel || panel.classList.contains("hidden")) return;
    panel.innerHTML = "";
    const h = document.createElement("div");
    h.className = "midi-h";
    h.textContent = state.inputs.length
      ? `MIDI · ${state.inputs.map((i) => i.name).join(", ")}`
      : "MIDI · no device — plug one in";
    panel.append(h);
    const list = document.createElement("div");
    list.className = "midi-rows";
    for (let i = 0; i < SLOTS; i++) {
      const row = document.createElement("div");
      row.className = "midi-row";
      const name = document.createElement("span");
      name.className = "midi-slot";
      name.textContent = slotName(i);
      const src = document.createElement("span");
      src.className = "midi-src mono";
      const bound = [...state.map].find(([, m]) => m.slot === i);
      src.textContent =
        state.learning === i
          ? "move a knob…"
          : bound
            ? `CC ${bound[0].split(":")[1]}${bound[1].mode !== "abs" ? " · endless" : ""}`
            : i === state.modSlot
              ? "mod wheel"
              : i === state.pressureSlot
                ? "pressure"
                : "—";
      const learn = document.createElement("button");
      learn.type = "button";
      learn.className = "util-btn";
      learn.textContent = state.learning === i ? "cancel" : "learn";
      learn.onclick = () => {
        state.learning = state.learning === i ? null : i;
        renderPanel();
      };
      // CLEAR only where there is a mapping to clear. Eight disabled CLEARs
      // down an unmapped panel read as a column of dead controls; an empty
      // cell keeps the rows aligned instead.
      let clear = document.createElement("span");
      if (bound) {
        clear = document.createElement("button");
        clear.type = "button";
        clear.className = "util-btn";
        clear.textContent = "clear";
        clear.onclick = () => {
          state.map.delete(bound[0]);
          save();
          renderPanel();
        };
      }
      row.append(name, src, learn, clear);
      list.append(row);
    }
    panel.append(list);
    const foot = document.createElement("div");
    foot.className = "midi-foot mono";
    const auto = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.auto;
    cb.onchange = () => {
      state.auto = cb.checked;
      save();
    };
    auto.append(cb, document.createTextNode(" first knobs you turn claim free controls"));
    const bend = document.createElement("label");
    const sel = document.createElement("select");
    // The house select, like every other one on the keybar: a bare UA
    // control is the one grey widget on the instrument.
    sel.className = "perf-sel";
    sel.setAttribute("aria-label", "Pitch-bend range in semitones");
    for (const r of [2, 7, 12, 24, 48]) {
      const o = document.createElement("option");
      o.value = String(r);
      o.textContent = `±${r}`;
      if (r === state.bendRange) o.selected = true;
      sel.append(o);
    }
    sel.onchange = () => {
      state.bendRange = Number(sel.value);
      save();
    };
    bend.append(document.createTextNode("bend "), sel);
    const clk = document.createElement("span");
    clk.textContent = state.lastBpm ? `clock ${state.lastBpm.toFixed(1)} bpm` : "no clock";
    foot.append(auto, bend, clk);
    panel.append(foot);
  }

  function wire() {
    const inputs = [...state.access.inputs.values()];
    state.inputs = inputs;
    state.device = inputs.map((i) => i.name).sort().join("+") || "none";
    load();
    // A device that left with the pedal down or a key pressed would leave
    // both stuck: the new set of inputs starts from nothing held.
    host.sustain(false);
    host.perform()?.setExpression(null);
    for (const input of inputs) input.onmidimessage = onMessage;
    host.onDevices(inputs.length);
    renderPanel();
  }

  if (navigator.requestMIDIAccess) {
    navigator
      .requestMIDIAccess({ sysex: false })
      .then((access) => {
        state.access = access;
        wire();
        access.onstatechange = wire;
      })
      .catch(() => host.onDevices(0));
  }

  return {
    attachPanel(el) {
      panel = el;
      renderPanel();
    },
    togglePanel() {
      if (!panel) return;
      panel.classList.toggle("hidden");
      renderPanel();
    },
    controlMovedElsewhere,
    // For tests and scripted captures: feed a raw message as if from a device.
    feed(data, timeStamp) {
      onMessage({ data: Uint8Array.from(data), timeStamp: timeStamp ?? performance.now() });
    },
  };
}
