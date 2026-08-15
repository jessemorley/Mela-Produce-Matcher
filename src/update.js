// The updater plugin's own JS wrapper is an ES module that imports from
// `@tauri-apps/api`, which this app doesn't depend on — it runs on
// `withGlobalTauri` globals instead. Its `check`/`downloadAndInstall` are
// thin wrappers over these two IPC commands, so we call them directly and
// skip the dependency.
// Read per-call, not destructured at module scope: update.test.js imports
// this file under plain node, where there's no window at all.
const tauri = () => window.__TAURI__.core;

// Resolves to the update metadata ({ rid, version, ... }) or null when the
// running version is already current. A dead network / missing release is a
// rejection, not a null — callers decide whether that's worth surfacing.
export function checkForUpdate() {
  return tauri().invoke("plugin:updater|check", {});
}

// Folds the plugin's download events into a 0..1 fraction. Split out from
// installUpdate (which can't run outside a webview) so it's directly
// testable — see update.test.js. Returns null when the server sent no
// content-length: there's no fraction to report, and `received/0` is NaN,
// which renders as "NaN%".
export function downloadProgress() {
  let received = 0;
  let total = 0;

  return ({ event, data }) => {
    if (event === "Started") total = data?.contentLength ?? 0;
    else if (event === "Progress") received += data?.chunkLength ?? 0;
    return total ? Math.min(1, received / total) : null;
  };
}

// ponytail: no resume, no retry — a failed download just re-offers the
// update on the next launch. Add retry when a real user hits a flaky one.
export function installUpdate(rid, onProgress) {
  const { invoke, Channel } = tauri();
  const onEvent = new Channel();
  const track = downloadProgress();

  onEvent.onmessage = (msg) => onProgress?.(track(msg));

  // Relaunches the app itself on success, so nothing after this resolves.
  return invoke("plugin:updater|download_and_install", { rid, onEvent });
}
