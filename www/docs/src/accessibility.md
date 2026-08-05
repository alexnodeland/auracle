# Accessibility

<p class="lede">What works, how, and what does not yet.</p>

Auracle is a dense expert tool. Coverage is uneven, and this page says where.

## Keyboard

**Everything structural is reachable from the keyboard**, including wiring.

The design principle is **one tab stop per region, arrows inside it**. Tabbing
through several hundred rack controls would be unusable, so the bank is a
single stop, the rack is a single stop, and the node bank is one stop per
group. Arrows move within.

The full map is in [Keyboard and MIDI](./keyboard.md). The path most worth
knowing is placing a module without a mouse:

<kbd>Tab</kbd> to the catalogue → <kbd>↑</kbd><kbd>↓</kbd> to a module →
<kbd>Enter</kbd> to arm it → <kbd>↑</kbd><kbd>↓</kbd> walks the **legal sockets,
each one announced** → <kbd>Enter</kbd> places it.

Focus is always visible, and dialogs return focus to whatever opened them.

## Screen readers

- **The bank announces its cursor.** Rows carry ids and the list carries
  `aria-activedescendant`.
- **Rows carry their whole state in the label** (name, id, saved, rating,
  prediction), because the row's buttons sit outside the tab order and the
  label has to encode what they would have said.
- **Sockets announce what will happen** when you arrow onto them: whether
  placing here inserts, replaces or wraps.
- **Transient messages** go to an `aria-live` toast region.
- **Persistent conditions** such as a muted unvetted patch or a crashed engine
  go to a pinned `role="alert"` strip that stays until the condition is
  resolved, rather than a toast that vanishes before it is read.

## Touch and coarse pointers

Every rack gesture works under a finger on a tablet: knob drags, cable pulls,
locks, the ⋯ menus.

Two rules carry it. Controls that own a drag **claim the gesture** before the
browser can, which lets the rack frame keep its own panning. And affordances a
mouse reveals by hovering (knob lock dots, the bank's stars and cut) are
**shown outright** on a coarse pointer, because hover-to-reveal on a tablet
means never. Small glyphs get an invisible finger pad, created only for coarse
pointers, so desktop hit areas are unchanged.

## Hit targets

Hit areas are measured with `elementFromPoint` rather than eyeballed. A knob's
whole face is grabbable, including under its ticks, track and value arc, and a
jack responds across its full ring diameter rather than only where its outline
is painted.

## Colour and contrast

Text meets **4.5:1** against its background. The palette has two tiers for
this: a text tier that clears the ratio, and a separate stroke tier for wire
glow and jack rings, where contrast rules do not apply.

**Colour is never the only channel.** Green versus amber distinguishes audio
from modulation, but modulation cables also terminate in a *named* destination,
and signal kinds are carried by jack labels as well as colour. Style islands
are hue-coded on the taste map *and* named in text everywhere they appear.

## Motion

The rack pulses modulation cables at their modulator's rate, which carries
information rather than decorating. The documentation site honours
`prefers-reduced-motion`. **The instrument does not yet gate its own animations
on it**, which is listed as a gap below.

## Known gaps

- **No handheld layout.** A coarse pointer under 620px gets a stand-in screen
  instead of the instrument. Deliberate for now: boot costs ~40 renders that a
  phone would pay for and have nowhere to display. It does mean Auracle is
  unusable on a phone.
- **`prefers-reduced-motion` is not honoured in the instrument.** The docs site
  respects it; the rack's pulsing cables and the boot animation do not.
- **The taste map is visual only.** The STYLES and DIRECTIONS tabs carry the
  same information as named coefficients and are the accessible route to it,
  but the map's spatial reading is not available another way.
- **Screen-reader coverage is deepest where it was tested.** The bank and the
  wiring path were built and verified against a screen reader. The scope
  configuration and the image exporter were not.
- **No high-contrast theme.** The palette clears AA but there is no AAA mode
  and no way to raise contrast beyond it.

If you hit something not listed here,
[an issue](https://github.com/alexnodeland/auracle/issues) is genuinely useful.
