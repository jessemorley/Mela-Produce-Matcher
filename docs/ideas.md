# Ideas / not yet done

## Strip ingredient text before sending to Claude

`ZINGREDIENTS` from Mela is full recipe-author prose: quantities, units,
parenthetical prep notes, section headers (`# SAUCE`), brand callouts. Most
of it is irrelevant to "does this recipe use produce X" — only the food
names matter for matching.

Stripping this locally (regex: drop leading quantity/unit tokens, drop
`(...)` asides, drop `# HEADER` lines) before it reaches `build_ranking_prompt`
would:

- shrink the ranking prompt significantly (ingredient text is most of its
  ~87KB across 166 recipes)
- make `filter_recipes_by_produce`'s substring match far more precise, since
  it's currently matching against prep-note noise too (95/115 recipes
  survived the filter on a real run — barely a cut)

Not done yet — revisit if prompt size/ranking latency is still a problem.
