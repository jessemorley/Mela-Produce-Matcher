import { ExternalLink, Clock, Heart, ChevronUp } from "lucide-react";
import { ingredientIcon } from "./icons.js";

const { invoke } = window.__TAURI__.core;

function inList(list, name) {
  const n = name.trim().toLowerCase();
  return list.some((p) => {
    const q = p.trim().toLowerCase();
    return q === n || q.includes(n) || n.includes(q);
  });
}

// `surfaceClass` makes the body its own standalone pane — used by the In
// Season stack, where each recipe *is* a pane rather than sitting inside one.
// Padding is identical either way, so a card is indistinguishable from the
// detail pane; only the surface differs.
// `onCollapse`, when given, adds a control to close this card back down —
// used by the In Season stack, where one of several matches is open at a
// time. The detail pane proper doesn't pass it: there's nothing to collapse
// into there.
// `ref` lands on the outer element so the In Season stack can scroll a
// newly-expanded card to the top of the pane. React 19 passes ref as a plain
// prop — no forwardRef needed.
export default function RecipeDetail({ recipe, surfaceClass = "", onCollapse, ref }) {
  const ingredients = recipe.ingredients || [];
  // Dave's Picks (live market update) take precedence over the seasonal
  // table when a key ingredient is in both, matching the backend's scoring.
  const pickMatches = recipe.pick_matches || [];
  const seasonalMatches = recipe.seasonal_matches || [];

  const hit = (name) =>
    !!name && (inList(pickMatches, name) || inList(seasonalMatches, name));

  // key_ingredients is a bare name list, so the pantry flag has to come from
  // the matching ingredient row. Unanalysed lines have no name and no flag —
  // those fall through to produce, which is the commoner case.
  const isPantry = (n) =>
    ingredients.find((i) => i.name && i.name.toLowerCase() === n.toLowerCase())?.pantry ?? false;

  // Index carried alongside each row so duplicate display lines (e.g. two
  // "1 clove garlic" entries) still get unique React keys.
  const indexed = ingredients.map((ingredient, index) => ({ ingredient, index }));
  const produceRows = indexed.filter(({ ingredient }) => !ingredient.pantry);
  const pantryRows = indexed.filter(({ ingredient }) => ingredient.pantry);

  return (
    <div ref={ref} className={`overflow-hidden pb-16 ${surfaceClass}`}>
      {/* Full-bleed banner. Mela's photos are bright, high-key and shot on
          white, so a scrim is doing real work here: without it the image ends
          in a hard bright line against the near-black pane, and the title
          below it loses its footing. */}
      {recipe.image && (
        <div className="relative h-52 w-full overflow-hidden">
          <img src={recipe.image} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-pane/10 via-pane/55 to-pane" />
        </div>
      )}

      <div className={`@container px-10 ${recipe.image ? "relative -mt-14" : "pt-9"}`}>
        {/* Container query, not viewport: this same body also renders as a
            stacked card inside the In Season pane, so it has to react to its
            own width. Below 30rem the button wraps onto its own line rather
            than squeezing the title into two-word lines. */}
        <div className="flex flex-col items-start gap-4 @[30rem]:flex-row @[30rem]:items-start @[30rem]:justify-between @[30rem]:gap-8">
          <div className="min-w-0 @[30rem]:flex-1">
            {/* Whole line takes the figure's style — 13px, medium, normal
                tracking — so only colour separates the number from the word. */}
            {typeof recipe.rating === "number" && (
              <p className="mb-3 text-[13px] font-medium text-text/45">
                <span className="tabular-nums text-match">
                  {Math.round(recipe.rating * 100)}
                </span>{" "}
                Match
              </p>
            )}
            <h2 className="text-[27px] font-semibold leading-[1.18] tracking-tight text-text">
              {recipe.title}
            </h2>
            <div className="mt-4 flex items-center gap-4 text-[12px] text-text/40">
              {recipe.total_time && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {recipe.total_time}
                </span>
              )}
              {recipe.yield && <span>{recipe.yield}</span>}
              {recipe.favorite && (
                <Heart className="h-3.5 w-3.5 fill-pick text-pick" />
              )}
              {recipe.excluded && <span className="text-alert-soft">Excluded</span>}
            </div>
          </div>
          {/* Exclude lives on the list row's context menu now — it's rare
              per-recipe housekeeping, not something to sit beside the one
              button people actually came here to press. */}
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => invoke("open_recipe", { id: recipe.id })}
              className="flex items-center gap-1.5 rounded-xl bg-text px-3 py-1.5 text-[12px] font-medium text-ground hover:brightness-110"
            >
              Open in Mela <ExternalLink className="h-3.5 w-3.5" />
            </button>
            {onCollapse && (
              <button
                onClick={onCollapse}
                title="Collapse"
                aria-label="Collapse"
                className="flex items-center rounded-xl bg-text/8 px-2.5 py-1.5 text-text/50 hover:bg-text/12 hover:text-text/80"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Every chip carries an icon — produce or pantry — so the icon reads
            as "what kind of thing this is", and the fill alone carries "in
            season". An icon only on a match conflated the two. */}
        {recipe.key_ingredients?.length > 0 && (
          <div className="mt-8">
            <p className="mb-3 text-[9.5px] uppercase tracking-[0.18em] text-text/32">
              Built around
            </p>
            <div className="flex flex-wrap gap-1.5">
              {recipe.key_ingredients.map((k) => {
                const on = hit(k);
                const Icon = ingredientIcon(isPantry(k));
                return (
                  <span
                    key={k}
                    className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-[13px] capitalize ${
                      on
                        ? "bg-match/12 text-match-soft"
                        : "bg-text/5 text-text/55"
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        on ? "text-match" : "text-text/35"
                      }`}
                      strokeWidth={1.75}
                    />
                    {k}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {recipe.description && (
          <p className="mt-8 whitespace-pre-wrap text-[13.5px] leading-[1.75] text-text/60">
            {recipe.description}
          </p>
        )}

        <div className="mt-10 grid grid-cols-2 gap-x-10 gap-y-2">
          <Col title="Produce" rows={produceRows} hit={hit} />
          <Col title="Pantry" rows={pantryRows} hit={() => false} />
        </div>
      </div>
    </div>
  );
}

// Text colour alone marks a seasonal match — no checkbox, which would imply
// availability, and no row fill, which competes with the chips above. An
// unfixed line (no name) shows its raw display text in italic alert colour.
function Col({ title, rows, hit }) {
  return (
    <div>
      <p className="mb-3 text-[9.5px] uppercase tracking-[0.18em] text-text/32">{title}</p>
      <div className="space-y-0.5">
        {rows.map(({ ingredient, index }) => (
          <div
            key={index}
            title={ingredient.name ? ingredient.display : undefined}
            className={`truncate px-3 py-1.5 text-[13px] capitalize ${
              ingredient.name ? "" : "italic"
            } ${
              hit(ingredient.name)
                ? "text-match-soft"
                : ingredient.name
                  ? "text-text/60"
                  : "text-alert-soft/75"
            }`}
          >
            {ingredient.name || ingredient.display}
          </div>
        ))}
        {rows.length === 0 && <p className="px-3 text-[12.5px] text-text/22">None.</p>}
      </div>
    </div>
  );
}
