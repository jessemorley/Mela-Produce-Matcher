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
    <div className="p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white mb-4"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back
      </button>
      <h2 className="text-lg font-bold text-white mb-4">{title}</h2>
      <article
        ref={articleRef}
        className="text-sm text-slate-300 leading-relaxed space-y-3 [&_a]:text-emerald-400 [&_a]:underline [&_img]:max-w-full [&_img]:rounded-lg"
      />
    </div>
  );
}
