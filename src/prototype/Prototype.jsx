// PROTOTYPE — the chosen shell (A2, "Ledger inset") with three competing
// layouts for the In Season tab, switchable via ?variant=1|2|3.
// Stub data only (no Tauri, no Mela, no Claude).
// Delete src/prototype/ once a direction wins.
import { useState } from "react";
import Switcher, { useVariant } from "./Switcher.jsx";
import Shell from "./VariantA2.jsx";
import * as fixtures from "./fixtures.js";
import { PRODUCE_LAYOUTS } from "./produceLayouts.jsx";

const KEYS = Object.keys(PRODUCE_LAYOUTS);

export default function Prototype() {
  const [key, go] = useVariant(KEYS);
  const [nav, setNav] = useState("produce"); // open on the tab being designed

  return (
    <>
      {/* Selection lives in the shell — it's shared across views now. */}
      <Shell data={fixtures} nav={nav} setNav={setNav} produceLayout={key} />
      {/* Only one layout survives the round — no bar until there's a choice. */}
      {KEYS.length > 1 && (
        <Switcher
          label={`In Season ${key} — ${PRODUCE_LAYOUTS[key].name}`}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
        />
      )}
    </>
  );
}
