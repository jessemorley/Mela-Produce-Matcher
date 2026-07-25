// node src/produceMatches.test.js
// Mirrors produce_matches_on_word_boundaries_not_substrings in lib.rs. If the
// two drift, In Season tiles silently show "no recipes" for produce the
// backend already matched.
import assert from "node:assert";
import { produceMatches, recipesUsing } from "./produceMatches.js";

// The bug this file exists for: tile name is the feed/table name, the stored
// match is the recipe's own ingredient name.
assert(produceMatches("brussels sprout", "brussels sprouts"));
assert(produceMatches("Brussel sprout", "brussel sprouts"));

assert(produceMatches("corn", "corn"));
assert(produceMatches("potato", "potatoes"));
assert(produceMatches("Apple", "apples"));
assert(produceMatches("snow pea", "snow peas"));
assert(produceMatches("sugar snap", "sugar snap peas"));

// Leading qualifier = different ingredient.
assert(!produceMatches("potato", "sweet potato"));
assert(!produceMatches("broccoli", "broccolini"));
assert(!produceMatches("corn", "sweet corn"));
// Mid-word, not a word boundary.
assert(!produceMatches("corn", "corned beef"));
assert(!produceMatches("pea", "peanut butter"));
assert(!produceMatches("orange", "oregano"));
// Trailing word names a product, not a form of the produce.
assert(!produceMatches("corn", "corn tortillas"));
assert(!produceMatches("apple", "apple cider vinegar"));

const recipes = [
  { pick_matches: ["brussels sprouts"], seasonal_matches: [] },
  { pick_matches: [], seasonal_matches: ["sweet potato"] },
  { pick_matches: [], seasonal_matches: [] },
];
assert.equal(recipesUsing(recipes, "brussels sprout").length, 1);
assert.equal(recipesUsing(recipes, "potato").length, 0);

console.log("ok");
