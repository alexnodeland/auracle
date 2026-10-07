//! Which sounds a deal draws from, and what it does when it draws a cut one
//! (#211).
//!
//! **The schedule.** The app hands the player a pair at eight sounds and
//! fills the rest of the pool behind them, so how many sounds had joined when
//! a deal was drawn depended on the machine: the same seed dealt 4,10 on one
//! boot and 5,6 on another. Under a [`DealSchedule`] the `k`-th deal of a
//! session draws only from the first `step · (k + 1)` members of the pool, in
//! pool order (the order the seed's fill folds its draws in, the same on
//! every machine), until that reaches the pool's size; every deal after it
//! draws from the whole pool. A caller that waits until those members have
//! joined before it deals ([`Engine::deal_need`]) deals the same pairs however
//! fast the pool filled. The wait costs a fast picker time, so the app sets a
//! schedule only for a session opened with a seed in the address, the one
//! kind whose pairs must be the same on every machine; every other session
//! deals with none, at once, from the members that have joined.
//!
//! **A cut sound.** A deal used to draw over the sounds not cut, by index, so
//! a cut anywhere in the pool moved every deal after it, even one that dealt
//! neither cut sound. Now a deal draws over every sound its schedule names,
//! cut ones included, and a pair holding a cut sound is thrown away and the
//! next deal of the session drawn in its place. A cut elsewhere then changes
//! nothing, and a pair that holds the cut sound becomes the deal the app would
//! have asked for after refusing it: the same pair whether the cut came
//! before the deal was asked for or after. That holds for the uniform draws
//! (the random rule, the scheduled checks, and every deal before the first
//! fit); the choosing rules score the sounds not cut, as they did.

use super::*;

#[cfg(test)]
mod tests;

/// How far into the pool each deal of a session reaches: the `k`-th deal
/// (from 0) draws from the first `step · (k + 1)` members, in pool order,
/// until that reaches the pool's size, and every later deal from the whole
/// pool. `dealt` is `k` for the next deal: every deal drawn so far, the ones
/// thrown away for holding a cut sound included. A step of 0 is no schedule:
/// every deal draws from the whole pool, as it is when the deal is drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DealSchedule {
    /// How many members the first deal reaches, and how many more each
    /// deal after it reaches. 0: no schedule.
    pub step: usize,
    /// Deals drawn so far this session: the next deal's place in the
    /// sequence.
    pub dealt: u64,
}

impl DealSchedule {
    /// A schedule of `step`, with no deal drawn yet.
    pub fn new(step: usize) -> Self {
        Self { step, dealt: 0 }
    }

    /// How far deal `k` reaches into a pool of target size `pool_size`:
    /// `Some(n)` for its first `n` members, `None` for all of it.
    pub fn reach(&self, k: u64, pool_size: usize) -> Option<usize> {
        if self.step == 0 {
            return None;
        }
        let n = (self.step as u128) * (u128::from(k) + 1);
        (n < pool_size as u128).then_some(n as usize)
    }

    /// How many members must have joined before deal `k` is drawn as the
    /// schedule says: its reach, or the pool's size for a deal that draws
    /// from the whole pool. None without a schedule.
    pub fn need(&self, k: u64, pool_size: usize) -> usize {
        match (self.step, self.reach(k, pool_size)) {
            (0, _) => 0,
            (_, Some(n)) => n,
            (_, None) => pool_size,
        }
    }
}

/// How a deal is drawn: uniformly (saying how), or by a choosing rule under
/// its posterior.
enum Rule<'a> {
    Uniform(&'static str),
    Thompson(&'a TastePosterior),
    Bald(&'a TastePosterior),
}

/// What one request for a pair comes to: the pair (none when fewer than two
/// sounds may be dealt from the whole pool), how many deals were drawn for
/// it, and, for a plan that may wait, how many members the first deal it
/// could not draw yet needs.
struct Planned {
    choice: Option<DuelChoice>,
    deals: u64,
    waits: Option<usize>,
}

impl Engine {
    /// The deals one request draws, from `sched`'s next on: each over the
    /// members its reach names (those standardized), until one deals a pair
    /// with no sound in `exclude`. `patient`: stop at the first deal whose
    /// members have not all joined rather than draw it over those that have.
    /// Reads the engine and draws from `rng`; changes nothing else, so a
    /// copy of the stream can plan without dealing.
    fn plan_deal<R: Rng>(
        &self,
        rng: &mut R,
        exclude: &[u64],
        sched: &DealSchedule,
        patient: bool,
    ) -> Planned {
        let size = self.cfg.pool_size;
        let len = self.pool.len();
        // A scheduled check, every `duel_check_every` pairs shown; none with
        // 0, as `is_multiple_of(0)` holds only of 0, which `> 0` rules out.
        let check =
            self.duels_shown > 0 && self.duels_shown.is_multiple_of(self.cfg.duel_check_every);
        // No taste yet, the random rule, or a scheduled check: a uniform
        // pair. A uniform pair *is* a calibration check, so it is tagged as
        // one whether it was scheduled or is simply how this engine picks
        // every duel. Under the random rule a scheduled check is no
        // different from any other deal and says "random": labelled
        // "check", every tenth pair read as the exception to a rule that has
        // none.
        let rule = match (self.posterior.as_deref(), check) {
            (None, _) => Rule::Uniform("random"),
            (Some(_), _) if self.cfg.acquisition == Acquisition::Random => Rule::Uniform("random"),
            (Some(_), true) => Rule::Uniform("check"),
            (Some(p), false) if self.cfg.acquisition == Acquisition::Thompson => Rule::Thompson(p),
            (Some(p), false) => Rule::Bald(p),
        };
        let cut = |i: usize| exclude.contains(&self.pool[i].id);
        let mut k = sched.dealt;
        loop {
            let deals = k - sched.dealt + 1;
            let need = sched.need(k, size);
            if patient && len < need {
                return Planned {
                    choice: None,
                    deals,
                    waits: Some(need),
                };
            }
            let end = sched.reach(k, size).map_or(len, |n| n.min(len));
            // Un-standardized candidates score utility exactly 0 (`dot` over
            // an empty vector), which beats every real utility once a user
            // has killed enough patches: they must not be selectable, the
            // same guard `ranked()` applies.
            let set: Vec<usize> = (0..end)
                .filter(|&i| !self.pool[i].phi_std.is_empty())
                .collect();
            let free: Vec<usize> = set.iter().copied().filter(|&i| !cut(i)).collect();
            // No later deal reaches further: with fewer than two sounds to
            // deal there is no pair.
            if free.len() < 2 && end == len {
                return Planned {
                    choice: None,
                    deals,
                    waits: None,
                };
            }
            let dealt = match rule {
                // Drawn over the cut sounds too, so a cut elsewhere moves
                // nothing. Each draw lands on two dealable sounds with
                // probability at least 2 / (n (n - 1)), so the deals end: in
                // a pool of 40 with two sounds left uncut, after about 780 on
                // average, microseconds of draws.
                Rule::Uniform(method) if set.len() >= 2 => {
                    let (a, b) = uniform_pair(rng, &set);
                    (!cut(a) && !cut(b)).then_some(DuelChoice {
                        a,
                        b,
                        info_gain: 0.0,
                        random_check: true,
                        method,
                    })
                }
                Rule::Thompson(posterior) if free.len() >= 2 => {
                    let (a, b) = thompson_pair(posterior, &self.pool, &free, rng);
                    Some(DuelChoice {
                        a,
                        b,
                        info_gain: 0.0,
                        random_check: false,
                        method: "thompson",
                    })
                }
                Rule::Bald(posterior) if free.len() >= 2 => {
                    let (a, b, info) = self.bald_pair(posterior, &free, rng);
                    Some(DuelChoice {
                        a,
                        b,
                        info_gain: info,
                        random_check: false,
                        method: "bald",
                    })
                }
                _ => None,
            };
            if dealt.is_some() {
                return Planned {
                    choice: dealt,
                    deals,
                    waits: None,
                };
            }
            // Thrown away (a side is cut), or nothing to draw this far in:
            // the next deal of the session, which may reach further.
            k += 1;
        }
    }

    /// How many members the pool must hold before the next deal, with the
    /// sounds in `exclude` not dealt, is drawn as `sched` says: 0 when it can
    /// be drawn now. Plans on a copy of `rng`, so it draws nothing. A deal
    /// thrown away for holding an excluded sound is followed by the next,
    /// which may reach further, so this can name more members than the next
    /// deal's own reach.
    pub fn deal_need<R: Rng + Clone>(
        &self,
        rng: &R,
        exclude: &[u64],
        sched: &DealSchedule,
    ) -> usize {
        let planned = self.plan_deal(&mut rng.clone(), exclude, sched, true);
        planned.waits.unwrap_or(0)
    }

    /// Deal the next pair under `sched`, never dealing a sound in `exclude`,
    /// without counting it as shown (see [`Engine::deal_duel_except`]), and
    /// count the deals drawn in `sched`. Drawn now, over the members that
    /// have joined: a caller that keeps to the schedule waits until
    /// [`Engine::deal_need`] says 0, or until the pool has stopped growing.
    pub fn deal_duel_scheduled<R: Rng>(
        &mut self,
        rng: &mut R,
        exclude: &[u64],
        sched: &mut DealSchedule,
    ) -> Option<DuelChoice> {
        let planned = self.plan_deal(rng, exclude, sched, false);
        sched.dealt += planned.deals;
        let choice = planned.choice?;
        let key = pair_key(self.pool[choice.a].id, self.pool[choice.b].id);
        self.dealt_unshown.push_back((key, choice.random_check));
        if self.dealt_unshown.len() > DEALT_UNSHOWN {
            self.dealt_unshown.pop_front();
        }
        Some(choice)
    }
}
