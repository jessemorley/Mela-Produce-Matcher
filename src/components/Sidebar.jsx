import { Tag, RefreshCw } from "lucide-react";
import { NAV } from "./nav.js";
import { VEGETABLE } from "./icons.js";
import StatusBar from "./StatusBar.jsx";

// Sits directly on the window ground — no pane surface — so only the list and
// detail read as floating cards. Hidden below 820px, where nav and the status
// bar re-home to the compact strip in RecipeList.
export default function Sidebar({
  selectedNav,
  onSelectNav,
  counts,
  busy,
  status,
  onCancel,
  onFullResync,
  categories,
  selectedTag,
  onSelectTag,
}) {
  return (
    <aside
      className="hidden shrink-0 flex-col overflow-hidden min-[820px]:flex"
      style={{ width: "var(--sidebar)" }}
    >
      {/* The traffic lights are drawn by macOS over the top-left of the
          window (titleBarStyle: Overlay), so the sidebar header starts below
          them. The spacer is a drag region in its own right: App.jsx's
          window-wide band sits *behind* the panes, so it only covers bare
          ground — an opaque pane has to carry its own. */}
      <div className="h-7 shrink-0" data-tauri-drag-region="deep" />

      {/* src-tauri/icons/ still holds the default Tauri placeholder (cyan and
          yellow), which fights the palette — so the mark is drawn here in the
          app's own accents until a real icon exists. */}
      {/* "deep" so the wordmark and tagline drag too — they sit inside the
          window's top drag band. The resync button inside is still blocked
          from dragging by Tauri's own clickable-element check. */}
      <div
        className="flex items-center gap-2.5 px-2.5 pb-6 pt-3"
        data-tauri-drag-region="deep"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-match/14">
          <VEGETABLE className="h-[18px] w-[18px] text-match" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold tracking-tight text-text">Sprout</h1>
          <p className="mt-0.5 text-[11px] text-text/40">Seasonal matcher</p>
        </div>
        <button
          onClick={onFullResync}
          disabled={busy}
          title="Resync all recipes from Mela"
          className="shrink-0 rounded-lg p-1.5 text-text/35 transition-colors hover:bg-text/[0.06] hover:text-text/70 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} strokeWidth={1.75} />
        </button>
      </div>

      <nav className="px-2.5">
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onSelectNav(key)}
            className={`mb-0.5 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-white/[0.035] ${
              selectedNav === key ? "bg-text/7 text-text/95" : "text-text/45"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </span>
            <span className="text-[10.5px] tabular-nums text-text/30">{counts[key]}</span>
          </button>
        ))}
      </nav>

      {categories.length > 0 && (
        <div className="mt-8 flex min-h-0 flex-1 flex-col px-2.5">
          <p className="px-3 pb-2 text-[9.5px] uppercase tracking-[0.18em] text-text/32">
            Categories
          </p>
          <div className="min-h-0 overflow-y-auto">
            {categories.map(({ label, count }) => {
              const active = selectedTag === label;
              return (
                <button
                  key={label}
                  onClick={() => onSelectTag(active ? null : label)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-white/[0.035] ${
                    active ? "bg-text/7 text-match" : "text-text/45"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{label}</span>
                  </span>
                  <span
                    className={`text-[10.5px] tabular-nums ${
                      active ? "text-match" : "text-text/30"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-auto">
        <StatusBar status={status} busy={busy} onCancel={onCancel} />
      </div>
    </aside>
  );
}
