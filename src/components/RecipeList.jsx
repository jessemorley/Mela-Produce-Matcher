import { useState } from "react";
import { Search, Check, Sparkles, Heart, Clock } from "lucide-react";

const { invoke } = window.__TAURI__.core;

// N. **Recipe Title** — id: RECIPE_ID — matches: ingredient, ingredient — fit: reason
const LINE_RE = /^(\d+)\.\s+\*\*(.+?)\*\*\s+—\s+id:\s+(\S+)\s+—\s+matches:\s+(.*?)\s+—\s+fit:\s+(.+)$/;

// Parses one streamed suggestion-line into a display-ready recipe. Lines
// that don't match the expected shape (stray commentary from Claude) still
// render, just without structure — same fallback the old plain-JS UI used.
export function parseSuggestionLine(line) {
  const match = line.match(LINE_RE);
  if (!match) {
    return { id: line, title: line, matches: [], fit: "", raw: true };
  }
  const [, rank, title, id, matchesStr, fit] = match;
  return {
    id,
    rank: Number(rank),
    title,
    matches: matchesStr.split(",").map((s) => s.trim()).filter(Boolean),
    fit,
    raw: false,
  };
}

// Produce names come dynamically from Claude reading the live newsletter,
// so they won't reliably match a small hand-picked name→emoji table (the
// mockup only covered 12 fixed items) — key on type instead, which always
// matches.
const TYPE_STYLE = {
  Fruit: { emoji: "🍎", color: "bg-orange-100 text-orange-700" },
  Vegetable: { emoji: "🥬", color: "bg-emerald-100 text-emerald-700" },
};

function ProduceIcon({ type }) {
  const { emoji, color } = TYPE_STYLE[type];
  return (
    <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-base ${color}`}>
      {emoji}
    </span>
  );
}

function inList(list, name) {
  const n = name.trim().toLowerCase();
  return list.some((p) => {
    const q = p.trim().toLowerCase();
    return q === n || q.includes(n) || n.includes(q);
  });
}

function MatchingView({ rankedRecipes, activeRecipeId, onSelectRecipe, searchQuery, onMatch }) {
  const filtered = rankedRecipes.filter((r) =>
    r.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="p-3">
        <button
          onClick={onMatch}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Match Recipes
        </button>
      </div>
      <div className="divide-y divide-slate-100">
        {filtered.map((rec) => (
          <div
            key={rec.id}
            onClick={() => onSelectRecipe(rec.id)}
            className={`p-3.5 cursor-pointer transition-all ${
              activeRecipeId === rec.id
                ? "bg-slate-100 border-l-2 border-emerald-500"
                : "hover:bg-slate-50"
            }`}
          >
            <div className="flex justify-between items-start mb-1.5">
              {rec.rank && (
                <span className="text-[10px] font-semibold text-slate-400">#{rec.rank}</span>
              )}
            </div>
            <h3 className="text-xs font-bold text-slate-900 leading-tight mb-1">{rec.title}</h3>
            {rec.fit && <p className="text-[10px] text-slate-500 mb-1.5">{rec.fit}</p>}
            <div className="flex flex-wrap gap-1">
              {rec.matches.map((ing) => (
                <span
                  key={ing}
                  className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600"
                >
                  <Check className="w-2.5 h-2.5 inline -mt-px mr-0.5" />
                  {ing}
                </span>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="p-3.5 text-xs text-slate-400">
            No matches yet — click "Match Recipes" above.
          </p>
        )}
      </div>
    </div>
  );
}

function ProduceView({ produce, searchQuery }) {
  const [category, setCategory] = useState("All");

  const items = [
    ...produce.fruit.map((name) => ({ name, type: "Fruit" })),
    ...produce.vegetable.map((name) => ({ name, type: "Vegetable" })),
  ]
    .filter((item) => category === "All" || item.type === category)
    .filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <span className="text-xs font-bold text-slate-500">Filter Category</span>
        <div className="flex space-x-1">
          {["All", "Fruit", "Vegetable"].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`text-[10px] px-2 py-0.5 rounded ${
                category === cat
                  ? "bg-slate-200 text-slate-800 font-semibold"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {items.map((item) => (
          <div
            key={item.name}
            className="p-2.5 rounded-lg border border-emerald-500/20 bg-emerald-50/10 flex items-center justify-between transition-all hover:border-emerald-500/40"
          >
            <div className="flex items-center space-x-2.5">
              <ProduceIcon type={item.type} />
              <div>
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1">
                  {item.name}
                  {inList(produce.pick, item.name) && <span title="Pick of the week">★</span>}
                </h4>
                <span className="text-[9px] text-slate-400">
                  {item.type}
                  {inList(produce.featured, item.name) && " · Featured"}
                </span>
              </div>
            </div>
            <div className="w-5 h-5 shrink-0 rounded-full bg-emerald-500 text-white flex items-center justify-center">
              <Check className="w-3.5 h-3.5" />
            </div>
          </div>
        ))}
      </div>
      {items.length === 0 && (
        <p className="text-xs text-slate-400">
          {produce.fruit.length + produce.vegetable.length === 0
            ? "No produce loaded yet."
            : "No produce matches that filter."}
        </p>
      )}
    </div>
  );
}

function SavedRecipesView({ recipes, activeRecipeId, onSelectRecipe, searchQuery }) {
  const filtered = recipes.filter((r) =>
    r.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  return (
    <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
      {filtered.map((rec) => (
        <div
          key={rec.id}
          onClick={() => onSelectRecipe(rec.id)}
          className={`p-3.5 cursor-pointer transition-all ${
            activeRecipeId === rec.id ? "bg-slate-100" : "hover:bg-slate-50"
          }`}
        >
          {rec.favorite && (
            <div className="flex justify-end mb-1">
              <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
            </div>
          )}
          <h3 className="text-xs font-bold text-slate-800">{rec.title}</h3>
          {(rec.total_time || rec.yield) && (
            <div className="flex items-center space-x-3 mt-2 text-[10px] text-slate-400">
              {rec.total_time && (
                <span className="flex items-center">
                  <Clock className="w-3 h-3 mr-1" />
                  {rec.total_time}
                </span>
              )}
              {rec.yield && <span>Serves {rec.yield}</span>}
            </div>
          )}
        </div>
      ))}
      {filtered.length === 0 && (
        <p className="p-3.5 text-xs text-slate-400">No saved recipes match that search.</p>
      )}
    </div>
  );
}

export default function RecipeList({
  selectedNav,
  searchQuery,
  onSearchChange,
  produce,
  rankedRecipes,
  allRecipes,
  activeRecipeId,
  onSelectRecipe,
  onMatch,
  feedLink,
  onOpenArticle,
}) {
  return (
    <div className="w-80 shrink-0 border-r border-slate-200/60 flex flex-col bg-white">
      <div className="h-8 shrink-0" data-tauri-drag-region />
      <div className="p-3 border-b border-slate-100 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search produce or recipes..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100 border-none rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        {feedLink && (
          <button
            onClick={onOpenArticle}
            className="text-[11px] text-emerald-600 hover:text-emerald-700"
          >
            Read the market update →
          </button>
        )}
      </div>

      {selectedNav === "matching" && (
        <MatchingView
          rankedRecipes={rankedRecipes}
          activeRecipeId={activeRecipeId}
          onSelectRecipe={onSelectRecipe}
          searchQuery={searchQuery}
          onMatch={onMatch}
        />
      )}
      {selectedNav === "produce" && <ProduceView produce={produce} searchQuery={searchQuery} />}
      {selectedNav === "recipes" && (
        <SavedRecipesView
          recipes={allRecipes}
          activeRecipeId={activeRecipeId}
          onSelectRecipe={onSelectRecipe}
          searchQuery={searchQuery}
        />
      )}
    </div>
  );
}
