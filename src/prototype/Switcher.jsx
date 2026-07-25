// PROTOTYPE — delete with the rest of src/prototype/.
import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Reads/writes ?variant= directly on window.location — the app has no router,
// and a prototype doesn't need one.
export function useVariant(keys) {
  const current = new URLSearchParams(window.location.search).get("variant");
  const active = keys.includes(current) ? current : keys[0];

  function go(delta) {
    const next = keys[(keys.indexOf(active) + delta + keys.length) % keys.length];
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState({}, "", url);
    window.dispatchEvent(new Event("popstate")); // force a re-render
  }

  useEffect(() => {
    function onKey(e) {
      const t = e.target;
      if (t.matches("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return [active, go];
}

export default function Switcher({ label, onPrev, onNext }) {
  if (import.meta.env.PROD) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full bg-white px-1.5 py-1.5 text-slate-900 shadow-2xl ring-1 ring-black/10">
      <button onClick={onPrev} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="Previous variant">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="px-2 text-xs font-semibold tabular-nums whitespace-nowrap">{label}</span>
      <button onClick={onNext} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="Next variant">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
