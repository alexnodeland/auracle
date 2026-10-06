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

/// **No draw depends on the target's width**, in the grammar or in any
/// other engine crate's non-test code: every integer `gen_range` goes
/// through [`gen_index`] or names its type on a bound (`0u64..n`,
/// `0i32..5`), and the only unsuffixed ranges left are float literals.
///
/// An unsuffixed integer range takes its type from where the result goes,
/// and `InputChannel::ALL[rng.gen_range(0..3)]` makes it a `usize`, which
/// wasm32 reads through `next_u32`. A native test cannot see that (on a
/// 64-bit host it is [`gen_index`] word for word, which is the point of
/// the function), and `boot_probe` sees it only in its first draws and
/// only when the misread word changes the tree. So this reads the source,
/// comments and string contents removed, a call spanning lines read as
/// one: a draw added for a new categorical fails here, on the machine it
/// was written on, rather than as a pool the browser deals differently.
///
/// Every `.rs` file under each crate's `src`, at any depth (a module in its
/// own directory, as `auracle-session/src/guess/` is, is read too). Test
/// code, an inline `#[cfg(test)] mod` or a file of tests ([`is_test_file`]),
/// is read in the grammar only, where seeded tests deal patches; this
/// module and its tests, which state the rule and test against the plain
/// draw, are not.
#[test]
fn no_draw_depends_on_the_targets_width() {
    let root = env!("CARGO_MANIFEST_DIR");
    // (directory, whether its test code is read too)
    let dirs = [
        (format!("{root}/src"), true),
        (format!("{root}/../auracle-features/src"), false),
        (format!("{root}/../auracle-taste/src"), false),
        (format!("{root}/../auracle-session/src"), false),
        (format!("{root}/../auracle-wasm/src"), false),
    ];
    let rule = [
        format!("{root}/src/rng.rs"),
        format!("{root}/src/rng/tests.rs"),
    ];
    let mut offenders = Vec::new();
    let mut calls = 0;
    let mut nested = 0;
    for (dir, with_tests) in &dirs {
        let mut files = Vec::new();
        rust_files(std::path::Path::new(dir), &mut files);
        assert!(!files.is_empty(), "no source under {dir}");
        for path in files {
            if rule.iter().any(|r| std::path::Path::new(r) == path)
                || (!with_tests && is_test_file(&path))
            {
                continue;
            }
            nested += usize::from(path.parent() != Some(std::path::Path::new(dir)));
            let text = std::fs::read_to_string(&path).expect("a source file");
            let mut code = code_only(&text);
            if !with_tests {
                code = without_test_modules(&code);
            }
            for (line, arg) in gen_range_args(&code) {
                calls += 1;
                if !names_its_width(&arg) {
                    offenders.push(format!("{}:{line}: gen_range({arg})", path.display()));
                }
            }
        }
    }
    assert!(
        calls > 0,
        "found no gen_range at all, so this proved nothing"
    );
    assert!(
        nested > 0,
        "read no module below the top of a src directory"
    );
    assert!(
        offenders.is_empty(),
        "a draw whose width depends on the target (use gen_index, or suffix a bound):\n{}",
        offenders.join("\n")
    );
}

/// Every `.rs` file under `dir`, at any depth, in name order.
fn rust_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .expect("a source directory")
        .map(|e| e.expect("a directory entry").path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// A file that holds only tests: `tests.rs`, or a name ending `_tests.rs`
/// (the files a `#[cfg(test)] mod tests;` points at, and the names the
/// coverage report leaves out).
fn is_test_file(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n == "tests.rs" || n.ends_with("_tests.rs"))
}

/// The scan itself: what it flags and what it lets through.
#[test]
fn the_width_scan_reads_what_it_claims() {
    let flagged = |src: &str| {
        gen_range_args(&code_only(src))
            .into_iter()
            .filter(|(_, a)| !names_its_width(a))
            .map(|(line, _)| line)
            .collect::<Vec<_>>()
    };
    assert_eq!(flagged("let c = ALL[rng.gen_range(0..3)];"), [1]);
    assert_eq!(flagged("rng.gen_range(0..ALL.len())"), [1]);
    assert_eq!(flagged("rng.gen_range(\n    0..n,\n)"), [1]);
    assert_eq!(flagged("x;\nrng.gen_range(0..=4usize)"), [2]);
    assert!(flagged("rng.gen_range(0i32..5) as i8").is_empty());
    assert!(flagged("rng.gen_range(0u64..n)").is_empty());
    assert!(flagged("rng.gen_range(-1.0..1.0)").is_empty());
    assert!(flagged("rng.gen_range(0.25..9.0)").is_empty());
    assert!(flagged("// rng.gen_range(0..n)\nlet s = \"gen_range(0..n)\";").is_empty());
    let tests = "fn a() {}\n#[cfg(test)]\nmod tests {\n    fn b() { rng.gen_range(0..n); }\n}\n";
    assert_eq!(flagged(tests), [4]);
    let code = without_test_modules(&code_only(tests));
    assert!(gen_range_args(&code).is_empty());
    // A file of tests is test code too; a module file beside it is not.
    let file = |p: &str| is_test_file(std::path::Path::new(p));
    assert!(file("src/guess/tests.rs") && file("src/genome/domain_tests.rs"));
    assert!(!file("src/guess.rs") && !file("src/contests.rs"));
}

/// `src` with comments blanked and string and char literals emptied,
/// newlines kept so line numbers still hold.
fn code_only(src: &str) -> String {
    let b: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    let ident = |c: char| c.is_alphanumeric() || c == '_';
    // Skip to `end` (exclusive), keeping only its newlines.
    let skip = |out: &mut String, from: usize, end: usize| {
        out.extend(b[from..end].iter().filter(|&&c| c == '\n'));
    };
    while i < b.len() {
        let c = b[i];
        let next = b.get(i + 1).copied();
        if c == '/' && next == Some('/') {
            let end = (i..b.len()).find(|&j| b[j] == '\n').unwrap_or(b.len());
            i = end;
        } else if c == '/' && next == Some('*') {
            let end = (i + 2..b.len().saturating_sub(1))
                .find(|&j| b[j] == '*' && b[j + 1] == '/')
                .map_or(b.len(), |j| j + 2);
            skip(&mut out, i, end);
            i = end;
        } else if c == 'r' && (i == 0 || !ident(b[i - 1])) && matches!(next, Some('"') | Some('#'))
        {
            let hashes = (i + 1..b.len()).take_while(|&j| b[j] == '#').count();
            let open = i + 1 + hashes;
            if b.get(open) != Some(&'"') {
                out.push(c);
                i += 1;
                continue;
            }
            let close: String = std::iter::once('"')
                .chain("#".repeat(hashes).chars())
                .collect();
            let close: Vec<char> = close.chars().collect();
            let end = (open + 1..=b.len() - close.len())
                .find(|&j| b[j..j + close.len()] == close[..])
                .map_or(b.len(), |j| j + close.len());
            out.push_str("\"\"");
            skip(&mut out, i, end);
            i = end;
        } else if c == '"' {
            let mut j = i + 1;
            while j < b.len() && b[j] != '"' {
                j += if b[j] == '\\' { 2 } else { 1 };
            }
            let end = (j + 1).min(b.len());
            out.push_str("\"\"");
            skip(&mut out, i, end);
            i = end;
        } else if c == '\'' && next == Some('\\') {
            let end = (i + 2..b.len())
                .find(|&j| b[j] == '\'')
                .map_or(b.len(), |j| j + 1);
            out.push_str("' '");
            i = end;
        } else if c == '\'' && b.get(i + 2) == Some(&'\'') {
            out.push_str("' '");
            i += 3;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// `code` (from [`code_only`]) with every `#[cfg(test)] mod … { … }`
/// blanked, newlines kept.
fn without_test_modules(code: &str) -> String {
    let mut out = code.to_string();
    let mut from = 0;
    while let Some(at) = out[from..].find("#[cfg(test)]").map(|a| a + from) {
        let after = out[at + "#[cfg(test)]".len()..].trim_start();
        from = at + 1;
        let Some(rest) = after.strip_prefix("mod ") else {
            continue;
        };
        let name_end = rest.find(|c: char| !(c.is_alphanumeric() || c == '_'));
        let Some(brace) = name_end
            .map(|n| rest[n..].trim_start())
            .filter(|r| r.starts_with('{'))
            .map(|r| out.len() - r.len())
        else {
            continue;
        };
        let mut depth = 0;
        let end = out[brace..]
            .char_indices()
            .find(|&(_, c)| {
                depth += match c {
                    '{' => 1,
                    '}' => -1,
                    _ => 0,
                };
                depth == 0
            })
            .map_or(out.len(), |(k, _)| brace + k + 1);
        let blank: String = out[at..end]
            .chars()
            .map(|c| if c == '\n' { '\n' } else { ' ' })
            .collect();
        out.replace_range(at..end, &blank);
    }
    out
}

/// Every `gen_range(…)` call in `code`: its line and its argument, with
/// whitespace collapsed, read to the matching parenthesis across lines.
fn gen_range_args(code: &str) -> Vec<(usize, String)> {
    code.match_indices("gen_range(")
        .map(|(at, m)| {
            let rest = &code[at + m.len()..];
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
                .map_or(rest.len(), |(k, _)| k);
            let arg: String = rest[..end].split_whitespace().collect::<Vec<_>>().join(" ");
            let line = code[..at].matches('\n').count() + 1;
            (line, arg.trim_end_matches(',').trim().to_string())
        })
        .collect()
}

/// Does a range argument fix its own type: a bound that is an integer
/// literal with a fixed-width suffix, or two float literals?
fn names_its_width(arg: &str) -> bool {
    const WIDTHS: [&str; 10] = [
        "i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32", "u64", "u128",
    ];
    let Some((lo, hi)) = arg.split_once("..") else {
        return false;
    };
    fn bound(s: &str) -> &str {
        s.trim()
            .trim_start_matches('=')
            .trim()
            .trim_start_matches('-')
    }
    let suffixed = |s: &str| {
        WIDTHS.iter().any(|w| {
            s.strip_suffix(w)
                .is_some_and(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit() || c == '_'))
        })
    };
    let float = |s: &str| s.contains('.') && s.parse::<f64>().is_ok();
    let (lo, hi) = (bound(lo), bound(hi));
    suffixed(lo) || suffixed(hi) || (float(lo) && float(hi))
}
