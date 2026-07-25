// Which card is expanded in the In Season stack.
//
// Three states, not two — `undefined` (untouched, so default to the top
// match) has to be distinguishable from `null` (deliberately collapsed). If
// they collapse together, the collapse button on the first card appears to do
// nothing, because the fallback immediately reopens it.
export function resolveOpen(recipes, openId) {
  if (openId === null) return null; // collapsed on purpose — stays collapsed
  // Untouched, or the open recipe is gone (produce changed under us).
  return recipes.some((r) => r.id === openId) ? openId : recipes[0]?.id;
}
