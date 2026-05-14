// Let's Copy — background service worker.
//
// Responsibilities:
//   - Persist the list of hosts where copy-unlock is enabled.
//   - Inject enable.js into the active tab when the user toggles ON.
//   - Dynamically register a MAIN-world, document_start content script for each
//     enabled host so that capture-phase event blockers run BEFORE the page's
//     own anti-copy handlers register. This is what fixes right-click locking.
//   - Keep the toolbar icon/badge in sync with the current tab's state.

const STORAGE_KEYS = { hosts: "enabledHosts", alwaysOn: "alwaysOn" };
const DYNAMIC_SCRIPT_ID = "letscopy-autoinject";

const state = {
  enabledHosts: new Set(),
  alwaysOn: false,
};

async function loadState() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.hosts, STORAGE_KEYS.alwaysOn]);
  state.enabledHosts = new Set(stored[STORAGE_KEYS.hosts] || []);
  state.alwaysOn = !!stored[STORAGE_KEYS.alwaysOn];
  await syncDynamicScripts();
}

async function saveState() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.hosts]: [...state.enabledHosts],
    [STORAGE_KEYS.alwaysOn]: state.alwaysOn,
  });
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol.startsWith("http") ? u.hostname : null;
  } catch {
    return null;
  }
}

function isEnabledFor(host) {
  return !!host && (state.alwaysOn || state.enabledHosts.has(host));
}

async function syncDynamicScripts() {
  // Remove the previous registration (ignore "not found" errors).
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
  } catch {}

  const matches = state.alwaysOn
    ? ["<all_urls>"]
    : [...state.enabledHosts].map(h => `*://${h}/*`);

  if (matches.length === 0) return;

  try {
    await chrome.scripting.registerContentScripts([{
      id: DYNAMIC_SCRIPT_ID,
      matches,
      js: ["enable.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
      persistAcrossSessions: true,
    }]);
  } catch (err) {
    console.warn("[Let's Copy] registerContentScripts failed:", err);
  }
}

async function injectNow(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["enable.js"],
      world: "MAIN",
      injectImmediately: true,
    });
  } catch (err) {
    // Common cases: chrome:// pages, web store, etc. — silently ignore.
    console.debug("[Let's Copy] executeScript skipped:", err?.message);
  }
}

async function updateActionUI(tabId, host) {
  const on = isEnabledFor(host);
  try {
    await chrome.action.setIcon({
      tabId,
      path: on
        ? { 24: "icons/icon24.png", 32: "icons/icon32.png", 128: "icons/icon128.png" }
        : { 24: "icons/icon24-disable.png", 32: "icons/icon32-disable.png", 128: "icons/icon128-disable.png" },
    });
    await chrome.action.setBadgeText({ tabId, text: on ? "ON" : "" });
    if (on) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#10b981" });
    }
  } catch {}
}

async function enableHost(host) {
  if (!host) return;
  state.enabledHosts.add(host);
  await saveState();
  await syncDynamicScripts();
}

async function disableHost(host) {
  if (!host) return;
  state.enabledHosts.delete(host);
  await saveState();
  await syncDynamicScripts();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function toggleCurrentTab() {
  const tab = await getActiveTab();
  if (!tab) return;
  const host = hostOf(tab.url);
  if (!host) return;
  if (isEnabledFor(host)) {
    await disableHost(host);
    await chrome.tabs.reload(tab.id);
  } else {
    await enableHost(host);
    await injectNow(tab.id);
  }
  await updateActionUI(tab.id, host);
}

// ── Listeners ───────────────────────────────────────────────────────────────

// Service workers can wake up any time and listeners may fire before
// loadState() resolves. Gate every handler on this promise so they never read
// an empty in-memory `state` (which would mis-render badges or drop hosts).
const ready = loadState();
chrome.runtime.onInstalled.addListener(loadState);
chrome.runtime.onStartup.addListener(loadState);

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await ready;
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateActionUI(tabId, hostOf(tab.url));
  } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading" && changeInfo.status !== "complete") return;
  await ready;
  await updateActionUI(tabId, hostOf(tab.url));
});

chrome.commands.onCommand.addListener(async (command) => {
  await ready;
  if (command === "toggle-current-site") await toggleCurrentTab();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    await ready;
    switch (msg?.type) {
      case "getState": {
        const tab = await getActiveTab();
        const host = tab ? hostOf(tab.url) : null;
        sendResponse({
          host,
          tabId: tab?.id ?? null,
          favicon: tab?.favIconUrl || null,
          enabledHosts: [...state.enabledHosts].sort(),
          alwaysOn: state.alwaysOn,
          currentEnabled: isEnabledFor(host),
          injectable: !!host,
        });
        break;
      }
      case "toggleCurrent": {
        await toggleCurrentTab();
        sendResponse({ ok: true });
        break;
      }
      case "disableHost": {
        await disableHost(msg.host);
        const tab = await getActiveTab();
        if (tab) await updateActionUI(tab.id, hostOf(tab.url));
        sendResponse({ ok: true });
        break;
      }
      case "enableHost": {
        await enableHost(msg.host);
        const tab = await getActiveTab();
        if (tab) {
          await updateActionUI(tab.id, hostOf(tab.url));
          if (hostOf(tab.url) === msg.host) await injectNow(tab.id);
        }
        sendResponse({ ok: true });
        break;
      }
      case "setAlwaysOn": {
        state.alwaysOn = !!msg.value;
        await saveState();
        await syncDynamicScripts();
        const tab = await getActiveTab();
        if (tab) {
          await updateActionUI(tab.id, hostOf(tab.url));
          if (state.alwaysOn) await injectNow(tab.id);
        }
        sendResponse({ ok: true });
        break;
      }
      case "clearAll": {
        state.enabledHosts.clear();
        state.alwaysOn = false;
        await saveState();
        await syncDynamicScripts();
        const tab = await getActiveTab();
        if (tab) await updateActionUI(tab.id, hostOf(tab.url));
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true; // keep the response channel open for the async work above
});
