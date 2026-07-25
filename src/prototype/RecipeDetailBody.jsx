// PROTOTYPE — the recipe detail body, shared by the Best Matches detail
// pane and the In Season stack. Its own file so VariantA2 and produceLayouts
// don't have to import from each other (a cycle).
import { ExternalLink, Ban, Clock, Heart } from "lucide-react";
import { rgba } from "./palettes.js";
import { ingredientIcon } from "./icons.js";

// `surfaceClass` makes the body its own standalone pane — used by the In
// Season stack, where each recipe *is* a pane rather than sitting inside one.
// Padding is identical either way, so a card is indistinguishable from the
// Best Matches detail pane; only the surface differs.
export function Detail({ rec, surfaceClass = "", surfaceStyle, palette: p }) {
  const produce = (rec.ingredients || []).filter((i) => !i.pantry);
  const pantry = (rec.ingredients || []).filter((i) => i.pantry);
  const hit = (n) => rec.pick_matches?.includes(n) || rec.seasonal_matches?.includes(n);

  // key_ingredients is a bare name list, so the pantry flag has to come from
  // the matching ingredient row. Unanalysed lines have no name and no flag —
  // those fall through to produce, which is the commoner case.
  const isPantry = (n) =>
    (rec.ingredients || []).find((i) => i.name && i.name.toLowerCase() === n.toLowerCase())?.pantry ?? false;

  return (
    <div className={`overflow-hidden pb-16 ${surfaceClass}`} style={surfaceStyle}>
      {/* Full-bleed banner. Mela's photos are bright, high-key and shot on
          white, so a scrim is doing real work here: without it the image ends
          in a hard bright line against the near-black pane, and the title
          below it loses its footing. */}
      {rec.image && (
        <div className="relative h-52 w-full overflow-hidden">
          <img src={rec.image} alt="" className="h-full w-full object-cover" />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, ${rgba(p.pane, 0.1)} 0%, ${rgba(p.pane, 0.55)} 55%, ${p.pane} 100%)`,
            }}
          />
        </div>
      )}

      <div className={`@container px-10 ${rec.image ? "-mt-14 relative" : "pt-9"}`}>
      {/* Container query, not viewport: this same body also renders as a
          stacked card inside the In Season pane, so it has to react to its own
          width. Below 30rem the button wraps onto its own line rather than
          squeezing the title into two-word lines. */}
      <div className="flex flex-col items-start gap-4 @[30rem]:flex-row @[30rem]:items-start @[30rem]:justify-between @[30rem]:gap-8">
        <div className="min-w-0 @[30rem]:flex-1">
          {/* Whole line takes the figure's old style — 13px, medium, normal
              tracking, title case — so only colour separates the two. */}
          {typeof rec.rating === "number" && (
            <p className="mb-3 text-[13px] font-medium" style={{ color: rgba(p.text, 0.45) }}>
              <span className="tabular-nums" style={{ color: p.match }}>{Math.round(rec.rating * 100)}</span> Match
            </p>
          )}
          <h2 className="text-[27px] font-semibold leading-[1.18] tracking-tight" style={{ color: p.text }}>
            {rec.title}
          </h2>
          <div className="mt-4 flex items-center gap-4 text-[12px]" style={{ color: rgba(p.text, 0.4) }}>
            {rec.total_time && <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{rec.total_time}</span>}
            {rec.yield && <span>{rec.yield}</span>}
            {rec.favorite && <Heart className="h-3.5 w-3.5" style={{ fill: p.pick, color: p.pick }} />}
          </div>
        </div>
        {/* Exclude lives on the list row's context menu now — it's a rare,
            per-recipe housekeeping action, not something to sit beside the
            one button people actually came here to press. */}
        <div className="flex shrink-0 gap-2">
          <button className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium hover:brightness-110" style={{ background: p.text, color: p.ground }}>
            Open in Mela <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Every chip carries an icon — produce or pantry — so the icon reads as
          "what kind of thing this is", and the fill alone carries "in season".
          Previously the icon appeared only on a match, which conflated the
          two and made it look like decoration. */}
      {rec.key_ingredients?.length > 0 && (
        <div className="mt-8">
          <p className="mb-3 text-[9.5px] uppercase tracking-[0.18em]" style={{ color: rgba(p.text, 0.32) }}>Built around</p>
          <div className="flex flex-wrap gap-1.5">
            {rec.key_ingredients.map((k) => {
              const on = hit(k);
              const Icon = ingredientIcon(isPantry(k));
              return (
                <span
                  key={k}
                  className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-[13px] capitalize"
                  style={
                    on
                      ? { background: rgba(p.matchWash, 0.12), color: p.matchSoft }
                      : { background: rgba(p.text, 0.05), color: rgba(p.text, 0.55) }
                  }
                >
                  <Icon
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: on ? p.match : rgba(p.text, 0.35) }}
                    strokeWidth={1.75}
                  />
                  {k}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {rec.description && (
        <p className="mt-8 whitespace-pre-wrap text-[13.5px] leading-[1.75]" style={{ color: rgba(p.text, 0.6) }}>
          {rec.description}
        </p>
      )}

      <div className="mt-10 grid grid-cols-2 gap-x-10 gap-y-2">
        <Col title="Produce" rows={produce} hit={hit} p={p} />
        <Col title="Pantry" rows={pantry} hit={() => false} p={p} />
      </div>
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
