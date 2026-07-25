// PROTOTYPE — the three views the first rounds never designed:
// All Recipes (list slot), the Fix Now queue (modal), and ArticleView
// (detail slot). No new idioms invented — each reuses the shell's existing
// vocabulary: flat rounded fills, palette tints, accent reserved for state.
import { useMemo, useState } from "react";
import { Search, Clock, Heart, ChevronLeft, Check, AlertCircle, BookOpen } from "lucide-react";
import { rgba } from "./palettes.js";
import { VEGETABLE } from "./icons.js";
import { FilterChip, ListEmpty } from "./ListStates.jsx";

// ─────────────────────────────────────────────────────────────────────────
// All Recipes — the list slot. Mirrors the real SavedRecipesView: synced /
// unsynced / excluded sections, each with a count. Rows echo the Best
// Matches row (same padding, same title size) but carry time/tags instead of
// a rating, since an unmatched recipe has no rating to show.
// ─────────────────────────────────────────────────────────────────────────
export function AllRecipesList({ recipes, activeId, onSelect, query, onQuery, onContextMenu, isExcluded, tag, onClearTag, p }) {
  const filtered = recipes
    .filter((r) => r.title.toLowerCase().includes(query.toLowerCase()))
    .filter((r) => !tag || r.tags?.includes(tag));
  const off = (r) => (isExcluded ? isExcluded(r.id) : r.excluded);
  const active = filtered.filter((r) => !off(r));
  const synced = active.filter((r) => r.key_ingredients?.length > 0);
  const unsynced = active.filter((r) => !(r.key_ingredients?.length > 0));
  const excluded = filtered.filter(off);

  const Row = ({ rec, dim }) => {
    const on = activeId === rec.id;
    return (
      <button
        onClick={() => onSelect(rec.id)}
        onContextMenu={onContextMenu?.(rec)}
        className="mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:brightness-125"
        style={{ background: on ? rgba(p.text, 0.07) : undefined, opacity: dim ? 0.5 : 1 }}
      >
        {/* Mela images are base64 data URIs; a recipe can have none, so the
            slot keeps its footprint and falls back to the produce mark. */}
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg"
          style={{ background: rgba(p.text, 0.05) }}
        >
          {rec.image ? (
            <img src={rec.image} alt="" className="h-full w-full object-cover" />
          ) : (
            <VEGETABLE className="h-[18px] w-[18px]" style={{ color: rgba(p.text, 0.22) }} strokeWidth={1.75} />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className="min-w-0 flex-1 text-[13px] leading-snug"
              style={{ color: rgba(p.text, on ? 0.95 : 0.65) }}
            >
              {rec.title}
            </span>
            {rec.favorite && <Heart className="h-3 w-3 shrink-0" style={{ fill: p.pick, color: p.pick }} />}
          </span>
          {(rec.total_time || rec.tags?.length > 0) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px]" style={{ color: rgba(p.text, 0.32) }}>
              {rec.total_time && (
                <span className="flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {rec.total_time}
                </span>
              )}
              {rec.tags?.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </span>
          )}
        </span>
      </button>
    );
  };

  const Section = ({ title, rows, dim }) =>
    rows.length > 0 && (
      <>
        <p className="px-3 pb-2 pt-5 text-[9.5px] uppercase tracking-[0.18em]" style={{ color: rgba(p.text, 0.32) }}>
          {title} · {rows.length}
        </p>
        {rows.map((rec) => (
          <Row key={rec.id} rec={rec} dim={dim} />
        ))}
      </>
    );

  return (
    <>
      <div className="flex items-baseline justify-between px-5 pb-4 pt-5">
        <h2 className="text-[12.5px] font-medium" style={{ color: rgba(p.text, 0.7) }}>
          All Recipes
        </h2>
        <span className="text-[10.5px] tabular-nums" style={{ color: rgba(p.text, 0.3) }}>
          {filtered.length === recipes.length ? recipes.length : `${filtered.length} of ${recipes.length}`}
        </span>
      </div>

      <SearchField value={query} onChange={onQuery} p={p} />
      {tag && <FilterChip tag={tag} onClear={onClearTag} p={p} />}

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <Section title="Synced" rows={synced} />
        <Section title="Unsynced" rows={unsynced} />
        <Section title="Excluded" rows={excluded} dim />
        {filtered.length === 0 && (
          <ListEmpty
            p={p}
            icon={recipes.length === 0 ? BookOpen : Search}
            title={recipes.length === 0 ? "No recipes yet" : "Nothing found"}
            body={
              recipes.length === 0
                ? "Recipes sync from Mela when the app starts."
                : tag && query
                  ? `No ${tag.toLowerCase()} recipes match that search.`
                  : tag
                    ? `Nothing in ${tag.toLowerCase()} yet.`
                    : "No recipes match that search."
            }
            action={tag ? { label: "Clear filter", onClick: onClearTag } : null}
          />
        )}
      </div>
    </>
  );
}

// Shared by both list views — sits where the market-update button sits on the
// In Season tab, so the list header block is the same height everywhere.
export function SearchField({ value, onChange, p }) {
  return (
    <div className="mx-3 mb-3 relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
        style={{ color: rgba(p.text, 0.3) }}
        strokeWidth={1.75}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search recipes"
        className="w-full rounded-xl border-none py-2.5 pl-9 pr-3 text-[11.5px] outline-none placeholder:opacity-60"
        style={{ background: p.ground, color: rgba(p.text, 0.8) }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Fix — a modal over whatever's on screen, so the queue doesn't displace the
// recipe you were reading.
//
// The suggestion list is the point: every canonical name already in the
// collection, ranked by closeness to what's been typed, with the number of
// recipes using it. Picking an existing name is one click; inventing a new
// one takes a deliberate second action.
// ─────────────────────────────────────────────────────────────────────────
export function FixView({ recipes, onClose, p }) {
  const queue = useMemo(() => unfixedDisplays(recipes), [recipes]);
  const known = useMemo(() => knownNames(recipes), [recipes]);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState("");
  const [pantry, setPantry] = useState(false);

  const current = queue[index];
  const remaining = queue.length - index;

  const suggestions = useMemo(() => rankNames(known, name || current || ""), [known, name, current]);
  const exact = known.find((k) => k.name.toLowerCase() === name.trim().toLowerCase());
  const isNew = name.trim() && !exact;

  if (!current) {
    return (
      <div
        className="fixed inset-0 z-40 flex items-center justify-center px-6"
        style={{ background: rgba(p.ground, 0.82) }}
        onClick={onClose}
      >
        <div
          className="flex w-[34rem] flex-col items-center rounded-2xl px-8 py-12"
          style={{ background: p.pane }}
          onClick={(e) => e.stopPropagation()}
        >
          <Check className="h-6 w-6" style={{ color: p.matchDim }} strokeWidth={1.5} />
          <p className="mt-3 text-[13px]" style={{ color: rgba(p.text, 0.35) }}>
            Every ingredient has a name.
          </p>
        </div>
      </div>
    );
  }

  function save() {
    if (!name.trim()) return;
    setName("");
    setPantry(false);
    if (index + 1 >= queue.length) onClose();
    else setIndex((i) => i + 1);
  }

  // Choosing an existing name carries its produce/pantry flag with it — that
  // classification is already settled, so re-asking would invite a conflict.
  function choose(k) {
    setName(k.name);
    setPantry(k.pantry);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-6"
      style={{ background: rgba(p.ground, 0.82) }}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-[34rem] overflow-y-auto rounded-2xl px-8 pb-8 pt-7"
        style={{ background: p.pane }}
        onClick={(e) => e.stopPropagation()}
      >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="mb-2.5 text-[13px] font-medium" style={{ color: rgba(p.text, 0.45) }}>
            <span className="tabular-nums" style={{ color: p.alert }}>{remaining}</span> to name
          </p>
          <h2 className="text-[21px] font-semibold leading-[1.25] tracking-tight" style={{ color: p.text }}>
            {current}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-xl px-3 py-1.5 text-[12px] hover:brightness-125"
          style={{ background: rgba(p.text, 0.07), color: rgba(p.text, 0.6) }}
        >
          Done
        </button>
      </div>

      <div className="mt-7">
        <p className="mb-3 text-[9.5px] uppercase tracking-[0.18em]" style={{ color: rgba(p.text, 0.32) }}>
          Name
        </p>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Start typing, or pick one below"
          className="w-full rounded-xl border-none px-4 py-3 text-[15px] outline-none placeholder:opacity-40"
          style={{ background: p.ground, color: rgba(p.text, 0.9) }}
        />

        {isNew && (
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px]" style={{ color: p.alertSoft }}>
            <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={2} />
            New ingredient — check it isn't one of these first
          </p>
        )}
      </div>

      <div className="mt-6">
        <p className="mb-3 text-[9.5px] uppercase tracking-[0.18em]" style={{ color: rgba(p.text, 0.32) }}>
          Already in your collection
        </p>
        <div className="space-y-0.5">
          {suggestions.map((k) => {
            const on = k.name.toLowerCase() === name.trim().toLowerCase();
            return (
              <button
                key={k.name}
                onClick={() => choose(k)}
                className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:brightness-125"
                style={{ background: rgba(p.text, on ? 0.11 : 0.04) }}
              >
                <span
                  className="min-w-0 flex-1 truncate text-[13px] capitalize"
                  style={{ color: rgba(p.text, on ? 0.95 : 0.7) }}
                >
                  {k.name}
                </span>
                <span className="shrink-0 text-[10.5px]" style={{ color: rgba(p.text, 0.3) }}>
                  {k.pantry ? "pantry" : "produce"}
                </span>
                <span className="w-5 shrink-0 text-right text-[10.5px] tabular-nums" style={{ color: rgba(p.text, 0.3) }}>
                  {k.count}
                </span>
              </button>
            );
          })}
          {suggestions.length === 0 && (
            <p className="px-3.5 py-2.5 text-[12.5px]" style={{ color: rgba(p.text, 0.3) }}>
              Nothing similar yet.
            </p>
          )}
        </div>
      </div>

      {/* Both controls take one explicit height rather than stacking their own
          paddings — the segmented wrapper's p-1 made it 11px shorter. */}
      <div className="mt-7 flex items-stretch gap-2">
        <div className="flex h-10 flex-1 gap-1 rounded-xl p-1" style={{ background: rgba(p.text, 0.04) }}>
          {[
            { label: "Produce", value: false },
            { label: "Pantry", value: true },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => setPantry(opt.value)}
              className="flex-1 rounded-lg text-[12px] transition-colors"
              style={{
                background: pantry === opt.value ? rgba(p.text, 0.09) : undefined,
                color: rgba(p.text, pantry === opt.value ? 0.9 : 0.45),
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={save}
          disabled={!name.trim()}
          className="h-10 shrink-0 rounded-xl px-5 text-[12.5px] font-medium transition-opacity disabled:opacity-30"
          style={{ background: p.text, color: p.ground }}
        >
          {index + 1 >= queue.length ? "Save and finish" : "Save and next"}
        </button>
      </div>
      </div>
    </div>
  );
}

// Same rule as the real unfixedDisplays: dedupe by raw line, skip recipes the
// Sync Now banner covers and recipes the user excluded. Mela repeats a line
// verbatim across recipes, so one fix clears every copy.
function unfixedDisplays(recipes) {
  const seen = new Set();
  const out = [];
  for (const r of recipes) {
    if (!r.key_ingredients?.length || r.excluded) continue;
    for (const ing of r.ingredients || []) {
      if (!ing.name && !seen.has(ing.display)) {
        seen.add(ing.display);
        out.push(ing.display);
      }
    }
  }
  return out;
}

// Every canonical name already in the collection, with how many ingredient
// rows use it — the count is what tells you "walnuts" is the established
// spelling and "walnut" would be the odd one out.
function knownNames(recipes) {
  const map = new Map();
  for (const r of recipes) {
    for (const ing of r.ingredients || []) {
      if (!ing.name) continue;
      const k = map.get(ing.name) || { name: ing.name, pantry: ing.pantry, count: 0 };
      k.count += 1;
      map.set(ing.name, k);
    }
  }
  return [...map.values()];
}

// Ranked by closeness, not prefix — the whole point is surfacing "walnuts"
// when someone types "walnut", and near-misses when they've typed nothing yet
// (the raw line still contains the word). Cheap bigram overlap: no dependency,
// and good enough to catch plurals and small spelling drift.
function rankNames(known, input) {
  const q = input.toLowerCase().replace(/[^a-z ]/g, " ").trim();
  if (!q) return known.slice().sort((a, b) => b.count - a.count).slice(0, 6);
  const qb = bigrams(q);
  return known
    .map((k) => {
      const n = k.name.toLowerCase();
      const contained = q.includes(n) || n.includes(q);
      return { ...k, score: dice(qb, bigrams(n)) + (contained ? 0.5 : 0) };
    })
    .filter((k) => k.score > 0.2)
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 6);
}

function bigrams(s) {
  const out = new Set();
  for (const word of s.split(/\s+/)) {
    for (let i = 0; i < word.length - 1; i++) out.add(word.slice(i, i + 2));
  }
  return out;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return (2 * shared) / (a.size + b.size);
}

// ─────────────────────────────────────────────────────────────────────────
// ArticleView — the newsletter, in the detail slot. Measure is capped for
// reading; this is the one place in the app with real prose, so it gets a
// larger body size and looser leading than any other pane.
// ─────────────────────────────────────────────────────────────────────────
export function ArticleView({ title, html, onBack, p }) {
  return (
    <div className="px-10 pb-16 pt-9">
      <button
        onClick={onBack}
        className="mb-6 flex items-center gap-1.5 text-[11.5px] hover:brightness-125"
        style={{ color: rgba(p.text, 0.45) }}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back
      </button>

      <h2
        className="text-[27px] font-semibold leading-[1.18] tracking-tight"
        style={{ color: p.text }}
      >
        {title}
      </h2>

      <article
        className="prose-newsletter mt-7 text-[14.5px] leading-[1.8]"
        style={{ color: rgba(p.text, 0.68) }}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <style>{`
        .prose-newsletter > * + * { margin-top: 1.1em; }
        .prose-newsletter h3 {
          margin-top: 2em;
          font-size: 9.5px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: ${rgba(p.text, 0.32)};
        }
        .prose-newsletter a { color: ${p.match}; text-decoration: none; border-bottom: 1px solid ${rgba(p.match, 0.35)}; }
        .prose-newsletter img { max-width: 100%; border-radius: 12px; }
      `}</style>
    </div>
  );
}
