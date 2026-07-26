import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

const { invoke } = window.__TAURI__.core;

// The newsletter's own markup is a Shopify page composed by hand: promo
// grids of recipe cards, a "buy the box" CTA, empty `<p> </p>` spacers left
// over from its editor, and a leading `<h1><img>` that's meant to be the
// post's banner, not inline body content. None of that reads well dropped
// straight into prose, so beyond stripping active content this also pulls
// the banner out and flattens the promo blocks into plain links.
//
// The feed is a fixed trusted merchant, but its HTML still shouldn't run
// anything inside the app webview: keep only the content, drop active bits
// and inline styling so our CSS formats it.
function sanitizeArticle(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script, style, iframe, object, embed, form, link, meta, button")
    .forEach((el) => el.remove());

  // The first heading's image is the post banner (a full-width photo Shopify
  // wraps in an <h1> so the newsletter itself never shows it inline) — pull
  // it out to render separately, the same way a recipe's cover photo is a
  // banner rather than part of its body.
  let banner = null;
  const firstImg = doc.querySelector("h1 img, h2 img");
  if (firstImg) {
    banner = firstImg.getAttribute("src");
    firstImg.closest("h1, h2").remove();
  }

  // The "buy the box" CTA (heading + product photo + illustration disclaimer)
  // is pure self-promotion, not newsletter content — drop the heading and
  // every sibling up to the next heading.
  doc.querySelectorAll("h1, h2, h3").forEach((el) => {
    if (!el.textContent.trim().toLowerCase().includes("in one box")) return;
    let sibling = el.nextElementSibling;
    el.remove();
    while (sibling && !/^h[1-3]$/i.test(sibling.tagName)) {
      const next = sibling.nextElementSibling;
      sibling.remove();
      sibling = next;
    }
  });

  // A promo grid (recipe cards) is any element with more than one image/link
  // inside it that isn't plain paragraph text — collapse each down to its
  // links, dropping the images and layout wrapper. Flagging the result
  // `.link-row` gives it a footer treatment (smaller, dimmer) instead of
  // reading as more editorial prose. A single-link row (the standalone
  // tangelo product plug after the recipe grid) is dropped rather than kept,
  // since it's promotional rather than something the newsletter is "about".
  doc.querySelectorAll("div, p").forEach((container) => {
    if (!container.isConnected || !container.querySelector("img")) return;
    const links = [...new Map(
      [...container.querySelectorAll("a[href]")].map((a) => [a.href, a])
    ).values()];
    if (links.length <= 1) {
      container.remove();
      return;
    }
    const replacement = doc.createElement("p");
    replacement.className = "link-row";
    links.forEach((a, i) => {
      const clean = doc.createElement("a");
      clean.setAttribute("href", a.getAttribute("href"));
      clean.textContent = a.textContent.trim() || a.querySelector("img")?.alt || "Link";
      replacement.append(clean);
      if (i < links.length - 1) replacement.append(document.createTextNode(" · "));
    });
    container.replaceWith(replacement);
  });

  // The newsletter marks both its editorial section breaks ("In Veg") and
  // its trailing promo headers ("Recipe Inspiration") as headings, just at
  // different levels (h3 vs h1). Folding h1/h2 into the same eyebrow style
  // as h3 means every section break in the piece reads consistently instead
  // of the promo headers looking like body text at heading size.
  // "Dave's Pick of the Week - Tangelos" repeats "Pick of the Week" from the
  // page title itself, so that prefix is trimmed to leave just the item name.
  doc.querySelectorAll("h1, h2").forEach((el) => {
    const h3 = doc.createElement("h3");
    h3.textContent = el.textContent.replace(/^dave'?s pick of the week\s*-\s*/i, "");
    el.replaceWith(h3);
  });

  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const keep =
        ["src", "alt", "href"].includes(name) &&
        !attr.value.trim().toLowerCase().startsWith("javascript:");
      if (!keep) el.removeAttribute(attr.name);
    }
  });

  // Editor spacer paragraphs (blank, or just a lone &nbsp;) still count as
  // "content" to the browser and each picks up the same margin-top as a real
  // paragraph, which is where the newsletter's big vertical gaps come from.
  // Every section's "- David Harris" byline is dropped the same way — it's a
  // repeated signature, not content, and pruning it doesn't need a heading-
  // scoped rule like the box CTA above since it's always its own paragraph.
  doc.querySelectorAll("p, div, h3").forEach((el) => {
    const text = el.textContent.replace(/ /g, " ").trim();
    if ((!text && !el.querySelector("img")) || /^-\s*david harris$/i.test(text)) el.remove();
  });

  return { body: doc.body, banner };
}

// The one place in the app with real prose, so it gets a larger body size and
// looser leading than any other pane. `title`/`html` are this week's post,
// already loaded by the launch sync; picking an older post from the archive
// dropdown swaps in that entry's title/html locally instead, so the current
// post never needs a re-fetch just to view it again.
export default function ArticleView({ title, html }) {
  const articleRef = useRef(null);
  const [banner, setBanner] = useState(null);
  const [archive, setArchive] = useState(null); // null until the picker's opened once
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [picked, setPicked] = useState(null); // an ArchiveEntry, or null for "this week"

  const shown = picked
    ? { title: picked.feed_title, html: picked.feed_html }
    : { title, html };

  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    const sanitized = sanitizeArticle(shown.html || "");
    el.replaceChildren(...sanitized.body.childNodes);
    setBanner(sanitized.banner);
  }, [shown.html]);

  useEffect(() => {
    if (!archiveOpen || archive) return;
    invoke("list_archive").then(setArchive);
  }, [archiveOpen, archive]);

  useEffect(() => {
    if (!archiveOpen) return;
    const close = () => setArchiveOpen(false);
    window.addEventListener("click", close);
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [archiveOpen]);

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
    <div className="pb-16">
      {banner && (
        <div className="relative h-52 w-full overflow-hidden">
          <img src={banner} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-pane/10 via-pane/55 to-pane" />
        </div>
      )}

      <div className={`px-10 ${banner ? "relative -mt-14" : "pt-9"}`}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[27px] font-semibold leading-[1.18] tracking-tight text-text">
            {shown.title}
          </h2>

          <div className="relative shrink-0 pt-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setArchiveOpen((v) => !v);
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] text-text/45 hover:bg-text/[0.06] hover:text-text/70"
            >
              Past updates
              <ChevronDown className="h-3 w-3" />
            </button>

            {archiveOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-full z-20 mt-1.5 max-h-80 w-72 overflow-y-auto rounded-xl bg-pane py-1 shadow-[0_8px_24px_rgba(19,18,17,0.6)]"
              >
                {archive == null ? (
                  <p className="px-3 py-2 text-[12px] text-text/45">Loading…</p>
                ) : (
                  archive.map((entry) => (
                    <button
                      key={entry.entry_id}
                      onClick={() => {
                        setPicked(entry.entry_id === archive[0]?.entry_id ? null : entry);
                        setArchiveOpen(false);
                      }}
                      className={`block w-full truncate px-3 py-1.5 text-left text-[12.5px] hover:brightness-125 ${
                        (picked?.entry_id ?? archive[0]?.entry_id) === entry.entry_id
                          ? "text-text"
                          : "text-text/60"
                      }`}
                    >
                      {entry.feed_title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <article
          ref={articleRef}
          className="prose-newsletter mt-7 text-[14.5px] leading-[1.8] text-text/68"
        />
      </div>

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
        .prose-newsletter b, .prose-newsletter strong { color: var(--color-text); font-weight: 600; }
        .prose-newsletter .link-row {
          font-size: 12.5px;
          color: color-mix(in oklab, var(--color-text) 55%, transparent);
        }
      `}</style>
    </div>
  );
}
