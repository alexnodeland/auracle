//! Which coordinates of φ a recording measures (Plan-005 task 11).
//!
//! ```bash
//! cargo run -p auracle-features --example file_phi --release
//! ```
//!
//! A dropped file is not the standard phrase, so a coordinate of φ means the
//! same on a file only if it does not depend on the phrase. This measures it.
//! Every preset is rendered on stimuli that are not the phrase
//! ([`recording_stimuli`]), each render is measured as a file
//! ([`featurize_file`]), and the result is compared, coordinate by
//! coordinate, with the same preset's φ on the phrase. The preset is the
//! truth: a file of *that* patch should land where the patch does.
//!
//! `phrase` is the phrase's own render measured as a file: only the trimming
//! and the missing note spans differ, so it is the ceiling, and it is not
//! part of the verdict.
//!
//! Columns per stimulus: `r`, Pearson's correlation across the presets
//! between the file's value and the phrase's; `rmse`, the root-mean-square
//! difference in σ of the presets' spread on the phrase; `bias`, the mean
//! difference (file minus phrase) in the same σ. The verdict: a coordinate
//! is measured by a file when, on every stimulus, `r ≥ SURVIVES_R` and
//! `rmse ≤ SURVIVES_RMSE`. The ones that are not are `FILE_MASKED`, and the
//! last column says whether the mask agrees with today's measurement.

use auracle_features::file::{agreement, recording_stimuli, SURVIVES_R, SURVIVES_RMSE};
use auracle_features::render::render_phrase;
use auracle_features::{featurize, featurize_file, AudioFeatures, PhraseSpec, FILE_MASKED};
use auracle_grammar::preset_bank;
use auracle_grammar::PatchTree;

/// One preset: its audio φ on the phrase, and as a file of the phrase's
/// render and of each stimulus. `None` where a render did not measure.
type Row = (Vec<f64>, Vec<Option<Vec<f64>>>);

fn measure(tree: &PatchTree) -> Option<Row> {
    let spec = PhraseSpec::default();
    let vc = featurize(tree, &spec).ok()?;
    let as_file = |samples: &[f64]| -> Option<Vec<f64>> {
        let pcm: Vec<f32> = samples.iter().map(|&s| s as f32).collect();
        match featurize_file(&pcm, spec.sample_rate) {
            Ok(f) => Some(f.audio.to_vec()),
            Err(e) => {
                eprintln!("  not measured as a file: {}", e.code());
                None
            }
        }
    };
    let mut files = vec![as_file(&vc.render.samples)];
    for (_, s) in recording_stimuli() {
        files.push(
            render_phrase(tree, &s)
                .ok()
                .and_then(|r| as_file(&r.samples)),
        );
    }
    Some((vc.features.audio.to_vec(), files))
}

fn main() {
    let bank = preset_bank();
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let chunk = bank.len().div_ceil(threads);
    let rows: Vec<Row> = std::thread::scope(|s| {
        let handles: Vec<_> = bank
            .chunks(chunk)
            .map(|part| {
                s.spawn(move || {
                    part.iter()
                        .filter_map(|p| measure(&p.tree))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().expect("a measuring thread panicked"))
            .collect()
    });
    let names = AudioFeatures::NAMES;
    let n = rows.len() as f64;
    let labels: Vec<&str> = std::iter::once("phrase")
        .chain(recording_stimuli().into_iter().map(|(n, _)| n))
        .collect();
    println!("{} presets measured on the phrase", rows.len());
    for (k, l) in labels.iter().enumerate() {
        let ok = rows.iter().filter(|r| r.1[k].is_some()).count();
        println!("  {l}: {ok} measured as a file");
    }
    print!("\n{:<24}", "coordinate");
    for l in &labels {
        print!(" {:>21}", format!("{l} r / rmse / bias"));
    }
    println!("  measured  masked");
    let mut disagree = 0;
    for (j, name) in names.iter().enumerate() {
        // The presets' spread on the phrase: the σ every difference is read in.
        let m = rows.iter().map(|r| r.0[j]).sum::<f64>() / n;
        let sd = (rows.iter().map(|r| (r.0[j] - m).powi(2)).sum::<f64>() / n).sqrt();
        let sd = if sd < 1e-9 { 1.0 } else { sd };
        print!("{name:<24}");
        let mut survives = true;
        for k in 0..labels.len() {
            let (a, b): (Vec<f64>, Vec<f64>) = rows
                .iter()
                .filter_map(|r| r.1[k].as_ref().map(|f| (r.0[j], f[j])))
                .unzip();
            let (r, rmse, bias) = agreement(&a, &b, sd);
            if k > 0 && (r < SURVIVES_R || rmse > SURVIVES_RMSE) {
                survives = false;
            }
            print!(" {:>21}", format!("{r:+.2} / {rmse:.2} / {bias:+.2}"));
        }
        let masked = FILE_MASKED.contains(name);
        if masked == survives {
            disagree += 1;
        }
        println!(
            "  {:<8}  {}{}",
            if survives { "yes" } else { "no" },
            if masked { "yes" } else { "no" },
            if masked == survives {
                "   <- disagrees"
            } else {
                ""
            }
        );
    }
    println!(
        "\nverdict: r >= {SURVIVES_R} and rmse <= {SURVIVES_RMSE} on every stimulus; \
         {disagree} coordinate(s) where FILE_MASKED disagrees"
    );
}
