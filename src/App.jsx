import { useEffect, useState, useMemo } from "react";
import { Leaf, Ban, Undo2 } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import RecipeList from "./components/RecipeList.jsx";
import RecipeDetail from "./components/RecipeDetail.jsx";
import ArticleView from "./components/ArticleView.jsx";
import FixNowQueue from "./components/FixNowQueue.jsx";
import { ContextMenu, useContextMenu } from "./components/ContextMenu.jsx";
import { produceIcon } from "./components/icons.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

export default function App() {
  const [status, setStatus] = useState("Starting...");
  const [busy, setBusy] = useState(true);
  const [selectedNav, setSelectedNav] = useState("matching"); // 'matching' | 'produce' | 'recipes'
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState(null);
  const [showArticle, setShowArticle] = useState(false);

  const [feedTitle, setFeedTitle] = useState("");
  const [feedHtml, setFeedHtml] = useState("");
  const [produce, setProduce] = useState({ fruit: [], vegetable: [], pick: [], featured: [] });
  const [seasonal, setSeasonal] = useState({ season: "", produce: [] });
  const [recipeCount, setRecipeCount] = useState(0);

  const [rankedRecipes, setRankedRecipes] = useState([]); // scored locally by key ingredients
  const [allRecipes, setAllRecipes] = useState([]); // full local recipes.json, for "All Recipes"
  const [unanalyzedCount, setUnanalyzedCount] = useState(0);
  const [unfixedCount, setUnfixedCount] = useState(0);
  const [showFixNow, setShowFixNow] = useState(false);
  const [menu, openMenu, closeMenu] = useContextMenu();

  // ONE selection drives the detail pane, whatever view made it — switching
  // nav browses, it doesn't select, so the pane holds until you pick something
  // new. Two independent states (a recipe id + a produce item) meant each view
  // silently overwrote what the other was showing.
  const [selection, setSelection] = useState({ kind: "none" }); // 'recipe' | 'produce' | 'none'

  // Launch-time sync: fetch cached-or-fresh produce, resync recipes.json from Mela.
  useEffect(() => {
    const unlistenPromises = [
      listen("status", (e) => setStatus(e.payload)),
      listen("produce", (e) => setProduce(e.payload)),
    ];

    setBusy(true);
    invoke("sync_on_launch")
      .then((result) => {
        setFeedTitle(result.produce.feed_title);
        setFeedHtml(result.produce.feed_html);
        setProduce(result.produce);
        setRecipeCount(result.recipe_count);
        setUnanalyzedCount(result.unanalyzed_count);
        setUnfixedCount(result.unfixed_count);
        return Promise.all([invoke("list_recipes"), invoke("seasonal_in_season")]);
      })
      .then(([recipes, seasonalInfo]) => {
        setAllRecipes(recipes ?? []); // unfixedCount already came from sync_on_launch
        setSeasonal(seasonalInfo);
      })
      .catch((err) => setStatus(err === "cancelled" ? "Cancelled." : `Error: ${err}`))
      .finally(() => setBusy(false));

    return () => {
      unlistenPromises.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);

  // Matching is local set-intersection now, not a Claude call, so it's
  // cheap enough to just re-run whenever the produce list or the analysed
  // recipe set changes — no "Match Recipes" button.
  useEffect(() => {
    if (produce.fruit.length || produce.vegetable.length) runMatch();
  }, [produce, allRecipes]);

  // Mela's own tags (ZRECIPETAG), already loaded onto every recipe — counts
  // recipes per tag so the sidebar can show them alongside each category.
  const categories = useMemo(() => {
    const counts = new Map();
    for (const r of allRecipes) {
      for (const tag of r.tags || []) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [allRecipes]);

  // Ranked recipes already carry their full record from the backend, so a
  // selection only needs the All Recipes list as a fallback for recipes that
  // never matched — including one just excluded, which drops out of the
  // ranked list but stays on screen.
  const activeRecipeId = selection.kind === "recipe" ? selection.id : null;
  const activeRecipe = useMemo(() => {
    if (!activeRecipeId) return null;
    return (
      rankedRecipes.find((r) => r.id === activeRecipeId) ||
      allRecipes.find((r) => r.id === activeRecipeId) ||
      null
    );
  }, [rankedRecipes, allRecipes, activeRecipeId]);

  const selectedProduce = selection.kind === "produce" ? selection.item : null;

  // The produce tile carries its own matching recipes, but those come from
  // the ranked list at click time — re-derive against the current one so an
  // exclusion (or a new week's produce) doesn't leave a stale card up.
  const produceRecipes = useMemo(() => {
    if (!selectedProduce) return [];
    return rankedRecipes.filter((r) =>
      [...r.pick_matches, ...r.seasonal_matches].some(
        (m) => m.toLowerCase() === selectedProduce.name.toLowerCase(),
      ),
    );
  }, [rankedRecipes, selectedProduce]);

  async function runMatch() {
    try {
      setRankedRecipes(
        await invoke("match_recipes", {
          fruit: produce.fruit,
          vegetable: produce.vegetable,
        }),
      );
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }

  // Mirrors unfixed_ingredients() in lib.rs: lines with no name, counted
  // only within recipes that HAVE been analysed (an unanalysed recipe's
  // lines are covered by the Sync Now banner instead).
  function countUnfixed(recipes) {
    return recipes
      .filter((r) => r.key_ingredients?.length > 0 && !r.excluded)
      .reduce(
        (total, r) => total + (r.ingredients || []).filter((i) => !i.name).length,
        0,
      );
  }

  function applyRecipes(recipes) {
    setAllRecipes(recipes);
    setUnfixedCount(countUnfixed(recipes));
    // Mirrors sync_result()'s unanalyzed_count: excluding an unanalysed
    // recipe takes it off the Sync Now banner without waiting for a resync.
    setUnanalyzedCount(
      recipes.filter((r) => !r.key_ingredients?.length && !r.excluded).length,
    );
  }

  // "Sync Now": run the Claude key-ingredient analysis over recipes the
  // launch sync found unanalysed, then refresh the local list. An analysis
  // that comes back incomplete can leave newly-unfixed lines behind, so
  // unfixedCount is recomputed here too, not just on launch.
  async function analyzeNew() {
    setBusy(true);
    try {
      await invoke("analyze_new_recipes");
      applyRecipes((await invoke("list_recipes")) ?? []); // recomputes unanalyzedCount
    } catch (err) {
      setStatus(err === "cancelled" ? "Cancelled." : `Error: ${err}`);
    } finally {
      setBusy(false);
    }
  }

  // Full-collection escape hatch: same slow path sync_on_launch used to run
  // unconditionally, now explicit. Replaces allRecipes wholesale.
  async function fullResync() {
    setBusy(true);
    try {
      const result = await invoke("full_resync");
      setProduce(result.produce);
      setRecipeCount(result.recipe_count);
      setUnanalyzedCount(result.unanalyzed_count);
      setUnfixedCount(result.unfixed_count);
      applyRecipes((await invoke("list_recipes")) ?? []);
    } catch (err) {
      setStatus(err === "cancelled" ? "Cancelled." : `Error: ${err}`);
    } finally {
      setBusy(false);
    }
  }

  // Excluding drops the recipe out of Best Matches immediately (it can never
  // match again), but the detail pane keeps showing it via the allRecipes
  // fallback, so nothing goes blank under the user after a right-click.
  async function toggleExcluded(recipe) {
    closeMenu();
    try {
      applyRecipes(
        await invoke("set_excluded", { id: recipe.id, excluded: !recipe.excluded }),
      );
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }

  const counts = {
    matching: rankedRecipes.length,
    produce: produce.fruit.length + produce.vegetable.length + seasonal.produce.length,
    recipes: recipeCount,
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ground font-sans text-text/72 select-none">
      <div className="h-8 shrink-0" data-tauri-drag-region />

      {/* One pane gives up width at a time, in priority order — the detail
          pane absorbs everything first, then the list, then the sidebar:
            ≥948    detail shrinks alone (it's flex-1); sides at full size
            880-948 detail floored at 300, list gives up 368 → 300
            820-880 list floored, sidebar gives up 240 → 180
            <820    sidebar hidden; detail recovers, then shrinks again
            630     hard floor — both panes are exactly 300 (tauri minWidth)
          --rail is the sidebar's contribution to the row (width + one gutter),
          so the list's clamp() reads one expression in both regimes. */}
      <style>{`
        .shell {
          --sidebar: clamp(180px, calc(100vw - 640px), 240px);
          --rail: 0px;
        }
        @media (min-width: 820px) { .shell { --rail: calc(var(--sidebar) + 10px); } }
      `}</style>

      <div className="shell flex min-h-0 flex-1 gap-2.5 px-2.5 pb-2.5">
        <Sidebar
          selectedNav={selectedNav}
          onSelectNav={setSelectedNav}
          counts={counts}
          busy={busy}
          status={status}
          onCancel={() => invoke("cancel")}
          onFullResync={fullResync}
          categories={categories}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
        />

        <RecipeList
          selectedNav={selectedNav}
          onSelectNav={setSelectedNav}
          counts={counts}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedTag={selectedTag}
          onClearTag={() => setSelectedTag(null)}
          produce={produce}
          seasonal={seasonal}
          rankedRecipes={rankedRecipes}
          allRecipes={allRecipes}
          activeRecipeId={activeRecipeId}
          onSelectRecipe={(id) => setSelection({ kind: "recipe", id })}
          selectedProduce={selectedProduce}
          onSelectProduce={(item) =>
            setSelection(item ? { kind: "produce", item } : { kind: "none" })
          }
          onContextMenu={openMenu}
          unanalyzedCount={unanalyzedCount}
          onSyncNow={analyzeNew}
          unfixedCount={unfixedCount}
          onFixNow={() => setShowFixNow(true)}
          onOpenArticle={() => setShowArticle(true)}
          status={status}
          busy={busy}
          onCancel={() => invoke("cancel")}
        />

        {/* Keyed on the selection, never on nav — switching tabs leaves the
            pane exactly as it was. A produce selection renders its recipes as
            their own surfaces, so the slot drops its pane fill in that case
            only; otherwise cards would sit on a second background. */}
        <main
          className={`min-w-[300px] flex-1 overflow-y-auto ${
            selectedProduce && !showArticle ? "" : "rounded-2xl bg-pane"
          }`}
        >
          {showArticle ? (
            <ArticleView title={feedTitle} html={feedHtml} onBack={() => setShowArticle(false)} />
          ) : selectedProduce ? (
            <ProducePane item={selectedProduce} recipes={produceRecipes} />
          ) : activeRecipe ? (
            <RecipeDetail recipe={activeRecipe} />
          ) : (
            <EmptyPane
              icon={<Leaf className="h-6 w-6 text-text/22" strokeWidth={1.5} />}
              body="Select a recipe or a piece of produce to see it here."
            />
          )}
        </main>
      </div>

      {showFixNow && (
        <FixNowQueue
          recipes={allRecipes}
          onClose={() => setShowFixNow(false)}
          onRecipesChange={applyRecipes}
        />
      )}

      <ContextMenu
        menu={menu}
        items={
          menu
            ? [
                menu.item.excluded
                  ? { label: "Include", icon: Undo2, onClick: () => toggleExcluded(menu.item) }
                  : {
                      label: "Exclude",
                      icon: Ban,
                      danger: true,
                      onClick: () => toggleExcluded(menu.item),
                    },
              ]
            : []
        }
      />
    </div>
  );
}

function EmptyPane({ icon, body }) {
  return (
    <div className="flex h-full min-h-full flex-col items-center justify-center px-10">
      {icon}
      <p className="mt-3 max-w-[22rem] text-center text-[13px] leading-relaxed text-text/35">
        {body}
      </p>
    </div>
  );
}

// A produce selection renders its matching recipes as full recipe cards — the
// same detail body as the pane, stacked. A lone card grows to fill the slot
// (flex, not min-h-full: a percentage minimum needs a definite parent height).
function ProducePane({ item, recipes }) {
  if (recipes.length === 0) {
    const Icon = produceIcon(item.type);
    return (
      <div className="flex min-h-full flex-col items-center justify-center rounded-2xl bg-pane px-10">
        <Icon
          className={`h-6 w-6 ${
            item.tone === "pick" ? "text-pick-dim" : "text-match-dim"
          }`}
          strokeWidth={1.5}
        />
        <p className="mt-3 max-w-[22rem] text-center text-[13px] leading-relaxed text-text/35">
          Nothing in your collection uses{" "}
          <span className="capitalize text-text/60">{item.name}</span> yet.
        </p>
      </div>
    );
  }

  const only = recipes.length === 1;
  return (
    <div className="flex min-h-full flex-col gap-2.5">
      {recipes.map((rec) => (
        <RecipeDetail
          key={rec.id}
          recipe={rec}
          surfaceClass={`rounded-2xl bg-pane ${only ? "flex flex-1 flex-col" : ""}`}
        />
      ))}
    </div>
  );
}
