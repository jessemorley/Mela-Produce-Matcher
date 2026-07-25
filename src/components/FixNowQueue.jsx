import { useMemo, useState } from "react";
import { X } from "lucide-react";

const { invoke } = window.__TAURI__.core;

// Byte-identical display lines only need fixing once — Mela repeats the
// same line verbatim across many recipes ("1 tsp salt"), and the backend
// clears every match for one submission (see set_ingredient_name).
function unfixedDisplays(recipes) {
  const seen = new Set();
  const displays = [];
  for (const recipe of recipes) {
    if (!recipe.key_ingredients?.length) continue; // covered by Sync Now instead
    if (recipe.excluded) continue; // never matched, so nothing to fix for it
    for (const ing of recipe.ingredients || []) {
      if (!ing.name && !seen.has(ing.display)) {
        seen.add(ing.display);
        displays.push(ing.display);
      }
    }
  }
  return displays;
}

export default function FixNowQueue({ recipes, onClose, onRecipesChange }) {
  const queue = useMemo(() => unfixedDisplays(recipes), [recipes]);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState("");
  const [pantry, setPantry] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = queue[index];
  const remaining = queue.length - index;

  async function submit(e) {
    e.preventDefault();
    if (!current || !name.trim()) return;
    setSaving(true);
    try {
      const updated = await invoke("set_ingredient_name", {
        display: current,
        name: name.trim(),
        pantry,
      });
      onRecipesChange(updated);
      setName("");
      setPantry(false);
      if (index + 1 >= queue.length) {
        onClose();
      } else {
        setIndex((i) => i + 1);
      }
    } catch (err) {
      console.error("failed to set ingredient name", err);
    } finally {
      setSaving(false);
    }
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40">
      <div className="w-96 bg-white rounded-xl shadow-xl p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Fix ingredient</h3>
            <p className="text-[11px] text-slate-400">{remaining} remaining</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg p-2.5">
          {current}
        </p>

        <form onSubmit={submit} className="space-y-3">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Canonical name (e.g. garlic)"
            className="w-full px-3 py-1.5 text-xs bg-slate-100 border-none rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={!pantry}
                onChange={() => setPantry(false)}
              />
              Produce
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={pantry} onChange={() => setPantry(true)} />
              Pantry
            </label>
          </div>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="w-full py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-all"
          >
            {index + 1 >= queue.length ? "Save & finish" : "Save & next"}
          </button>
        </form>
      </div>
    </div>
  );
}
