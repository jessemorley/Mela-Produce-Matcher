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

The app window is a native macOS WKWebView (Tauri), not a browser tab, so
there's no CDP/Playwright target to attach a driver to — Claude should not
attempt to screenshot or drive the running app to verify UI changes. `npx
vite build` (or `cargo check` for Rust) is the available correctness check;
the user verifies UI/UX changes visually themselves in the running
`npm run tauri dev` window.

## Architecture

**Backend** (`src-tauri/src/lib.rs`) exposes Tauri commands:

1. `sync_on_launch` — runs once on app start (invoked from `App.jsx`'s mount
   effect, not a button). Always does a cheap GET of the newsletter feed and
   compares the latest Atom entry's `<id>` against `produce_cache.json` (in
   Tauri's app data dir). On a match, reuses the cached fruit/vegetable/pick/
   featured lists and skips the expensive Claude produce-extraction call
   entirely; on a miss (or missing/corrupt cache), re-runs the extraction
   (`parse_produce_line`) and rewrites the cache. Independently of that,
   every launch also syncs `recipes.json` (same app data dir) against Mela's
   SQLite — but incrementally, not a full rescan: `recipe_ids` runs one cheap
   query for every `(Z_PK, ZID)` in Mela, `diff_recipe_ids` compares that
   against the cached recipe IDs, and only genuinely new IDs get a real
   per-row read (`load_recipe`, image thumbnail included) while IDs already
   in the cache are reused untouched — an in-Mela edit to an existing recipe
   is *not* picked up this way (see `resync_recipe`/`full_resync` below).
   `merge_recipes` (which used to reconcile a full fresh SQLite re-read
   against the cache every launch) is gone; there's nothing left to
   reconcile once already-cached recipes are never re-read. It returns
   `unanalyzed_count` (recipes with no `key_ingredients`), which drives the
   "N new recipes detected / Sync Now" banner. Launch never calls Claude for
   recipe analysis.
2. `resync_recipe(id)` / `full_resync` — the escape hatches for an edit made
   directly in Mela, which `sync_on_launch`'s cache-trusting diff can't see.
   `resync_recipe` re-reads one recipe by ID and splices it into the cache;
   it's a working Tauri command but currently has no frontend caller (the
   per-recipe "Resync from Mela" button in `RecipeDetail.jsx` was removed —
   `full_resync` is the only resync path exposed in the UI now, via the
   `RefreshCw` icon button in `Sidebar.jsx`'s header, re-reading every
   recipe unconditionally, i.e. today's pre-incremental-sync behavior on
   demand). Both share `sync_produce` with `sync_on_launch`
   for the produce-cache half so the three commands can't diverge on that
   part — only the recipe-loading strategy differs.
3. `analyze_new_recipes` — the "Sync Now" button. Sends every cached recipe
   with empty `key_ingredients` to Claude in a *single* batched call
   (`build_key_ingredient_prompt`), numbering each recipe's ingredient lines
   and asking for two things per recipe: the 2-4 defining ingredients
   ranked most-defining first (`key:` line, drives ranking exactly as
   before), and, for *every* numbered line, a canonical singular `name` plus
   `produce`/`pantry` (`N => name => produce|pantry` lines). A multi-item
   line ("salt and pepper") gets one combined name rather than being split,
   so the index mapping stays 1:1 with the stored `Vec<Ingredient>`.
   `parse_key_ingredient_lines` parses both parts; a recipe is only marked
   analysed if *every* ingredient index came back (checked by set equality
   against `0..len`) — a partial response leaves the unread lines' `name`
   empty (unfixed) rather than silently under-analysing the recipe. This is
   the only place recipe analysis happens, and it's also where per-line
   `name`/`pantry` get set — there is no separate pantry-classification call
   any more. As each recipe's `id:` line streams back mid-call, a `status`
   event fires with that recipe's title, so the status bar shows real-time
   per-recipe progress ("Analysing 3/10: Asparagus Stir Fry") through the
   single batched call rather than sitting on one message for the whole run.
4. `set_ingredient_name` — the "Fix Now" queue's save action. A recipe whose
   analysis came back incomplete leaves some lines with `name: ""`
   (unfixed); this command sets a hand-typed `name`/`pantry` on **every**
   ingredient across the whole collection whose `display` is byte-identical
   to the one being fixed, since Mela repeats common lines ("1 tsp salt")
   verbatim across many recipes — fixing it once shouldn't mean re-typing
   the same correction for every recipe that has it.
5. `match_recipes` — **no Claude call.** Scores cached recipes locally
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
6. `list_recipes` — returns the full local `recipes.json` as-is, for the
   frontend's "Saved Recipes" browse view (independent of any ranking).

Only analysed recipes can ever match, since scoring reads `key_ingredients`
exclusively. A fresh install shows zero matches until "Sync Now" runs.

Each recipe's `ingredients` is a `Vec<Ingredient>` (`{ display, name,
pantry }`), not a text blob. `display` is the raw Mela line verbatim;
`name`/`pantry` are empty/false until Claude fills them in via
`analyze_new_recipes`, and `name: ""` means "not analysed yet" — such lines
are excluded from anything that reads `name`. `parse_ingredient_lines`
builds the vector at Mela-sync time, dropping `# SECTION` headers and blank
lines so no downstream reader has to. There used to be a Rust heuristic
(`ingredient_name`) that reduced a raw line to a canonical name by stripping
quantities/units/prep words, plus a shipped pantry-staple list
(`pantry_defaults.txt`) it was checked against — both are gone. The
heuristic mis-parsed enough real recipe lines (`"cups/173 gram all purpose
flour"`, `"cups/6 ounce walnut halve and piece"`) that the fix was to stop
guessing and let the same Claude call that already ranks key ingredients
produce the canonical name and pantry/produce flag directly, per line.

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
through a callback. `analyze_new_recipes` is the one caller that uses this
for something beyond the final answer — see above — produce extraction
still passes a no-op callback. Two flags matter beyond the streaming
plumbing:
- `--effort low`. Default effort was observed (via `ttft_ms` on this app's
  real batch prompts) spending up to ~20s composing a response before its
  first token, on a task that's pure extraction/classification, not
  reasoning — `low` cuts that to ~1-2s with no quality drop seen on this
  prompt shape.
- `--setting-sources ""`. The spawned process inherits this app's own
  working directory, which sits inside a Claude Code project — without
  this flag the CLI loads `~/.claude`'s user-level settings, including
  whatever plugins happen to be globally enabled, and a `SessionStart` hook
  from one was observed injecting an unrelated system prompt that broke
  the model's adherence to the rigid `id:`/`key:`/`N => name => kind`
  output format entirely. Loading no settings sources keeps every call a
  clean, isolated completion regardless of what's configured for
  interactive use on the machine running the app.

The child's PID is tracked in `RunningChild` (shared Tauri state) for the
whole call so the `cancel` command can `kill -9` it; a SIGKILL exit is
distinguished from a genuine CLI failure (`is_kill_signal`, unix-only) and
surfaced to the frontend as the sentinel error string `"cancelled"` rather
than a real error.

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
row, then the recipe text, then the ingredients below it split into Produce
and Pantry columns by each ingredient's own `pantry` flag — no JS-side
reimplementation of any Rust logic, since the backend now stores the
classification directly. Each row shows `ingredient.name` (capitalised via
CSS, not string mutation) with the raw `display` line as a hover tooltip;
Tauri's WKWebView doesn't reliably render the native `title` attribute, so
the tooltip is a CSS-only `group`-hover element instead. `ArticleView.jsx`
is a sanitized in-app reader for the full newsletter post (`sanitizeArticle`
strips scripts/styles/forms/dangerous attributes), toggled in place of the
detail pane; external links inside it route through `open_url` to the
system browser rather than navigating the webview.

`FixNowQueue.jsx` is a modal queue over every unfixed ingredient
(`name: ""`) belonging to an *analysed* recipe (an unanalysed recipe's
lines are covered by the Sync Now banner instead, not this one) —
`unfixedDisplays` in that file dedupes by `display` before building the
queue, matching `set_ingredient_name`'s byte-identical-clears-all backend
behaviour, so the user never has to type the same correction twice for a
line Mela repeats verbatim across recipes ("1 tsp salt"). `App.jsx` mirrors
the backend's `unfixed_ingredients` count in JS (`countUnfixed`) so the
banner updates immediately after a fix without waiting on a full resync.

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
