import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadBackground } from "./fake-chrome.js";

const lastBadge = (bg) => bg.log.badge.at(-1);

test("switching a site on saves it, registers an early unlock script and unlocks the open page", async () => {
    const bg = loadBackground();
    await bg.ready();
    assert.deepEqual(await bg.send({ type: "toggleCurrent" }), { ok: true });

    assert.deepEqual(bg.storage.enabledHosts, ["example.com"]);
    const [script] = bg.registered.values();
    assert.deepEqual(script.matches, ["*://example.com/*"]);
    assert.equal(script.runAt, "document_start");
    assert.equal(script.world, "MAIN");
    assert.equal(script.allFrames, true);
    assert.deepEqual(script.js, ["enable.js"]);

    // The page that is already open is unlocked right away, without a reload.
    assert.equal(bg.log.executeScript.length, 1);
    assert.deepEqual(bg.log.executeScript[0].target, { tabId: 1, allFrames: true });
    assert.equal(bg.log.executeScript[0].world, "MAIN");
    assert.deepEqual(bg.log.reload, []);
    assert.deepEqual(lastBadge(bg), { tabId: 1, text: "ON" });
});

test("switching it off forgets the site and reloads the page so its own rules apply again", async () => {
    const bg = loadBackground({ stored: { enabledHosts: ["example.com"], alwaysOn: false } });
    await bg.ready();
    await bg.send({ type: "toggleCurrent" });

    assert.deepEqual(bg.storage.enabledHosts, []);
    assert.deepEqual(bg.matches(), []);
    assert.deepEqual(bg.log.reload, [1]);
    assert.deepEqual(lastBadge(bg), { tabId: 1, text: "" });
});

test("getState describes the current tab for the popup", async () => {
    const bg = loadBackground({ stored: { enabledHosts: ["zeta.org", "example.com"] } });
    await bg.ready();
    assert.deepEqual(await bg.send({ type: "getState" }), {
        host: "example.com",
        tabId: 1,
        favicon: "https://example.com/favicon.ico",
        enabledHosts: ["example.com", "zeta.org"],
        alwaysOn: false,
        currentEnabled: true,
        injectable: true,
        canToggle: true,
    });
});

test("pages that aren't http(s) can't be switched on", async () => {
    const bg = loadBackground({ tabs: [{ id: 7, url: "chrome://extensions/", active: true }] });
    await bg.ready();
    const state = await bg.send({ type: "getState" });
    assert.equal(state.host, null);
    assert.equal(state.injectable, false);
    assert.equal(state.canToggle, false);

    await bg.send({ type: "toggleCurrent" });
    assert.equal(bg.storage.enabledHosts, undefined);
    assert.deepEqual(bg.log.executeScript, []);
    assert.deepEqual(bg.log.reload, []);
});

test("Always on registers one script for every site and unlocks the open page", async () => {
    const bg = loadBackground();
    await bg.ready();
    await bg.send({ type: "setAlwaysOn", value: true });

    assert.equal(bg.storage.alwaysOn, true);
    assert.deepEqual(bg.matches(), ["<all_urls>"]);
    assert.equal(bg.log.executeScript.length, 1);
    const state = await bg.send({ type: "getState" });
    assert.equal(state.currentEnabled, true);
});

// Regression: in Always-on mode the shortcut "switched off" a site that was
// never in the list, so it reloaded the page (losing anything typed into it)
// and the site stayed unlocked anyway.
test("the keyboard shortcut does nothing while Always on is set", async () => {
    const bg = loadBackground({ stored: { enabledHosts: [], alwaysOn: true } });
    await bg.ready();
    await bg.command("toggle-current-site");

    assert.deepEqual(bg.log.reload, []);
    assert.deepEqual(bg.storage.enabledHosts, []);
    assert.deepEqual(bg.matches(), ["<all_urls>"]);
    // ...and the popup is told the same, from the same rule.
    assert.equal((await bg.send({ type: "getState" })).canToggle, false);
});

test("only http and https pages can be switched on", async () => {
    for (const url of ["file:///C:/notes.html", "ftp://example.com/", "chrome-extension://abc/popup.html", "about:blank"]) {
        const bg = loadBackground({ tabs: [{ id: 3, url, active: true }] });
        await bg.ready();
        assert.equal((await bg.send({ type: "getState" })).canToggle, false, url);
    }
});

test("the keyboard shortcut toggles the current site", async () => {
    const bg = loadBackground();
    await bg.ready();
    await bg.command("toggle-current-site");
    assert.deepEqual(bg.storage.enabledHosts, ["example.com"]);
    await bg.command("toggle-current-site");
    assert.deepEqual(bg.storage.enabledHosts, []);
    assert.deepEqual(bg.log.reload, [1]);
});

test("saved sites come back when the service worker restarts", async () => {
    const bg = loadBackground({ stored: { enabledHosts: ["a.example", "b.example"], alwaysOn: false } });
    await bg.ready();
    assert.deepEqual(bg.matches(), ["*://a.example/*", "*://b.example/*"]);
    assert.deepEqual(bg.log.warnings, []);
});

// Before: each sync unregistered inside an empty catch and then registered,
// so overlapping syncs could both register the same ID.
test("overlapping start-up syncs leave exactly one registration and no errors", async () => {
    const bg = loadBackground({ stored: { enabledHosts: ["a.example"], alwaysOn: false } });
    await Promise.all([bg.ready(), bg.startup(), bg.startup()]);
    assert.equal(bg.registered.size, 1);
    assert.deepEqual(bg.matches(), ["*://a.example/*"]);
    assert.deepEqual(bg.log.warnings, []);
});

test("removing a site from the list stops it from being unlocked", async () => {
    const bg = loadBackground({ stored: { enabledHosts: ["a.example", "example.com"] } });
    await bg.ready();
    await bg.send({ type: "disableHost", host: "a.example" });
    assert.deepEqual(bg.storage.enabledHosts, ["example.com"]);
    assert.deepEqual(bg.matches(), ["*://example.com/*"]);
});

test("adding a site unlocks the open page only when it is that site", async () => {
    const bg = loadBackground();
    await bg.ready();
    await bg.send({ type: "enableHost", host: "other.example" });
    assert.deepEqual(bg.log.executeScript, []);
    await bg.send({ type: "enableHost", host: "example.com" });
    assert.equal(bg.log.executeScript.length, 1);
    assert.deepEqual(bg.matches(), ["*://other.example/*", "*://example.com/*"]);
});

test("Clear all turns Always on off and forgets every site", async () => {
    const bg = loadBackground({ stored: { enabledHosts: ["a.example", "example.com"], alwaysOn: true } });
    await bg.ready();
    await bg.send({ type: "clearAll" });
    assert.deepEqual(bg.storage, { enabledHosts: [], alwaysOn: false });
    assert.deepEqual(bg.matches(), []);
});

test("the toolbar uses the manifest's icons: its own icons for on, the action's for off", async () => {
    const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
    const bg = loadBackground({ stored: { enabledHosts: ["example.com"] } });
    await bg.ready();
    await bg.tabUpdated(1, { status: "complete" }, { id: 1, url: "https://example.com/" });
    assert.deepEqual(bg.log.icon.at(-1).path, manifest.icons);
    await bg.tabUpdated(2, { status: "complete" }, { id: 2, url: "https://elsewhere.example/" });
    assert.deepEqual(bg.log.icon.at(-1).path, manifest.action.default_icon);
});

test("the toolbar icon follows the tab's site", async () => {
    const bg = loadBackground({ stored: { enabledHosts: ["example.com"] } });
    await bg.ready();
    await bg.tabUpdated(1, { status: "complete" }, { id: 1, url: "https://example.com/" });
    assert.match(JSON.stringify(bg.log.icon.at(-1).path), /icon24\.png/);
    await bg.tabUpdated(2, { status: "complete" }, { id: 2, url: "https://elsewhere.example/" });
    assert.match(JSON.stringify(bg.log.icon.at(-1).path), /icon24-disable\.png/);
    assert.deepEqual(lastBadge(bg), { tabId: 2, text: "" });
});

test("unknown messages get an error reply", async () => {
    const bg = loadBackground();
    await bg.ready();
    assert.deepEqual(await bg.send({ type: "nope" }), { ok: false, error: "unknown message" });
});
