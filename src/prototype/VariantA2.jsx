// PROTOTYPE — A2: "Ledger, inset"
// Three panes with the space *between* them rather than inside: a warm
// near-black ground, each pane a flat rounded fill on top of it — no rings,
// no drop shadows, the gutter alone separates them. Rows stay reasonably
// tight; the airiness comes from those gutters, not from line-height.
// Colour comes entirely from palettes.js — two accents (match / pick) plus a
// separate alert, so nothing borrows a meaning it doesn't own.
import { useState } from "react";
import { Leaf, Sparkles, BookOpen, Tag, Ban, Undo2 } from "lucide-react";
import { PRODUCE_LAYOUTS, ProduceDetail } from "./produceLayouts.jsx";
import { Detail } from "./RecipeDetailBody.jsx";
import { PALETTE, rgba } from "./palettes.js";
import { VEGETABLE } from "./icons.js";
import { AllRecipesList, FixView, ArticleView } from "./remainingViews.jsx";
import { ContextMenu, useContextMenu } from "./ContextMenu.jsx";

export const name = "Ledger, inset — floating panes, warm ground";

const NAV = [
  { key: "matching", label: "Best Matches", icon: Sparkles },
  { key: "produce", label: "In Season", icon: Leaf },
  { key: "recipes", label: "All Recipes", icon: BookOpen },
];

export default function VariantA2({ data, nav, setNav, produceLayout = "1" }) {
  const p = PALETTE;
  const { produce, seasonal, rankedRecipes, allRecipes, categories, unanalyzedCount, unfixedCount, status, recipeCount } = data;
  const counts = { matching: rankedRecipes.length, produce: produce.fruit.length + produce.vegetable.length + seasonal.produce.length, recipes: recipeCount };
  const ProduceLayout = PRODUCE_LAYOUTS[produceLayout].Component;

  // ONE selection drives the right pane, whatever view made it — switching nav
  // browses, it doesn't select, so the pane holds until you pick something new.
  // Two independent states (a recipe id + a produce item) meant each view
  // silently overwrote what the other was showing.
  const [selection, setSelection] = useState({ kind: "recipe", id: rankedRecipes[0]?.id });
  const [query, setQuery] = useState("");
  const [showFix, setShowFix] = useState(false);
  const [showArticle, setShowArticle] = useState(false);
  const [menu, openMenu, closeMenu] = useContextMenu();

  // Prototype: no backend, so exclusion is local state keyed by recipe id.
  const [excluded, setExcluded] = useState(() => new Set(allRecipes.filter((r) => r.excluded).map((r) => r.id)));
  const isExcluded = (id) => excluded.has(id);
  function toggleExcluded(id) {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    closeMenu();
  }

  const activeId = selection.kind === "recipe" ? selection.id : null;
  const activeRecipe =
    activeId && (rankedRecipes.find((r) => r.id === activeId) || allRecipes.find((r) => r.id === activeId));
  const activeProduce = selection.kind === "produce" ? selection.item : null;

  // Flat: no ring, no drop shadow. Panes separate from the ground by fill
  // alone, so the gutter does the work an outline used to.
  const pane = "rounded-2xl";
  const paneStyle = { background: p.pane };

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden font-sans select-none"
      style={{ background: p.ground, color: rgba(p.text, 0.72) }}
    >
      <div className="h-8 shrink-0" data-tauri-drag-region />
      <div className="flex min-h-0 flex-1 gap-2.5 px-2.5 pb-2.5">
        {/* Sidebar sits directly on the window ground — no pane surface — so
            only the list and detail read as floating cards. */}
        <aside className="flex w-60 shrink-0 flex-col overflow-hidden">
          {/* src-tauri/icons/ still holds the default Tauri placeholder (cyan
              and yellow), which fights the palette — so the mark is drawn here
              in the app's own accents until a real icon exists. */}
          <div className="flex items-center gap-2.5 px-5 pb-6 pt-5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: rgba(p.match, 0.14) }}
            >
              <VEGETABLE className="h-[18px] w-[18px]" style={{ color: p.match }} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-tight" style={{ color: p.text }}>Sprout</h1>
              <p className="mt-0.5 text-[11px]" style={{ color: rgba(p.text, 0.4) }}>Seasonal matcher</p>
            </div>
          </div>
          <nav className="px-2.5">
            {NAV.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setNav(key)}
                className="mb-0.5 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-white/[0.035]"
                style={{
                  background: nav === key ? rgba(p.text, 0.07) : undefined,
                  color: rgba(p.text, nav === key ? 0.95 : 0.45),
                }}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </span>
                <span className="text-[10.5px] tabular-nums" style={{ color: rgba(p.text, 0.3) }}>{counts[key]}</span>
              </button>
            ))}
          </nav>
          <div className="mt-8 px-2.5">
            <p className="px-3 pb-2 text-[9.5px] uppercase tracking-[0.18em]" style={{ color: rgba(p.text, 0.32) }}>Categories</p>
            {categories.map(({ label, count }) => (
              <button key={label} className="flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left text-[12.5px] hover:bg-white/[0.035]" style={{ color: rgba(p.text, 0.45) }}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{label}</span>
                </span>
                <span className="text-[10.5px] tabular-nums" style={{ color: rgba(p.text, 0.3) }}>{count}</span>
              </button>
            ))}
          </div>
          <div className="mt-auto px-5 py-4">
            <p className="truncate text-[10.5px]" style={{ color: rgba(p.text, 0.3) }}>{status}</p>
          </div>
        </aside>

        {/* Slot 2 is always the browse list, slot 3 always the detail — the
            panes never change job or count between nav items. In Season fills
            them with produce/its recipes rather than growing a new pane. */}
        <section className={`flex w-[23rem] shrink-0 flex-col overflow-hidden ${pane}`} style={paneStyle}>
          {nav === "produce" ? (
            <ProduceLayout
              produce={produce}
              seasonal={seasonal}
              rankedRecipes={rankedRecipes}
              selected={activeProduce}
              onSelect={(item) => setSelection(item ? { kind: "produce", item } : { kind: "none" })}
              onOpenArticle={() => setShowArticle(true)}
              palette={p}
            />
          ) : nav === "recipes" ? (
            <AllRecipesList
              recipes={allRecipes}
              onContextMenu={openMenu}
              isExcluded={isExcluded}
              activeId={activeId}
              onSelect={(id) => setSelection({ kind: "recipe", id })}
              query={query}
              onQuery={setQuery}
              p={p}
            />
          ) : (
          <>
          <div className="flex items-baseline justify-between px-5 pb-4 pt-5">
            <h2 className="text-[12.5px] font-medium" style={{ color: rgba(p.text, 0.7) }}>Best Matches</h2>
            <span className="text-[10.5px] tabular-nums" style={{ color: rgba(p.text, 0.3) }}>{rankedRecipes.length}</span>
          </div>
          {(unanalyzedCount > 0 || unfixedCount > 0) && (
            <div className="mx-3 mb-3 space-y-1.5">
              {unanalyzedCount > 0 && (
                <button
                  className="flex w-full items-center justify-between rounded-xl px-3.5 py-2 text-left transition-colors"
                  style={{ background: rgba(p.pick, 0.1) }}
                >
                  <span className="text-[11.5px]" style={{ color: p.pickSoft }}>{unanalyzedCount} new</span>
                  <span className="text-[11px] font-medium" style={{ color: p.pick }}>Sync</span>
                </button>
              )}
              {unfixedCount > 0 && (
                <button
                  className="flex w-full items-center justify-between rounded-xl px-3.5 py-2 text-left transition-colors"
                  onClick={() => setShowFix(true)}
                  style={{ background: rgba(p.alert, 0.12) }}
                >
                  <span className="text-[11.5px]" style={{ color: p.alertSoft }}>{unfixedCount} not found</span>
                  <span className="text-[11px] font-medium" style={{ color: p.alert }}>Fix</span>
                </button>
              )}
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {rankedRecipes
              .filter((r) => r.title.toLowerCase().includes(query.toLowerCase()))
              .map((rec) => {
              const on = activeId === rec.id;
              return (
                <button
                  key={rec.id}
                  onClick={() => setSelection({ kind: "recipe", id: rec.id })}
                  onContextMenu={openMenu(rec)}
                  className="mb-1 flex w-full items-start gap-3.5 rounded-xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.035]"
                  style={{ background: on ? rgba(p.text, 0.07) : undefined }}
                >
                  <span
                    className="w-7 shrink-0 pt-px text-right text-[14px] font-medium tabular-nums"
                    style={{ color: rec.rating > 0.7 ? p.match : rec.rating > 0.4 ? p.matchDim : rgba(p.text, 0.28) }}
                  >
                    {Math.round(rec.rating * 100)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] leading-snug" style={{ color: rgba(p.text, on ? 0.95 : 0.6) }}>{rec.title}</span>
                    <span className="mt-1.5 block truncate text-[10.5px] capitalize" style={{ color: rgba(p.text, 0.32) }}>
                      {[...rec.pick_matches, ...rec.seasonal_matches].join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          </>
          )}
        </section>

        {/* Keyed on the selection, never on nav — switching tabs leaves the
            pane exactly as it was. A produce selection renders its recipes as
            their own surfaces, so the slot drops its pane fill in that case
            only; otherwise cards would sit on a second background. */}
        <main
          className={`min-w-0 flex-1 overflow-y-auto ${activeProduce ? "" : pane}`}
          style={activeProduce ? undefined : paneStyle}
        >
          {showArticle ? (
            <ArticleView
              title={data.feedTitle}
              html={data.feedHtml}
              onBack={() => setShowArticle(false)}
              p={p}
            />
          ) : activeProduce ? (
            <ProduceDetail item={activeProduce} paneClass={pane} paneStyle={paneStyle} palette={p} />
          ) : activeRecipe ? (
            <Detail rec={activeRecipe} palette={p} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-10">
              <Leaf className="h-6 w-6" style={{ color: rgba(p.text, 0.22) }} strokeWidth={1.5} />
              <p className="mt-3 max-w-[22rem] text-center text-[13px] leading-relaxed" style={{ color: rgba(p.text, 0.35) }}>
                Select a recipe or a piece of produce to see it here.
              </p>
            </div>
          )}
        </main>
      </div>

      {showFix && <FixView recipes={allRecipes} onClose={() => setShowFix(false)} p={p} />}

      <ContextMenu
        menu={menu}
        p={p}
        items={
          menu
            ? [
                isExcluded(menu.item.id)
                  ? { label: "Include", icon: Undo2, onClick: () => toggleExcluded(menu.item.id) }
                  : { label: "Exclude", icon: Ban, danger: true, onClick: () => toggleExcluded(menu.item.id) },
              ]
            : []
        }
      />
    </div>
  );
}
