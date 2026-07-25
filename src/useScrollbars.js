import { useEffect } from "react";

// Shows scrollbars only while scrolling. The CSS keeps every thumb
// transparent at rest and fades one in whenever its element carries
// `.scrolling` (see index.css); this adds that class on scroll and drops it
// again after the user stops.
//
// One delegated listener in the capture phase rather than a ref per pane:
// scroll doesn't bubble, but it does capture, so a single listener on the
// document sees every scroller in the app — including ones that mount later
// (recipe cards, the Fix modal) with no wiring of their own.
const IDLE_MS = 900;

export function useScrollbars() {
  useEffect(() => {
    const timers = new WeakMap();

    function onScroll(e) {
      const el = e.target;
      if (!(el instanceof Element)) return; // document scroll: body doesn't scroll here
      el.classList.add("scrolling");
      clearTimeout(timers.get(el));
      timers.set(
        el,
        setTimeout(() => el.classList.remove("scrolling"), IDLE_MS),
      );
    }

    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);
}
