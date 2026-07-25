// PROTOTYPE — the status bar, which the earlier rounds left as one static
// line of text.
//
// The backend already emits "Analysing 3/10: Asparagus Stir Fry" during the
// batched Claude call, so the progress is *known* — the old bar threw that
// away and rendered it as flat text next to an indeterminate spinner. Here a
// parsed n/total drives a real progress line, and the spinner is reserved for
// work whose duration genuinely isn't known (feed fetch, Mela sync).
//
// It sits in the sidebar's footer rather than spanning the window: that's
// where the idle status text already lives, and a full-width bar would give a
// background task more prominence than the recipe you're reading.
import { Loader2, X, AlertCircle } from "lucide-react";
import { rgba } from "./palettes.js";

// "Analysing 3/10: Asparagus Stir Fry" → { done: 3, total: 10, label: "..." }
export function parseProgress(status) {
  const m = /^Analysing (\d+)\/(\d+): (.+)$/.exec(status || "");
  if (!m) return null;
  return { done: Number(m[1]), total: Number(m[2]), label: m[3] };
}

export default function StatusBar({ status, busy, onCancel, p }) {
  const progress = busy ? parseProgress(status) : null;
  const isError = /^Error:/.test(status || "");

  return (
    <div className="px-2.5 pb-4 pt-3">
      <div className="px-3">
        {progress ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10.5px] tabular-nums" style={{ color: rgba(p.text, 0.5) }}>
                Analysing {progress.done} of {progress.total}
              </span>
              <button
                onClick={onCancel}
                className="shrink-0 text-[10.5px] hover:brightness-125"
                style={{ color: rgba(p.text, 0.35) }}
              >
                Cancel
              </button>
            </div>

            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full" style={{ background: rgba(p.text, 0.08) }}>
              <div
                className="h-full rounded-full transition-[width] duration-300 ease-out"
                style={{ width: `${(progress.done / progress.total) * 100}%`, background: p.match }}
              />
            </div>

            {/* Which recipe is being analysed right now — the reason the
                backend streams per-recipe events at all. */}
            <p className="mt-2 truncate text-[10.5px]" style={{ color: rgba(p.text, 0.3) }}>
              {progress.label}
            </p>
          </>
        ) : busy ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" style={{ color: rgba(p.text, 0.4) }} />
            <span className="min-w-0 flex-1 truncate text-[10.5px]" style={{ color: rgba(p.text, 0.45) }}>
              {status}
            </span>
            <button
              onClick={onCancel}
              className="shrink-0 rounded p-0.5 hover:brightness-125"
              style={{ color: rgba(p.text, 0.35) }}
              aria-label="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : isError ? (
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" style={{ color: p.alert }} strokeWidth={2} />
            <span className="min-w-0 flex-1 text-[10.5px] leading-relaxed" style={{ color: p.alertSoft }}>
              {status.replace(/^Error:\s*/, "")}
            </span>
          </div>
        ) : (
          <p className="truncate text-[10.5px]" style={{ color: rgba(p.text, 0.3) }}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
