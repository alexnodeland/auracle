//! Random draws that come out the same on every target.
//!
//! A seed is a promise that the same session deals the same patches
//! ([ADR-001](../../../docs/decisions/001-one-random-stream-per-consumer.md)),
//! and a promise made on one machine should hold on the next. The engine runs
//! natively (the tests, the diagnostics, `make perform-wirings`) and as wasm in
//! the browser, so a draw has to mean the same thing on both.
//!
//! `rng.gen_range(0..n)` with `n: usize` does not. rand 0.8 draws a `usize`
//! from `next_u32` on a 32-bit target (wasm32) and from `next_u64` on a 64-bit
//! one, and keeps the high bits of the product with the range either way, so
//! the two targets read different words of the same stream, spend a different
//! number of words, and part ways at the first such draw. The grammar's prior
//! picks module kinds by index, so from the same seed it dealt a different tree
//! on each target from the second draw of the fill stream on (the root
//! filter's kind: `SvfLp` natively, `Ladder` in wasm, for the shipped seed;
//! `crates/auracle-wasm/tests/boot_agrees.rs` pins what it now deals). Every
//! other draw the prior makes is already width-independent (an `f64`, a
//! `bool`, a `gen_range` over a literal range, which is an `i32`), so the
//! index is the one thing to pin.
//!
//! Not covered: `fugue-ppl`'s Metropolis step picks the site it moves with
//! `sites[rng.gen_range(0..sites.len())]` (`inference/mh.rs`, 0.2.2), the same
//! `usize` draw, and a walk is built on it. A seeded walk (EVOLVE's breeding,
//! the ⚡ refine) is therefore still not the same on wasm32 and natively, until
//! that call draws a `u64` upstream.

use rand::Rng;

/// A uniform index in `0..n`, drawn as a `u64` on every target.
///
/// `u64` rather than `u32` because that is what a 64-bit `usize` has always
/// drawn: native pools, the checked-in tables and the shipped wirings are
/// unchanged, and wasm32, the one target that read the stream differently,
/// now reads it the way they do. Use this for any index drawn from an RNG
/// whose value reaches a seeded result, in place of `rng.gen_range(0..n)`
/// over a `usize`.
///
/// Panics if `n` is 0, as `gen_range` does.
#[inline]
pub fn gen_index<R: Rng + ?Sized>(rng: &mut R, n: usize) -> usize {
    rng.gen_range(0..n as u64) as usize
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    /// On the 64-bit hosts the tests run on, [`gen_index`] is `gen_range` over a
    /// `usize`, word for word, so pinning the draw did not move one native
    /// pool. (On wasm32 the plain `gen_range` is the one that differs.)
    #[cfg(target_pointer_width = "64")]
    #[test]
    fn an_index_is_what_a_64_bit_usize_always_drew() {
        for n in [1usize, 2, 3, 5, 6, 7, 10, 33, 1000, 1 << 20] {
            let mut a = StdRng::seed_from_u64(n as u64);
            let mut b = StdRng::seed_from_u64(n as u64);
            for _ in 0..200 {
                assert_eq!(gen_index(&mut a, n), b.gen_range(0..n));
            }
            // Both spent the same words, so what follows agrees too.
            assert_eq!(a.gen::<u64>(), b.gen::<u64>());
        }
    }

    /// The first indices of seed 42, as every target must read them: a
    /// `usize` read through `next_u32` would not produce these.
    #[test]
    fn an_index_reads_the_stream_the_same_way_everywhere() {
        let mut rng = StdRng::seed_from_u64(42);
        let drawn: Vec<usize> = (0..12).map(|_| gen_index(&mut rng, 6)).collect();
        assert_eq!(drawn, [3, 3, 2, 0, 2, 4, 5, 0, 5, 3, 2, 3]);
    }

    /// No draw in this crate reads the stream by the target's width: every
    /// `gen_range` is over literals (an `i32` or an `f64`) or a `u64`, and an
    /// index goes through [`gen_index`].
    ///
    /// A native test cannot see the other kind (on a 64-bit host it is
    /// [`gen_index`] word for word, which is the point of the function), and
    /// `boot_probe` only sees one in its first draws and only when the word
    /// it misreads changes the tree. So this reads the source: a
    /// `gen_range(0..ALL.len())` added for a new categorical fails here, on
    /// the machine it was written on, rather than as a pool the browser
    /// deals differently.
    #[test]
    fn no_draw_in_the_crate_depends_on_the_targets_width() {
        let literal = |s: &str| s.trim().trim_start_matches('-').parse::<f64>().is_ok();
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        let mut offenders = Vec::new();
        for entry in std::fs::read_dir(dir).expect("the crate's src") {
            let path = entry.expect("a src entry").path();
            // This module states the rule and tests against the plain draw.
            if path.extension().is_none_or(|e| e != "rs") || path.ends_with("rng.rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("a source file");
            for (n, line) in text.lines().enumerate() {
                if line.trim_start().starts_with("//") {
                    continue;
                }
                for (at, _) in line.match_indices("gen_range(") {
                    // The argument, to its matching parenthesis.
                    let rest = &line[at + "gen_range(".len()..];
                    let mut depth = 1;
                    let end = rest
                        .char_indices()
                        .find(|&(_, c)| {
                            depth += match c {
                                '(' => 1,
                                ')' => -1,
                                _ => 0,
                            };
                            depth == 0
                        })
                        .map_or(rest.len(), |(i, _)| i);
                    let arg = &rest[..end];
                    let fine = arg.trim_end().ends_with("as u64")
                        || arg.split_once("..").is_some_and(|(lo, hi)| {
                            literal(lo) && literal(hi.trim_start_matches('='))
                        });
                    if !fine {
                        offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
                    }
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "a draw whose width depends on the target (use gen_index):\n{}",
            offenders.join("\n")
        );
    }
}
