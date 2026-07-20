const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

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

window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("suggest-form");
  const feedUrlInput = document.getElementById("feed-url");
  const suggestBtn = document.getElementById("suggest-btn");
  const statusEl = document.getElementById("status");
  const resultsEl = document.getElementById("results");

  listen("status", (event) => {
    statusEl.textContent = event.payload;
  });

  listen("suggestion-line", (event) => {
    renderLine(resultsEl, event.payload);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    resultsEl.innerHTML = "";
    statusEl.textContent = "";
    suggestBtn.disabled = true;
    try {
      await invoke("suggest", { feedUrl: feedUrlInput.value });
    } catch (err) {
      statusEl.textContent = `Error: ${err}`;
    } finally {
      suggestBtn.disabled = false;
    }
  });
});
