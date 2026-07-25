import { useEffect, useRef } from "react";
import { ChevronLeft } from "lucide-react";

const { invoke } = window.__TAURI__.core;

// The feed is a fixed trusted merchant, but its HTML still shouldn't run
// anything inside the app webview: keep only the content, drop active bits
// and inline styling so our CSS formats it.
function sanitizeArticle(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script, style, iframe, object, embed, form, link, meta")
    .forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const keep =
        ["src", "alt", "href"].includes(name) &&
        !attr.value.trim().toLowerCase().startsWith("javascript:");
      if (!keep) el.removeAttribute(attr.name);
    }
  });
  return doc.body;
}

// The one place in the app with real prose, so it gets a larger body size and
// looser leading than any other pane.
export default function ArticleView({ title, html, onBack }) {
  const articleRef = useRef(null);

  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    el.replaceChildren(...sanitizeArticle(html || "").childNodes);
  }, [html]);

  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    // Links inside the article open in the real browser, not the webview.
    function onClick(e) {
      const a = e.target.closest("a[href]");
      if (!a) return;
      e.preventDefault();
      if (a.href.startsWith("http")) invoke("open_url", { url: a.href });
    }
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="px-10 pb-16 pt-9">
      <button
        onClick={onBack}
        className="mb-6 flex items-center gap-1.5 text-[11.5px] text-text/45 hover:brightness-125"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back
      </button>

      <h2 className="text-[27px] font-semibold leading-[1.18] tracking-tight text-text">
        {title}
      </h2>

      <article
        ref={articleRef}
        className="prose-newsletter mt-7 text-[14.5px] leading-[1.8] text-text/68"
      />

      <style>{`
        .prose-newsletter > * + * { margin-top: 1.1em; }
        .prose-newsletter h3 {
          margin-top: 2em;
          font-size: 9.5px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: color-mix(in oklab, var(--color-text) 32%, transparent);
        }
        .prose-newsletter a {
          color: var(--color-match);
          text-decoration: none;
          border-bottom: 1px solid color-mix(in oklab, var(--color-match) 35%, transparent);
        }
        .prose-newsletter img { max-width: 100%; border-radius: 12px; }
      `}</style>
    </div>
  );
}
