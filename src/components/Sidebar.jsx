import { useState } from "react";
import { Leaf, Sparkles, BookOpen, RefreshCw, ChevronDown } from "lucide-react";

const NAV_ITEMS = [
  { key: "matching", label: "Harvest Matches", icon: Sparkles, count: (c) => c.matchCount },
  { key: "produce", label: "In Season", icon: Leaf, count: (c) => c.produceCount },
  { key: "recipes", label: "Saved Recipes", icon: BookOpen, count: (c) => c.recipeCount },
];

const TAG_DOTS = ["bg-amber-400", "bg-rose-400", "bg-emerald-400", "bg-sky-400", "bg-violet-400"];

export default function Sidebar({
  selectedNav,
  onSelectNav,
  matchCount,
  produceCount,
  recipeCount,
  busy,
  onFullResync,
  categories,
  selectedTag,
  onSelectTag,
}) {
  const counts = { matchCount, produceCount, recipeCount };
  const [categoriesOpen, setCategoriesOpen] = useState(true);

  return (
    <div className="w-64 shrink-0 bg-slate-100/90 border-r border-slate-200/60 flex flex-col overflow-hidden">
      <div className="h-8 shrink-0" data-tauri-drag-region />

      <div className="px-4 py-3 flex items-center space-x-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-teal-500/20">
          <Leaf className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="font-bold text-sm tracking-wide text-slate-950">Sprout</h1>
          <p className="text-xs text-slate-500">Seasonal Matcher</p>
        </div>
        <button
          onClick={onFullResync}
          disabled={busy}
          title="Resync all recipes from Mela"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 disabled:opacity-50 transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="px-2 space-y-1">
        <span className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
          Library
        </span>
        {NAV_ITEMS.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => onSelectNav(key)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              selectedNav === key
                ? "bg-emerald-500 text-white shadow-sm"
                : "text-slate-700 hover:bg-slate-200/50"
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </div>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                selectedNav === key ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
              }`}
            >
              {count(counts)}
            </span>
          </button>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="mt-6 px-2 flex flex-col min-h-0 flex-1">
          <button
            onClick={() => setCategoriesOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 mb-1 shrink-0"
          >
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              Categories
            </span>
            <ChevronDown
              className={`w-3 h-3 text-slate-400 transition-transform ${
                categoriesOpen ? "" : "-rotate-90"
              }`}
            />
          </button>
          {categoriesOpen && (
            <div className="space-y-0.5 overflow-y-auto min-h-0">
              {categories.map(({ label, count }, i) => (
                <button
                  key={label}
                  onClick={() => onSelectTag(selectedTag === label ? null : label)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-all ${
                    selectedTag === label
                      ? "bg-slate-200 text-slate-900 font-semibold"
                      : "text-slate-600 hover:bg-slate-200/50"
                  }`}
                >
                  <span className="flex items-center space-x-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${TAG_DOTS[i % TAG_DOTS.length]}`} />
                    <span>{label}</span>
                  </span>
                  <span className="text-[10px] text-slate-400">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
