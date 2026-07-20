const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

// N. **Recipe Title** — id: RECIPE_ID — matches: ... — fit: ...
const LINE_RE = /^(\d+)\.\s+\*\*(.+?)\*\*\s+—\s+id:\s+(\S+)\s+—\s+(.+)$/;

function renderLine(resultsEl, line) {
  const match = line.match(LINE_RE);
  if (!match) {
    if (line.trim()) {
      const li = document.createElement("li");
      li.className = "raw-line";
      li.textContent = line;
      resultsEl.appendChild(li);
    }
    return;
  }
  const [, , title, id, rest] = match;
  const li = document.createElement("li");
  const link = document.createElement("a");
  link.href = "#";
  link.textContent = title;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    invoke("open_recipe", { id });
  });
  li.appendChild(link);
  li.append(" — " + rest);
  resultsEl.appendChild(li);
}

// Claude's wording won't always match exactly ("cosmic crisp apple" vs
// "apple"), so match emphasis lists loosely by substring either way.
function inList(list, name) {
  const n = name.trim().toLowerCase();
  return list.some((p) => {
    const q = p.trim().toLowerCase();
    return q === n || q.includes(n) || n.includes(q);
  });
}

function renderProduceGroup(sectionEl, chipsEl, items, pick, featured) {
  chipsEl.innerHTML = "";
  sectionEl.hidden = items.length === 0;
  for (const item of items) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = item;
    if (inList(pick, item)) {
      chip.classList.add("pick");
      chip.textContent = `★ ${item}`;
      chip.title = "Pick of the week";
    } else if (inList(featured, item)) {
      chip.classList.add("featured");
      chip.title = "Featured this week";
    }
    chipsEl.appendChild(chip);
  }
}

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

window.addEventListener("DOMContentLoaded", () => {
  const toolbarEl = document.getElementById("toolbar");
  const fetchBtn = document.getElementById("fetch-btn");
  const matchBtn = document.getElementById("match-btn");
  const cancelBtn = document.getElementById("cancel-btn");
  const statusEl = document.getElementById("status");
  const spinnerEl = document.getElementById("spinner");
  const placeholderEl = document.getElementById("placeholder");
  const resultsEl = document.getElementById("results");
  const feedTitleEl = document.getElementById("feed-title");
  const feedLinkEl = document.getElementById("feed-link");
  const articleViewEl = document.getElementById("article-view");
  const articleEl = document.getElementById("article");
  const articleBackEl = document.getElementById("article-back");
  const fruitSection = document.getElementById("fruit-section");
  const fruitChipsEl = document.getElementById("fruit-chips");
  const vegetableSection = document.getElementById("vegetable-section");
  const vegetableChipsEl = document.getElementById("vegetable-chips");

  let feedTitle = "";
  let feedLink = "";
  let feedHtml = "";
  let fruit = [];
  let vegetable = [];

  toolbarEl.addEventListener("mousedown", (e) => {
    if (e.target === toolbarEl && e.button === 0) {
      getCurrentWindow().startDragging();
    }
  });

  function showArticle(show) {
    articleViewEl.hidden = !show;
    resultsEl.hidden = show;
    placeholderEl.hidden = show || resultsEl.children.length > 0;
  }

  listen("status", (event) => {
    statusEl.textContent = event.payload;
  });

  listen("produce", (event) => {
    const { fruit, vegetable, pick = [], featured = [] } = event.payload;
    renderProduceGroup(fruitSection, fruitChipsEl, fruit, pick, featured);
    renderProduceGroup(vegetableSection, vegetableChipsEl, vegetable, pick, featured);
  });

  listen("suggestion-line", (event) => {
    renderLine(resultsEl, event.payload);
  });

  async function runStep(fn) {
    fetchBtn.disabled = true;
    matchBtn.disabled = true;
    cancelBtn.hidden = false;
    spinnerEl.hidden = false;
    try {
      await fn();
    } catch (err) {
      statusEl.textContent = err === "cancelled" ? "Cancelled." : `Error: ${err}`;
    } finally {
      fetchBtn.disabled = false;
      matchBtn.disabled = fruit.length === 0 && vegetable.length === 0;
      cancelBtn.hidden = true;
      spinnerEl.hidden = true;
    }
  }

  fetchBtn.addEventListener("click", () => {
    runStep(async () => {
      resultsEl.innerHTML = "";
      showArticle(false);
      fruitSection.hidden = true;
      vegetableSection.hidden = true;
      feedTitleEl.hidden = true;
      feedLinkEl.hidden = true;
      const result = await invoke("fetch_produce");
      feedTitle = result.feed_title;
      feedLink = result.feed_link;
      feedHtml = result.feed_html;
      fruit = result.fruit;
      vegetable = result.vegetable;
      feedTitleEl.textContent = feedTitle;
      feedTitleEl.hidden = !feedTitle;
      feedLinkEl.hidden = !feedHtml;
    });
  });

  matchBtn.addEventListener("click", () => {
    runStep(async () => {
      resultsEl.innerHTML = "";
      showArticle(false);
      placeholderEl.hidden = true;
      await invoke("match_recipes", { feedTitle, fruit, vegetable });
    });
  });

  cancelBtn.addEventListener("click", () => {
    invoke("cancel");
  });

  feedLinkEl.addEventListener("click", (e) => {
    e.preventDefault();
    articleEl.innerHTML = "";
    articleEl.append(...sanitizeArticle(feedHtml).childNodes);
    showArticle(true);
  });

  articleBackEl.addEventListener("click", (e) => {
    e.preventDefault();
    showArticle(false);
  });

  // Links inside the article open in the real browser.
  articleEl.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    e.preventDefault();
    if (a.href.startsWith("http")) invoke("open_url", { url: a.href });
  });
});
