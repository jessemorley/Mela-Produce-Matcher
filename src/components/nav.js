import { Sparkles, Leaf, BookOpen } from "lucide-react";

// Shared by the sidebar and the compact strip RecipeList shows below 820px,
// so the two can't drift apart on labels or order.
export const NAV = [
  { key: "matching", label: "Best Matches", icon: Sparkles },
  { key: "produce", label: "In Season", icon: Leaf },
  { key: "recipes", label: "All Recipes", icon: BookOpen },
];
