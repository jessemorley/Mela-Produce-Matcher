// Recipes whose in-season matches include a given produce tile — the one
// comparison behind both the In Season tile counts and the selected-produce
// detail pane.
//
// The exact compare is safe here only because `m.produce` is the name the
// backend matched *against* (see `Match` in lib.rs), drawn from the same feed
// and seasonal-table vocabulary the tiles carry. Comparing against
// `m.ingredient` instead would be comparing across vocabularies and would
// need produce_matches' rules reimplemented in JS — which is the bug this
// shape exists to make impossible. Case-folded because the feed capitalises
// inconsistently ("Brussel sprout").
export function recipesUsing(rankedRecipes, name) {
  const n = name.trim().toLowerCase();
  return rankedRecipes.filter((r) =>
    [...r.pick_matches, ...r.seasonal_matches].some(
      (m) => m.produce.trim().toLowerCase() === n,
    ),
  );
}
