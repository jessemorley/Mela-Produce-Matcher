# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tauri desktop app that suggests recipes from a local Mela cookbook app
based on what produce is in season, per the Harris Farm "Dave's Market
Update" newsletter (a hardcoded Shopify Atom feed). It shells out to the
`claude` CLI (not the API) to do the produce extraction and per-recipe
key-ingredient analysis (ranking itself is local, no LLM),
so it rides the user's Claude Code subscription rather than metering API
calls.

`suggest.py` at the repo root is the original standalone CLI prototype this
app grew out of. It duplicates the same read-Mela / fetch-feed / ask-Claude
flow in Python and still runs independently (`python3 suggest.py`,
`--dry-run` to preview without calling Claude) — useful for quick manual
checks, but the Tauri app in `src/` + `src-tauri/` is where active
development happens.

## Commands

Run from repo root unless noted:

- `npm run tauri dev` — start the app in dev mode (Vite dev server + hot-reloads `src/`)
- `npm run tauri build` — production build (runs `vite build` then bundles)
- `npm run dev` / `npm run build` — just the frontend, without launching Tauri
- `cd src-tauri && cargo check` — fast Rust typecheck without a full build
- `cd src-tauri && cargo build` — build the Rust backend alone
- `cd src-tauri && cargo test` — runs the small unit test module covering
  the produce/recipe cache JSON round-trip and cache-hit comparison logic

`src/` is a Vite + React app (JSX, Tailwind v4 via `@tailwindcss/vite`, no
`tailwind.config.js` needed since nothing's customized). `frontendDist`
points at `../dist` (Vite's build output) in `tauri.conf.json`; dev mode
proxies to Vite on `localhost:1420` via `devUrl`/`beforeDevCommand`. There is
still no linter or JS test suite.

## Architecture

**Backend** (`src-tauri/src/lib.rs`) exposes Tauri commands:

1. `sync_on_launch` — runs once on app start (invoked from `App.jsx`'s mount
   effect, not a button). Always does a cheap GET of the newsletter feed and
   compares the latest Atom entry's `<id>` against `produce_cache.json` (in
   Tauri's app data dir). On a match, reuses the cached fruit/vegetable/pick/
   featured lists and skips the expensive Claude produce-extraction call
   entirely; on a miss (or missing/corrupt cache), re-runs the extraction
   (`parse_produce_line`) and rewrites the cache. Independently of that,
   every launch also does a full resync of `recipes.json` (same app data
   dir) from Mela's SQLite, running the fresh rows through `merge_recipes`
   so already-analysed `key_ingredients` survive the overwrite — no
   incremental diffing yet (see the `// ponytail:` comment on
   `save_recipes_cache`). It returns `unanalyzed_count` (recipes with no
   `key_ingredients`), which drives the "N new recipes detected / Sync Now"
   banner. Launch never calls Claude for recipe analysis.
2. `analyze_new_recipes` — the "Sync Now" button. Sends every cached recipe
   with empty `key_ingredients` to Claude in a *single* batched call
   (`build_key_ingredient_prompt`), asking for the 2-4 ingredients that
   define each dish, ranked most-defining first — so asparagus in an
   asparagus-and-tofu stir fry outranks a spring onion garnish. Parses the
   `id: X — key: a, b, c` lines (`parse_key_ingredient_lines`, skipping
   unparseable ones rather than failing the batch) and writes the results
   back into `recipes.json`. This is the only place recipe analysis happens.
3. `match_recipes` — **no Claude call.** Scores cached recipes locally
   against the week's produce with `score_recipe`: a hit on the first key
   ingredient is worth 4, the second 3, and so on (floored at 1), so
   recipes *built around* in-season produce outrank ones that merely
   garnish with it. Recipes scoring 0 are dropped; ties break on title for
   a stable order. Instant and offline, so `App.jsx` just re-runs it in an
   effect whenever produce or the recipe list changes — there's no "Match
   Recipes" button. Produce names and key ingredients are compared by
   `produce_matches`, which splits both into plural-normalised words and
   compares them *from the front*: a trailing noun extends a name
   ("sugar snap" == "sugar snap peas", since the feed abbreviates where
   recipes don't) but a leading qualifier makes a different ingredient
   ("potato" != "sweet potato", "broccoli" != "broccolini"). Plain
   substring matching was the original rule and would rank a corned beef
   recipe as seasonal when corn is in season.
4. `list_recipes` — returns the full local `recipes.json` as-is, for the
   frontend's "Saved Recipes" browse view (independent of any ranking).

Only analysed recipes can ever match, since scoring reads `key_ingredients`
exclusively. A fresh install shows zero matches until "Sync Now" runs.

The frontend holds `feedTitle`/`fruit`/`vegetable`/ranked-recipe and
`unanalyzedCount` state in `App.jsx` — there is no server-side session.

Recipes are read directly from Mela's SQLite database
(`~/Library/Group Containers/66JC38RDUD.recipes.mela/Data/Curcuma.sqlite`),
opened `mode=ro` so it's safe to query while Mela itself has the file open
(including its WAL), but only during the `sync_on_launch` resync — analysis
and ranking both read `recipes.json` instead. `open_recipe` opens a
matched recipe back in Mela via its `mela://recipe/{id}` URL scheme.

**Claude invocation** (`run_claude` / `run_claude_inner`) always shells out
to the `claude` CLI with `--output-format stream-json
--include-partial-messages`, streaming parsed text deltas back line-by-line
through a callback — both remaining callers (produce extraction and
key-ingredient analysis) pass a no-op callback and just use the full answer
at the end, so nothing streams to the frontend any more. The child's PID is
tracked in `RunningChild` (shared Tauri state) for the whole call so the
`cancel` command can `kill -9` it; a SIGKILL exit is distinguished from a
genuine CLI failure (`is_kill_signal`, unix-only) and surfaced to the
frontend as the sentinel error string `"cancelled"` rather than a real error.

**Frontend** (`src/App.jsx` + `src/components/`) listens for two events —
`status` (free-text progress) and `produce` (`{fruit, vegetable, pick,
featured}`). Ranked recipes arrive as the return value of `match_recipes`,
not as events. Produce items render with a colored emoji tile keyed by type
(`TYPE_STYLE` in `RecipeList.jsx`, Fruit vs Vegetable) rather than per-item icons — Claude's
produce names come dynamically from the live newsletter, so a fixed
name→icon lookup would drift out of date; keying on type instead always
matches, at the cost of visual variety between individual items.

Three-pane layout (`Sidebar` / `RecipeList` / main canvas in `App.jsx`):
left nav (Harvest Matches / This Week's Produce / Saved Recipes) with live
counts, a middle list that switches view based on the selected nav item,
and a right detail pane (`RecipeDetail.jsx`) showing whichever recipe is
selected. `match_recipes` returns each ranked recipe flattened with its full
record plus `score`/`matches`, so the detail pane needs no merging — it
falls back to the Saved Recipes list only for recipes that never matched.
`RecipeDetail.jsx` shows the stored `key_ingredients` as a "Built around"
row, highlighting the ones in season. `ArticleView.jsx` is a sanitized
in-app reader for the full newsletter post (`sanitizeArticle` strips
scripts/styles/forms/dangerous attributes), toggled in place of the detail
pane; external links inside it route through `open_url` to the system
browser rather than navigating the webview.

Dark mode only — no light theme, no `prefers-color-scheme` toggle.

The app window uses a native macOS overlay title bar (`titleBarStyle:
Overlay`, `hiddenTitle: true` in `tauri.conf.json`) — panes have their own
`data-tauri-drag-region` spacer strips to keep the draggable area under the
real traffic lights, there's no custom-drawn window chrome.

Those strips only work because `capabilities/default.json` grants
`core:window:allow-start-dragging` explicitly — `core:default` does *not*
include it, and without it Tauri rejects every `start_dragging` call and the
window silently won't drag anywhere. That failure mode is invisible except as
an unhandled promise rejection in the webview console (right-click → Inspect),
so it reads like a CSS or layout bug from the outside. Same applies to any
other core command that quietly does nothing: check the console for a
permission rejection before digging into the frontend.
