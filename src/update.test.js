// Run: node src/update.test.js
//
// The download events are the only real logic in update.js, and every way
// they go wrong is silent: a missing content-length divides by zero and the
// status bar reads "NaN%", and a fraction over 1.0 reads "103%". Neither
// throws, so nothing else would catch them.
import assert from "node:assert/strict";
import { downloadProgress } from "./update.js";

// Normal case: accumulates chunks against the announced total.
{
  const track = downloadProgress();
  assert.equal(track({ event: "Started", data: { contentLength: 100 } }), 0);
  assert.equal(track({ event: "Progress", data: { chunkLength: 25 } }), 0.25);
  assert.equal(track({ event: "Progress", data: { chunkLength: 25 } }), 0.5);
  assert.equal(track({ event: "Finished" }), 0.5);
}

// No content-length: null (indeterminate), never NaN.
{
  const track = downloadProgress();
  assert.equal(track({ event: "Started", data: {} }), null);
  const pct = track({ event: "Progress", data: { chunkLength: 4096 } });
  assert.equal(pct, null, "no total means no fraction to report");
}

// Chunks overshooting the announced length clamp at 1.0 rather than 103%.
{
  const track = downloadProgress();
  track({ event: "Started", data: { contentLength: 10 } });
  assert.equal(track({ event: "Progress", data: { chunkLength: 99 } }), 1);
}

// Two concurrent downloads must not share a counter.
{
  const a = downloadProgress();
  const b = downloadProgress();
  a({ event: "Started", data: { contentLength: 100 } });
  b({ event: "Started", data: { contentLength: 100 } });
  a({ event: "Progress", data: { chunkLength: 50 } });
  assert.equal(b({ event: "Progress", data: { chunkLength: 10 } }), 0.1);
}

console.log("update.js progress: all assertions passed");
