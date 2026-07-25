// Run: node src/components/parseProgress.test.js
//
// parseProgress is coupled to a format! string in lib.rs. These cases pin
// that contract from the JS side — if the Rust wording changes, this fails
// instead of the progress bar silently degrading to a spinner in the UI.
import assert from "node:assert/strict";
import { parseProgress } from "./parseProgress.js";

// The real emission: `format!("Analysing {seen}/{total}: {title}")`
assert.deepEqual(parseProgress("Analysing 3/10: Asparagus Stir Fry"), {
  done: 3,
  total: 10,
  label: "Asparagus Stir Fry",
});

// Titles contain colons and digits; only the first colon separates.
assert.deepEqual(parseProgress("Analysing 1/2: Soup: 20 Minute Version"), {
  done: 1,
  total: 2,
  label: "Soup: 20 Minute Version",
});

// The *other* Analysing message in lib.rs is indeterminate — it must not
// parse, or the bar would render a progress track with no numbers behind it.
assert.equal(parseProgress("Analysing 5 new recipes..."), null);

// Non-progress phases fall through to the spinner.
assert.equal(parseProgress("Checking harrisfarm.com.au..."), null);
assert.equal(parseProgress("Error: cancelled"), null);
assert.equal(parseProgress(""), null);
assert.equal(parseProgress(undefined), null);

console.log("parseProgress: ok");
