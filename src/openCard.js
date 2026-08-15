// Which card is expanded in the In Season stack. `openId` is null when
// nothing is open (initial state, or a deliberate collapse) or a recipe id.
// If the open recipe is gone (produce changed under us, or it was excluded),
// falls back to closed rather than popping a different card open.
export function resolveOpen(recipes, openId) {
  return recipes.some((r) => r.id === openId) ? openId : null;
}
