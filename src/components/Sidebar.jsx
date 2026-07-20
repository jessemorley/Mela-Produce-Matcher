import { Leaf, Sparkles, BookOpen } from "lucide-react";

const NAV_ITEMS = [
  { key: "matching", label: "Harvest Matches", icon: Sparkles, count: (c) => c.matchCount },
  { key: "produce", label: "This Week's Produce", icon: Leaf, count: (c) => c.produceCount },
  { key: "recipes", label: "Saved Recipes", icon: BookOpen, count: (c) => c.recipeCount },
];

// ponytail: display-only, same as the mockup — Mela's schema has no tag
// field to filter on. Wire up onClick when it does.
const PANTRY_TAGS = [
  { label: "Baking Comfort", dot: "bg-amber-400" },
  { label: "Quick Dinners", dot: "bg-rose-400" },
  { label: "Vegan/Vegetarian", dot: "bg-emerald-400" },
];

export default function Sidebar({ selectedNav, onSelectNav, matchCount, produceCount, recipeCount }) {
  const counts = { matchCount, produceCount, recipeCount };

  return (
    <div className="w-64 shrink-0 bg-slate-100/90 border-r border-slate-200/60 flex flex-col">
      <div className="h-8 shrink-0" data-tauri-drag-region />

      <div className="px-4 py-3 flex items-center space-x-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-teal-500/20">
          <Leaf className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-sm tracking-wide text-slate-950">Sprout</h1>
          <p className="text-xs text-slate-500">Seasonal Matcher</p>
        </div>
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

      <div className="mt-6 px-2 space-y-1">
        <span className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
          My Pantry Tags
        </span>
        <div className="px-3 space-y-2 py-1.5">
          {PANTRY_TAGS.map(({ label, dot }) => (
            <div key={label} className="flex items-center space-x-2 text-xs text-slate-600">
              <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
