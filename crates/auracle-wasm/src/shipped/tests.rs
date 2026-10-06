use super::*;

#[test]
fn a_source_ignores_uids_and_sees_everything_else() {
    let bank = auracle_grammar::preset_bank();
    let p = &bank[0];
    let mut again = p.tree.clone();
    again.ensure_uids();
    assert_eq!(
        preset_source(p.name, &p.tree),
        preset_source(p.name, &again)
    );
    assert_ne!(
        preset_source(p.name, &p.tree),
        preset_source("renamed", &p.tree)
    );
    assert_ne!(
        preset_source(p.name, &p.tree),
        preset_source(p.name, &bank[1].tree)
    );
}
