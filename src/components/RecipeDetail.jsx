import { useState } from "react";
import { Check, ExternalLink, Clock, User, Heart, MoreVertical } from "lucide-react";

const { invoke } = window.__TAURI__.core;

function inList(list, name) {
  const n = name.trim().toLowerCase();
  return list.some((p) => {
    const q = p.trim().toLowerCase();
    return q === n || q.includes(n) || n.includes(q);
  });
}

// Mirrors ingredient_name() in lib.rs closely enough to look an ingredient
// up in the pantry set. The backend owns the canonical version — this only
// has to agree on the common shapes, and a disagreement costs a wrong
// column, which the row's own menu can correct.
const LEADING_NOISE = new Set([
  "cup", "cups", "tbsp", "tbsps", "tsp", "tsps", "tablespoon", "tablespoons", "teaspoon",
  "teaspoons", "pound", "pounds", "lb", "lbs", "ounce", "ounces", "oz", "gram", "grams", "g",
  "kg", "ml", "l", "litre", "litres", "clove", "cloves", "can", "cans", "tin", "tins", "bunch",
  "bunches", "sprig", "sprigs", "slice", "slices", "pinch", "pinches", "handful", "handfuls",
  "package", "packages", "large", "medium", "small", "whole", "of", "fresh", "freshly", "dried",
  "ground", "chopped", "minced", "diced", "sliced", "grated", "toasted", "raw", "ripe", "extra",
  "virgin", "to",
]);

function singular(word) {
  if (/(o|ch|sh)es$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

// Rust's trim_matches only strips non-alphanumerics from the ENDS of a
// token, so trim the same way here — a blanket strip would turn "jalapeños"
// into "jalapeo" and never match the stored pantry entry.
const trimEnds = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

function ingredientName(line) {
  let s = line.toLowerCase().replace(/&nbsp;/g, " ");
  // Drop bracketed asides, widest span first, like the Rust side.
  const open = s.indexOf("(");
  const close = s.lastIndexOf(")");
  if (open !== -1 && close > open) s = s.slice(0, open) + " " + s.slice(close + 1);
  s = s.split(",")[0];
  const words = s.split(/[\s-]+/).filter(Boolean);
  while (words.length) {
    const w = trimEnds(words[0]);
    const unit = w.replace(/^[^a-z]+/, "");
    if (!/\p{L}/u.test(w) || LEADING_NOISE.has(w) || LEADING_NOISE.has(unit)) words.shift();
    else break;
  }
  return words.map((w) => singular(trimEnds(w))).filter(Boolean).join(" ");
}

export default function RecipeDetail({ recipe, pantry = [], onPantryChange }) {
  const [menuFor, setMenuFor] = useState(null);
  const ingredientLines = (recipe.ingredients || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const matches = recipe.matches || [];

  // Anything not in the stored pantry set is produce, so a new ingredient
  // shows up as produce rather than being silently hidden as a staple.
  const pantrySet = new Set(pantry);
  const isHeader = (line) => line.startsWith("#");
  const rows = ingredientLines
    .filter((l) => !isHeader(l))
    .map((line) => ({ line, pantry: pantrySet.has(ingredientName(line)) }));
  const produceRows = rows.filter((r) => !r.pantry);
  const pantryRows = rows.filter((r) => r.pantry);

  async function move(line, isPantry) {
    setMenuFor(null);
    try {
      onPantryChange?.(await invoke("set_pantry_item", { ingredient: line, isPantry }));
    } catch (err) {
      console.error("failed to update pantry", err);
    }
  }

  function IngredientRow({ line, isPantry }) {
    const inSeason = !isPantry && matches.length > 0 && inList(matches, line);
    return (
      <div
        className={`group flex items-center justify-between p-2.5 rounded-lg border ${
          inSeason
            ? "border-emerald-500/20 bg-emerald-50/60 text-slate-800"
            : "border-slate-200/60 text-slate-500"
        }`}
      >
        <div className="flex items-center space-x-2.5 min-w-0">
          <div
            className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
              inSeason ? "bg-emerald-500 text-white" : "border border-slate-300"
            }`}
          >
            {inSeason && <Check className="w-3 h-3" />}
          </div>
          <span className="text-xs truncate">{line}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 relative">
          {inSeason && (
            <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">
              In Season
            </span>
          )}
          <button
            onClick={() => setMenuFor(menuFor === line ? null : line)}
            className="p-0.5 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label="Categorise ingredient"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          {menuFor === line && (
            <div className="absolute right-0 top-6 z-20 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-xs">
              <button
                onClick={() => move(line, false)}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-slate-700"
              >
                Confirm as produce
              </button>
              <button
                onClick={() => move(line, true)}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-slate-700"
              >
                Move to pantry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-black text-slate-900 leading-tight">{recipe.title}</h2>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {recipe.total_time && (
              <span className="flex items-center bg-slate-100 px-2 py-1 rounded">
                <Clock className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                {recipe.total_time}
              </span>
            )}
            {recipe.yield && (
              <span className="flex items-center bg-slate-100 px-2 py-1 rounded">
                <User className="w-3.5 h-3.5 mr-1 text-blue-600" />
                {recipe.yield}
              </span>
            )}
            {recipe.favorite && <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />}
          </div>
        </div>
        <button
          onClick={() => invoke("open_recipe", { id: recipe.id })}
          className="shrink-0 flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium bg-emerald-500 text-white rounded-lg shadow-sm hover:bg-emerald-600 transition-all"
        >
          <span>Open in Mela</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {recipe.key_ingredients?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-slate-400">Built around</span>
          {recipe.key_ingredients.map((ing) => (
            <span
              key={ing}
              className={`text-[11px] px-2 py-0.5 rounded ${
                inList(matches, ing)
                  ? "bg-emerald-100 text-emerald-700 font-medium"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {ing}
            </span>
          ))}
        </div>
      )}

      {recipe.description && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Recipe</h3>
          <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
            {recipe.description}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Ingredients</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                Produce
              </h4>
              {produceRows.map(({ line }) => (
                <IngredientRow key={line} line={line} isPantry={false} />
              ))}
              {produceRows.length === 0 && (
                <p className="text-[11px] text-slate-400">No fresh produce.</p>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Pantry
              </h4>
              {pantryRows.map(({ line }) => (
                <IngredientRow key={line} line={line} isPantry />
              ))}
              {pantryRows.length === 0 && (
                <p className="text-[11px] text-slate-400">
                  {pantry.length === 0 ? "Pantry not categorised yet." : "No pantry items."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
