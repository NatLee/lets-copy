// Let's Copy — background service worker.
//
// Responsibilities:
//   - Persist the list of hosts where copy-unlock is enabled, and the per-site
//     options (OPTIONS).
//   - Inject enable.js into the active tab when the user toggles ON.
//   - Dynamically register MAIN-world, document_start content scripts for the
//     enabled hosts so that capture-phase event blockers run BEFORE the page's
//     own anti-copy handlers register. This is what fixes right-click locking.
//   - Keep the toolbar icon/badge in sync with the current tab's state.

const STORAGE_KEYS = { hosts: "enabledHosts", alwaysOn: "alwaysOn" };
// Every content script this worker registers has an ID starting with this.
const DYNAMIC_SCRIPT_ID = "letscopy-autoinject";
// The page-side unlock, injected in the page's own JavaScript world.
const UNLOCK_SCRIPT = "enable.js";

// Per-site options. Each one is off until it is switched on for a site in the
// popup, and enable.js reads it from globalThis.__letsCopyOptions. Registered
// (document_start) content scripts can only be files, so `script` is a
// one-line file that turns the option on ahead of enable.js; everywhere else
// the worker hands the page its options directly (setPageOptions).
const OPTIONS = {
  // Keep the page from seeing Ctrl+C / ⌘C, for sites that cancel the shortcut.
  copyShortcut: { storageKey: "copyShortcutHosts", script: "options/copy-shortcut.js" },
};
const OPTION_NAMES = Object.keys(OPTIONS);

// Toolbar look per state. The icons come from the manifest: the extension's
// own icons (check mark) mean "on", the action's default icons (the greyed
// copy symbol it starts with) mean "off".
const MANIFEST = chrome.runtime.getManifest();
const TOOLBAR_ICONS = { on: MANIFEST.icons, off: MANIFEST.action.default_icon };
const BADGE = { text: "ON", color: "#10b981" };
// Pages Let's Copy can work on: the schemes the "*://host/*" match patterns cover.
const UNLOCKABLE_PROTOCOLS = new Set(["http:", "https:"]);

const state = {
  enabledHosts: new Set(),
  alwaysOn: false,
  // option name -> hosts that have it on
  options: Object.fromEntries(OPTION_NAMES.map((name) => [name, new Set()])),
};

async function loadState() {
  const optionKeys = OPTION_NAMES.map((name) => OPTIONS[name].storageKey);
  const stored = await chrome.storage.local.get([STORAGE_KEYS.hosts, STORAGE_KEYS.alwaysOn, ...optionKeys]);
  state.enabledHosts = new Set(stored[STORAGE_KEYS.hosts] || []);
  state.alwaysOn = !!stored[STORAGE_KEYS.alwaysOn];
  for (const name of OPTION_NAMES) state.options[name] = new Set(stored[OPTIONS[name].storageKey] || []);
  await syncDynamicScripts();
}

async function saveState() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.hosts]: [...state.enabledHosts],
    [STORAGE_KEYS.alwaysOn]: state.alwaysOn,
    ...Object.fromEntries(OPTION_NAMES.map((name) => [OPTIONS[name].storageKey, [...state.options[name]]])),
  });
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return UNLOCKABLE_PROTOCOLS.has(u.protocol) ? u.hostname : null;
  } catch {
    return null;
  }
}

function isEnabledFor(host) {
  return !!host && (state.alwaysOn || state.enabledHosts.has(host));
}

// Whether the per-site switch (popup) and the shortcut can change this site.
// Not while Always on is set: it has no per-site exceptions, so "switching a
// site off" would only reload the page and leave it unlocked.
function canToggle(host) {
  return !!host && !state.alwaysOn;
}

/** The options switched on for `host`, e.g. ["copyShortcut"]. */
const optionsOn = (host) => OPTION_NAMES.filter((name) => state.options[name].has(host));
/** Every option for `host` as true/false, e.g. { copyShortcut: false }. */
const optionValues = (host) => Object.fromEntries(OPTION_NAMES.map((name) => [name, state.options[name].has(host)]));

const matchPattern = (host) => `*://${host}/*`;

function contentScript(optionNames, matches, excludeMatches = []) {
  return {
    id: [DYNAMIC_SCRIPT_ID, ...optionNames].join("-"),
    matches,
    ...(excludeMatches.length ? { excludeMatches } : {}),
    js: [...optionNames.map((name) => OPTIONS[name].script), UNLOCK_SCRIPT],
    runAt: "document_start",
    world: "MAIN",
    allFrames: true,
    persistAcrossSessions: true,
  };
}

// The content scripts that should be registered for the current state: they
// run at document_start, before the page's own scripts. Sites are grouped by
// the options they have on, one registration per group. With Always on, one
// registration covers every site except those that have options.
function wantedScripts() {
  const groups = new Map(); // "copyShortcut" (or "") -> { names, hosts }
  const unlocked = state.alwaysOn
    ? new Set(OPTION_NAMES.flatMap((name) => [...state.options[name]]))
    : state.enabledHosts;
  for (const host of unlocked) {
    const names = optionsOn(host);
    const key = names.join("+");
    if (!groups.has(key)) groups.set(key, { names, hosts: [] });
    groups.get(key).hosts.push(host);
  }
  const scripts = [];
  if (state.alwaysOn) {
    const withOptions = [...groups.values()].flatMap((g) => g.hosts);
    scripts.push(contentScript([], ["<all_urls>"], withOptions.map(matchPattern)));
  }
  for (const { names, hosts } of groups.values()) scripts.push(contentScript(names, hosts.map(matchPattern)));
  return scripts;
}

// Replace our registrations with wantedScripts(). Calls are queued: the worker
// can load its state from several events at once (start-up, install), and two
// overlapping syncs would register the same ID twice.
let syncQueue = Promise.resolve();
function syncDynamicScripts() {
  syncQueue = syncQueue.then(async () => {
    const ours = (await chrome.scripting.getRegisteredContentScripts())
      .map((s) => s.id)
      .filter((id) => id.startsWith(DYNAMIC_SCRIPT_ID));
    if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
    const wanted = wantedScripts();
    if (wanted.length) await chrome.scripting.registerContentScripts(wanted);
  }).catch((err) => console.warn("[Let's Copy] could not update the content scripts:", err));
  return syncQueue;
}

// Runs in the page (MAIN world) through executeScript; must be self-contained.
function setPageOptions(options) {
  Object.assign((globalThis.__letsCopyOptions ||= {}), options);
}

async function inject(tabId, injection) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", injectImmediately: true, ...injection });
  } catch (err) {
    // Common cases: chrome:// pages, web store, a tab that just closed.
    console.debug("[Let's Copy] executeScript skipped:", err?.message);
  }
}

// Unlock a page that is already open: its options first, then the unlock.
async function injectNow(tabId, host) {
  await inject(tabId, { func: setPageOptions, args: [optionValues(host)] });
  await inject(tabId, { files: [UNLOCK_SCRIPT] });
}

async function updateActionUI(tabId, host) {
  const on = isEnabledFor(host);
  try {
    await chrome.action.setIcon({ tabId, path: on ? TOOLBAR_ICONS.on : TOOLBAR_ICONS.off });
    await chrome.action.setBadgeText({ tabId, text: on ? BADGE.text : "" });
    if (on) await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.color });
  } catch {
    // The tab was closed or navigated away while we were updating it.
  }
}

async function enableHost(host) {
  if (!host) return;
  state.enabledHosts.add(host);
  await saveState();
  await syncDynamicScripts();
}

// Removing a site forgets its options too.
async function disableHost(host) {
  if (!host) return;
  state.enabledHosts.delete(host);
  for (const name of OPTION_NAMES) state.options[name].delete(host);
  await saveState();
  await syncDynamicScripts();
}

// Switch an option for a site. Open tabs of that site get the change at
// once; later visits get it from the registered scripts.
async function setOption(host, name, value) {
  if (!host || !OPTIONS[name]) return false;
  if (value) state.options[name].add(host);
  else state.options[name].delete(host);
  await saveState();
  await syncDynamicScripts();
  if (isEnabledFor(host)) {
    for (const tab of await chrome.tabs.query({ url: matchPattern(host) })) {
      await inject(tab.id, { func: setPageOptions, args: [{ [name]: !!value }] });
    }
  }
  return true;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function toggleCurrentTab() {
  const tab = await getActiveTab();
  const host = tab ? hostOf(tab.url) : null;
  if (!canToggle(host)) return;
  if (isEnabledFor(host)) {
    await disableHost(host);
    await chrome.tabs.reload(tab.id);
  } else {
    await enableHost(host);
    await injectNow(tab.id, host);
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
          canToggle: canToggle(host),
          options: host ? optionValues(host) : {},
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
          if (hostOf(tab.url) === msg.host) await injectNow(tab.id, msg.host);
        }
        sendResponse({ ok: true });
        break;
      }
      case "setOption": {
        const ok = await setOption(msg.host, msg.name, msg.value);
        sendResponse(ok ? { ok: true } : { ok: false, error: "unknown option or site" });
        break;
      }
      case "setAlwaysOn": {
        state.alwaysOn = !!msg.value;
        await saveState();
        await syncDynamicScripts();
        const tab = await getActiveTab();
        if (tab) {
          const host = hostOf(tab.url);
          await updateActionUI(tab.id, host);
          if (state.alwaysOn) await injectNow(tab.id, host);
        }
        sendResponse({ ok: true });
        break;
      }
      case "clearAll": {
        state.enabledHosts.clear();
        state.alwaysOn = false;
        for (const name of OPTION_NAMES) state.options[name].clear();
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
