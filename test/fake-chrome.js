// Runs src/background.js in a Node vm against a small in-memory stand-in for
// the chrome.* APIs it uses, so its behaviour can be tested without a browser.
// The fakes keep Chrome's rules that matter here: unregistering an unknown
// content-script ID throws, and registering a duplicate ID throws.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const code = readFileSync(path.join(src, "background.js"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(src, "manifest.json"), "utf8"));

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function loadBackground({ stored = {}, tabs } = {}) {
    const storage = clone(stored);
    const openTabs = tabs || [
        { id: 1, url: "https://example.com/post/1", favIconUrl: "https://example.com/favicon.ico", active: true },
    ];
    const registered = new Map();
    const log = { executeScript: [], reload: [], icon: [], badge: [], warnings: [] };
    const listeners = { message: [], command: [], installed: [], startup: [], activated: [], updated: [] };
    const event = (name) => ({ addListener: (fn) => listeners[name].push(fn) });

    const chrome = {
        storage: {
            local: {
                async get(keys) {
                    const out = {};
                    for (const k of [].concat(keys)) if (k in storage) out[k] = clone(storage[k]);
                    return out;
                },
                async set(obj) {
                    Object.assign(storage, clone(obj));
                },
            },
        },
        scripting: {
            async registerContentScripts(list) {
                for (const s of list) {
                    if (registered.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
                    registered.set(s.id, clone(s));
                }
            },
            async unregisterContentScripts({ ids }) {
                for (const id of ids) {
                    if (!registered.has(id)) throw new Error(`Nonexistent script ID '${id}'`);
                    registered.delete(id);
                }
            },
            async getRegisteredContentScripts() {
                return [...registered.values()].map(clone);
            },
            async executeScript(opts) {
                log.executeScript.push(clone(opts));
                return [];
            },
        },
        action: {
            async setIcon(o) { log.icon.push(clone(o)); },
            async setBadgeText(o) { log.badge.push(clone(o)); },
            async setBadgeBackgroundColor() {},
        },
        tabs: {
            async query() { return openTabs.filter((t) => t.active).map(clone); },
            async get(id) { return clone(openTabs.find((t) => t.id === id)); },
            async reload(id) { log.reload.push(id); },
            onActivated: event("activated"),
            onUpdated: event("updated"),
        },
        runtime: {
            onInstalled: event("installed"),
            onStartup: event("startup"),
            onMessage: event("message"),
            getManifest: () => clone(manifest),
        },
        commands: { onCommand: event("command") },
    };

    const quiet = {
        log() {}, debug() {}, info() {},
        warn: (...a) => log.warnings.push(a.join(" ")),
        error: (...a) => log.warnings.push(a.join(" ")),
    };
    const ctx = vm.createContext({ chrome, console: quiet, URL, setTimeout, clearTimeout });
    vm.runInContext(code, ctx, { filename: "background.js" });

    return {
        storage,
        registered,
        log,
        tabs: openTabs,
        /** Resolves once the worker has loaded its saved state. */
        ready: () => vm.runInContext("ready", ctx),
        /** Send a message the way the popup does and wait for the reply. */
        send: (msg) =>
            new Promise((resolve) => {
                listeners.message[0](msg, { id: "test" }, (r) => resolve(clone(r)));
            }),
        /** Fire a keyboard command (chrome.commands). */
        command: (name) => Promise.all(listeners.command.map((fn) => fn(name))),
        /** Fire chrome.tabs.onUpdated. */
        tabUpdated: (tabId, changeInfo, tab) => Promise.all(listeners.updated.map((fn) => fn(tabId, changeInfo, tab))),
        /** Matches of the one dynamic content script, or [] when none is registered. */
        matches: () => [...registered.values()].flatMap((s) => s.matches),
    };
}
