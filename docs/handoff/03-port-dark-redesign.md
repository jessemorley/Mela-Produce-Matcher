# Handoff: port the dark redesign prototype into the real app

## Status: prototype design-complete and committed. Zero production code changed.

Five commits on `redesign/react-vite-launch-sync`, nothing pushed:

```
882715c  Make the shell responsive down to a 630px floor
e89790f  Add progress, category filtering, and empty states
b373b18  Design the remaining views and wire real Mela thumbnails
106f688  Replace the default accent palette with a hand-picked one
7c68f95  Add throwaway dark-redesign prototype for the three-pane shell
```

Everything lives in `src/prototype/` plus `prototype.html`. The only change
outside it is `minWidth: 640 → 630` in `src-tauri/tauri.conf.json` (in
`882715c`). **`src/App.jsx` and `src/components/` are untouched.**

Read `src/prototype/NOTES.md` first — it records the design verdicts, the
reasoning behind each structural decision, the responsive table, and two
findings from the real Mela database. This document covers only what that file
doesn't: how to get the design into production.

Working tree has three untracked files that are **not ours** and predate this
work — `docs/handoff/02-incremental-recipe-sync.md`, `svg/`,
`text-633FA7B3FA08-1.jsx`. Leave them alone.

## Run the prototype

```
npm run dev   →   http://localhost:1420/prototype.html
```

Open it in a **browser, not the Tauri window** — it's stub data with no Tauri
bridge, and `prototype.html` is absent from `dist/` because Vite only bundles
`index.html`. Keep it running beside the real app while porting; it's the
reference.

## What the prototype is and isn't

It is a **visual and behavioural spec**. It has zero `invoke` calls and zero
event listeners. Nothing is portable as-is — this is a re-style of the real
components against a reference that renders next to them, not a file swap.

Real app surface that the prototype has no equivalent for:

- 11 Tauri commands: `sync_on_launch`, `list_recipes`, `match_recipes`,
  `analyze_new_recipes`, `set_ingredient_name`, `set_excluded`,
  `resync_recipe`/`full_resync`, `open_recipe`, `open_url`,
  `seasonal_in_season`, `cancel`
- 2 events: `status`, `produce`
- The `full_resync` button (`RefreshCw` in the real `Sidebar.jsx` header)

## Component mapping

| Prototype | Real | Notes |
|---|---|---|
| `VariantA2.jsx` | `App.jsx` + `Sidebar.jsx` | shell, nav, panes, responsive rules |
| `RecipeDetailBody.jsx` | `RecipeDetail.jsx` | closest 1:1 of anything |
| `produceLayouts.jsx` | `ProduceView` in `RecipeList.jsx` | tiles + produce detail |
| `remainingViews.jsx` → `AllRecipesList` | `SavedRecipesView` in `RecipeList.jsx` | |
| `remainingViews.jsx` → `FixView` | `FixNowQueue.jsx` | see warning below |
| `remainingViews.jsx` → `ArticleView` | `ArticleView.jsx` | see warning below |
| `StatusBar.jsx` | inline footer in `App.jsx` | |
| `ListStates.jsx`, `ContextMenu.jsx`, `icons.js`, `palettes.js` | new files | |

## Suggested order

1. **Palette → `src/index.css` as CSS custom properties**, and flip
   `color-scheme: light` → `dark`. Without the flip, native scrollbars and form
   controls stay light against the dark ground. In the prototype colour is
   inline `style` only because it was runtime-switchable data during the
   comparison; with one palette it should be real classes or custom properties.
2. **`App.jsx` selection model.** The one structural change, and everything
   else sits on it — see below.
3. **Sidebar → RecipeList → RecipeDetail**, one at a time against the running
   prototype.
4. **The rest**: status bar, context menu, Fix view, ArticleView, empty states.
5. **Delete `src/prototype/` and `prototype.html`.** Fix the "Dark mode only"
   line in `CLAUDE.md`, which currently describes an intent the light-themed
   components never matched, and update its architecture notes for the changes
   below.

## The one structural change

Today `App.jsx` holds `activeRecipeId` and derives `activeRecipe`. The
prototype replaces this with a single tagged selection:

```js
const [selection, setSelection] = useState({ kind: "recipe", id });
// kind: "recipe" | "produce" | "none"
```

Nav browses; only clicking a row selects. So switching tabs leaves the detail
pane showing whatever you last picked. The old code had `activeRecipeId` and a
separate produce selection, and the pane chose between them by checking `nav` —
which meant each view silently overwrote what the other was showing.

Consequence: selection is **exclusive**. Picking produce clears the recipe
highlight and vice versa, because one pane shows one thing.

## Warnings — things that will break if ported carelessly

- **`sanitizeArticle` in the real `ArticleView.jsx` is a security boundary,
  not styling.** The prototype uses `dangerouslySetInnerHTML` on already-clean
  fixture HTML. Keep the real sanitiser; port only the visual treatment.
- **`ZRECIPEIMAGEOBJECT.ZDATA` has a 1-byte prefix before the JPEG magic**
  (`01 ff d8 ff`). Must be stripped. The app renders images today, so
  `lib.rs` presumably handles it — verify before touching that path.
- **150 of 215 image rows in the real DB are not images** — they're 38-byte
  UUID references to external files. Only 65 recipes have inline data, so the
  no-image fallback is a common path, not an edge case.
- **The recipe header uses a container query, not a viewport one.** The same
  body renders as a stacked card inside the In Season pane, where it can be
  narrow while the window is wide. A viewport breakpoint misses that.
- **Categories are unreachable below 820px** — the sidebar is hidden and the
  compact strip has no room for a long list. An active filter can be cleared
  via its chip but not set. Accepted for now; a dropdown would fix it.
- **`rankNames` in `remainingViews.jsx` is real logic** (fuzzy ingredient-name
  matching, Dice coefficient over bigrams) with a threshold that silently
  degrades if wrong. It was verified against fixtures by hand. If it ports, it
  wants a test.
- **`parseProgress` in `StatusBar.jsx` depends on the exact `format!` string**
  in `lib.rs` (`"Analysing {seen}/{total}: {title}"`). If that wording ever
  changes, the progress bar silently falls back to the spinner.

## Open decision, not yet made

Excluding a recipe from **Best Matches** should probably drop it out of the
ranked list immediately, since excluded recipes can never match — but that
means the recipe you're currently reading can vanish from the list under you,
and the selection has to go somewhere. The prototype only re-sections All
Recipes (its ranked list is fixture data and doesn't recompute). Needs a call
during the port.

## Verification available

- `npx vite build` — the only real check for the frontend
- `cd src-tauri && cargo check` — Rust typecheck
- **`vite build` passing does not mean it renders.** It compiled cleanly with
  a `ReferenceError` in a component body during this session. Load the page.
- Per `CLAUDE.md`, the Tauri window is a native WKWebView with no CDP target —
  there's no way to drive or screenshot the running app. The user verifies
  UI changes visually themselves.

## Suggested skills

- **`/prototype`** — if any further design questions come up mid-port, the
  same skill produced this prototype; don't improvise new UI inline.
- **`/tdd`** — for `rankNames` and `parseProgress`, the two pieces of real
  logic that would move into production with no test coverage.
- **`/simplify`** — after the port lands, to catch the inline-style-to-class
  conversion leaving debris, and any prototype scaffolding that survived.
- **`/code-review`** — before merging; this touches every frontend file.
