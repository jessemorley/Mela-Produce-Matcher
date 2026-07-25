// Ingredient-name suggestions for the Fix queue.
//
// Why this exists: naming an ingredient "walnut" when the collection already
// says "walnut halves" silently splits one ingredient into two, and nothing
// downstream ever notices. So every canonical name already in the collection
// is offered, ranked by closeness to what's been typed — seeded from the raw
// line before anything is typed at all.
//
// Ranked by closeness, not prefix: the whole point is surfacing "walnuts"
// when someone types "walnut". Cheap bigram overlap (Dice coefficient) — no
// dependency, and good enough to catch plurals and small spelling drift.

// Every canonical name in the collection, with how many ingredient rows use
// it — the count is what tells you "walnuts" is the established spelling and
// "walnut" would be the odd one out.
export function knownNames(recipes) {
  const map = new Map();
  for (const r of recipes) {
    for (const ing of r.ingredients || []) {
      if (!ing.name) continue;
      const k = map.get(ing.name) || { name: ing.name, pantry: ing.pantry, count: 0 };
      k.count += 1;
      map.set(ing.name, k);
    }
  }
  return [...map.values()];
}

// ponytail: 0.2 threshold and 6 results tuned by hand against the real
// collection; both are arbitrary. Raise the threshold if noise creeps in.
const THRESHOLD = 0.2;
const LIMIT = 6;

export function rankNames(known, input) {
  const q = (input || "").toLowerCase().replace(/[^a-z ]/g, " ").trim();
  // Nothing typed yet: the most-used names are the best prior.
  if (!q) return known.slice().sort((a, b) => b.count - a.count).slice(0, LIMIT);
  const qb = bigrams(q);
  return known
    .map((k) => {
      const n = k.name.toLowerCase();
      // A containment hit ("walnut" inside "1 cup walnut halves") is a
      // stronger signal than bigram overlap alone, which dilutes badly when
      // the query is a whole raw line.
      const contained = q.includes(n) || n.includes(q);
      return { ...k, score: dice(qb, bigrams(n)) + (contained ? 0.5 : 0) };
    })
    .filter((k) => k.score > THRESHOLD)
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, LIMIT);
}

function bigrams(s) {
  const out = new Set();
  for (const word of s.split(/\s+/)) {
    for (let i = 0; i < word.length - 1; i++) out.add(word.slice(i, i + 2));
  }
  return out;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return (2 * shared) / (a.size + b.size);
}
