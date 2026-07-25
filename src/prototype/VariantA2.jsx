// PROTOTYPE — A2: "Ledger, inset"
// Same three panes and same rating spine, but the space goes *between* the
// panes rather than inside them. The window has a warm off-black ground and
// each pane floats on it as a rounded, slightly-lifted surface. Rows stay
// reasonably tight — the airiness comes from the gutters and the soft
// elevation, not from line-height. Emerald is demoted to a single accent on
// the rating; everything else is neutral so the number reads first.
import { useState } from "react";
import { Leaf, Sparkles, BookOpen, Tag } from "lucide-react";
import { PRODUCE_LAYOUTS, ProduceDetail } from "./produceLayouts.jsx";
import { Detail } from "./RecipeDetailBody.jsx";

export const name = "Ledger, inset — floating panes, warm ground";

const NAV = [
  { key: "matching", label: "Best Matches", icon: Sparkles },
  { key: "produce", label: "In Season", icon: Leaf },
  { key: "recipes", label: "All Recipes", icon: BookOpen },
];

export default function VariantA2({ data, nav, setNav, produceLayout = "1" }) {
  const { produce, seasonal, rankedRecipes, allRecipes, categories, unanalyzedCount, unfixedCount, status, recipeCount } = data;
  const counts = { matching: rankedRecipes.length, produce: produce.fruit.length + produce.vegetable.length + seasonal.produce.length, recipes: recipeCount };
  const ProduceLayout = PRODUCE_LAYOUTS[produceLayout].Component;

  // ONE selection drives the right pane, whatever view made it — switching nav
  // browses, it doesn't select, so the pane holds until you pick something new.
  // Two independent states (a recipe id + a produce item) meant each view
  // silently overwrote what the other was showing.
  const [selection, setSelection] = useState({ kind: "recipe", id: rankedRecipes[0]?.id });

  const activeId = selection.kind === "recipe" ? selection.id : null;
  const activeRecipe =
    activeId && (rankedRecipes.find((r) => r.id === activeId) || allRecipes.find((r) => r.id === activeId));
  const activeProduce = selection.kind === "produce" ? selection.item : null;

  const pane = "rounded-2xl bg-[#17171a] ring-1 ring-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.4)]";

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0e0e10] font-sans text-neutral-300 select-none">
      <div className="h-8 shrink-0" data-tauri-drag-region />
      <div className="flex min-h-0 flex-1 gap-2.5 px-2.5 pb-2.5">
        {/* Sidebar sits directly on the window ground — no pane surface — so
            only the list and detail read as floating cards. */}
        <aside className="flex w-60 shrink-0 flex-col overflow-hidden">
          <div className="px-5 pb-6 pt-5">
            <h1 className="text-sm font-semibold tracking-tight text-neutral-100">Sprout</h1>
            <p className="mt-0.5 text-[11px] text-neutral-500">Seasonal matcher</p>
          </div>
          <nav className="px-2.5">
            {NAV.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setNav(key)}
                className={`mb-0.5 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12.5px] transition-colors ${
                  nav === key ? "bg-white/[0.07] text-neutral-100" : "text-neutral-500 hover:bg-white/[0.035] hover:text-neutral-300"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </span>
                <span className="text-[10.5px] tabular-nums text-neutral-600">{counts[key]}</span>
              </button>
            ))}
          </nav>
          <div className="mt-8 px-2.5">
            <p className="px-3 pb-2 text-[9.5px] uppercase tracking-[0.18em] text-neutral-600">Categories</p>
            {categories.map(({ label, count }) => (
              <button key={label} className="flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left text-[12.5px] text-neutral-500 hover:bg-white/[0.035]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{label}</span>
                </span>
                <span className="text-[10.5px] tabular-nums text-neutral-600">{count}</span>
              </button>
            ))}
          </div>
          <div className="mt-auto px-5 py-4">
            <p className="truncate text-[10.5px] text-neutral-600">{status}</p>
          </div>
        </aside>

        {/* Slot 2 is always the browse list, slot 3 always the detail — the
            panes never change job or count between nav items. In Season fills
            them with produce/its recipes rather than growing a new pane. */}
        <section className={`flex w-[23rem] shrink-0 flex-col overflow-hidden ${pane}`}>
          {nav === "produce" ? (
            <ProduceLayout
              produce={produce}
              seasonal={seasonal}
              rankedRecipes={rankedRecipes}
              selected={activeProduce}
              onSelect={(item) => setSelection(item ? { kind: "produce", item } : { kind: "none" })}
            />
          ) : (
          <>
          <div className="flex items-baseline justify-between px-5 pb-4 pt-5">
            <h2 className="text-[12.5px] font-medium text-neutral-300">Best Matches</h2>
            <span className="text-[10.5px] tabular-nums text-neutral-600">{rankedRecipes.length}</span>
          </div>
          {(unanalyzedCount > 0 || unfixedCount > 0) && (
            <div className="mx-3 mb-3 space-y-1.5">
              {unanalyzedCount > 0 && (
                <button className="flex w-full items-center justify-between rounded-xl bg-amber-400/[0.08] px-3.5 py-2 text-left hover:bg-amber-400/[0.14]">
                  <span className="text-[11.5px] text-amber-200/80">{unanalyzedCount} new</span>
                  <span className="text-[11px] font-medium text-amber-300">Sync</span>
                </button>
              )}
              {unfixedCount > 0 && (
                <button className="flex w-full items-center justify-between rounded-xl bg-rose-400/[0.08] px-3.5 py-2 text-left hover:bg-rose-400/[0.14]">
                  <span className="text-[11.5px] text-rose-200/80">{unfixedCount} not found</span>
                  <span className="text-[11px] font-medium text-rose-300">Fix</span>
                </button>
              )}
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {rankedRecipes.map((rec) => {
              const on = activeId === rec.id;
              return (
                <button
                  key={rec.id}
                  onClick={() => setSelection({ kind: "recipe", id: rec.id })}
                  className={`mb-1 flex w-full items-start gap-3.5 rounded-xl px-3.5 py-3 text-left transition-colors ${
                    on ? "bg-white/[0.07]" : "hover:bg-white/[0.035]"
                  }`}
                >
                  <span className={`w-7 shrink-0 pt-px text-right text-[14px] font-medium tabular-nums ${
                    rec.rating > 0.7 ? "text-emerald-400" : rec.rating > 0.4 ? "text-emerald-500/60" : "text-neutral-600"
                  }`}>
                    {Math.round(rec.rating * 100)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12.5px] leading-snug ${on ? "text-neutral-100" : "text-neutral-400"}`}>{rec.title}</span>
                    <span className="mt-1.5 block truncate text-[10.5px] capitalize text-neutral-600">
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
        <main className={`min-w-0 flex-1 overflow-y-auto ${activeProduce ? "" : pane}`}>
          {activeProduce ? (
            <ProduceDetail item={activeProduce} paneClass={pane} />
          ) : activeRecipe ? (
            <Detail rec={activeRecipe} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-10">
              <Leaf className="h-6 w-6 text-neutral-700" strokeWidth={1.5} />
              <p className="mt-3 max-w-[22rem] text-center text-[13px] leading-relaxed text-neutral-600">
                Select a recipe or a piece of produce to see it here.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
