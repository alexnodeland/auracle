//! # evosynth-session
//!
//! The **two-loop engine** (DESIGN.md §1.5) — the orchestration layer every
//! frontend (web, plugin) drives:
//!
//! - **Patch loop** (fast, silent, machine-paced): tempered SMC over
//!   `π_β(x) ∝ p_grammar(x) · exp(β · E[u_θ(x)])` — grammar prior, subtree
//!   moves, struct-only screening, render survivors, feature-score.
//! - **Taste loop** (slow, human-paced, persistent): feedback events condition
//!   the (θ, z, τ) posterior, persisted across sessions.
//!
//! Between them sits **acquisition**: choosing what to play the user —
//! exploit (high `E[u]`) vs explore (max expected information gain on θ).
//! A confident model serves bangers; an uncertain one asks good questions.
//! This is what defeats interactive evolution's human-bottleneck failure mode.
//!
//! All session UX modes (duel stream, population grid, radio) are thin
//! emitters into the same observation stream — the engine does not know or
//! care which surface produced an event.

pub mod engine {
    //! Session lifecycle: candidate pool, SMC scheduling, β schedule.
}

pub mod acquisition {
    //! Explore/exploit selection of duels, panels, and radio queue items.
}

pub mod events {
    //! The unified observation stream consumed by `evosynth-taste`.
}

#[cfg(test)]
mod tests {
    #[test]
    fn workspace_smoke() {
        // Replaced in M4 by the headless closed loop: engine + synthetic user
        // end-to-end, asserting taste convergence without any UI.
    }
}
