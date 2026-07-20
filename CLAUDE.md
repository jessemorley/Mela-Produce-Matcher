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

- `npm run tauri dev` — start the app in dev mode (hot-reloads `src/`)
- `npm run tauri build` — production build
- `cd src-tauri && cargo check` — fast Rust typecheck without a full build
- `cd src-tauri && cargo build` — build the Rust backend alone

There is no JS build step, linter, or test suite — `src/` is plain
HTML/CSS/JS loaded directly by Tauri's webview (`frontendDist` points at
`../src` in `tauri.conf.json`), no bundler involved.

## Architecture

**Backend** (`src-tauri/src/lib.rs`) exposes two Tauri commands that make up
a two-stage pipeline, deliberately kept as separate round-trips rather than
one combined command:

1. `fetch_produce` — fetches the newsletter's latest Atom entry, strips HTML,
   asks Claude to extract in-season produce as two labeled lines (`Fruit:` /
   `Vegetable:`, parsed by `parse_produce_line`), and returns them along with
   the feed title.
2. `match_recipes` — takes the fruit/vegetable lists back from the frontend,
   loads the full Mela recipe collection, does a cheap local substring
   prefilter (`filter_recipes_by_produce`) before ever calling Claude, then
   asks Claude to rank the filtered candidates against the produce list.

The frontend holds `feedTitle`/`fruit`/`vegetable` state between the two
calls — there is no server-side session.

Recipes are read directly from Mela's SQLite database
(`~/Library/Group Containers/66JC38RDUD.recipes.mela/Data/Curcuma.sqlite`),
opened `mode=ro` so it's safe to query while Mela itself has the file open
(including its WAL). `open_recipe` opens a matched recipe back in Mela via
its `mela://recipe/{id}` URL scheme.

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

**Frontend** (`src/main.js`) listens for three events emitted during the
pipeline — `status` (free-text progress), `produce` (`{fruit, vegetable}`
arrays, rendered as icon tiles + chips), and `suggestion-line` (each line of
the ranked output, parsed by `LINE_RE` into title/id/reason and rendered as a
clickable link back into Mela). Produce items are matched to icons by
slugifying the name (`lowercase`, spaces → underscores) and loading
`svg/<slug>.svg`; a missing icon just fails silently (`onerror` removes the
tile) rather than showing a broken image, since Claude's wording won't
always exactly match the ~450 icon filenames under `src/svg/` (copied from
the root-level `svg/` asset source — edit icons there, not in `src/svg/`,
and re-copy).

Dark mode only — no light theme, no `prefers-color-scheme` toggle. SVG tiles
are near-black source art recolored white via CSS `filter: invert(1)` on the
`<img>` (kept off the tile's own container so the container's background
isn't inverted too).
