import { useEffect, useState, useMemo } from "react";
import { Leaf, Loader2, XCircle } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import RecipeList from "./components/RecipeList.jsx";
import RecipeDetail from "./components/RecipeDetail.jsx";
import ArticleView from "./components/ArticleView.jsx";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

export default function App() {
  const [status, setStatus] = useState("Starting...");
  const [busy, setBusy] = useState(true);
  const [selectedNav, setSelectedNav] = useState("matching"); // 'matching' | 'produce' | 'recipes'
  const [searchQuery, setSearchQuery] = useState("");
  const [showArticle, setShowArticle] = useState(false);

  const [feedTitle, setFeedTitle] = useState("");
  const [feedLink, setFeedLink] = useState("");
  const [feedHtml, setFeedHtml] = useState("");
  const [produce, setProduce] = useState({ fruit: [], vegetable: [], pick: [], featured: [] });
  const [recipeCount, setRecipeCount] = useState(0);

  const [rankedRecipes, setRankedRecipes] = useState([]); // scored locally by key ingredients
  const [allRecipes, setAllRecipes] = useState([]); // full local recipes.json, for "Saved Recipes"
  const [activeRecipeId, setActiveRecipeId] = useState(null);
  const [unanalyzedCount, setUnanalyzedCount] = useState(0);

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
        setFeedLink(result.produce.feed_link);
        setFeedHtml(result.produce.feed_html);
        setProduce(result.produce);
        setRecipeCount(result.recipe_count);
        setUnanalyzedCount(result.unanalyzed_count);
        return invoke("list_recipes");
      })
      .then((recipes) => setAllRecipes(recipes ?? []))
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

  // Ranked recipes already carry their full record from the backend, so a
  // selection only needs the Saved Recipes list as a fallback for recipes
  // that never matched.
  const activeRecipe = useMemo(() => {
    const id = activeRecipeId ?? rankedRecipes[0]?.id;
    if (!id) return null;
    return (
      rankedRecipes.find((r) => r.id === id) ||
      allRecipes.find((r) => r.id === id) ||
      null
    );
  }, [rankedRecipes, allRecipes, activeRecipeId]);

  async function runMatch() {
    setActiveRecipeId(null);
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

  // "Sync Now": run the Claude key-ingredient analysis over recipes the
  // launch sync found unanalysed, then refresh the local list.
  async function analyzeNew() {
    setBusy(true);
    try {
      await invoke("analyze_new_recipes");
      setAllRecipes((await invoke("list_recipes")) ?? []);
      setUnanalyzedCount(0);
    } catch (err) {
      setStatus(err === "cancelled" ? "Cancelled." : `Error: ${err}`);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    invoke("cancel");
  }

  return (
    <div className="w-screen h-screen bg-slate-50 flex text-slate-800 font-sans overflow-hidden select-none">
      <Sidebar
        selectedNav={selectedNav}
        onSelectNav={setSelectedNav}
        matchCount={rankedRecipes.length}
        produceCount={produce.fruit.length + produce.vegetable.length}
        recipeCount={recipeCount}
      />

      <RecipeList
        selectedNav={selectedNav}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        produce={produce}
        rankedRecipes={rankedRecipes}
        allRecipes={allRecipes}
        activeRecipeId={activeRecipe?.id}
        onSelectRecipe={setActiveRecipeId}
        unanalyzedCount={unanalyzedCount}
        onSyncNow={analyzeNew}
        feedLink={feedLink}
        onOpenArticle={() => setShowArticle(true)}
      />

      <div className="flex-1 flex flex-col bg-slate-50/50 overflow-hidden relative">
        <div className="absolute inset-x-0 top-0 h-8 z-10" data-tauri-drag-region />
        <div className="flex-1 overflow-y-auto">
          {showArticle ? (
            <ArticleView
              title={feedTitle}
              html={feedHtml}
              onBack={() => setShowArticle(false)}
            />
          ) : activeRecipe ? (
            <RecipeDetail recipe={activeRecipe} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
              <Leaf className="w-8 h-8" />
              <p>Match recipes against this week's produce to get started.</p>
            </div>
          )}
        </div>

        <div className="h-9 shrink-0 border-t border-slate-200/60 px-4 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {status}
          </span>
          {busy && (
            <button
              onClick={cancel}
              className="flex items-center gap-1 text-rose-600 hover:text-rose-700"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
