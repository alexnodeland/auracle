# Films

<p class="lede">Short films about Auracle: what it is, how to play it, and how
it works underneath. Captions are on by default, and every film's full
transcript is printed under it.</p>

Everything you hear in them is Auracle: the music is scored for its own voices
and played by its engine.
The narration is synthetic (Kokoro-82M, offline).

## Start here

### Auracle <span class="film-len">2:03</span>

<figure class="film" id="film-launch">
<video controls preload="none" playsinline poster="../assets/film/launch.jpg">
<source src="../assets/film/launch.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/launch.vtt" srclang="en" label="English" default>
</video>
<figcaption>The launch film: what Auracle is, what it feels like to play, and what is underneath.</figcaption>
</figure>

<ol class="film-chapters">
<li><a href="../assets/film/launch.mp4#t=0.0" data-film="launch" data-t="0.00">0:00</a> Knowing your circuit</li>
<li><a href="../assets/film/launch.mp4#t=21.6" data-film="launch" data-t="21.56">0:22</a> Auracle</li>
<li><a href="../assets/film/launch.mp4#t=27.7" data-film="launch" data-t="27.69">0:28</a> Two sounds, one pick</li>
<li><a href="../assets/film/launch.mp4#t=35.3" data-film="launch" data-t="35.27">0:35</a> Real circuits</li>
<li><a href="../assets/film/launch.mp4#t=43.1" data-film="launch" data-t="43.15">0:43</a> Playing it</li>
<li><a href="../assets/film/launch.mp4#t=71.8" data-film="launch" data-t="71.75">1:12</a> Offers</li>
<li><a href="../assets/film/launch.mp4#t=89.8" data-film="launch" data-t="89.75">1:30</a> Underneath</li>
<li><a href="../assets/film/launch.mp4#t=104.5" data-film="launch" data-t="104.52">1:45</a> Every note</li>
<li><a href="../assets/film/launch.mp4#t=112.9" data-film="launch" data-t="112.91">1:53</a> Play it</li>
</ol>

<details class="film-transcript"><summary>Transcript</summary>

Every synthesizer has a sound in it that's yours. Finding it means knowing your circuit: which modules to wire together, where the feedback goes, and how each choice shapes the sound. Auracle is a synthesizer that searches for your sound. In EVOLVE, it plays you two sounds. You pick the one you like better. Every pick teaches it your taste, and it grows new patches toward it. Not samples. Real modular circuits, built and wired from scratch. Then you play it, in PERFORM. Turn Bright, and it finds the knobs that make this patch brighter. Let it wander, and the knobs turn themselves toward your taste. Press Offer, and a new version grows from the sound in your hands. Blend into it. Take it, or pass. Either way, it learns. Open the sound in PATCH any time. Every knob is real, and you can watch PERFORM turn them. Underneath, a model of your taste bets on every choice before you make it, and keeps score in public. Every note in this film is Auracle. Free, open source, and running in your browser. Play it today.

</details>

## How it works

### How Auracle learns what you like <span class="film-len">1:49</span>

<figure class="film" id="film-taste">
<video controls preload="none" playsinline poster="../assets/film/taste.jpg">
<source src="../assets/film/taste.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/taste.vtt" srclang="en" label="English" default>
</video>
<figcaption>The taste model, animated: what it hears, what a pick tells it, how it keeps score, and how it searches.</figcaption>
</figure>

<ol class="film-chapters">
<li><a href="../assets/film/taste.mp4#t=0.0" data-film="taste" data-t="0.00">0:00</a> Choosing, not describing</li>
<li><a href="../assets/film/taste.mp4#t=10.7" data-film="taste" data-t="10.71">0:11</a> What it listens for</li>
<li><a href="../assets/film/taste.mp4#t=27.9" data-film="taste" data-t="27.86">0:28</a> A pick is evidence</li>
<li><a href="../assets/film/taste.mp4#t=37.9" data-film="taste" data-t="37.86">0:38</a> Every taste that still fits</li>
<li><a href="../assets/film/taste.mp4#t=47.1" data-film="taste" data-t="47.14">0:47</a> More than one taste</li>
<li><a href="../assets/film/taste.mp4#t=57.9" data-film="taste" data-t="57.86">0:58</a> Forecasts, scored</li>
<li><a href="../assets/film/taste.mp4#t=70.7" data-film="taste" data-t="70.71">1:11</a> The search</li>
<li><a href="../assets/film/taste.mp4#t=84.3" data-film="taste" data-t="84.29">1:24</a> Reading what it learned</li>
<li><a href="../assets/film/taste.mp4#t=92.9" data-film="taste" data-t="92.86">1:33</a> Learning while you play</li>
<li><a href="../assets/film/taste.mp4#t=100.0" data-film="taste" data-t="100.00">1:40</a> In the open</li>
</ol>

<details class="film-transcript"><summary>Transcript</summary>

You know which of two sounds you like, long before you can say why. So Auracle never asks you to describe a sound. It asks you to choose. Behind every choice, it listens for the things you hear: how bright a sound is, how noisy, how it starts, and how fast it moves. That's eighteen measurements of every patch's sound, all from the same short phrase, and twenty-six more of how the patch is built. Each pick is evidence: you liked this set of measurements more than that one. Many tastes could explain one pick. A few picks rule most of them out. Auracle keeps every taste that still fits, weighted by how well it fits. With every answer, that cloud of possible tastes draws tighter. And taste isn't one direction. You can love dark drones and bright plucks. So the model keeps several lenses, and a sound only has to please one of them. Before every duel, it writes down a forecast. Afterwards, it checks. The TRUST view shows how honest those forecasts have been, even when the answer is: no better than a coin flip, yet. Then it searches. Evolution proposes new patches from a grammar of modules, and your taste tilts every proposal toward what you'll like. Thousands are heard silently. Only the best few ever reach you. You can read what it learned: a map of every patch you've heard, the styles it found, and each direction with its uncertainty. And when you play, it keeps listening. An offer you hear, then take or pass, counts just like a duel. Your taste, learned in the open. And it never leaves your browser.

</details>

### Under the hood <span class="film-len">2:17</span>

<figure class="film" id="film-engine">
<video controls preload="none" playsinline poster="../assets/film/engine.jpg">
<source src="../assets/film/engine.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/engine.vtt" srclang="en" label="English" default>
</video>
<figcaption>For engineers: the genome, audition, features, the taste model, search, PERFORM's wiring, and the web runtime.</figcaption>
</figure>

<ol class="film-chapters">
<li><a href="../assets/film/engine.mp4#t=0.0" data-film="engine" data-t="0.00">0:00</a> Five crates</li>
<li><a href="../assets/film/engine.mp4#t=10.7" data-film="engine" data-t="10.71">0:11</a> The genome</li>
<li><a href="../assets/film/engine.mp4#t=22.9" data-film="engine" data-t="22.86">0:23</a> Compiling to DSP</li>
<li><a href="../assets/film/engine.mp4#t=30.7" data-film="engine" data-t="30.71">0:31</a> The audition</li>
<li><a href="../assets/film/engine.mp4#t=40.0" data-film="engine" data-t="40.00">0:40</a> Features</li>
<li><a href="../assets/film/engine.mp4#t=55.0" data-film="engine" data-t="55.00">0:55</a> Utility</li>
<li><a href="../assets/film/engine.mp4#t=75.0" data-film="engine" data-t="75.00">1:15</a> Calibration</li>
<li><a href="../assets/film/engine.mp4#t=84.3" data-film="engine" data-t="84.29">1:24</a> Search</li>
<li><a href="../assets/film/engine.mp4#t=98.6" data-film="engine" data-t="98.57">1:39</a> PERFORM's wiring</li>
<li><a href="../assets/film/engine.mp4#t=115.7" data-film="engine" data-t="115.71">1:56</a> The runtime</li>
<li><a href="../assets/film/engine.mp4#t=125.7" data-film="engine" data-t="125.71">2:06</a> Read it, run it</li>
</ol>

<details class="film-transcript"><summary>Transcript</summary>

Auracle is a Rust workspace of five crates, compiled to WebAssembly. Here's how a patch becomes a sound, and a choice becomes a model. A patch is a term in a typed grammar: a probabilistic program over modules. Every knob and every structural choice has a trace address, so a whole patch is one draw from a prior. It compiles to a quiver signal graph, which runs one sample at a time with no allocation on the audio path. Every candidate plays the same standard phrase, normalized for loudness, through a vetting gate that rejects silence, clipping and DC. From that phrase come eighteen perceptual features, from brightness and noisiness to envelope shape and three bands of modulation rate. Twenty-six structural ones come from the patch itself. Every one is standardized. Taste is a utility: the maximum over a few linear experts on those features. A duel, a keep or a cut, a star rating: each has its own likelihood. The posterior is sampled by Markov chain Monte Carlo, and each new answer reweights those samples until a refit is due. Every duel is forecast before it's answered. Each forecast is scored with a proper scoring rule, separately for each kind of evidence. Search targets a Boltzmann distribution: the grammar's prior, tilted by expected utility. Refinement is Metropolis-Hastings on the trace, through fugue-evo. A lock is exact conditioning. PERFORM's named controls are fixed directions in that standardized space of sound. For each patch, a finite-difference Jacobian and a ridge solve wire each control to its knobs. Every half of every control is then checked on real renders. In the browser, the engine runs in a worker, and the voices in an AudioWorklet. A render farm measures candidates in parallel. Every claim here has a measurement behind it, in the reference. Read it, run it, and change it.

</details>

### The math <span class="film-len">2:46</span>

<figure class="film" id="film-math">
<video controls preload="none" playsinline poster="../assets/film/math.jpg">
<source src="../assets/film/math.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/math.vtt" srclang="en" label="English" default>
</video>
<figcaption>For a technical audience: the taste model and the search as the code computes them, and why each piece has the form it does.</figcaption>
</figure>

<ol class="film-chapters">
<li><a href="../assets/film/math.mp4#t=0.0" data-film="math" data-t="0.00">0:00</a> Intro</li>
<li><a href="../assets/film/math.mp4#t=6.4" data-film="math" data-t="6.43">0:06</a> Utility</li>
<li><a href="../assets/film/math.mp4#t=22.9" data-film="math" data-t="22.86">0:23</a> Likelihoods</li>
<li><a href="../assets/film/math.mp4#t=43.6" data-film="math" data-t="43.57">0:44</a> Posterior</li>
<li><a href="../assets/film/math.mp4#t=61.4" data-film="math" data-t="61.43">1:01</a> Calibration</li>
<li><a href="../assets/film/math.mp4#t=77.1" data-film="math" data-t="77.14">1:17</a> Acquisition</li>
<li><a href="../assets/film/math.mp4#t=90.7" data-film="math" data-t="90.71">1:31</a> Target</li>
<li><a href="../assets/film/math.mp4#t=108.6" data-film="math" data-t="108.57">1:49</a> Refine</li>
<li><a href="../assets/film/math.mp4#t=122.9" data-film="math" data-t="122.86">2:03</a> Locks</li>
<li><a href="../assets/film/math.mp4#t=134.3" data-film="math" data-t="134.29">2:14</a> Perform</li>
<li><a href="../assets/film/math.mp4#t=157.1" data-film="math" data-t="157.14">2:37</a> Outro</li>
</ol>

<details class="film-transcript"><summary>Transcript</summary>

The math inside Auracle, and why each piece has its shape. Each patch becomes forty-four features, standardized to one scale. Utility is the maximum over a few linear experts, never their average. So you can love dark drones and bright plucks, and each is scored by its own best lens. Three kinds of answer feed that one utility. A duel is Bradley-Terry, logistic in the utility difference. Cutting a patch is a kill, judged against a bar fitted per session. A picky day moves the bar. Not the taste. Stars fall between fitted cutpoints, so a harsh rater moves the cutpoints. With no hidden lens labels, every parameter is a real number. So plain Metropolis-Hastings fits it, and keeps five hundred draws. Between fits, each answer reweights the draws, exactly and nearly free. When the weights collapse, it pays for a refit. Each duel is forecast before you answer, then scored by Brier. Brier is a proper rule, so only an honest probability scores best. Accuracy cannot see overconfidence. Each kind of evidence gets its own score. Which pair should it ask about? Picking the most informative pair only tied random pairs. Thompson sampling lost. So pairs are random, and every duel is also an unbiased check. Search aims at a Boltzmann target, the grammar's prior times the exponential of beta times expected utility. The prior supplies parsimony as a probability, not a penalty to tune. Beta, at two, is the one dial between browsing and optimizing. Refinement is Metropolis-Hastings on the trace, through fugue-evo. It walks forty steps from each of the ten best patches. Keeping where each walk ends climbs the target instead of sampling it, which suits a shortlist. A lock is exact conditioning. Moves that change, delete or create a locked address are rejected. Checking births as well as deaths keeps detailed balance. PERFORM's controls are fixed directions in standardized sound. Bright is centroid plus rolloff. Each patch gets its own Jacobian from one nudged render per knob, since knobs act differently in each. A ridge solve picks at most four knobs for each control. Each half is then rendered for real, and closes if it stops moving the right way. Every constant here is in the reference, with its measurement where there is one.

</details>

### The sound engine <span class="film-len">2:49</span>

<figure class="film" id="film-dsp">
<video controls preload="none" playsinline poster="../assets/film/dsp.jpg">
<source src="../assets/film/dsp.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/dsp.vtt" srclang="en" label="English" default>
</video>
<figcaption>For audio engineers: the patch graph, the modules and their types, compilation, the audition phrase, loudness, vetting, the features, and the live voices.</figcaption>
</figure>

<ol class="film-chapters">
<li><a href="../assets/film/dsp.mp4#t=0.0" data-film="dsp" data-t="0.00">0:00</a> Intro</li>
<li><a href="../assets/film/dsp.mp4#t=7.1" data-film="dsp" data-t="7.14">0:07</a> Graph</li>
<li><a href="../assets/film/dsp.mp4#t=22.9" data-film="dsp" data-t="22.86">0:23</a> Modules</li>
<li><a href="../assets/film/dsp.mp4#t=41.4" data-film="dsp" data-t="41.43">0:41</a> Compile</li>
<li><a href="../assets/film/dsp.mp4#t=54.3" data-film="dsp" data-t="54.29">0:54</a> Phrase</li>
<li><a href="../assets/film/dsp.mp4#t=72.1" data-film="dsp" data-t="72.14">1:12</a> Vetting</li>
<li><a href="../assets/film/dsp.mp4#t=82.9" data-film="dsp" data-t="82.86">1:23</a> Loudness</li>
<li><a href="../assets/film/dsp.mp4#t=99.3" data-film="dsp" data-t="99.29">1:39</a> Features</li>
<li><a href="../assets/film/dsp.mp4#t=130.0" data-film="dsp" data-t="130.00">2:10</a> Live</li>
<li><a href="../assets/film/dsp.mp4#t=149.3" data-film="dsp" data-t="149.29">2:29</a> Farm</li>
<li><a href="../assets/film/dsp.mp4#t=159.3" data-film="dsp" data-t="159.29">2:39</a> Outro</li>
</ol>

<details class="film-transcript"><summary>Transcript</summary>

This is how Auracle makes sound, from the patch graph to the live voices. Underneath is quiver, a modular synthesis library in Rust. On each tick, one sample moves through the whole graph. Continuous knobs are atomic values the audio thread reads, so turning one needs no recompile. The palette has forty-two modules, from a plucked string to sidechained dynamics. The filter is a state variable design, or a diode ladder that saturates harder one way. Audio and modulation are separate Rust types, so a mistyped patch cannot even be built. Every voice ends with a DC blocker where needed, an exponential envelope, and a limiter. Resonance and feedback are capped, so filters cannot oscillate and delays cannot run away. For comparison, every patch plays the same five second phrase. It holds a C, stabs an octave higher, and plays a two note chord. It ends on a low C, with a long release. The random seed is reset every render, so the samples repeat bit for bit. First, each raw render goes through a gate. It fails silence, runaway peaks, and signals dominated by DC. What fails is never played. Loudness is measured the broadcast way, with K weighting and gated blocks. Each patch is matched to minus eighteen loudness units, since louder wins comparisons. The gain stops short of clipping instead of limiting, so timbre is untouched. From that render come eighteen audio features. Four measure the spectrum's brightness and its movement, on a logarithmic frequency axis. Texture, level and envelope take seven more, and one measures the bass. Three are read from single notes. Three more are bands of motion on the held note. The bands run from half a hertz to two, and from two to eight. The fastest runs from eight to thirty. Twenty-six structural features come from the patch, with no render. Live, the same compiler builds four voices inside an AudioWorklet. Four more play PERFORM's offers, crossfaded at equal power. In steady state, the audio thread allocates nothing. A patch change fades out, rebuilds the voices in silence, and carries your held notes across. Auditions render in parallel, on up to six workers. Draws are indexed and absorbed in order, so the pool is identical at any width. One compiler serves search and stage, so what you play is what the model measured.

</details>
