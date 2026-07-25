// PROTOTYPE — exactly three ingredient icons, shared by every view.
//
// Produce names come from Claude reading a live newsletter, so a per-name
// icon table would drift out of date. Key on the coarsest thing that's always
// known instead: fruit, vegetable, or pantry.
//
// Note the asymmetry in the data: market produce carries a Fruit/Vegetable
// type, but a stored Ingredient is only `{display, name, pantry}` — no
// fruit/vegetable split. So ingredient chips can distinguish produce from
// pantry, and nothing finer, without a backend change.
import { Apple, Sprout, Wheat } from "lucide-react";

export const FRUIT = Apple;
export const VEGETABLE = Sprout;
export const PANTRY = Wheat;

// Market/seasonal produce, which does carry a type. Anything without one
// (the seasonal table is a flat name list) falls back to the vegetable mark.
export const produceIcon = (type) => (type === "Fruit" ? FRUIT : VEGETABLE);

// A stored ingredient: pantry flag is all there is to go on.
export const ingredientIcon = (pantry) => (pantry ? PANTRY : VEGETABLE);
