# Prototype — dark redesign of the three-pane shell

**Question:** What should Sprout look like in dark mode, and is the three-pane
shell (sidebar / list / detail) the right structure at all?

Run: `npm run dev` → http://localhost:1420/prototype.html

Open it in a **browser**, not the Tauri window — stub data only
(`fixtures.js`), no Tauri bridge, no Mela, no Claude. Fixtures deliberately
include the awkward cases: a 96% hero, a 19% weak match, an unanalysed recipe,
an excluded recipe, two unfixed ingredient lines (`name: ""`), and a title long
enough to wrap in the list column.

## Verdict — A2 "Ledger, inset", newsprint palette

Round 1 tried three shells (A Ledger / B Market Board / C Tonight); A won on
structure, C on spaciousness. Round 2 tried three visual takes on A's bones
(A1 breathing / A2 inset / A3 editorial) — **A2 won**. Round 3 tried three In
Season layouts; **tiles** won. Round 4 tried three palettes; **newsprint**
won. Losing variants are deleted, not kept around.

A2: sidebar sits directly on the window ground, list and detail sit as flat
rounded fills with a 10px gutter — no rings, no drop shadows.

**Palette** (`palettes.js`): warm near-black ground `#131211`, panes `#1B1A18`,
bone text `#EDE9E3`. Two accents — chicory-pistachio `#9FC08A` for seasonal
match, red pencil `#C4453A` for Dave's Picks — plus a separate oxblood
`#9E5A4E` for errors so an alert can't be misread as a pick. Tailwind's
`emerald`/`amber` defaults are gone, and so is the blue-leaning `neutral-*`
grey: every neutral is now a tint of the palette's warm bone, which was doing
as much of the generic feel as the accents were.

### Decisions worth keeping

- **The panes never change job or count between nav items.** Slot 2 is always
  the browse list, slot 3 always the detail. In Season fills those slots with
  produce / its recipes rather than growing a fourth pane; an earlier version
  hid the middle pane and grew a right one, which broke the implied contract.
- **One `selection` drives the right pane**, tagged `{kind: "recipe"|"produce"}`.
  Switching nav browses, it doesn't select — so the pane holds what you last
  picked. Two independent states meant each view silently overwrote the other.
- **In Season tiles are sorted by how many of your recipes use the item**, and
  dim when none do. That fact is the useful one and the old flat list never
  showed it.
- **A produce selection renders its matching recipes as full recipe cards** —
  the same `Detail` body as the detail pane, stacked. A lone card grows to fill
  the slot (flex, not `min-h-full`: a percentage minimum needs a definite
  parent height).
- **Produce icons key on type** (Fruit/Vegetable/seasonal), never on name — the
  same reason `TYPE_STYLE` does in the real `RecipeList`: feed names come from
  Claude reading a live newsletter and drift.
- **No coloured status dots.** Icons and text colour carry state instead.

## Known gaps (deliberate)

- No thumbnails — real `rec.image` is a base64 data URI from Mela; fixtures set
  `image: null`.
- Only Best Matches and In Season render. Search, All Recipes, the Article
  view, and the Fix Now queue aren't built; nav is wired but inert.
- No `full_resync` / `set_excluded` / `open_recipe` wiring — buttons are inert.
- Fixture coverage: only "leek" has 2 matching recipes; everything else has 1,
  so the stacked-card case has one entry point.

## Next

Fold A2 into `src/components/`, delete `src/prototype/` and `prototype.html`,
and fix the "Dark mode only" line in CLAUDE.md — it currently describes an
intent the light-themed components never matched.
