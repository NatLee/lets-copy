// Let's Copy — popup UI.

const els = {
  hero: document.getElementById("hero"),
  favicon: document.getElementById("favicon"),
  hostname: document.getElementById("hostname"),
  stateLabel: document.getElementById("state-label"),
  toggle: document.getElementById("toggle"),
  reload: document.getElementById("reload-btn"),
  alwaysOn: document.getElementById("always-on"),
  sitesList: document.getElementById("sites-list"),
  sitesCard: document.querySelector(".sites-card"),
  count: document.getElementById("count"),
  clearAll: document.getElementById("clear-all"),
  version: document.getElementById("version"),
};

const FALLBACK_FAVICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23818cf8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10'/><line x1='2' y1='12' x2='22' y2='12'/><path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'/></svg>`
  );

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

function render(state) {
  // Version in footer.
  if (els.version && !els.version.dataset.set) {
    els.version.textContent = "v" + chrome.runtime.getManifest().version;
    els.version.dataset.set = "1";
  }

  // Hero — current site
  const host = state.host;
  if (host) {
    els.hostname.textContent = host;
    els.favicon.src = state.favicon || `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
    els.favicon.onerror = () => { els.favicon.src = FALLBACK_FAVICON; };
    els.toggle.checked = !!state.currentEnabled;
    // When Always-on is engaged, the per-site toggle is conceptually pinned —
    // disabling it would only delete from the host list while always-on keeps
    // unlocking. Lock the control and explain why.
    els.toggle.disabled = !!state.alwaysOn;
    els.toggle.title = state.alwaysOn ? "Turn off Always-on to manage this site individually" : "Toggle for this site";
    if (state.currentEnabled) {
      els.hero.dataset.state = "on";
      els.stateLabel.textContent = state.alwaysOn ? "Unlocked via Always-on" : "Copy unlocked on this site";
    } else {
      els.hero.dataset.state = "off";
      els.stateLabel.textContent = "Disabled on this site";
    }
  } else {
    els.hostname.textContent = "Not a web page";
    els.favicon.src = FALLBACK_FAVICON;
    els.toggle.checked = false;
    els.toggle.disabled = true;
    els.toggle.title = "";
    els.hero.dataset.state = "unsupported";
    els.stateLabel.textContent = "Open an http(s) page to use Let's Copy";
  }

  // Always on
  els.alwaysOn.checked = !!state.alwaysOn;

  // Active sites list — build with DOM APIs so hostnames (which may include
  // IDN / punycode characters) can't accidentally inject markup.
  const hosts = state.enabledHosts || [];
  els.count.textContent = hosts.length;
  els.sitesCard.dataset.empty = hosts.length === 0 ? "true" : "false";
  els.sitesList.replaceChildren();
  for (const h of hosts) {
    const li = document.createElement("li");
    li.className = "site-item fade-in";

    const dot = document.createElement("span");
    dot.className = "site-dot";

    const label = document.createElement("span");
    label.className = "site-host";
    label.textContent = h;
    label.title = h;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "site-remove";
    remove.dataset.host = h;
    remove.title = `Remove ${h}`;
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="18" y1="6" x2="6" y2="18"></line>' +
      '<line x1="6" y1="6" x2="18" y2="18"></line>' +
      "</svg>";

    li.append(dot, label, remove);
    els.sitesList.appendChild(li);
  }
}

async function refresh() {
  const state = await send({ type: "getState" });
  if (state) render(state);
}

// ── Wire up handlers ────────────────────────────────────────────────────────

els.toggle.addEventListener("change", async () => {
  await send({ type: "toggleCurrent" });
  await refresh();
});

els.alwaysOn.addEventListener("change", async (e) => {
  await send({ type: "setAlwaysOn", value: e.target.checked });
  await refresh();
});

// Reload the active tab — on-demand injection can't undo a page-script that
// already registered a capture-phase contextmenu blocker, but a reload lets
// the dynamic content script run at document_start and beat it cleanly.
els.reload.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) {
      await chrome.tabs.reload(tab.id);
      window.close();
    }
  } catch {}
});

els.sitesList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".site-remove");
  if (!btn) return;
  await send({ type: "disableHost", host: btn.dataset.host });
  await refresh();
});

// Two-step confirmation — window.confirm() would close the popup in some
// Chrome builds, so we inline a "click again to confirm" pattern instead.
let clearAllArmed = false;
let clearAllTimer = null;
const CLEAR_ALL_LABEL = els.clearAll.textContent;

const disarmClearAll = () => {
  clearAllArmed = false;
  els.clearAll.classList.remove("armed");
  els.clearAll.textContent = CLEAR_ALL_LABEL;
  if (clearAllTimer) { clearTimeout(clearAllTimer); clearAllTimer = null; }
};

els.clearAll.addEventListener("click", async () => {
  const state = await send({ type: "getState" });
  if (!state) return;
  if ((state.enabledHosts?.length || 0) === 0 && !state.alwaysOn) return;

  if (!clearAllArmed) {
    clearAllArmed = true;
    els.clearAll.classList.add("armed");
    els.clearAll.textContent = "Click again to confirm";
    clearAllTimer = setTimeout(disarmClearAll, 3000);
    return;
  }
  disarmClearAll();
  await send({ type: "clearAll" });
  await refresh();
});

// Hide GitHub link if we don't have a real URL configured.
document.getElementById("repo-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  // Best-effort — open extension's homepage if defined in the manifest.
  const manifest = chrome.runtime.getManifest();
  const url = manifest.homepage_url || "https://github.com/";
  chrome.tabs.create({ url });
});

refresh();
