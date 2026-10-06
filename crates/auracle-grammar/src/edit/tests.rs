use super::*;
use crate::tests::draw;
use crate::PatchGrammarPrior;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// Structural sites reject knob edits; unknown addresses error cleanly.
#[test]
fn edits_reject_structure_and_unknowns() {
    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(12);
    let (tree, _) = draw(&prior, &mut rng);
    assert!(matches!(
        set_param(&tree, "node#leaf", ParamValue::Index(0)),
        Err(EditError::Structural(_))
    ));
    assert!(matches!(
        set_param(&tree, "nowhere#cut", ParamValue::Continuous(0.5)),
        Err(EditError::UnknownAddress(_))
    ));
}
