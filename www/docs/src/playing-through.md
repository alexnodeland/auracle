# Playing through Auracle

<p class="lede">AUDIO IN brings your own signal into a patch: a microphone, a
guitar through an interface, a drum machine’s line out. Patch it into a filter
or a delay and play through it, or into a follower and let it move the
knobs.</p>

## Add AUDIO IN

1. Open a sound in [PATCH](./views/play.md).
2. In the module rail, under **SOURCES**, click **audio in**. Every socket it
   can take lights up.
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
| The input line | The device on that input (*1 · MacBook Pro Microphone*). Click it to pick another |
| The square | Your input’s level, before the patch |
| **MONITOR** | Hear your input through the sound |
| **NEW CLIP** | Capture a new clip for the model (see [the clip](#the-clip-what-the-model-hears)) |

## Hear it: MONITOR

Monitoring starts off every time Auracle opens. While it is off, your input
moves the level and nothing else, and the keys play the sound with its AUDIO
IN silent.

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

The first time you allow an input, the device the browser opens is input 1,
and each other device it lists gets the next number. The number stays with
the device: a sound
saved on input 2 reads the same interface next time, and a device you plug in
later takes the next free number. There are eight.

To change a module’s input, click its input line and pick one. It is one undo
step, like any setting.

**One device, one stream.** A device is opened once, however many modules read
it, and every one of them shows its level.

**The keys hear one input.** The sound you play takes one input at a time: the
first AUDIO IN’s, in the patch’s order. Another AUDIO IN set to a different
input shows that input’s level, and its input line says *meter only*. In the
sound, it hears the first one’s input.

**Unplugged.** If a device goes away, its modules say *unplugged* and go
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

## Breeding it

A sound with AUDIO IN breeds like any other. ⚡ EVOLVE FROM THIS and a
generation walk it through the clip, and every child keeps its AUDIO IN on
the input you set, while its gain, its channel, and everything around it can
change. No generation adds AUDIO IN to a sound by itself: an input is in a
sound only because you patched it in.

## What it doesn’t do yet

- **No face yet.** The square on the module shows your input’s level; a face of
  your input will take its place.
- **One input for the keys** (above), and one clip for every input.

## What to try next

- Put a filter after AUDIO IN, then sweep the cutoff with MONITOR on.
- Patch a **follower** into that filter’s mod slot: the louder you play, the
  further it opens.
- Put AUDIO IN in a **ducker**’s key socket under a pad, or in a **vocoder**’s
  voice socket, and let your playing shape a sound the keys play.
- Read the [PATCH guide](./views/play.md) for the rest of the rack.
