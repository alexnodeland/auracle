// What the address (and a setting kept for it) asks of a boot: how wide the
// render farm is (`?farm=N`) and the session's random seed (`?seed=N`). Pure:
// main.js hands in `location.search`, the setting and the console, so
// tests/params.test.mjs holds the parsing, bad input included, with no page.

/** The widest farm the address may ask for. */
export const FARM_MAX = 8;

/** `?farm=N` (or the `auracle-renderers` setting), 0–8, or null. `search` is
 *  the address's query (`location.search`); `stored` reads the setting, and
 *  is called only when the address names no farm, so an address's `?farm=`
 *  outranks it (an empty `?farm=` included, which asks for nothing). A
 *  number is floored and held to 0–8; anything else is null, and the width
 *  is the machine's (`farmWidth`). */
export function farmOverride(search, stored = () => null) {
  const override = new URLSearchParams(search).get("farm") ?? stored();
  if (override != null && override !== "") {
    const n = Number(override);
    if (Number.isFinite(n)) return Math.max(0, Math.min(FARM_MAX, Math.floor(n)));
  }
  return null;
}

/** `?seed=N`: the session's random seed, any whole number (taken modulo
 *  2^32, exactly, as the engine's u32), or null; anything else is said
 *  through `warn` (the console's) and ignored. The engine draws its pool, its
 *  pairs, its walks and its fits from streams of this one number (ADR-001),
 *  so a fresh session with the same seed deals the same sounds: a session
 *  can be shared, or replayed. The page's own draws (which side of the table
 *  a sound stands on, the warm start's nine cards, the sides of the
 *  keep-as-new comparison) stay random: they are there against position
 *  bias. Read at boot, never saved. */
export function seedOverride(search, warn = (s) => console.warn(s)) {
  const raw = new URLSearchParams(search).get("seed");
  if (raw == null) return null;
  if (!/^\d+$/.test(raw)) {
    warn(`[auracle] ?seed= takes a whole number, so "${raw}" is ignored and this session's random seed is its own.`);
    return null;
  }
  return Number(BigInt(raw) % 4294967296n);
}
