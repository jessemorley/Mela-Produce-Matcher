// PROTOTYPE — the two list states the earlier rounds never covered: an
// active category filter, and an empty list.
//
// The distinction that matters: "empty because a filter is hiding things" and
// "empty because there's genuinely nothing" look identical if you only render
// one message. The first needs a way out, the second needs an explanation —
// so the empty state takes an optional action, and the filter chip sits above
// the list while a filter is on, giving it a one-click exit from the pane
// you're actually looking at.
import { Tag, X } from "lucide-react";
import { rgba } from "./palettes.js";

export function FilterChip({ tag, onClear, p }) {
  return (
    <div className="mx-3 mb-3">
      <button
        onClick={onClear}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:brightness-125"
        style={{ background: rgba(p.match, 0.1) }}
      >
        <Tag className="h-3 w-3 shrink-0" style={{ color: p.match }} strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: p.matchSoft }}>
          {tag}
        </span>
        <X className="h-3 w-3 shrink-0" style={{ color: rgba(p.text, 0.4) }} strokeWidth={2} />
      </button>
    </div>
  );
}

// Also the first-run screen: a fresh install has no analysed recipes, so this
// is the first thing a new user sees. It has to explain rather than just be
// blank, and offer the one action that resolves it.
export function ListEmpty({ icon: Icon, title, body, action, p }) {
  return (
    <div className="flex flex-col items-center px-6 pb-8 pt-14 text-center">
      {Icon && <Icon className="h-5 w-5" style={{ color: rgba(p.text, 0.2) }} strokeWidth={1.5} />}
      <p className="mt-3 text-[13px] font-medium" style={{ color: rgba(p.text, 0.6) }}>
        {title}
      </p>
      <p className="mt-1.5 max-w-[15rem] text-[11.5px] leading-relaxed" style={{ color: rgba(p.text, 0.35) }}>
        {body}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-xl px-3.5 py-1.5 text-[11.5px] font-medium transition-opacity hover:opacity-90"
          style={{ background: rgba(p.text, 0.08), color: rgba(p.text, 0.75) }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
