use super::*;
use auracle_features::{featurize, PhraseSpec};
use auracle_grammar::preset_bank;

/// **A name already taken is numbered, from 2.** The first claim takes the
/// name itself, the next ones `base 2`, `base 3`, each recorded, so a bank
/// never shows two rows under one name; a name a player gave counts as
/// taken like any other.
#[test]
fn a_name_already_taken_is_numbered_from_two() {
    let mut taken: HashSet<String> = ["Glass Pad 2".to_string()].into();
    assert_eq!(claim_name("Glass Pad", &mut taken), "Glass Pad");
    assert_eq!(claim_name("Glass Pad", &mut taken), "Glass Pad 3");
    assert_eq!(claim_name("Glass Pad", &mut taken), "Glass Pad 4");
    assert_eq!(taken.len(), 4);
}

/// **A scale fitted on no sounds tells no sounds apart.** With nothing to
/// cut into thirds every axis is inactive, so every sound takes the middle
/// word on each: one name, whatever it sounds like.
#[test]
fn a_scale_fitted_on_no_sounds_tells_no_sounds_apart() {
    let spec = PhraseSpec::default();
    let bank = preset_bank();
    let scale = NameScale::fit(std::iter::empty());
    let names: HashSet<String> = ["First Bass", "Bell Jar", "Noise Wash"]
        .iter()
        .map(|n| {
            let p = bank.iter().find(|p| p.name == *n).expect("a preset");
            scale.name(&featurize(&p.tree, &spec).expect("vets").features)
        })
        .collect();
    assert_eq!(names, HashSet::from(["Soft Key".to_string()]));
}
