# Handoff: LLM-produced ingredient names + produce/pantry rebuild

## Status: design complete, zero implementation. Start at Phase 1.

The whole design below was settled through two `/grill-me` passes and **two live
Haiku probes on real recipe data**. Every fork is resolved; the model and wire
format are proven. Nothing is left to decide — the next session builds.

Working tree is clean at commit `9960b7d`. The two untracked files (`svg/`,
`text-633FA7B3FA08-1.jsx`) are pre-existing, unrelated, not ours — leave them.

## Why this rebuild

`ingredient_name` (the Rust heuristic that reduces "3 pounds yukon gold potatoes,
partially peeled" → "potato") reduces messy lines badly. Failures leak into the
pantry list, the vocabulary, and matching. User's examples: `approx 1/2 cup
vegetable broth`, `cups/173 gram all purpose flour`, `cups/6 ounce walnut halve
and piece` — all left unreduced.

Decision: **stop refining the heuristic; delete it.** The LLM analysis pass (already
the "Sync Now" call) now produces a canonical `name` per ingredient. Because the
stored name is authoritative, **seasonal matching no longer calls the LLM at all** —
it reads the stored name.

## The resolved design (the contract)

**Data model.** `Recipe.ingredients` changes from `String` blob to
`Vec<Ingredient>`, each `Ingredient { display, name, pantry }`:
- `display` — raw Mela line, verbatim (e.g. `"1 medium onion ((diced))"`)
- `name` — LLM-produced canonical ingredient (`"onion"`); **empty string = unfixed**
- `pantry` — LLM-produced bool; `false` = produce
- `#` section headers and blank lines dropped at sync.

**Analysis call (Haiku).** One call per batch. Prompt numbers each ingredient line;
response is index-addressed to avoid echoing display text (proven ~61% output
saving):
```
id: <recipe id>
key: <2-4 defining ingredients, most-defining first>
<n> => <name> => <produce|pantry>     # one per ingredient line, in order, ALL of them
```
`key:` still drives `key_ingredients` ranking as today. The per-line `=>` output is new.

**Completeness check** = `set(returned indices) == set(0..n)`. A recipe that doesn't
come back complete is NOT marked done; its unread lines keep `name: ""`.

**Critical invariant:** the prompt numbers the stored `Vec<Ingredient>` directly, and
names write back into that same vector — one ordering by construction. Index `n` must
never be able to point at a different line than it was scored against. (This is why
the reverted `8ddd43b`'s approach of indexing re-split raw text was fragile.)

**Matching.** No LLM. `score_recipe`/`match_recipes` read `Ingredient.name`, skipping
empty ones, via the existing `produce_matches` (unchanged — keep the head-word rule
from `f1276d8`).

**Merge across resync.** `merge_recipes` carries `name`+`pantry` per-line by **exact
`display` match**, first-unused-wins on duplicate display lines. Edited lines (display
changed in Mela) fall back to unfixed (`name: ""`) and get re-analysed. This preserves
both LLM names and manual fixes across the every-launch resync.

**Fix Now (failure surfacing).** Batch runs to completion, THEN a banner
`"N ingredients not found · Fix Now"` (mirror the existing "N new recipes detected ·
Sync Now" banner pattern). Fix Now opens a queue over all empty-`name` ingredients;
user types the missing name; **one fix clears all byte-identical `display` lines in the
current queue** (dedupe obvious repeats). New Tauri command needed, e.g.
`set_ingredient_name`. Empty `name` = excluded from matching until fixed.

**Multi-ingredient lines** ("salt and pepper"): **one name per line, do NOT split.**
Data shows 46 such lines are all salt/pepper (pantry, inert for matching) and exactly
ONE joins two produce items ("Shredded cabbage and carrots"). Splitting would break the
index-completeness check and the 1:1 display→ingredient mapping for negligible gain.
The one produce+produce line is recoverable by hand via Fix Now if it ever matters.
`name` may therefore contain a comma (`"salt, pepper"`) — the parser must NOT split
`name` on commas; take everything between the two `=>` as the name.

**Model.** `CLAUDE_MODEL` const (currently `"sonnet"`, `src/lib.rs:12`) → `"haiku"`.
Both probes passed: 36/36 and clean names where the heuristic failed. If analysis ever
struggles, bump the const back — but split it first if only produce-extraction should
stay cheap.

## What gets DELETED (Phase 1 demolition)

- `ingredient_name` (Rust) and its JS twin `ingredientName` in `RecipeDetail.jsx`
- `build_pantry`, `list_pantry`, `set_pantry_item` commands + the pantry override menu
- `ingredient_vocabulary`, `build_pantry_prompt`, `unclassified_ingredients`
- `src/pantry_defaults.txt`, `DEFAULT_PANTRY`/`default_pantry`, `pantry.json` load/save
- `SyncResult.unclassified_count`
- Every reader of `.ingredients` as text switches to the struct (prompt builder does
  `r.ingredients.replace('\n', "; ")` today — must reconstruct from `display`).

Note: produce/pantry split in the detail pane currently comes ENTIRELY from the pantry
set being deleted. It is replaced by `Ingredient.pantry` from the analysis call.

## Build order (commit per phase)

1. ✅ **Data model + demolition** — `Ingredient` struct, `Vec<Ingredient>`, `load_recipes`
   splits into structs (name/pantry empty), delete the heuristic apparatus, fix all
   readers. Biggest diff.
2. ✅ **Analysis call** — rewrite `build_key_ingredient_prompt` (index format above) and
   the parser (count-validation, comma-safe name), `merge_recipes` per-line carry.
   Model landed on **sonnet, not haiku** — timed probes against real recipe data
   this session showed sonnet ~2x faster end-to-end (see below), and `--effort low`
   was added to cut time-to-first-token from ~20s to ~1-2s.
3. ✅ **Matching** — re-evaluated, not changed. This line predates the two-part
   prompt built in step 2. `score_recipe` still reads `key_ingredients` (the
   ranked 2-4 defining items), not `Ingredient.name` (every ingredient, unranked)
   — switching would drop the rank-weighted scoring that makes an asparagus stir
   fry outrank a beef pie with an asparagus garnish, the redesign's original
   point (`defining_ingredient_outranks_garnish` test). `key_ingredients` is the
   correct signal for scoring; `Ingredient.name` is for the produce/pantry
   columns and Fix Now, not ranking. No code change needed here.
4. **Frontend** — two columns from `ingredient.pantry`/`ingredient.display` ✅ done
   (plus capitalisation + hover tooltip showing the raw `display` line). **Fix Now
   banner + queue + `set_ingredient_name` command — not built yet.** Currently an
   unfixed ingredient (`name: ""`) just silently falls out of the produce/pantry
   split and any name-based UI; there's no way to see or correct it from the app.
5. **Confirm** — partially covered: this session ran real-data timing/quality
   probes (not the originally-planned "wider Haiku sample," since the model
   changed to sonnet), confirming output format correctness and completeness on
   10-recipe batches. A dedicated wider-sample confirmation pass hasn't run.

### Session notes (post-handoff)

Two problems surfaced only by testing against the real app, not visible from the
design alone:
- The `claude` CLI child process inherits this project's own working directory,
  so it picked up the user's globally-enabled `ponytail` plugin's `SessionStart`
  hook — injecting an unrelated system prompt that broke the model's adherence
  to the rigid `id:`/`key:`/`N => name => kind` output format entirely (`Error:
  claude returned no usable key ingredients`). Fixed with `--setting-sources ""`
  on the spawned process, which loads no settings sources (no plugins, no hooks,
  no project/user CLAUDE.md) — see `run_claude` in `lib.rs`.
- Status bar sat on one "Analysing N recipes..." message for the whole batched
  call. `analyze_new_recipes` now emits a `status` event per recipe as its `id:`
  line streams back (via `run_claude`'s existing `on_line` callback), giving
  real-time per-recipe progress without splitting into N separate calls.

## Consequences to accept (already agreed with user)

- **Invalidates the current `recipes.json` shape** (`ingredients` string → array) and
  all names. First launch after Phase 2 shows every recipe needing analysis, then a
  possibly-large Fix Now queue. Inherent, not a bug. `merge_recipes` rebuilds from Mela
  on resync so no manual migration needed.
- A recipe with any empty-`name` line can miss a match it deserves until fixed — the
  honest cost of "perfect name or nothing."

## Verification norms this codebase follows

- `cd src-tauri && cargo test` — unit tests live in `src/lib.rs` `#[cfg(test)]`. Pin
  new non-trivial logic (parser completeness, merge per-line carry, comma-in-name).
- `npm run build` (from repo root) — frontend must build.
- `cargo check` must be warning-clean (dead code from the demolition will warn — that's
  the signal you missed a deletion).
- **Do NOT** append scratch tests to `src/lib.rs` then `git checkout` it — that
  discarded uncommitted work once this session. Use a separate throwaway file for probes.
- The heuristic had a Rust/JS duplication that had to agree on all 1,917 real lines.
  That duplication is being DELETED — good riddance — but if any JS-side derivation
  survives, re-check parity against real data.

## Reference (don't duplicate — read these)

- `CLAUDE.md` — current architecture. **Will need updating after each phase**; the
  pantry/`ingredient_name`/matching sections all describe soon-to-be-deleted code.
- Recent commits tell the evolution: `73d045c` (per-recipe key analysis), `f1276d8`
  (head-word `produce_matches` — KEEP this), `8ddd43b` (per-recipe produce_lines —
  REVERTED, its index-against-re-split-text approach is the fragility to avoid),
  `2a39937`+`9960b7d` (pantry set — being DELETED).
- Real data lives at
  `~/Library/Application Support/com.jessmorley.recipesuggester/recipes.json`
  (166 recipes, ~2100 ingredient lines) — use it for probes and coverage checks, as
  this session did.

## Suggested skills

- **`ponytail`** (already active this session, level full) — the demolition is the
  point; resist re-adding abstraction. Delete more than you write.
- **`tdd`** — Phases 2 and 4 have the non-trivial logic (parser completeness, merge
  per-line carry, Fix Now dedup). Pin them with tests as you go.
- Re-run **`/grill-me`** only if a NEW fork appears mid-build; the current tree is fully
  resolved, so don't re-litigate settled decisions.
