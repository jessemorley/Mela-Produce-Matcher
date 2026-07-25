// PROTOTYPE — the chosen palette. Emerald+amber were both Tailwind defaults,
// which was most of why the old scheme read as generic; these are hand-picked
// hex on a warmed ground (the cool blue-grey cast was doing as much damage as
// the accents themselves).
//
// Three were tried — "produce stall" (chicory/blood orange), "newsprint"
// (chicory/red pencil), "winter root" (beet/parsnip). Newsprint won.
//
// `match` — seasonal match rating, "Built around" chips, in-season produce
// `pick`  — Dave's Picks (the live market update)
// `alert` — errors only; kept separate so it can't be read as a pick
// Each accent carries a `Soft` (text on a wash) and a `Dim` (inactive state).

export const PALETTE = {
  ground: "#131211",
  pane: "#1B1A18",
  text: "#EDE9E3",

  // Chicory lifted toward pistachio: bright enough to carry against the
  // ground, still yellow-leaning and dusty rather than blue-green emerald.
  match: "#9FC08A",
  matchSoft: "#BAD4A8",
  matchDim: "#5C7350",
  matchWash: "#9FC08A",

  pick: "#C4453A",
  pickSoft: "#D9756B",
  pickDim: "#6E2F29",

  // Picks own the red, so the error state moves to oxblood to stay distinct.
  alert: "#9E5A4E",
  alertSoft: "#C08878",
};

// Inline styles rather than Tailwind classes — the palette is data here, and
// arbitrary-value classes can't be built from a runtime variable anyway. When
// this folds into src/components/ these should become real classes or CSS
// custom properties, since there'll only be one palette.
export const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
