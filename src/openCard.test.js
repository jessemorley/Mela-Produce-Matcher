// Run: node src/openCard.test.js
import assert from "node:assert/strict";
import { resolveOpen } from "./openCard.js";

const recipes = [{ id: "a" }, { id: "b" }, { id: "c" }];

// Nothing open: stays closed, no default expansion.
assert.equal(resolveOpen(recipes, null), null);

// An explicit pick is respected.
assert.equal(resolveOpen(recipes, "c"), "c");

// The open recipe is gone (different produce selected, or it was excluded):
// falls back to closed, not a different card popping open.
assert.equal(resolveOpen([{ id: "x" }, { id: "y" }], "c"), null);

// No matches at all: no crash, nothing open.
assert.equal(resolveOpen([], null), null);

console.log("openCard: ok");
