import { useMemo, useState } from "react";
import { Check, AlertCircle } from "lucide-react";
import { knownNames, rankNames } from "./rankNames.js";

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
  // Frozen on open: saving rewrites `recipes`, and a live queue would
  // renumber underneath the user mid-fix.
  const [queue] = useState(() => unfixedDisplays(recipes));
  const known = useMemo(() => knownNames(recipes), [recipes]);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState("");
  const [pantry, setPantry] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = queue[index];
  const remaining = queue.length - index;

  // The suggestion list is the point of this screen — seeded from the raw
  // line until the user types, so the closest existing names are already
  // on offer before anything is entered.
  const suggestions = useMemo(() => rankNames(known, name || current || ""), [known, name, current]);
  const exact = known.find((k) => k.name.toLowerCase() === name.trim().toLowerCase());
  const isNew = name.trim() && !exact;

  async function save() {
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
      if (index + 1 >= queue.length) onClose();
      else setIndex((i) => i + 1);
    } catch (err) {
      console.error("failed to set ingredient name", err);
    } finally {
      setSaving(false);
    }
  }

  // Choosing an existing name carries its produce/pantry flag with it — that
  // classification is already settled, so re-asking would invite a conflict.
  function choose(k) {
    setName(k.name);
    setPantry(k.pantry);
  }

  if (!current) {
    return (
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-ground/80 px-6"
        onClick={onClose}
      >
        <div
          className="flex w-[34rem] flex-col items-center rounded-2xl bg-pane px-8 py-12"
          onClick={(e) => e.stopPropagation()}
        >
          <Check className="h-6 w-6 text-match-dim" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] text-text/35">Every ingredient has a name.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ground/80 px-6"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-[34rem] overflow-y-auto rounded-2xl bg-pane px-8 pb-8 pt-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="mb-2.5 text-[13px] font-medium text-text/45">
              <span className="tabular-nums text-alert">{remaining}</span> to name
            </p>
            <h2 className="text-[21px] font-semibold leading-[1.25] tracking-tight text-text">
              {current}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-xl bg-text/8 px-3 py-1.5 text-[12px] text-text/60 hover:brightness-125"
          >
            Done
          </button>
        </div>

        <div className="mt-7">
          <p className="mb-3 text-[11px] font-medium tracking-[0.02em] text-text/40">Name</p>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Start typing, or pick one below"
            className="w-full rounded-xl border-none bg-ground px-4 py-3 text-[15px] text-text/90 outline-none placeholder:opacity-40"
          />
          {isNew && (
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-alert-soft">
              <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={2} />
              New ingredient — check it isn't one of these first
            </p>
          )}
        </div>

        <div className="mt-6">
          <p className="mb-3 text-[11px] font-medium tracking-[0.02em] text-text/40">
            Already in your collection
          </p>
          <div className="space-y-0.5">
            {suggestions.map((k) => {
              const on = k.name.toLowerCase() === name.trim().toLowerCase();
              return (
                <button
                  key={k.name}
                  onClick={() => choose(k)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:brightness-125 ${
                    on ? "bg-text/11" : "bg-text/4"
                  }`}
                >
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] capitalize ${
                      on ? "text-text/95" : "text-text/70"
                    }`}
                  >
                    {k.name}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-text/30">
                    {k.pantry ? "pantry" : "produce"}
                  </span>
                  <span className="w-5 shrink-0 text-right text-[10.5px] tabular-nums text-text/30">
                    {k.count}
                  </span>
                </button>
              );
            })}
            {suggestions.length === 0 && (
              <p className="px-3.5 py-2.5 text-[12.5px] text-text/30">Nothing similar yet.</p>
            )}
          </div>
        </div>

        {/* Both controls take one explicit height rather than stacking their
            own paddings — the segmented wrapper's p-1 made it 11px shorter. */}
        <div className="mt-7 flex items-stretch gap-2">
          <div className="flex h-10 flex-1 gap-1 rounded-xl bg-text/4 p-1">
            {[
              { label: "Produce", value: false },
              { label: "Pantry", value: true },
            ].map((opt) => (
              <button
                key={opt.label}
                onClick={() => setPantry(opt.value)}
                className={`flex-1 rounded-lg text-[12px] transition-colors ${
                  pantry === opt.value
                    ? "bg-text/9 text-text/90"
                    : "text-text/45"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="h-10 shrink-0 rounded-xl bg-text px-5 text-[12.5px] font-medium text-ground transition-opacity disabled:opacity-30"
          >
            {index + 1 >= queue.length ? "Save and finish" : "Save and next"}
          </button>
        </div>
      </div>
    </div>
  );
}
