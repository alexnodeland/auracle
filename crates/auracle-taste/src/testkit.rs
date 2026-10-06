//! What the crate's tests share: standardized synthetic φ, one ground-truth
//! listener, and a scratch file of the test process's own.

use rand::Rng;

use crate::synthetic::SyntheticUser;

/// The feature dimension the tests work in.
pub const D: usize = 16;

/// One standardized φ: `D` unit normals, Box–Muller from the caller's stream.
pub fn random_phi<R: Rng>(rng: &mut R) -> Vec<f64> {
    (0..D)
        .map(|_| {
            let (u1, u2): (f64, f64) = (rng.gen(), rng.gen());
            (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
        })
        .collect()
}

/// A sparse, interpretable taste: likes dims 0/3 strongly, dislikes 1/7.
pub fn ground_truth() -> SyntheticUser {
    let mut theta = vec![0.0; D];
    theta[0] = 1.8;
    theta[1] = -1.2;
    theta[3] = 1.0;
    theta[7] = -0.8;
    theta[10] = 0.5;
    SyntheticUser {
        theta,
        tau: 0.4,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    }
}

/// A file of this process's own, so that test runs in several worktrees at
/// once never read each other's half-written files.
pub fn scratch_file(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("auracle-taste-{}-{name}", std::process::id()))
}
