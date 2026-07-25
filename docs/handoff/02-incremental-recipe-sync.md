# Handoff: incremental recipe sync (stop full-rescanning Mela every launch)

## Status: plan approved, zero implementation. Start at plan Phase 1.

The plan is fully designed and user-approved; nothing left to decide except
where noted below. The next session builds it.

Working tree has **uncommitted changes** from the session before this one
(image-thumbnail work — see below). Do not discard them; this task builds on
top. The two untracked files (`svg/`, `text-633FA7B3FA08-1.jsx`) are
pre-existing, unrelated, not ours — leave them.

## Why this change

Two sessions ago, recipe list rows got cover-image thumbnails baked into
`recipes.json` (uncommitted, see `git diff src-tauri/src/lib.rs`). That
surfaced that `sync_on_launch` does a **full SQLite re-scan of every Mela
recipe on every app launch** — previously cheap (string copies), now real CPU
work (JPEG/PNG/WebP/TIFF decode + resize + re-encode per recipe, ~165
recipes). The user saw a 40s+ resync on relaunch and asked for an
architectural fix: **scan for new/removed recipes only, don't rebuild
everything**.

There's a pre-existing `ponytail:` comment on `save_recipes_cache` in
`src-tauri/src/lib.rs` (search for "full resync every launch") flagging
exactly this gap — it's now expensive enough to matter.

## The resolved design

Full plan detail lives in the plan file (still present at time of writing):
`/Users/jmorley/.claude/plans/adaptive-finding-lemur.md` — **read that file
first**, it has the concrete function signatures, file-by-file changes, and
verification steps. Summary of the key decisions (already made, don't
re-litigate):

- **Trust the cache** for any recipe ID already seen. Mela has no reliable
  last-edited timestamp column (`ZDATE` looks like date-added, not
  date-modified), so there's no free way to detect an in-place edit to an
  existing recipe. On launch, only fetch recipe IDs that are new since last
  time; drop IDs that disappeared from Mela. This is the core of the fix.
- **Per-recipe manual resync**: a "Resync from Mela" button in
  `RecipeDetail.jsx` (near the existing "Open in Mela" button) calls a new
  `resync_recipe(id)` command that re-reads just that one row and splices it
  into the cache. This is the escape hatch for "I edited this recipe in Mela
  and want the change to show up here."
- **Full resync escape hatch**: a small `RefreshCw` icon button in
  `Sidebar.jsx`'s header (next to the "Sprout" logo), calling a new
  `full_resync` command that does today's full-scan behavior on demand.
  `sync_on_launch` stops doing this by default.
- `merge_recipes` goes away entirely — it existed to reconcile a full fresh
  re-read against the cache; the new design never re-reads a recipe it
  already has, so there's nothing to reconcile. Its tests need to be ported
  to test the new diff logic instead (plan file has the suggested shape: a
  pure `diff_recipe_ids` function, unit-testable without a real SQLite
  connection, same pattern as today's `recipe()` test helper).

## What's already built (uncommitted, do not revert)

`git diff` on `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`,
`src/components/RecipeList.jsx` — the image-thumbnail feature:
- `Recipe` gained `image` (base64 JPEG data URI, thumbnailed to 128px) and
  `tags` (from Mela's `ZRECIPETAG`/`Z_4TAGS` join) fields.
- New `image` crate dependency (jpeg/png/webp/tiff decoders only, no
  defaults — HEIC isn't decodable by this crate so those ~3 recipes ship
  their original bytes unresized rather than losing the photo).
- Cover image resolution handles two Mela storage forms: small images
  inline in `ZRECIPEIMAGEOBJECT.ZDATA` with a 1-byte prefix, or (most
  photos, past Core Data's external-storage threshold) a
  `\x02<UUID>\x00`-shaped marker pointing to a file under
  `.Curcuma_SUPPORT/_EXTERNAL_DATA/<uuid>` alongside the Mela SQLite file.
  See `cover_image_data_uri`/`external_storage_uuid`/`sniff_image_data_uri`
  in `lib.rs`.
- `RecipeList.jsx`'s `SavedRecipeRow` now shows the thumbnail, tags as
  badges, and moved the favorite heart down next to the time/tags row
  (per direct user feedback mid-session).
- All 19 Rust tests pass (`cargo test` in `src-tauri/`); this was run and
  confirmed working against the real Mela DB before the perf issue came up.

This is the code the incremental-sync work will touch (`load_recipes` is the
function the plan splits into `recipe_ids` + `load_recipe`), so read it
before starting.

## Suggested skills

- None of this repo's listed skills map directly to "resume an approved
  plan" — just read the plan file and implement it directly, following
  `CLAUDE.md`'s existing conventions (ponytail-style comments for deliberate
  shortcuts, no new abstractions beyond what's specified).
- Run `/code-review` (or the equivalent skill in this environment) after
  implementing, before considering it done — this touches the core sync
  path and cache invalidation logic, worth a second look.
- Use the `run` skill (or `npm run tauri dev` directly, no project-specific
  run skill exists yet per this session's exploration) to verify against the
  real Mela database — the plan's verification section lists concrete
  manual steps (add/delete/edit a recipe in Mela, relaunch, check behavior).

## Notes for continuation

- `cargo test` and `cargo check` both passed as of the end of this session
  with the image-thumbnail changes in place — confirm they still pass after
  merge_recipes is removed.
- The plan flags one open risk to sanity-check during implementation: confirm
  nothing relied on `merge_recipes`'s full-rescan silently repairing a
  corrupted/stale cached row — the new design has no such repair path by
  design (that's what the manual resync buttons are for).
- Nothing has been committed yet in this session or the previous one. When
  ready to commit, the image-thumbnail work and the incremental-sync work
  are logically separate changes — consider two commits rather than one, but
  confirm with the user first (per repo convention, only commit when asked).
