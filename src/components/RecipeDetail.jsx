import { ExternalLink, Clock, User, Heart, Check, RefreshCw } from "lucide-react";

const { invoke } = window.__TAURI__.core;

function inList(list, name) {
  const n = name.trim().toLowerCase();
  return list.some((p) => {
    const q = p.trim().toLowerCase();
    return q === n || q.includes(n) || n.includes(q);
  });
}

export default function RecipeDetail({ recipe, onResync }) {
  const ingredients = recipe.ingredients || [];
  const matches = recipe.matches || [];

  // Index carried alongside each row so duplicate display lines (e.g. two
  // "1 clove garlic" entries) still get unique React keys.
  const indexed = ingredients.map((ingredient, index) => ({ ingredient, index }));
  const produceRows = indexed.filter(({ ingredient }) => !ingredient.pantry);
  const pantryRows = indexed.filter(({ ingredient }) => ingredient.pantry);

  function IngredientRow({ ingredient }) {
    const inSeason =
      !ingredient.pantry && ingredient.name && matches.length > 0 && inList(matches, ingredient.name);
    return (
      <div
        className={`flex items-center justify-between p-2.5 rounded-lg border ${
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
          <span className="relative group/tooltip text-xs truncate capitalize">
            {ingredient.name || ingredient.display}
            {ingredient.name && ingredient.name !== ingredient.display && (
              <span className="pointer-events-none absolute left-0 top-full mt-1 z-30 hidden group-hover/tooltip:block whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] normal-case text-white shadow-lg">
                {ingredient.display}
              </span>
            )}
          </span>
        </div>
        {inSeason && (
          <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold shrink-0">
            In Season
          </span>
        )}
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
        <div className="shrink-0 flex items-center space-x-2">
          <button
            onClick={() => onResync(recipe.id)}
            title="Re-read this recipe from Mela"
            className="flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Resync from Mela</span>
          </button>
          <button
            onClick={() => invoke("open_recipe", { id: recipe.id })}
            className="flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium bg-emerald-500 text-white rounded-lg shadow-sm hover:bg-emerald-600 transition-all"
          >
            <span>Open in Mela</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
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

      {ingredients.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Ingredients</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                Produce
              </h4>
              {produceRows.map(({ ingredient, index }) => (
                <IngredientRow key={index} ingredient={ingredient} />
              ))}
              {produceRows.length === 0 && (
                <p className="text-[11px] text-slate-400">No fresh produce.</p>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Pantry
              </h4>
              {pantryRows.map(({ ingredient, index }) => (
                <IngredientRow key={index} ingredient={ingredient} />
              ))}
              {pantryRows.length === 0 && (
                <p className="text-[11px] text-slate-400">No pantry items.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
