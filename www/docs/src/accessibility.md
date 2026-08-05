# Accessibility

<p class="lede">What works, how, and what does not yet.</p>

Auracle is a dense expert tool, and density is usually where accessibility gets
abandoned. It has not been here, but the coverage is uneven and this page says
where.

## Keyboard

**Everything structural is reachable from the keyboard**, including wiring — which
had no keyboard path at all until it was built one.

The design principle is **one tab stop per region, arrows inside it**. Tabbing
through several hundred rack controls would be unusable, so the bank is a single
stop, the rack is a single stop, and the node bank is one stop per group. Arrows
move within.

The full map is in [Keyboard and MIDI](./keyboard.md). The path most worth knowing
is placing a module without a mouse:

<kbd>Tab</kbd> to the catalogue → <kbd>↑</kbd><kbd>↓</kbd> to a module →
<kbd>Enter</kbd> to arm it → <kbd>↑</kbd><kbd>↓</kbd> walks the **legal sockets,
each one announced** → <kbd>Enter</kbd> places it.

Focus is always visible, and dialogs return focus to whatever opened them.

## Screen readers

- **The bank announces its cursor.** Rows carry ids and the list carries
  `aria-activedescendant`. This was once broken in a specific and instructive way:
  the list claimed `role="listbox"` while arrowing through it said *nothing at
  all*.
- **Rows carry their whole state in the label** — name, id, saved, rating,
  prediction — because the row's buttons are deliberately outside the tab order,
  so the label has to encode what they would have said.
- **Sockets announce what will happen** when you arrow onto them: whether placing
  here inserts, replaces or wraps.
- **Transient messages** go to an `aria-live` toast region.
- **Persistent conditions** — a muted unvetted patch, a crashed engine — go to a
  pinned `role="alert"` strip that stays until the condition is resolved, rather
  than a toast that vanishes before it is read.

## Touch and coarse pointers

Every rack gesture works under a finger on a tablet: knob drags, cable pulls,
locks, the ⋯ menus.

Two rules carry it. Controls that own a drag **claim the gesture** before the
browser can, which lets the rack frame keep its own panning. And affordances a
mouse reveals by hovering — knob lock dots, the bank's stars and cut — are
**shown outright** on a coarse pointer, because hover-to-reveal on a tablet means
never. Small glyphs get an invisible finger pad, created only for coarse pointers,
so desktop hit areas are unchanged.

## Hit targets

Measured with `elementFromPoint`, not eyeballed — because two controls turned out
to be far smaller than they looked. An SVG shape only hit-tests where it is
*painted*: a jack's outer circle is unfilled, so only its 1.6px ring responded, and
scanning across an 11px jack found **four live pixels in two slivers**. A knob's
ticks, track and value arc all ride outside its body and were intercepting the
press, so a 44px face had a 36px control inside it.

Both are fixed. If you remember the rack feeling fiddly, it was, and it is not now.

## Colour and contrast

Text meets **4.5:1** against its background. The palette exists in two tiers
precisely for this reason: a text tier that clears the ratio, and a separate
stroke tier for wire glow and jack rings where contrast rules do not apply. Using
one tier for both is what once made every dimmed label in the app fail AA —
including the lineage log, which is the copy that explains what evolution actually
did.

**Colour is never the only channel.** Green versus amber distinguishes audio from
modulation, but modulation cables also terminate in a *named* destination, and
signal kinds are carried by jack labels as well as colour. Style islands are
hue-coded on the taste map *and* named in text everywhere they appear.

## Motion

The rack pulses modulation cables at their modulator's rate, which is informative
rather than decorative. The documentation site honours
`prefers-reduced-motion`. **The instrument does not yet gate its own animations on
it** — that is a real gap, listed below.

## Known gaps

Stated plainly rather than omitted:

- **No handheld layout.** A coarse pointer under 620px gets a stand-in screen
  instead of the instrument. Deliberate for now — boot costs ~40 renders that a
  phone would pay for and have nowhere to display — but it means Auracle is
  unusable on a phone, full stop.
- **`prefers-reduced-motion` is not honoured in the instrument.** The docs site
  respects it; the rack's pulsing cables and the boot animation do not.
- **The taste map is visual only.** The MAP tab has no non-visual equivalent — the
  STYLES and DIRECTIONS tabs carry the same information as named coefficients and
  are the accessible route to it, but the map's spatial reading is not available
  another way.
- **Screen-reader coverage is deepest where it was tested.** The bank and the
  wiring path were built and verified against a screen reader. The scope
  configuration and the image exporter were not.
- **No high-contrast theme.** The palette clears AA but there is no AAA mode and no
  way to raise contrast beyond it.

If you hit something not listed here,
[an issue](https://github.com/alexnodeland/auracle/issues) is genuinely useful —
these gaps are known because someone looked, and the list gets longer when more
people do.
