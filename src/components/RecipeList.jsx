import { Search, Clock, Heart, Newspaper, Star, BookOpen, Sparkles } from "lucide-react";
import { NAV } from "./nav.js";
import { produceIcon, VEGETABLE } from "./icons.js";
import { FilterChip, ListEmpty } from "./ListStates.jsx";
import StatusBar from "./StatusBar.jsx";
import { imageSrc } from "../imageSrc.js";
import { recipesUsing } from "../recipesUsing.js";

// Header of every list view — same slot, same chrome, so switching nav never
// moves the pane's furniture.
// Sits inside the pane's top drag band and is lifted above the strip
// (`relative z-10`) so it renders on top — which means the strip below can't
// see the mousedown, so the header carries "deep" itself. Text and counts
// drag; any real button inside is still blocked by Tauri's clickable check.
function ListHeader({ title, count, total }) {
  return (
    <div
      className="relative z-10 flex items-baseline justify-between px-5 pb-4 pt-5"
      data-tauri-drag-region="deep"
    >
      <h2 className="text-[12.5px] font-medium text-text/70">{title}</h2>
      <span className="text-[10.5px] tabular-nums text-text/30">
        {total !== undefined && total !== count ? `${count} of ${total}` : count}
      </span>
    </div>
  );
}

function SearchField({ value, onChange }) {
  return (
    <div className="relative mx-3 mb-3">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text/30"
        strokeWidth={1.75}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search recipes"
        className="w-full rounded-xl border-none bg-ground py-2.5 pl-9 pr-3 text-[11.5px] text-text/80 outline-none placeholder:opacity-60"
      />
    </div>
  );
}

function MatchingView({
  rankedRecipes,
  activeRecipeId,
  onSelectRecipe,
  onContextMenu,
  selectedTag,
  onClearTag,
  unanalyzedCount,
  onSyncNow,
  unfixedCount,
  onFixNow,
}) {
  const shown = rankedRecipes.filter((r) => !selectedTag || r.tags?.includes(selectedTag));

  return (
    <>
      <ListHeader title="Best Matches" count={shown.length} total={rankedRecipes.length} />

      {/* Banners first: they're notifications about the collection and don't
          change with the view. The filter chip sits directly above the list
          it's filtering. */}
      {(unanalyzedCount > 0 || unfixedCount > 0) && (
        <div className="mx-3 mb-3 space-y-1.5">
          {unanalyzedCount > 0 && (
            <button
              onClick={onSyncNow}
              className="flex w-full items-center justify-between rounded-xl bg-pick/10 px-3.5 py-2 text-left transition-colors hover:brightness-125"
            >
              <span className="text-[11.5px] text-pick-soft">{unanalyzedCount} new</span>
              <span className="text-[11px] font-medium text-pick">Sync</span>
            </button>
          )}
          {unfixedCount > 0 && (
            <button
              onClick={onFixNow}
              className="flex w-full items-center justify-between rounded-xl bg-alert/12 px-3.5 py-2 text-left transition-colors hover:brightness-125"
            >
              <span className="text-[11.5px] text-alert-soft">{unfixedCount} not found</span>
              <span className="text-[11px] font-medium text-alert">Fix</span>
            </button>
          )}
        </div>
      )}

      {selectedTag && <FilterChip tag={selectedTag} onClear={onClearTag} />}

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {shown.map((rec) => {
          const on = activeRecipeId === rec.id;
          return (
            <button
              key={rec.id}
              onClick={() => onSelectRecipe(rec.id)}
              onContextMenu={onContextMenu(rec)}
              className={`mb-1 flex w-full items-start gap-3.5 rounded-xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.035] ${
                on ? "bg-text/7" : ""
              }`}
            >
              <span
                className={`w-7 shrink-0 pt-px text-right text-[14px] font-medium tabular-nums ${
                  rec.rating > 0.7
                    ? "text-match"
                    : rec.rating > 0.4
                      ? "text-match-dim"
                      : "text-text/28"
                }`}
              >
                {Math.round(rec.rating * 100)}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[12.5px] leading-snug ${
                    on ? "text-text/95" : "text-text/60"
                  }`}
                >
                  {rec.title}
                </span>
                <span className="mt-1.5 block truncate text-[10.5px] capitalize text-text/32">
                  {[...rec.pick_matches, ...rec.seasonal_matches]
                    .map((m) => m.ingredient)
                    .join(" · ")}
                </span>
              </span>
            </button>
          );
        })}

        {shown.length === 0 && (
          <ListEmpty
            icon={Sparkles}
            title={
              selectedTag ? "Nothing here" : unanalyzedCount > 0 ? "Nothing analysed yet" : "No matches"
            }
            body={
              selectedTag
                ? `No ${selectedTag.toLowerCase()} recipes match this week's produce.`
                : unanalyzedCount > 0
                  ? "Your recipes need analysing before they can be matched against what's in season."
                  : "Nothing in your collection matches this week's produce."
            }
            action={
              selectedTag
                ? { label: "Clear filter", onClick: onClearTag }
                : unanalyzedCount > 0
                  ? { label: "Sync now", onClick: onSyncNow }
                  : null
            }
          />
        )}
      </div>
    </>
  );
}

function splitProduce(produce, seasonal) {
  const market = [
    ...produce.fruit.map((name) => ({ name, type: "Fruit" })),
    ...produce.vegetable.map((name) => ({ name, type: "Vegetable" })),
  ];
  const marketNames = new Set(market.map((m) => m.name.toLowerCase()));
  const seasonalOnly = (seasonal.produce || []).filter((n) => !marketNames.has(n.toLowerCase()));
  return { market, seasonalOnly };
}

function hasName(list, name) {
  const n = name.trim().toLowerCase();
  return (list || []).some((p) => p.trim().toLowerCase() === n);
}

// Two layers: Dave's Picks come from the live market update; seasonal produce
// comes from the stable per-season table (see seasonal_in_season in lib.rs).
// Tiles are sorted by how many of your recipes use the item and dim when none
// do — the one fact the old flat list never showed.
function ProduceView({ produce, seasonal, rankedRecipes, selectedProduce, onSelectProduce, onOpenArticle }) {
  const { market, seasonalOnly } = splitProduce(produce, seasonal);

  // Same three-tier star as the ingredient list in RecipeDetail: gold for the
  // newsletter's pick of the week, filled for a featured item, outline for
  // the rest of the market update. Seasonal-table tiles get none — the
  // section heading already says which layer they're in.
  const decorate = (name, tone, type) => ({
    name,
    tone,
    type,
    // Case-insensitive: the feed capitalises inconsistently ("Brussel
    // sprout"), and an exact compare drops the star with no visible error.
    pickOfWeek: hasName(produce.pick, name),
    featured: hasName(produce.featured, name),
    uses: recipesUsing(rankedRecipes, name),
  });

  const byUse = (a, b) => b.uses.length - a.uses.length || a.name.localeCompare(b.name);
  const marketTiles = market.map((m) => decorate(m.name, "pick", m.type)).sort(byUse);
  const seasonTiles = seasonalOnly.map((n) => decorate(n, "seasonal")).sort(byUse);

  // Same idiom as the recipe rows: transparent at rest, filled only when
  // selected. "Nothing uses this" is carried by dimmed text and icon rather
  // than a third background shade.
  const Tile = ({ item }) => {
    const on = selectedProduce?.name === item.name;
    const Icon = produceIcon(item.type);
    const cookable = item.uses.length > 0;
    return (
      <button
        onClick={() => onSelectProduce(on ? null : item)}
        className={`flex w-full min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.035] ${
          on ? "bg-text/7" : ""
        }`}
      >
        {/* Both layers are green; the section heading says which is which, so
            colour is free to carry "is this cookable from your collection". */}
        <Icon
          className={`h-4 w-4 shrink-0 ${cookable ? "text-match" : "text-match-dim"}`}
          strokeWidth={1.75}
        />
        <span
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-[13px] capitalize ${
            on ? "text-text/95" : cookable ? "text-text/70" : "text-text/35"
          }`}
        >
          <span className="truncate">{item.name}</span>
          {/* Non-gold stars take the tile's own tone via currentColor, so a
              tile nothing uses dims its star along with everything else. */}
          {item.pickOfWeek ? (
            <Star
              className="h-3 w-3 shrink-0 fill-gold text-gold"
              aria-label="Pick of the week"
            />
          ) : item.featured ? (
            <Star
              className={`h-3 w-3 shrink-0 fill-current ${
                cookable ? "text-match" : "text-match-dim"
              }`}
              aria-label="Featured this week"
            />
          ) : item.tone === "pick" ? (
            <Star
              className={`h-3 w-3 shrink-0 ${cookable ? "text-match" : "text-match-dim"}`}
              strokeWidth={2}
              aria-label="In this week's market update"
            />
          ) : null}
        </span>
        {/* No placeholder when nothing uses it — the dimmed name and icon
            already carry that, and a column of dashes read as noise. */}
        {cookable && (
          <span className="shrink-0 text-[10.5px] tabular-nums text-text/40">
            {item.uses.length}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      <ListHeader title="In Season" count={market.length + seasonalOnly.length} />

      <div className="mx-3 mb-3">
        <button
          onClick={onOpenArticle}
          className="flex w-full items-center gap-2.5 rounded-xl bg-text/5 px-3.5 py-2.5 text-left hover:brightness-125"
        >
          <Newspaper className="h-3.5 w-3.5 shrink-0 text-text/40" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-text/55">
            Read the market update
          </span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {/* Both section headings share the tiles' green — the wording is what
            separates the layers now that neither column is red. */}
        <p className="px-2 pb-2 text-[9.5px] uppercase tracking-[0.18em] text-match">
          Dave's Picks
        </p>
        <div className="space-y-1">
          {marketTiles.map((item) => (
            <Tile key={item.name} item={item} />
          ))}
          {marketTiles.length === 0 && (
            <p className="px-3 py-1.5 text-[11.5px] text-text/30">Nothing this week.</p>
          )}
        </div>

        {seasonal.season && (
          <>
            <p className="px-2 pb-2 pt-6 text-[9.5px] uppercase tracking-[0.18em] text-match">
              Also in {seasonal.season.toLowerCase()}
            </p>
            <div className="space-y-1">
              {seasonTiles.map((item) => (
                <Tile key={item.name} item={item} />
              ))}
              {seasonTiles.length === 0 && (
                <p className="px-3 py-1.5 text-[11.5px] text-text/30">
                  Nothing more in season.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// Mirrors the backend's own buckets: excluded recipes are never analysed or
// matched, so they belong in neither synced nor unsynced — own section, still
// browsable and un-excludable.
function SavedRecipesView({
  recipes,
  activeRecipeId,
  onSelectRecipe,
  onContextMenu,
  searchQuery,
  onSearchChange,
  selectedTag,
  onClearTag,
}) {
  const filtered = recipes
    .filter((r) => r.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter((r) => !selectedTag || r.tags?.includes(selectedTag));
  const active = filtered.filter((r) => !r.excluded);
  const synced = active.filter((r) => r.key_ingredients?.length > 0);
  const unsynced = active.filter((r) => !(r.key_ingredients?.length > 0));
  const excluded = filtered.filter((r) => r.excluded);

  const Row = ({ rec, dim }) => {
    const on = activeRecipeId === rec.id;
    return (
      <button
        onClick={() => onSelectRecipe(rec.id)}
        onContextMenu={onContextMenu(rec)}
        className={`mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:brightness-125 ${
          on ? "bg-text/7" : ""
        } ${dim ? "opacity-50" : ""}`}
      >
        {/* Not every recipe has a photo, so the slot keeps its footprint and
            falls back to the produce mark rather than collapsing. The image is
            a full-resolution original the webview downscales to this 56px
            slot — see imageSrc.js for why it can't be used as a bare path. */}
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-text/5">
          {rec.image ? (
            <img src={imageSrc(rec.image)} alt="" className="h-full w-full object-cover" />
          ) : (
            <VEGETABLE className="h-[18px] w-[18px] text-text/22" strokeWidth={1.75} />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={`min-w-0 flex-1 text-[13px] leading-snug ${
                on ? "text-text/95" : "text-text/65"
              }`}
            >
              {rec.title}
            </span>
            {rec.favorite && (
              <Heart className="h-3 w-3 shrink-0 fill-pick text-pick" />
            )}
          </span>
          {(rec.total_time || rec.tags?.length > 0) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-text/32">
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
        <p className="px-3 pb-2 pt-5 text-[9.5px] uppercase tracking-[0.18em] text-text/32">
          {title} · {rows.length}
        </p>
        {rows.map((rec) => (
          <Row key={rec.id} rec={rec} dim={dim} />
        ))}
      </>
    );

  return (
    <>
      <ListHeader title="All Recipes" count={filtered.length} total={recipes.length} />
      <SearchField value={searchQuery} onChange={onSearchChange} />
      {selectedTag && <FilterChip tag={selectedTag} onClear={onClearTag} />}

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <Section title="Synced" rows={synced} />
        <Section title="Unsynced" rows={unsynced} />
        <Section title="Excluded" rows={excluded} dim />
        {filtered.length === 0 && (
          <ListEmpty
            icon={recipes.length === 0 ? BookOpen : Search}
            title={recipes.length === 0 ? "No recipes yet" : "Nothing found"}
            body={
              recipes.length === 0
                ? "Recipes sync from Mela when the app starts."
                : selectedTag && searchQuery
                  ? `No ${selectedTag.toLowerCase()} recipes match that search.`
                  : selectedTag
                    ? `Nothing in ${selectedTag.toLowerCase()} yet.`
                    : "No recipes match that search."
            }
            action={selectedTag ? { label: "Clear filter", onClick: onClearTag } : null}
          />
        )}
      </div>
    </>
  );
}

export default function RecipeList({
  selectedNav,
  onSelectNav,
  counts,
  searchQuery,
  onSearchChange,
  selectedTag,
  onClearTag,
  produce,
  seasonal,
  rankedRecipes,
  allRecipes,
  activeRecipeId,
  onSelectRecipe,
  selectedProduce,
  onSelectProduce,
  onContextMenu,
  unanalyzedCount,
  onSyncNow,
  unfixedCount,
  onFixNow,
  onOpenArticle,
  status,
  busy,
  onCancel,
}) {
  return (
    // Fluid, not stepped: the list gives up width continuously as the window
    // narrows, so the detail pane holds at 300px the whole way down instead of
    // the two trading a jump at each breakpoint. The middle term is what's
    // left once the sidebar, gutters and a 300px detail pane are accounted for.
    <section
      className="relative flex shrink-0 flex-col overflow-hidden rounded-2xl bg-pane"
      style={{ width: "clamp(300px, calc(100vw - var(--rail) - 340px), 23rem)" }}
    >
      {/* This pane is opaque, so the window-wide drag band in App.jsx (which
          sits behind the panes) can't show through it — it carries its own.
          Absolute so it overlays the pane's top without taking layout space:
          the list header keeps its own padding, and this just makes the space
          around it draggable.

          It stays at the default level rather than -z-10, which this pane's
          own bg-pane would paint over; the views below lift themselves above
          it with `relative z-10` so their headers and rows stay clickable. */}
      <div className="absolute inset-x-0 top-0 h-[50px]" data-tauri-drag-region="deep" />

      {/* Below 820px the sidebar is gone, so nav and status have to live
          somewhere: a compact strip at the top of this pane. Categories are
          unreachable here — no room for a long list — but an active filter can
          still be cleared via its chip. */}
      <div className="relative z-10 min-[820px]:hidden">
        {/* Clearance for the traffic lights, which this pane sits under once
            the sidebar is hidden. Same 52px as the sidebar's spacer — they
            sit at y 37..51 (trafficLightPosition in tauri.conf.json), so
            anything shorter puts the nav strip underneath them. */}
        <div className="h-[52px] shrink-0" />
        <div className="flex gap-1 px-2.5 pt-1">
          {NAV.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onSelectNav(key)}
              title={label}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] transition-colors hover:bg-white/[0.035] ${
                selectedNav === key ? "bg-text/7 text-text/90" : "text-text/40"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="tabular-nums">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedNav === "produce" ? (
        <ProduceView
          produce={produce}
          seasonal={seasonal}
          rankedRecipes={rankedRecipes}
          selectedProduce={selectedProduce}
          onSelectProduce={onSelectProduce}
          onOpenArticle={onOpenArticle}
        />
      ) : selectedNav === "recipes" ? (
        <SavedRecipesView
          recipes={allRecipes}
          activeRecipeId={activeRecipeId}
          onSelectRecipe={onSelectRecipe}
          onContextMenu={onContextMenu}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          selectedTag={selectedTag}
          onClearTag={onClearTag}
        />
      ) : (
        <MatchingView
          rankedRecipes={rankedRecipes}
          activeRecipeId={activeRecipeId}
          onSelectRecipe={onSelectRecipe}
          onContextMenu={onContextMenu}
          selectedTag={selectedTag}
          onClearTag={onClearTag}
          unanalyzedCount={unanalyzedCount}
          onSyncNow={onSyncNow}
          unfixedCount={unfixedCount}
          onFixNow={onFixNow}
        />
      )}

      <div className="mt-auto shrink-0 min-[820px]:hidden">
        <StatusBar status={status} busy={busy} onCancel={onCancel} />
      </div>
    </section>
  );
}
