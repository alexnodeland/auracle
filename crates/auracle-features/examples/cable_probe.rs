//! What the cable probe costs, and what it reads (Plan-005 task 9e).
//!
//! For every preset: the standard phrase rendered plain (`render_phrase`)
//! and with every audio cable read after every tick (`probe_cables`), each
//! timed in this thread's CPU time, alternately, so a busy machine slows
//! both alike; and the two renders compared bit for bit. Then every cable of
//! `--show` presets, as PATCH would draw them.
//!
//! cargo run --release -p auracle-features --example cable_probe -- [--show "Dub Echo"]
//!
//! The wasm twin is `crates/auracle-wasm/examples/cable_cost.mjs`.
use auracle_features::{probe_cables, render_phrase, PhraseSpec};

/// This thread's CPU time, in ms.
fn cpu_ms() -> f64 {
    #[repr(C)]
    struct Timespec {
        sec: i64,
        nsec: i64,
    }
    extern "C" {
        fn clock_gettime(clock: i32, tp: *mut Timespec) -> i32;
    }
    #[cfg(target_os = "macos")]
    const THREAD_CPUTIME: i32 = 16;
    #[cfg(not(target_os = "macos"))]
    const THREAD_CPUTIME: i32 = 3;
    let mut t = Timespec { sec: 0, nsec: 0 };
    // SAFETY: `clock_gettime` writes one `timespec` into memory we own.
    let ok = unsafe { clock_gettime(THREAD_CPUTIME, &mut t) } == 0;
    if ok {
        t.sec as f64 * 1e3 + t.nsec as f64 * 1e-6
    } else {
        f64::NAN
    }
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let show: Vec<String> = args
        .iter()
        .enumerate()
        .filter(|(_, a)| *a == "--show")
        .filter_map(|(i, _)| args.get(i + 1).cloned())
        .collect();
    let show = if show.is_empty() {
        vec!["Dub Echo".to_string(), "Sub & Sparkle".to_string()]
    } else {
        show
    };
    let spec = PhraseSpec::default();
    let presets = auracle_grammar::presets();
    println!(
        "{} presets, the standard phrase ({} samples)\n",
        presets.len(),
        spec.total_samples()
    );
    println!("preset                     cables  plain ms  probed ms  overhead  identical");
    let (mut plain_all, mut probed_all, mut ratio_all) = (Vec::new(), Vec::new(), Vec::new());
    let mut differ = 0;
    for (name, tree) in &presets {
        // Warm once, then two alternating rounds; the faster of each.
        let _ = render_phrase(tree, &spec);
        let (mut plain, mut probed) = (f64::INFINITY, f64::INFINITY);
        let mut same = true;
        let mut cables = 0;
        for _ in 0..2 {
            let t = cpu_ms();
            let a = render_phrase(tree, &spec).expect("renders");
            plain = plain.min(cpu_ms() - t);
            let t = cpu_ms();
            let (b, p) = probe_cables(tree, &spec).expect("renders");
            probed = probed.min(cpu_ms() - t);
            cables = p.cables.len();
            same &= a.samples.len() == b.samples.len()
                && a.samples
                    .iter()
                    .zip(&b.samples)
                    .all(|(x, y)| x.to_bits() == y.to_bits());
        }
        if !same {
            differ += 1;
        }
        println!(
            "{name:<26} {cables:>6} {plain:>9.0} {probed:>10.0} {:>8.1}% {:>10}",
            100.0 * (probed / plain - 1.0),
            if same { "yes" } else { "NO" }
        );
        plain_all.push(plain);
        probed_all.push(probed);
        ratio_all.push(probed / plain);
    }
    println!(
        "\nmedian: plain {:.0} ms, probed {:.0} ms, probed/plain {:.3}; renders that differ: {differ}",
        median(plain_all),
        median(probed_all),
        median(ratio_all)
    );
    for name in &show {
        let Some((_, tree)) = presets.iter().find(|(n, _)| n == name) else {
            println!("\nno preset named {name}");
            continue;
        };
        let mut tree = tree.clone();
        tree.ensure_uids();
        let (_, p) = probe_cables(&tree, &spec).expect("renders");
        println!("\n{name}: every audio cable, dB re 1 V over the phrase (the live meter's scale)");
        println!("  from        to          rms dB   peak dB");
        for c in &p.cables {
            println!(
                "  {:<11} {:<11} {:>7.1} {:>9.1}",
                c.from, c.to, c.rms_db, c.peak_db
            );
        }
    }
}
