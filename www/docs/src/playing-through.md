# Playing through Auracle

<p class="lede">AUDIO IN brings your own signal into a patch: a microphone, a
guitar through an interface, a drum machine’s line out. Patch it into a filter
or a delay and play through it, or into a follower and let it move the
knobs.</p>

## Add AUDIO IN

1. Open a sound in [PATCH](./views/play.md).
2. Press **ADD MODULE** and, in the catalog, under **SOURCES**, click **audio
   in**. Every socket it can take lights up.
3. Click a lit socket. AUDIO IN takes it, as any source does.
4. The browser asks for a microphone or an interface. Allow it.

The browser is asked only then: never when Auracle opens, and never when you
open a sound that already has AUDIO IN. Once you’ve allowed an input, a sound
with AUDIO IN opens it by itself wherever the browser says it remembers your
answer (Chrome and Edge do). Otherwise its module shows **ALLOW INPUT**.

What AUDIO IN hears stays in this browser. Nothing is sent anywhere.

## The module

AUDIO IN has three settings and a row under them:

| Part | What it does |
|---|---|
| **INPUT** | Which of your inputs it reads, numbered from 1 |
| **GAIN** | Its level, from −24 to +12 dB (unity at 67%) |
| **CHANNEL** | Left, right, or both summed. A mono microphone is the same on all three |
| The input line | The input’s name (*1 · MacBook Pro Microphone*). Click it to pick another |
| The square | Your input, before the patch: its level up the left edge, and its [face](./faces.md) as you play, from what it is playing now |
| **MONITOR** | Hear your input through the sound |
| **NEW CLIP** | Capture a new clip for the model (see [the clip](#the-clip-what-the-model-hears)) |

## Hear it: MONITOR

Monitoring starts off every time Auracle opens, and it turns off when you
open a sound with no AUDIO IN. While it is off, your input moves the level and
nothing else, and the keys play the sound with its AUDIO IN silent.

1. Put on headphones. A microphone near your speakers hears the sound it is
   making and feeds back.
2. Press **MONITOR**.
3. Play into your input. You don’t need to hold a key: the sound is held open
   for you.

The sound is held open as if C4 were held, so your input runs through the
whole patch, the amp envelope included. It settles at the sustain level, as a
held key does. The keys play over it.

```admonish info collapsible=true title="How it works: the open voice"
Every patch ends in its amp envelope, and the keys open it. So with no key
down, a sound with AUDIO IN would be silent however loud its input was.

The live instrument builds a sound with AUDIO IN one voice longer than its
four. With MONITOR on, that extra voice is held at C4 at full velocity, apart
from the four the keys play, so no key, chord, unison, or arpeggio takes it.
Knobs reach it as they reach the others. A sound with no AUDIO IN has no open
voice, so nothing drones.

Every voice hears your input. A key held over the open voice is a second voice
listening, so while it sounds you hear your input twice, as a chord in the
standard phrase does.
```

## Your inputs

The first time you allow an input, the microphone or interface the browser
opens is input 1, and each other one it lists gets the next number. The number
stays with what you plugged in: a sound saved on input 2 reads the same
interface next time, and one you plug in later takes the next free number. There are eight.

To change a module’s input, click its input line and pick one. It is one undo
step, like any setting.

**One input, one stream.** An input is opened once, however many modules read
it, and every one of them shows its level.

**The keys hear one input.** The sound you play takes one input at a time: the
first AUDIO IN’s, in the patch’s order. Another AUDIO IN set to a different
input shows that input’s level, and its input line says *meter only*. In the
sound, it hears the first one’s input.

**Unplugged.** If an input goes away, its modules say *unplugged* and go
silent, and a toast says so. Plug it back in and it opens again by itself, and
MONITOR picks up where it was.

**Refused.** If you refuse the browser’s question, AUDIO IN stays in the patch,
silent, and its module says *input refused*. To allow it later, allow the
microphone for this site in the browser’s settings, then press **ASK AGAIN**.

## The clip: what the model hears

Your input is never the same twice, so the model can’t rate a sound by what it
does to your input live. It hears a sound with AUDIO IN through a **clip**
instead: six seconds of your input, captured the first time it carries a
signal after you add AUDIO IN. Until then, the model hears it through a
built-in plucked phrase.

- A toast says when the capture starts (*Capturing 6 s of …*), and when the
  model has the clip.
- The clip is saved with your session, in this browser. One clip serves every
  AUDIO IN.
- **NEW CLIP** captures again. Play what you mean to play through the sound
  while it runs. Every sound with AUDIO IN in the pool is rated again with the
  new clip.
- **▶** on a sound with AUDIO IN plays it through the clip, as the model hears
  it. The keys and MONITOR play it with your input, live.

The [reference](../reference/audition/clips.html) has how the clip is made,
stored, and measured.

## Play it with your voice: TRACK

**track**, under **DYNAMICS** in the catalog, plays a chain from the pitch
and the notes of what it listens to: sing, whistle, or play a line into an
input, and the chain follows you.

1. Click **track**, then click a lit socket after the chain you want to play.
   The chain goes into TRACK’s first socket, and an AUDIO IN into its second
   (**listen**). Placing it asks for an input, as AUDIO IN does.
2. Put on headphones and press **MONITOR** on the AUDIO IN.
3. Sing or play into the input. The chain plays your notes.

| Knob | What it does |
|---|---|
| **BAND** | Where it listens for a pitch: low (40–500 Hz), mid (70–1000 Hz), or high (140–2000 Hz) |
| **SENSITIVITY** | How quiet a note can be and still play |
| **DYNAMICS** | How far your playing’s level shapes the chain |

There is one input and one pitch in it, so every note a chord plays inside
TRACK’s chain is the note you sing. Keys still play over it: each key sounds
the tracked note through the rest of the patch, and stops when you let it go.

```admonish info collapsible=true title="How it works: one tracked voice"
The open voice is the one that tracks. It is not held like a key: the tracker
opens it when it hears a note and lets it go when you stop. Every key’s voice
follows it, playing the note it tracks frame by frame, and stops with its key.
Without that, each key’s voice tracked the input itself and stayed open while
you sang, so the keys you played piled up.
```

## Record into it: CAPTURE

**capture**, under **SPACE**, records what is patched into it, up to four
seconds, and plays the take from the keys.

1. Click **capture**, then click a lit socket after the chain you want to
   record. Until you record, it is silent.
2. Patch an AUDIO IN into it to record your input, or leave the chain that was
   there to record that.
3. Press **RECORD** on the module and play. Press **STOP** to end it; it stops
   by itself at four seconds.

Each time you record, RECORD makes a new **take**. It goes into the sound as
an edit: one undo step, and the module says how long it is (*take · 2.4 s*).
**PLAY** sets how a key plays it: once to its end, while the key is held, or
round and round. Recording doesn’t need MONITOR, and it doesn’t interrupt what
the keys are playing.

The take is part of that edit, like a knob you turned. To keep the sound with
it, press **KEEP AS NEW** ([keeping an edit](./rack.md#keep-an-edit-as-a-new-sound));
until you do, the sound in the bank still holds the take it had. Moving to
another sound while RECORD is lit stops it, and that recording is dropped:
*Recording stopped: you moved to another sound.*

**Kept safe.** If a saved sound’s take can’t be read when Auracle opens, and
the take was all it played, the sound is kept out of the pool and
listed at the foot of **POOL** under **KEPT SAFE**. Press **RECORD AGAIN** on
it and play into the input it reads: it gets a new take and joins the
pool again.

## Breeding it

A sound with AUDIO IN breeds like any other. ⚡ EVOLVE FROM THIS and a
generation walk it through the clip, and every child keeps its AUDIO IN on
the input you set, while its gain, its channel, and everything around it can
change. No generation adds AUDIO IN to a sound by itself: an input is in a
sound only because you patched it in. A TRACK or a CAPTURE stays where you put
it too, and a CAPTURE keeps its take.

## What it doesn’t do yet

- **One input for the keys** (above), and one clip for every input.

## What to try next

- Put a filter after AUDIO IN, then sweep the cutoff with MONITOR on.
- Patch a **follower** into that filter’s mod slot: the louder you play, the
  further it opens.
- Put AUDIO IN in a **ducker**’s key socket under a pad, or in a **vocoder**’s
  voice socket, and let your playing shape a sound the keys play.
- Read the [PATCH guide](./views/play.md) for the rest of the rack.
