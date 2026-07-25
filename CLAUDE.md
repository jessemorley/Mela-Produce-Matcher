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
5. `set_excluded(id, excluded)` — the "Exclude"/"Include" item on the
   right-click context menu of any recipe row (both list views; rare
   housekeeping, so it isn't a button beside "Open in Mela"). Sets
   `Recipe.excluded`, a user-marked "this recipe has no
   seasonal-produce story" flag (a vegan cheese sauce). An excluded recipe is
   skipped by `match_recipes`, by `analyze_new_recipes` (so excluding before
   the first analysis also saves the Claude call), and by both
   `unanalyzed_count` and `unfixed_ingredients`, so excluding clears it off
   the Sync Now / Fix Now banners. Mela has no such field, so `full_resync`
   and `resync_recipe` explicitly carry the flag over from the cache
   (`excluded_ids`) rather than letting a fresh read reset it.
6. `match_recipes` — **no Claude call.** Rates cached recipes locally with
   `rate_recipe` across **two layers**: the live market update (`fruit`+
   `vegetable`, "Dave's Picks") weighted `PICK_WEIGHT` (3), and a stable
   per-season produce table (`SEASONAL_PRODUCE`, filtered by
   `current_season()` off the system clock — AU seasons) weighted
   `SEASONAL_WEIGHT` (1). Each key ingredient scores its rank weight (first
   key ingredient worth 4, second 3, ... floored at 1) times the best layer
   it hits, and the result is normalised to a **0.0–1.0 `rating`** (score
   over the max possible, every key ingredient a top-weighted pick) — a
   match *rating*, not an ordinal rank, so it's comparable across recipes
   regardless of ingredient count and the UI shows a percentage. A market
   pick always beats a seasonal-only hit for the same ingredient (and isn't
   double-counted). Each ranked recipe carries `pick_matches` and
   `seasonal_matches` separately so the UI can tag them differently ("Dave's
   Pick" amber vs "In Season" green). Recipes rating 0 are dropped; ties
   break on title. Instant and offline, so `App.jsx` just re-runs it in an
   effect whenever produce or the recipe list changes — there's no "Match
   Recipes" button. `seasonal_in_season` is a separate cheap command (no
   recipes, calendar-only) returning the current season name plus its
   in-season table produce, for the "In Season" tab's second list. Produce
   names and key ingredients are compared by
   `produce_matches`, which splits both into plural-normalised words and
   compares them *from the front*: a trailing noun extends a name
   ("sugar snap" == "sugar snap peas", since the feed abbreviates where
   recipes don't) but a leading qualifier makes a different ingredient
   ("potato" != "sweet potato", "broccoli" != "broccolini"). Plain
   substring matching was the original rule and would rank a corned beef
   recipe as seasonal when corn is in season.
7. `list_recipes` — returns the full local `recipes.json` as-is, for the
   frontend's "All Recipes" browse view (independent of any ranking).

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
not as events. Exactly three ingredient icons exist (`icons.js`: apple =
fruit, sprout = vegetable, wheat = pantry), keyed on type and never on name —
Claude's produce names come dynamically from the live newsletter, so a fixed
name→icon lookup would drift out of date; keying on type always matches, at
the cost of visual variety between individual items.

Three-pane layout (`Sidebar` / `RecipeList` / main canvas in `App.jsx`):
left nav (Best Matches / In Season / All Recipes) with live counts, a middle
list that switches view based on the selected nav item, and a right detail
pane (`RecipeDetail.jsx`).

**One tagged `selection` drives the detail pane**, `{kind: "recipe"|"produce"
|"none"}`. Switching nav *browses*; only clicking a row selects, so the pane
holds whatever you last picked across tab changes. Selection is therefore
exclusive — picking produce clears the recipe highlight and vice versa,
because one pane shows one thing. (Previously a separate `activeRecipeId`
and produce selection both fed the pane, which chose between them by checking
`nav`, so each view silently overwrote what the other was showing.)

`match_recipes` returns each ranked recipe flattened with its full record
plus `rating`/`pick_matches`/`seasonal_matches`, so the detail pane needs no
merging — it falls back to the All Recipes list only for recipes that never
matched. That fallback is what lets excluding a recipe drop it out of Best
Matches immediately while the detail pane keeps showing it, rather than going
blank under the user.

The "In Season" tab renders both layers as tiles (Dave's Picks from the
market update, then the seasonal table for the current season), sorted by how
many of your recipes use each item and dimmed when none do. Selecting produce
fills the detail pane with its matching recipes as stacked full recipe cards
— the same `RecipeDetail` body, with `surfaceClass` making each card its own
pane. `App.jsx` re-derives those matches from the current ranked list rather
than trusting the tile's snapshot, so an exclusion can't leave a stale card
up.

`RecipeDetail.jsx` shows an optional full-bleed image banner (with a scrim —
Mela's photos are bright and shot on white, so without it the image ends in a
hard line against the near-black pane), the stored `key_ingredients` as a
"Built around" chip row, the recipe text, then the ingredients split into
Produce and Pantry columns by each ingredient's own `pantry` flag — no
JS-side reimplementation of any Rust logic, since the backend stores the
classification directly. Its header uses a **container** query, not a
viewport one: the same body renders as a narrow stacked card inside the In
Season pane while the window is wide, so a viewport breakpoint would miss it.
Rows show `ingredient.name` (capitalised via CSS, not string mutation) with
the raw `display` line as the tooltip. `ArticleView.jsx`
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

The queue's suggestion list is the point of that screen, not decoration:
naming an ingredient "walnut" when the collection already says "walnut
halves" silently splits one ingredient into two, so every canonical name
already in the collection is ranked by fuzzy closeness (`rankNames.js`, Dice
coefficient over bigrams) and seeded from the raw line before anything is
typed. Picking an existing name carries its produce/pantry flag across; a
genuinely new name is flagged. The queue is frozen when the modal opens —
saving rewrites `recipes`, and a live queue would renumber under the user
mid-fix.

## Frontend styling and tests

**Dark only — one palette, no light theme and no `prefers-color-scheme`
toggle.** The palette lives in `src/index.css` in an `@theme` block, so
`ground`/`pane`/`text`/`match`/`pick`/`alert` are real Tailwind colours
(`bg-pane`, `text-text/60`, `fill-pick`). Declare them there, **not** in
`:root` — an opacity modifier on a bare `var()` arbitrary value
(`text-[var(--text)]/60`) silently compiles to *nothing* in Tailwind v4:
`vite build` passes and the app renders unstyled. Note also that only
Tailwind's standard opacity steps work; an off-step value needs brackets
(`bg-text/[0.06]`, not `bg-text/6`). Neutrals are all alpha tints of `text`
rather than a separate grey ramp. `color-scheme: dark` is set so native
scrollbars and form controls match.

Two pieces of pure frontend logic have tests, run with plain `node` (no
runner, no framework, since the repo has no JS test setup):

- `node src/components/parseProgress.test.js` — `parseProgress` parses the
  status bar's progress line and is coupled to an exact `format!` string in
  `lib.rs` (`"Analysing {seen}/{total}: {title}"`). If that wording changes
  it returns null and the bar silently degrades to a spinner, so the test
  pins the shape (including that the *other* message, `"Analysing 5 new
  recipes..."`, must NOT parse).
- `node src/components/rankNames.test.js` — the Fix queue's fuzzy matching,
  whose threshold degrades silently if wrong.

**Responsive rules** (the `.shell` block in `App.jsx`): one pane gives up
width at a time, in priority order — detail first, then the list, then the
sidebar. The detail pane needs no rule of its own since it's `flex-1` and
absorbs surplus by default; it just has a `min-w-[300px]` floor. Two
`clamp()`s then take over in sequence, and `--rail` carries the sidebar's
contribution (width + gutter) so the list's clamp reads one expression in
both regimes.

| Width | Moving | Sidebar | List | Detail |
|---|---|---|---|---|
| ≥948 | detail | 240 | 368 | shrinking |
| 948→880 | list | 240 | 368→300 | 300 |
| 880→820 | sidebar | 240→180 | 300 | 300 |
| <820 | sidebar hidden | — | 368→300 | ≥300 |
| 630 | floor | — | 300 | 300 |

Below 820px the sidebar is hidden, so nav and the status bar re-home to a
compact strip at the top of the list pane (`NAV` in `nav.js` is shared by
both so they can't drift). **Categories are unreachable there** — a long list
with no room in a strip; an active filter can still be cleared via its chip
but not set. `minWidth` in `tauri.conf.json` is 630, exactly list-min +
detail-min + padding + gutter; below that CSS can't hold the floor.

The app window uses a native macOS overlay title bar (`titleBarStyle:
Overlay`, `hiddenTitle: true` in `tauri.conf.json`) — a single full-width
`data-tauri-drag-region` strip above the panes in `App.jsx` keeps the
draggable area under the real traffic lights, there's no custom-drawn window
chrome.

Those strips only work because `capabilities/default.json` grants
`core:window:allow-start-dragging` explicitly — `core:default` does *not*
include it, and without it Tauri rejects every `start_dragging` call and the
window silently won't drag anywhere. That failure mode is invisible except as
an unhandled promise rejection in the webview console (right-click → Inspect),
so it reads like a CSS or layout bug from the outside. Same applies to any
other core command that quietly does nothing: check the console for a
permission rejection before digging into the frontend.
