// Run: node src/openCard.test.js
//
// The undefined/null distinction is the whole point of this module and is
// easy to collapse back into a single falsy check, which silently breaks the
// collapse button on the first card.
import assert from "node:assert/strict";
import { resolveOpen } from "./openCard.js";

const recipes = [{ id: "a" }, { id: "b" }, { id: "c" }];

// Untouched: the top match is open, so the stack is never all headers.
assert.equal(resolveOpen(recipes, undefined), "a");

// An explicit pick is respected.
assert.equal(resolveOpen(recipes, "c"), "c");

// Deliberately collapsed stays collapsed — including on the first card,
// where a naive `openId || recipes[0].id` fallback would reopen it.
assert.equal(resolveOpen(recipes, null), null);

// The open recipe is gone (different produce selected, or it was excluded):
// fall back to the new top match rather than showing nothing expanded.
assert.equal(resolveOpen([{ id: "x" }, { id: "y" }], "c"), "x");

// No matches at all: no crash, nothing open.
assert.equal(resolveOpen([], undefined), undefined);
assert.equal(resolveOpen([], null), null);

console.log("openCard: ok");
