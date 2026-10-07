// Is the audio struggling? (issue 288). On a slow laptop the voices can run
// short of the audio thread's time: the output underruns, which is heard as
// a crackle, and the audio clock falls behind the page's. Only while it does
// does the instrument protect the audio: an offer in PERFORM's B rests at
// BLEND's home instead of rendering, and the engine's and the farm's
// background work makes room while notes sound (main.js `strainChanged`). On
// a machine with headroom neither happens: B renders always, so PEEK and
// BLEND are heard at the next quantum, and nothing waits on playing.
//
// Pure: main.js samples the audio context every `STRAIN_TICK_MS` and hands
// each sample here; tests/strain.test.mjs holds the rule on samples it
// writes. The thresholds are judgment, not measurement: named here so they
// are found and said in docs/architecture/web-runtime.md.

/** How often main samples the audio. */
export const STRAIN_TICK_MS = 250;
/** Nothing counts until the audio has run this long: the worklet compiles
 *  the engine, and an offer's first four voices, on the audio thread, and
 *  either reads as the clock falling behind on any machine. */
export const STRAIN_WARMUP_MS = 4000;
/** A sample is late when the audio clock fell this far behind the page's
 *  since the one before (a quantum is 2.7 ms at 48 kHz; a clock that keeps up
 *  holds within a millisecond), or when the browser counted an underrun. */
export const STRAIN_LATE_MS = 4;
/** Two late samples within this window put the protections on: one is a
 *  hiccup (a patch's compile), two is the audio running short. */
export const STRAIN_WINDOW_MS = 4000;
export const STRAIN_LATE_SAMPLES = 2;
/** The protections stay on until this long has gone by with no late sample,
 *  doubled each time they come on again in a session, up to the most. With
 *  them on the struggle is hidden, so leaving is a probe: if the audio still
 *  needs them, they come back within a window, and stay longer. */
export const STRAIN_HOLD_MS = 30_000;
export const STRAIN_HOLD_MAX_MS = 480_000;

/** The rule over a session's samples. `now` is the clock samples are taken
 *  on (main hands it `performance.now`). */
export function createStrain({ now }) {
  let on = false;
  let runningSince = null;
  let late = [];
  let lastLate = -Infinity;
  let entries = 0;
  let hold = STRAIN_HOLD_MS;
  return {
    /** Are the protections on? */
    get on() {
      return on;
    },
    /** How long they stay on after the last late sample, this time. */
    get hold() {
      return hold;
    },
    /** One sample: `lag`, the milliseconds the audio clock fell behind the
     *  page's since the last sample (null where the browser cannot say);
     *  `underruns`, the underruns the browser counted since the last (null
     *  where it counts none); `running`, the audio is running and the page
     *  in sight (a suspended context's clock stands still). True when the
     *  protections came on or went off with it. */
    sample({ lag = null, underruns = null, running }) {
      const t = now();
      if (!running) {
        runningSince = null;
        return false;
      }
      if (runningSince == null) runningSince = t;
      if (t - runningSince < STRAIN_WARMUP_MS) return false;
      if ((lag != null && lag > STRAIN_LATE_MS) || (underruns != null && underruns > 0)) {
        lastLate = t;
        late = late.filter((at) => t - at < STRAIN_WINDOW_MS);
        late.push(t);
      }
      if (!on && late.length >= STRAIN_LATE_SAMPLES) {
        on = true;
        hold = Math.min(STRAIN_HOLD_MS * 2 ** entries, STRAIN_HOLD_MAX_MS);
        entries += 1;
        return true;
      }
      if (on && t - lastLate >= hold) {
        on = false;
        late = [];
        return true;
      }
      return false;
    },
  };
}
