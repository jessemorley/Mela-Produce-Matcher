// "Analysing 3/10: Asparagus Stir Fry" → { done: 3, total: 10, label: "..." }
//
// Coupled to the exact format! string in lib.rs (`"Analysing {seen}/{total}:
// {title}"`). If that wording changes this returns null and the status bar
// silently falls back to the spinner — parseProgress.test.js pins the shape
// so that breakage surfaces as a failing test instead.
//
// Its own module rather than living in StatusBar.jsx so it's importable by a
// plain `node` test without a JSX transform.
export function parseProgress(status) {
  const m = /^Analysing (\d+)\/(\d+): (.+)$/.exec(status || "");
  if (!m) return null;
  return { done: Number(m[1]), total: Number(m[2]), label: m[3] };
}
