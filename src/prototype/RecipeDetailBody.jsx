// PROTOTYPE — the recipe detail body, shared by the Best Matches detail
// pane and the In Season stack. Its own file so VariantA2 and produceLayouts
// don't have to import from each other (a cycle).
import { ExternalLink, Ban, Clock, Heart, Sprout } from "lucide-react";

// `surfaceClass` makes the body its own standalone pane — used by the In
// Season stack, where each recipe *is* a pane rather than sitting inside one.
// Padding is identical either way, so a card is indistinguishable from the
// Best Matches detail pane; only the surface differs.
export function Detail({ rec, surfaceClass = "" }) {
  const produce = (rec.ingredients || []).filter((i) => !i.pantry);
  const pantry = (rec.ingredients || []).filter((i) => i.pantry);
  const hit = (n) => rec.pick_matches?.includes(n) || rec.seasonal_matches?.includes(n);

  return (
    <div className={`px-10 pb-16 pt-9 ${surfaceClass}`}>
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0">
          {/* Whole line takes the figure's old style — 13px, medium, normal
              tracking, title case — so only colour separates the two. */}
          {typeof rec.rating === "number" && (
            <p className="mb-3 text-[13px] font-medium text-neutral-500">
              <span className="tabular-nums text-emerald-400">{Math.round(rec.rating * 100)}</span> Match
            </p>
          )}
          <h2 className="max-w-lg text-[27px] font-semibold leading-[1.18] tracking-tight text-neutral-50">
            {rec.title}
          </h2>
          <div className="mt-4 flex items-center gap-4 text-[12px] text-neutral-500">
            {rec.total_time && <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{rec.total_time}</span>}
            {rec.yield && <span>{rec.yield}</span>}
            {rec.favorite && <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500" />}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="flex items-center gap-1.5 rounded-xl bg-white/[0.06] px-3 py-1.5 text-[12px] text-neutral-400 hover:bg-white/[0.1]">
            <Ban className="h-3.5 w-3.5" /> Exclude
          </button>
          <button className="flex items-center gap-1.5 rounded-xl bg-neutral-100 px-3 py-1.5 text-[12px] font-medium text-black hover:bg-white">
            Open in Mela <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* A2 idiom: content sits on a filled surface, not bare on the pane, and
          a matched key ingredient carries a filled emerald chip — the icon
          alone read as decoration rather than a state. */}
      {rec.key_ingredients?.length > 0 && (
        <div className="mt-8">
          <p className="mb-3 text-[9.5px] uppercase tracking-[0.18em] text-neutral-600">Built around</p>
          <div className="flex flex-wrap gap-1.5">
            {rec.key_ingredients.map((k) => (
              <span
                key={k}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-[13px] capitalize ${
                  hit(k) ? "bg-emerald-400/[0.08] text-emerald-200" : "bg-white/[0.05] text-neutral-400"
                }`}
              >
                {hit(k) && <Sprout className="h-3.5 w-3.5 shrink-0 text-emerald-400" strokeWidth={1.75} />}
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {rec.description && <p className="mt-8 max-w-2xl whitespace-pre-wrap text-[13.5px] leading-[1.75] text-neutral-400">{rec.description}</p>}

      <div className="mt-10 grid max-w-2xl grid-cols-2 gap-x-10 gap-y-2">
        <Col title="Produce" rows={produce} hit={hit} />
        <Col title="Pantry" rows={pantry} hit={() => false} />
      </div>
    </div>
  );
}

// Text colour alone marks a seasonal match — no checkbox, which would imply
// availability, and no row fill, which competes with the chips above.
function Col({ title, rows, hit }) {
  return (
    <div>
      <p className="mb-3 text-[9.5px] uppercase tracking-[0.18em] text-neutral-600">{title}</p>
      <div className="space-y-0.5">
        {rows.map((i, n) => (
          <div
            key={n}
            className={`truncate px-3 py-1.5 text-[13px] capitalize ${
              hit(i.name) ? "text-emerald-200" : i.name ? "text-neutral-400" : "italic text-rose-400/60"
            }`}
          >
            {i.name || i.display}
          </div>
        ))}
        {rows.length === 0 && <p className="px-3 text-[12.5px] text-neutral-700">None.</p>}
      </div>
    </div>
  );
}
