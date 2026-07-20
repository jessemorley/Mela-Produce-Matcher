# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tauri desktop app that suggests recipes from a local Mela cookbook app
based on what produce is in season, per the Harris Farm "Dave's Market
Update" newsletter (a hardcoded Shopify Atom feed). It shells out to the
`claude` CLI (not the API) to do the produce extraction and recipe ranking,
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
   dir) from Mela's SQLite — no incremental diffing yet (see the
   `// ponytail:` comment on `save_recipes_cache` for the seam to extend if
   that ever needs to change).
2. `match_recipes` — takes the fruit/vegetable lists back from the frontend,
   reads the local `recipes.json` cache (not Mela directly — only the sync
   step touches Mela's SQLite), does a cheap local substring prefilter
   (`filter_recipes_by_produce`) before ever calling Claude, then asks
   Claude to rank the filtered candidates against the produce list.
3. `list_recipes` — returns the full local `recipes.json` as-is, for the
   frontend's "Saved Recipes" browse view (independent of any ranking).

The frontend holds `feedTitle`/`fruit`/`vegetable`/ranked-recipe state in
`App.jsx` — there is no server-side session.

Recipes are read directly from Mela's SQLite database
(`~/Library/Group Containers/66JC38RDUD.recipes.mela/Data/Curcuma.sqlite`),
opened `mode=ro` so it's safe to query while Mela itself has the file open
(including its WAL), but only during the `sync_on_launch` resync — everyday
ranking reads go through `recipes.json` instead. `open_recipe` opens a
matched recipe back in Mela via its `mela://recipe/{id}` URL scheme.

**Claude invocation** (`run_claude` / `run_claude_inner`) always shells out
to the `claude` CLI with `--output-format stream-json
--include-partial-messages`, streaming parsed text deltas back line-by-line
through a callback — used live for the ranking output (`suggestion-line`
events to the frontend) and silently (no-op callback) for the produce
extraction, which only needs the full answer at the end. The child's PID is
tracked in `RunningChild` (shared Tauri state) for the whole call so the
`cancel` command can `kill -9` it; a SIGKILL exit is distinguished from a
genuine CLI failure (`is_kill_signal`, unix-only) and surfaced to the
frontend as the sentinel error string `"cancelled"` rather than a real error.

**Frontend** (`src/App.jsx` + `src/components/`) listens for the same three
events — `status` (free-text progress), `produce` (`{fruit, vegetable, pick,
featured}`), and `suggestion-line` (each line of the ranked output, parsed
by `parseSuggestionLine` in `RecipeList.jsx` into rank/title/id/matches/fit).
Produce items are matched to icons by slugifying the name (`lowercase`,
spaces → underscores) and loading `/svg/<slug>.svg`; a missing icon just
fails silently (`onError` hides the tile) rather than showing a broken
image, since Claude's wording won't always exactly match the ~450 icon
filenames served from `public/svg/` (copied from the root-level `svg/`
asset source — edit icons there, not in `public/svg/`, and re-copy;
`public/` is Vite's static-asset convention, so anything there is served
byte-for-byte at the same path).

Three-pane layout (`Sidebar` / `RecipeList` / main canvas in `App.jsx`):
left nav (Harvest Matches / This Week's Produce / Saved Recipes) with live
counts, a middle list that switches view based on the selected nav item,
and a right detail pane (`RecipeDetail.jsx`) showing whichever recipe is
selected — merging ranking info (`matches`/`fit`, if the recipe came from a
`match_recipes` run) with the full record from `recipes.json`
(`description`/`ingredients`) by id. `ArticleView.jsx` is a sanitized
in-app reader for the full newsletter post (`sanitizeArticle` strips
scripts/styles/forms/dangerous attributes), toggled in place of the detail
pane; external links inside it route through `open_url` to the system
browser rather than navigating the webview.

Dark mode only — no light theme, no `prefers-color-scheme` toggle. SVG tiles
are near-black source art recolored white via CSS `filter: invert(1)`
(the `.produce-icon` class in `src/index.css`) on the `<img>` itself, not
its container, so the container's own background isn't inverted too.

The app window uses a native macOS overlay title bar (`titleBarStyle:
Overlay`, `hiddenTitle: true` in `tauri.conf.json`) — panes have their own
`data-tauri-drag-region` spacer strips to keep the draggable area under the
real traffic lights, there's no custom-drawn window chrome.
