// PROTOTYPE — delete with the rest of src/prototype/.
// Stub data shaped exactly like the real backend payloads so variants are
// judged against real density: long titles, missing images, unanalysed
// recipes, excluded recipes, ingredients with empty `name`.

export const produce = {
  feed_title: "Dave's Market Update — Week of 20 July",
  fruit: ["blood orange", "pink lady apple", "rhubarb", "kiwifruit", "nashi pear"],
  vegetable: [
    "brussels sprout",
    "cavolo nero",
    "jerusalem artichoke",
    "leek",
    "swede",
    "sugar snap",
    "cauliflower",
  ],
  pick: ["blood orange", "jerusalem artichoke"],
  featured: ["cavolo nero", "rhubarb"],
};

export const seasonal = {
  season: "Winter",
  produce: [
    "beetroot", "cabbage", "carrot", "celeriac", "fennel", "grapefruit",
    "kale", "mandarin", "parsnip", "potato", "pumpkin", "silverbeet",
    "turnip", "witlof",
  ],
};

const ing = (display, name, pantry = false) => ({ display, name, pantry });

// A deliberately awkward spread: a 96% hero, a few middling matches, one
// recipe with no image, one with a very long title, one unanalysed, one
// excluded. If a layout only looks good on the tidy rows, that shows here.
export const allRecipes = [
  {
    id: "r1",
    title: "Roast Jerusalem Artichoke with Blood Orange",
    image: null,
    total_time: "1 hr 10 min",
    yield: "Serves 4",
    favorite: true,
    excluded: false,
    tags: ["Dinner", "Vegetarian"],
    key_ingredients: ["jerusalem artichoke", "blood orange", "thyme"],
    description:
      "Halve the artichokes and roast cut-side down until the edges catch. Segment the blood oranges over a bowl to keep the juice, then dress everything while still warm so the dressing soaks in rather than sitting on top.",
    ingredients: [
      ing("800g jerusalem artichokes, scrubbed", "jerusalem artichoke"),
      ing("2 blood oranges", "blood orange"),
      ing("4 sprigs thyme", "thyme"),
      ing("3 tbsp olive oil", "olive oil", true),
      ing("1 tsp salt", "salt", true),
      ing("freshly cracked black pepper", "black pepper", true),
    ],
  },
  {
    id: "r2",
    title: "Cavolo Nero and White Bean Stew",
    image: null,
    total_time: "45 min",
    yield: "Serves 6",
    favorite: false,
    excluded: false,
    tags: ["Dinner", "Soup"],
    key_ingredients: ["cavolo nero", "cannellini bean", "leek"],
    description:
      "A stew that improves on the second day. Strip the cavolo nero off its stems, but keep the stems — sliced thin, they go in with the leeks and give the base a bit of body.",
    ingredients: [
      ing("1 bunch cavolo nero", "cavolo nero"),
      ing("2 leeks, white part only", "leek"),
      ing("400g tin cannellini beans", "cannellini bean", true),
      ing("1L vegetable stock", "vegetable stock", true),
      ing("2 cloves garlic", "garlic"),
      ing("1 tsp salt", "salt", true),
    ],
  },
  {
    id: "r3",
    title: "Shaved Brussels Sprout Salad with Pink Lady and Toasted Hazelnut",
    image: null,
    total_time: "20 min",
    yield: "Serves 4 as a side",
    favorite: false,
    excluded: false,
    tags: ["Salad", "Quick"],
    key_ingredients: ["brussels sprout", "pink lady apple"],
    description:
      "Shave the sprouts as thin as you can manage — a mandoline if you have one. Dress ten minutes before serving so they soften slightly without going limp.",
    ingredients: [
      ing("300g brussels sprouts", "brussels sprout"),
      ing("1 pink lady apple", "pink lady apple"),
      ing("60g hazelnuts, toasted", "hazelnut", true),
      ing("2 tbsp lemon juice", "lemon juice", true),
      // Unfixed line — analysis came back incomplete for this one.
      ing("cups/173 gram all purpose flour", "", true),
    ],
  },
  {
    id: "r4",
    title: "Rhubarb and Nashi Pear Crumble",
    image: null,
    total_time: "55 min",
    yield: "Serves 8",
    favorite: true,
    excluded: false,
    tags: ["Dessert"],
    key_ingredients: ["rhubarb", "nashi pear"],
    description:
      "The nashi holds its shape where an ordinary pear would collapse, which keeps the filling from turning to jam under the crumble.",
    ingredients: [
      ing("500g rhubarb", "rhubarb"),
      ing("2 nashi pears", "nashi pear"),
      ing("150g plain flour", "plain flour", true),
      ing("100g brown sugar", "brown sugar", true),
      ing("120g cold butter", "butter", true),
    ],
  },
  {
    id: "r5",
    title: "Leek and Potato Soup",
    image: null,
    total_time: "40 min",
    yield: "Serves 4",
    favorite: false,
    excluded: false,
    tags: ["Soup", "Quick"],
    key_ingredients: ["leek", "potato"],
    description: "Sweat the leeks properly — no colour, just softness — before the stock goes in.",
    ingredients: [
      ing("3 leeks", "leek"),
      ing("600g potatoes", "potato"),
      ing("1L chicken stock", "chicken stock", true),
      ing("50g butter", "butter", true),
    ],
  },
  {
    id: "r6",
    title: "Cauliflower Steaks with Caper Brown Butter",
    image: null,
    total_time: "35 min",
    yield: "Serves 2",
    favorite: false,
    excluded: false,
    tags: ["Dinner", "Vegetarian"],
    key_ingredients: ["cauliflower", "caper"],
    description: "Cut through the core so the steaks hold together in the pan.",
    ingredients: [
      ing("1 head cauliflower", "cauliflower"),
      ing("2 tbsp capers", "caper", true),
      ing("80g butter", "butter", true),
    ],
  },
  {
    id: "r7",
    title: "Beetroot, Witlof and Walnut",
    image: null,
    total_time: "25 min",
    yield: "Serves 4",
    favorite: false,
    excluded: false,
    tags: ["Salad"],
    key_ingredients: ["beetroot", "witlof"],
    description: "Roast the beets whole in foil, then peel them under cold running water.",
    ingredients: [
      ing("4 beetroot", "beetroot"),
      ing("2 heads witlof", "witlof"),
      ing("cups/6 ounce walnut halve and piece", "", true),
    ],
  },
  {
    id: "r8",
    title: "Weeknight Miso Noodles",
    image: null,
    total_time: "15 min",
    yield: "Serves 2",
    favorite: false,
    excluded: false,
    tags: ["Quick", "Dinner"],
    key_ingredients: [], // unanalysed — drives the Sync Now banner
    description: "",
    ingredients: [ing("200g udon", "", true), ing("2 tbsp white miso", "", true)],
  },
  {
    id: "r9",
    title: "All-Purpose Vegan Cheese Sauce",
    image: null,
    total_time: "10 min",
    yield: "Makes 2 cups",
    favorite: false,
    excluded: true, // no seasonal story — user-excluded
    tags: ["Basics"],
    key_ingredients: [],
    description: "",
    ingredients: [ing("1 cup raw cashews", "cashew", true)],
  },
];

// Shape of match_recipes(): the full record flattened with rating +
// pick_matches/seasonal_matches. Ordered by rating desc, as the backend does.
const ranked = (id, rating, pick_matches, seasonal_matches) => ({
  ...allRecipes.find((r) => r.id === id),
  rating,
  pick_matches,
  seasonal_matches,
});

export const rankedRecipes = [
  ranked("r1", 0.96, ["jerusalem artichoke", "blood orange"], []),
  ranked("r2", 0.71, ["cavolo nero", "leek"], []),
  ranked("r3", 0.58, ["brussels sprout", "pink lady apple"], []),
  ranked("r4", 0.5, ["rhubarb", "nashi pear"], []),
  ranked("r5", 0.42, ["leek"], ["potato"]),
  ranked("r6", 0.33, ["cauliflower"], []),
  ranked("r7", 0.19, [], ["beetroot", "witlof"]),
];

export const categories = [
  { label: "Dinner", count: 3 },
  { label: "Salad", count: 2 },
  { label: "Quick", count: 3 },
  { label: "Soup", count: 2 },
  { label: "Vegetarian", count: 2 },
  { label: "Dessert", count: 1 },
  { label: "Basics", count: 1 },
];

export const unanalyzedCount = 1;
export const unfixedCount = 2;
export const recipeCount = allRecipes.length;
export const status = "Reused cached produce · 9 recipes";
