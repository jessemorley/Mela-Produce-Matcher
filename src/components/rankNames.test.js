// Run: node src/components/rankNames.test.js
//
// The threshold in rankNames degrades silently if it's wrong — too high and
// "walnuts" stops being offered for "walnut", which is the exact mistake the
// suggestion list exists to prevent. These cases pin the behaviour that
// matters, not the scores themselves.
import assert from "node:assert/strict";
import { knownNames, rankNames } from "./rankNames.js";

const recipes = [
  {
    ingredients: [
      { display: "1 cup walnut halves", name: "walnut halves", pantry: false },
      { display: "1 tsp salt", name: "salt", pantry: true },
      { display: "2 leeks", name: "leek", pantry: false },
    ],
  },
  {
    ingredients: [
      { display: "1/2 cup walnut halves", name: "walnut halves", pantry: false },
      { display: "salt to taste", name: "salt", pantry: true },
      { display: "1 onion", name: "onion", pantry: false },
      { display: "", name: "", pantry: false }, // unfixed: must be ignored
    ],
  },
];

const known = knownNames(recipes);

// Counts aggregate across recipes; unfixed lines (name: "") contribute nothing.
assert.equal(known.length, 4);
assert.equal(known.find((k) => k.name === "walnut halves").count, 2);
assert.equal(known.find((k) => k.name === "salt").count, 2);
assert.equal(known.find((k) => k.name === "leek").count, 1);
// The pantry flag rides along, so picking a suggestion carries it across.
assert.equal(known.find((k) => k.name === "salt").pantry, true);
assert.equal(known.find((k) => k.name === "leek").pantry, false);

// THE case this whole module exists for: the singular must surface the
// established plural rather than letting the user invent a second name.
assert.equal(rankNames(known, "walnut")[0].name, "walnut halves");

// Seeded from the raw line, before the user has typed anything.
assert.equal(rankNames(known, "1 cup walnut halves")[0].name, "walnut halves");

// Plural drift in the other direction.
assert.equal(rankNames(known, "leeks")[0].name, "leek");

// Empty input falls back to most-used first, and never exceeds the limit.
const seeded = rankNames(known, "");
assert.equal(seeded[0].count, 2);
assert.ok(seeded.length <= 6);

// A genuinely unrelated name shouldn't drag in the whole collection.
assert.equal(rankNames(known, "cinnamon").length, 0);

// Digits and punctuation in the raw line don't break matching.
assert.equal(rankNames(known, "1/2 tsp. salt!")[0].name, "salt");

console.log("rankNames: ok");
