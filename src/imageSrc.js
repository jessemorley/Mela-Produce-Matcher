const { convertFileSrc } = window.__TAURI__.core;

// `recipe.image` is an absolute path on disk (the full-resolution original
// copied out of Mela at sync time), not a data: URI — so every <img> has to
// route it through Tauri's asset protocol to get a URL the webview will load.
// Kept in one place because a raw path in a src="" fails silently: the webview
// treats it as a relative URL, gets a 404, and renders an empty box that looks
// exactly like "this recipe has no photo".
export function imageSrc(path) {
  return path ? convertFileSrc(path) : "";
}
