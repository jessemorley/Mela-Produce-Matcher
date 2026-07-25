// PROTOTYPE — the chosen shell (A2, "Ledger inset") on the chosen palette.
// Stub data only (no Tauri, no Mela, no Claude).
// Delete src/prototype/ once this is folded into src/components/.
import { useState } from "react";
import Shell from "./VariantA2.jsx";
import * as fixtures from "./fixtures.js";

export default function Prototype() {
  const [nav, setNav] = useState("matching");

  // Selection lives in the shell — it's shared across views.
  return <Shell data={fixtures} nav={nav} setNav={setNav} />;
}
