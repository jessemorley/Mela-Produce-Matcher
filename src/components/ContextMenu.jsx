// Right-click menu for recipe rows, shared by both list panes. Exclude used
// to be a button in the detail header; it's rare housekeeping, so it lives
// here rather than sitting beside "Open in Mela".
import { useEffect, useRef, useState } from "react";

// Returns [menu, openAt, close] — spread openAt onto a row's onContextMenu.
export function useContextMenu() {
  const [menu, setMenu] = useState(null); // { x, y, item }
  const menuRef = useRef(null); // set by ContextMenu below

  useEffect(() => {
    if (!menu) return;
    // Capture phase runs before the click reaches a menu button in bubble
    // phase, so an unconditional close() here unmounted the menu out from
    // under its own item clicks — "Exclude" closed the menu but never fired.
    // Only close for clicks that land outside the menu itself.
    const close = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      setMenu(null);
    };
    window.addEventListener("click", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    const onKey = (e) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openAt = (item) => (e) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, item });
  };

  return [menu, openAt, () => setMenu(null), menuRef];
}

export function ContextMenu({ menu, items, menuRef }) {
  if (!menu) return null;

  // Keep the menu on screen when the row is near the right/bottom edge.
  const W = 176;
  const H = items.length * 32 + 8;
  const x = Math.min(menu.x, window.innerWidth - W - 8);
  const y = Math.min(menu.y, window.innerHeight - H - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 rounded-xl bg-pane py-1 shadow-[0_8px_24px_rgba(19,18,17,0.6)]"
      style={{ left: x, top: y, width: W }}
    >
      {items.map(({ label, icon: Icon, onClick, danger }) => (
        <button
          key={label}
          onClick={onClick}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] hover:brightness-125 ${
            danger ? "text-alert-soft" : "text-text/75"
          }`}
        >
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />}
          {label}
        </button>
      ))}
    </div>
  );
}
