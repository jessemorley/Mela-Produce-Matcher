// PROTOTYPE — the In Season tab: tile survey + slide-in recipe panel.
//
// The problem with the original scrolling column: 26 items in a 368px lane
// while the widest pane sat empty, and a two-layer taxonomy (market vs
// season) forced through a one-dimensional list so neither layer was legible
// at a glance. This spans the full canvas and drops the middle list.
//
// Tiles are sorted by how many of your recipes use the item — the one fact
// the old list never showed.
import { useEffect } from "react";
import { Newspaper, Star } from "lucide-react";
import { Detail } from "./RecipeDetailBody.jsx";
import { rgba } from "./palettes.js";
import { produceIcon, VEGETABLE } from "./icons.js";

// Three icons total, shared with the recipe views — see icons.js.
const iconFor = produceIcon;

export function splitProduce(produce, seasonal) {
  const market = [
    ...produce.fruit.map((name) => ({ name, type: "Fruit" })),
    ...produce.vegetable.map((name) => ({ name, type: "Vegetable" })),
  ];
  const marketNames = new Set(market.map((m) => m.name.toLowerCase()));
  const seasonalOnly = (seasonal.produce || []).filter((n) => !marketNames.has(n.toLowerCase()));
  return { market, seasonalOnly };
}

function recipesUsing(rankedRecipes, name) {
  return rankedRecipes.filter((r) =>
    [...r.pick_matches, ...r.seasonal_matches].some((m) => m.toLowerCase() === name.toLowerCase()),
  );
}

// Selection lives in the shell (VariantA2) because the recipe panel is a
// sibling pane, not a child of this one.
function TileGrid({ produce, seasonal, rankedRecipes, selected, onSelect, onOpenArticle, palette: p }) {
  const { market, seasonalOnly } = splitProduce(produce, seasonal);
  const sel = selected;
  const setSel = onSelect;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSel]);

  const decorate = (name, tone, type) => ({
    name,
    tone,
    type,
    starred: produce.pick.includes(name),
    featured: produce.featured.includes(name),
    uses: recipesUsing(rankedRecipes, name),
  });

  const byUse = (a, b) => b.uses.length - a.uses.length || a.name.localeCompare(b.name);
  const marketTiles = market.map((m) => decorate(m.name, "pick", m.type)).sort(byUse);
  const seasonTiles = seasonalOnly.map((n) => decorate(n, "seasonal")).sort(byUse);

  // Same idiom as the recipe rows: transparent at rest, filled only when
  // selected. "Nothing uses this" is carried by dimmed text and icon rather
  // than a third background shade.
  const Tile = ({ item }) => {
    const on = sel?.name === item.name;
    const Icon = iconFor(item.type);
    const cookable = item.uses.length > 0;
    return (
      <button
        onClick={() => setSel(on ? null : item)}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.035]"
        style={{ background: on ? rgba(p.text, 0.07) : undefined }}
      >
        <Icon
          className="h-4 w-4 shrink-0"
          style={{
            color: item.tone === "pick"
              ? (cookable ? p.pick : p.pickDim)
              : (cookable ? p.match : p.matchDim),
          }}
          strokeWidth={1.75}
        />
        <span
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] capitalize"
          style={{ color: rgba(p.text, on ? 0.95 : cookable ? 0.7 : 0.35) }}
        >
          <span className="truncate">{item.name}</span>
          {item.starred && <Star className="h-3 w-3 shrink-0" style={{ fill: p.pick, color: p.pick }} />}
        </span>
        <span className="shrink-0 text-[10.5px] tabular-nums" style={{ color: rgba(p.text, cookable ? 0.4 : 0.2) }}>
          {cookable ? item.uses.length : "—"}
        </span>
      </button>
    );
  };

  // Header matches the Best Matches list header — same slot, same chrome.
  return (
    <>
      <div className="flex items-baseline justify-between px-5 pb-4 pt-5">
        <h2 className="text-[12.5px] font-medium" style={{ color: rgba(p.text, 0.7) }}>In Season</h2>
        <span className="text-[10.5px] tabular-nums" style={{ color: rgba(p.text, 0.3) }}>{market.length + seasonalOnly.length}</span>
      </div>

      <div className="mx-3 mb-3">
        <button
          onClick={onOpenArticle}
          className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left hover:brightness-125"
          style={{ background: rgba(p.text, 0.05) }}
        >
          <Newspaper className="h-3.5 w-3.5 shrink-0" style={{ color: rgba(p.text, 0.4) }} strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: rgba(p.text, 0.55) }}>Read the market update</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <p className="px-2 pb-2 text-[9.5px] uppercase tracking-[0.18em]" style={{ color: p.pick }}>Dave's Picks</p>
        <div className="space-y-1">
          {marketTiles.map((item) => <Tile key={item.name} item={item} />)}
        </div>

        <p className="px-2 pb-2 pt-6 text-[9.5px] uppercase tracking-[0.18em]" style={{ color: p.match }}>
          Also in {seasonal.season.toLowerCase()}
        </p>
        <div className="space-y-1">
          {seasonTiles.map((item) => <Tile key={item.name} item={item} />)}
        </div>
      </div>
    </>
  );
}


// Fills the same detail slot as RecipeDetail. With recipes selected the cards
// are the only surfaces — the slot itself is bare, so nothing sits on a second
// background. The empty states have no cards, so they take the pane fill
// themselves via `paneClass`.
export function ProduceDetail({ item, paneClass = "", paneStyle, palette: p }) {
  const empty = (icon, body) => (
    <div className={`flex min-h-full flex-col items-center justify-center px-10 ${paneClass}`} style={paneStyle}>
      {icon}
      <p className="mt-3 max-w-[22rem] text-center text-[13px] leading-relaxed" style={{ color: rgba(p.text, 0.35) }}>{body}</p>
    </div>
  );

  if (!item) {
    return empty(
      <VEGETABLE className="h-6 w-6" style={{ color: rgba(p.text, 0.22) }} strokeWidth={1.5} />,
      "Select produce to see which of your recipes use it.",
    );
  }

  if (item.uses.length === 0) {
    const EmptyIcon = iconFor(item.type);
    return empty(
      <EmptyIcon
        className="h-6 w-6"
        style={{ color: item.tone === "pick" ? p.pickDim : p.matchDim }}
        strokeWidth={1.5}
      />,
      <>
        Nothing in your collection uses{" "}
        <span className="capitalize" style={{ color: rgba(p.text, 0.6) }}>{item.name}</span> yet.
      </>,
    );
  }

  // No wrapper heading and no shared surface — each recipe card is its own
  // pane, stacked. Which produce is selected is already stated by the list.
  //
  // A lone card fills the slot rather than leaving dead ground beneath it.
  // The wrapper is a flex column with min-h-full (resolves against the slot,
  // which has a definite height); the card then grows via flex-1. Putting
  // min-h-full on the card itself does nothing — a percentage minimum needs a
  // definite parent height, and the wrapper only has a minimum.
  const only = item.uses.length === 1;
  return (
    <div className="flex min-h-full flex-col gap-2.5">
      {item.uses.map((rec) => (
        <Detail
          key={rec.id}
          rec={rec}
          surfaceClass={`${paneClass} ${only ? "flex flex-1 flex-col" : ""}`}
          surfaceStyle={paneStyle}
          palette={p}
        />
      ))}
    </div>
  );
}

export const PRODUCE_LAYOUTS = {
  1: { Component: TileGrid, name: "Tiles in the list slot" },
};
