import { Check, ExternalLink } from "lucide-react";

const { invoke } = window.__TAURI__.core;

function inList(list, name) {
  const n = name.trim().toLowerCase();
  return list.some((p) => {
    const q = p.trim().toLowerCase();
    return q === n || q.includes(n) || n.includes(q);
  });
}

export default function RecipeDetail({ recipe }) {
  const ingredientLines = (recipe.ingredients || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const matches = recipe.matches || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <h2 className="text-2xl font-black text-white leading-tight">{recipe.title}</h2>
        <button
          onClick={() => invoke("open_recipe", { id: recipe.id })}
          className="shrink-0 flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium bg-emerald-500 text-white rounded-lg shadow-sm hover:bg-emerald-600 transition-all"
        >
          <span>Open in Mela</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {recipe.fit && <p className="text-sm text-slate-300">{recipe.fit}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {ingredientLines.length > 0 && (
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Ingredients
            </h3>
            <div className="space-y-2">
              {ingredientLines.map((ing, idx) => {
                const isInSeason = matches.length > 0 && inList(matches, ing);
                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-2.5 rounded-lg border ${
                      isInSeason
                        ? "border-emerald-500/20 bg-emerald-500/5 text-slate-100"
                        : "border-slate-800/60 text-slate-400"
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                          isInSeason ? "bg-emerald-500 text-white" : "border border-slate-700"
                        }`}
                      >
                        {isInSeason && <Check className="w-3 h-3" />}
                      </div>
                      <span className="text-xs">{ing}</span>
                    </div>
                    {isInSeason && (
                      <span className="text-[9px] bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded font-bold shrink-0">
                        In Season
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {recipe.description && (
          <div className={ingredientLines.length > 0 ? "lg:col-span-3 space-y-3" : "lg:col-span-5 space-y-3"}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Recipe</h3>
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
              {recipe.description}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
