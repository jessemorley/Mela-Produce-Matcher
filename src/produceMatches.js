// JS mirror of `produce_matches` in src-tauri/src/lib.rs. The backend stores
// the *recipe's* ingredient name in pick_matches/seasonal_matches (e.g.
// "brussels sprouts"), while the In Season tiles carry the feed/table name
// ("brussels sprout", "Brussel sprout") — so an `===` compare shows "no
// recipes" on names the backend already matched. Keep the two in sync; the
// rules are documented in full on the Rust side.

const NOT_A_PRODUCE_FORM = new Set([
  "tortilla", "tortillas", "flour", "starch", "vinegar", "syrup", "oil", "chip", "chips",
  "flake", "flakes", "powder", "extract", "meal", "bread", "cereal", "milk",
]);

function singular(word) {
  if (word.endsWith("es")) {
    const stem = word.slice(0, -2);
    if (stem.endsWith("o") || stem.endsWith("ch") || stem.endsWith("sh")) return stem;
  }
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

const normalise = (s) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(singular);

// True if a produce name and a recipe ingredient name the same thing. Compared
// from the front, so one may extend the other with trailing words ("sugar snap"
// == "sugar snap peas") but a leading qualifier makes it a different ingredient
// ("potato" != "sweet potato").
export function produceMatches(produce, key) {
  const a = normalise(produce);
  const b = normalise(key);
  const shared = Math.min(a.length, b.length);
  if (shared === 0) return false;
  for (let i = 0; i < shared; i++) if (a[i] !== b[i]) return false;
  const longer = a.length > b.length ? a : b;
  return !longer.slice(shared).some((w) => NOT_A_PRODUCE_FORM.has(w));
}

// Recipes whose matched produce includes `name` — the single comparison behind
// both the In Season tile counts and the selected-produce detail pane.
export function recipesUsing(rankedRecipes, name) {
  return rankedRecipes.filter((r) =>
    [...r.pick_matches, ...r.seasonal_matches].some((m) => produceMatches(name, m)),
  );
}
