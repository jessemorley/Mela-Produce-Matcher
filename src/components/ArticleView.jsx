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
// Wraps every mention of an in-season produce name in a click target that
// selects the matching tile in the list pane. `terms` comes from the Rust
// `produce_search_terms` command — each spelling worth searching for plus the
// canonical tile name it resolves to, already sorted longest-first.
//
// The newsletter's own words are never rewritten: a "kumera" mention still
// reads "kumera", it just carries `data-produce="sweet potato"`. The alias
// vocabulary stays in Rust; this only scans.
//
// One regex alternation does all the matching logic, deliberately. Regex
// alternation is first-match-wins, so the longest-first ordering *is* the
// rule that stops "potato" claiming a "sweet potato" mention — no separate
// pass. `\b` gives word boundaries, so "corn" can't match "corned beef", and
// the `g`/`i` flags cover every mention and the feed's inconsistent casing.
//
// Only text nodes are touched, which is what makes this safe: an href or an
// alt attribute containing a produce name can't be corrupted, because the
// walk never sees it.
function linkProduceMentions(doc, terms) {
  if (!terms?.length) return;
  const canonical = new Map(terms.map((t) => [t.term.toLowerCase(), t.canonical]));
  const pattern = terms.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // The trailing `(?:e?s)?` catches the plurals prose is actually written in
  // — "kumeras", "potatoes" — which the terms themselves are not (they're
  // singular, matching the tile names). Without it `\b` stops at the "s" and
  // most real mentions are missed. Deliberately cruder than the Rust
  // `singular`: over-matching here costs a link on "peas" pointing at the
  // "pea" tile, which is right anyway.
  const re = new RegExp(`\\b(${pattern})(?:e?s)?\\b`, "gi");

  // Collected before mutating: replacing a node mid-walk invalidates the
  // walker's position.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const targets = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // Leave the newsletter's own links alone (they open in the browser), and
    // skip the eyebrow headings and promo footer — a link there reads as
    // chrome rather than a mention in prose.
    if (node.parentElement?.closest("a, h3, .link-row")) continue;
    if (re.test(node.data)) targets.push(node);
    re.lastIndex = 0;
  }

  // First mention of each produce only — a produce newsletter names its items
  // constantly, and linking all of them turns the prose into a field of
  // green. Keyed on the canonical, so "kumera" and a later "sweet potato"
  // count as the same item and only the first one links. Spans the whole
  // article rather than per-paragraph, which is why it lives out here.
  const linked = new Set();

  for (const node of targets) {
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of node.data.matchAll(re)) {
      const name = canonical.get(m[1].toLowerCase()) ?? m[1].toLowerCase();
      if (linked.has(name)) continue;
      linked.add(name);
      frag.append(node.data.slice(last, m.index));
      const link = doc.createElement("a");
      link.className = "produce-link";
      // m[0] is the whole match including any plural suffix ("kumeras"), m[1]
      // the bare term the canonical map is keyed on ("kumera"). The link
      // *shows* m[0] so the newsletter's own words are untouched, and
      // *carries* the canonical tile name.
      link.setAttribute("data-produce", name);
      link.textContent = m[0];
      frag.append(link);
      last = m.index + m[0].length;
    }
    frag.append(node.data.slice(last));
    node.replaceWith(frag);
  }
}

function sanitizeArticle(html, terms) {
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

  // Last, deliberately: after the attribute pass above (which would otherwise
  // strip `data-produce` right back off) and after the pruning (no point
  // scanning content that's about to be removed).
  linkProduceMentions(doc, terms);

  return { body: doc.body, banner };
}

// The one place in the app with real prose, so it gets a larger body size and
// looser leading than any other pane. `title`/`html` are this week's post,
// already loaded by the launch sync; picking an older post from the archive
// dropdown swaps in that entry's title/html locally instead, so the current
// post never needs a re-fetch just to view it again.
export default function ArticleView({ title, html, produce, onSelectProduce }) {
  const articleRef = useRef(null);
  const [banner, setBanner] = useState(null);
  const [archive, setArchive] = useState(null); // null until the picker's opened once
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [picked, setPicked] = useState(null); // an ArchiveEntry, or null for "this week"

  const shown = picked
    ? { title: picked.feed_title, html: picked.feed_html }
    : { title, html };

  // Fetches the searchable produce vocabulary (from Rust, so the alias table
  // stays in one place) and sanitizes in the same pass, so the article never
  // renders once unlinked and again once terms arrive. `produce` is always
  // *this week's* picks — an archived post has no produce list of its own
  // (ArchiveEntry only carries title/html), so linking it against this week's
  // vocabulary would tag mentions with the wrong season's tiles. Only the
  // current post gets links; an archived post renders with none, which is a
  // fine degradation over a misleading one.
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    const terms = picked
      ? Promise.resolve([])
      : invoke("produce_search_terms", {
          fruit: produce?.fruit ?? [],
          vegetable: produce?.vegetable ?? [],
        }).catch(() => []); // no links is a fine degradation
    let cancelled = false;
    terms.then((terms) => {
      if (cancelled) return;
      const sanitized = sanitizeArticle(shown.html || "", terms);
      el.replaceChildren(...sanitized.body.childNodes);
      setBanner(sanitized.banner);
    });
    return () => {
      cancelled = true;
    };
  }, [shown.html, produce?.fruit, produce?.vegetable, picked]);

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
    // Two kinds of link live in here. A produce mention selects its tile in
    // the list pane and is checked first — it carries no href, so the
    // outbound branch below would skip it. Everything else is the
    // newsletter's own link and opens in the real browser, not the webview.
    function onClick(e) {
      const mention = e.target.closest("a[data-produce]");
      if (mention) {
        e.preventDefault();
        onSelectProduce?.(mention.getAttribute("data-produce"));
        return;
      }
      const a = e.target.closest("a[href]");
      if (!a) return;
      e.preventDefault();
      if (a.href.startsWith("http")) invoke("open_url", { url: a.href });
    }
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [onSelectProduce]);

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
        /* An in-app jump, not an outbound link: carried by colour alone. The
           rule above gives every <a> a bottom border, so this has to clear it
           explicitly — mentions are frequent enough in a produce newsletter
           that underlining them all stripes the prose. */
        .prose-newsletter a.produce-link {
          cursor: pointer;
          border-bottom: none;
        }
        .prose-newsletter a.produce-link:hover {
          color: var(--color-text);
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
