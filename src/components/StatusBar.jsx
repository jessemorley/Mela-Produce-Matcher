// The status bar. The backend emits "Analysing 3/10: Asparagus Stir Fry"
// per recipe during the batched Claude call, so progress through that phase
// is *known* — it drives a real progress line, and the spinner is reserved
// for work whose duration genuinely isn't known (feed fetch, Mela sync).
//
// It sits in the sidebar's footer rather than spanning the window: that's
// where the idle status text lives, and a full-width bar would give a
// background task more prominence than the recipe you're reading.
import { Loader2, X, AlertCircle } from "lucide-react";
import { parseProgress } from "./parseProgress.js";

export default function StatusBar({ status, busy, onCancel }) {
  const progress = busy ? parseProgress(status) : null;
  const isError = /^Error:/.test(status || "");

  return (
    <div className="px-2.5 pb-4 pt-3">
      <div className="px-3">
        {progress ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10.5px] tabular-nums text-text/50">
                Analysing {progress.done} of {progress.total}
              </span>
              <button
                onClick={onCancel}
                className="shrink-0 text-[10.5px] text-text/35 hover:brightness-125"
              >
                Cancel
              </button>
            </div>

            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-text/8">
              <div
                className="h-full rounded-full bg-match transition-[width] duration-300 ease-out"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>

            {/* Which recipe is being analysed right now — the reason the
                backend streams per-recipe events at all. */}
            <p className="mt-2 truncate text-[10.5px] text-text/30">{progress.label}</p>
          </>
        ) : busy ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-text/40" />
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-text/45">
              {status}
            </span>
            <button
              onClick={onCancel}
              className="shrink-0 rounded p-0.5 text-text/35 hover:brightness-125"
              aria-label="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : isError ? (
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-px h-3 w-3 shrink-0 text-alert" strokeWidth={2} />
            <span className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-alert-soft">
              {status.replace(/^Error:\s*/, "")}
            </span>
          </div>
        ) : (
          <p className="truncate text-[10.5px] text-text/30">{status}</p>
        )}
      </div>
    </div>
  );
}
