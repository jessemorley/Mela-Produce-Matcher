// PROTOTYPE — the recipe detail body, shared by the Best Matches detail
// pane and the In Season stack. Its own file so VariantA2 and produceLayouts
// don't have to import from each other (a cycle).
import { ExternalLink, Ban, Clock, Heart, Sprout } from "lucide-react";
import { rgba } from "./palettes.js";

// `surfaceClass` makes the body its own standalone pane — used by the In
// Season stack, where each recipe *is* a pane rather than sitting inside one.
// Padding is identical either way, so a card is indistinguishable from the
// Best Matches detail pane; only the surface differs.
export function Detail({ rec, surfaceClass = "", surfaceStyle, palette: p }) {
  const produce = (rec.ingredients || []).filter((i) => !i.pantry);
  const pantry = (rec.ingredients || []).filter((i) => i.pantry);
  const hit = (n) => rec.pick_matches?.includes(n) || rec.seasonal_matches?.includes(n);

  return (
    <div className={`px-10 pb-16 pt-9 ${surfaceClass}`} style={surfaceStyle}>
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0">
          {/* Whole line takes the figure's old style — 13px, medium, normal
              tracking, title case — so only colour separates the two. */}
          {typeof rec.rating === "number" && (
            <p className="mb-3 text-[13px] font-medium" style={{ color: rgba(p.text, 0.45) }}>
              <span className="tabular-nums" style={{ color: p.match }}>{Math.round(rec.rating * 100)}</span> Match
            </p>
          )}
          <h2 className="max-w-lg text-[27px] font-semibold leading-[1.18] tracking-tight" style={{ color: p.text }}>
            {rec.title}
          </h2>
          <div className="mt-4 flex items-center gap-4 text-[12px]" style={{ color: rgba(p.text, 0.4) }}>
            {rec.total_time && <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{rec.total_time}</span>}
            {rec.yield && <span>{rec.yield}</span>}
            {rec.favorite && <Heart className="h-3.5 w-3.5" style={{ fill: p.pick, color: p.pick }} />}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] hover:brightness-125" style={{ background: rgba(p.text, 0.07), color: rgba(p.text, 0.6) }}>
            <Ban className="h-3.5 w-3.5" /> Exclude
          </button>
          <button className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium hover:brightness-110" style={{ background: p.text, color: p.ground }}>
            Open in Mela <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* A2 idiom: content sits on a filled surface, not bare on the pane, and
          a matched key ingredient carries a filled accent chip — the icon
          alone read as decoration rather than a state. */}
      {rec.key_ingredients?.length > 0 && (
        <div className="mt-8">
          <p className="mb-3 text-[9.5px] uppercase tracking-[0.18em]" style={{ color: rgba(p.text, 0.32) }}>Built around</p>
          <div className="flex flex-wrap gap-1.5">
            {rec.key_ingredients.map((k) => (
              <span
                key={k}
                className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-[13px] capitalize"
                style={
                  hit(k)
                    ? { background: rgba(p.matchWash, 0.12), color: p.matchSoft }
                    : { background: rgba(p.text, 0.05), color: rgba(p.text, 0.55) }
                }
              >
                {hit(k) && <Sprout className="h-3.5 w-3.5 shrink-0" style={{ color: p.match }} strokeWidth={1.75} />}
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {rec.description && (
        <p className="mt-8 max-w-2xl whitespace-pre-wrap text-[13.5px] leading-[1.75]" style={{ color: rgba(p.text, 0.6) }}>
          {rec.description}
        </p>
      )}

      <div className="mt-10 grid max-w-2xl grid-cols-2 gap-x-10 gap-y-2">
        <Col title="Produce" rows={produce} hit={hit} p={p} />
        <Col title="Pantry" rows={pantry} hit={() => false} p={p} />
      </div>
    </div>
  );
}

// Text colour alone marks a seasonal match — no checkbox, which would imply
// availability, and no row fill, which competes with the chips above.
function Col({ title, rows, hit, p }) {
  return (
    <div>
      <p className="mb-3 text-[9.5px] uppercase tracking-[0.18em]" style={{ color: rgba(p.text, 0.32) }}>{title}</p>
      <div className="space-y-0.5">
        {rows.map((i, n) => (
          <div
            key={n}
            className={`truncate px-3 py-1.5 text-[13px] capitalize ${i.name ? "" : "italic"}`}
            style={{ color: hit(i.name) ? p.matchSoft : i.name ? rgba(p.text, 0.6) : rgba(p.alertSoft, 0.75) }}
          >
            {i.name || i.display}
          </div>
        ))}
        {rows.length === 0 && <p className="px-3 text-[12.5px]" style={{ color: rgba(p.text, 0.22) }}>None.</p>}
      </div>
    </div>
  );
}
