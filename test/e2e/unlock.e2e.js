// End-to-end: load the extension into a real browser and check what a visitor
// can do on test/fixtures/demo-page.html, which blocks copying seven ways.
//
//   npm run test:e2e          (needs Edge, Chrome or Chromium; see scripts/lib/browser.mjs)
//   EXTENSION_DIR=unzipped/ npm run test:e2e     (test a packaged build instead of src/)
//
// "The page's blocker ran" is measured with the page's own counters
// (window.__pageSaw) and with cancelable events dispatched on the page.
// Example hostnames are mapped to 127.0.0.1.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../../scripts/lib/browser.mjs";
import { DEMO_PORT, serveDemo } from "../../scripts/demo-server.mjs";

// src/ by default; EXTENSION_DIR points the tests at another unpacked copy,
// e.g. the contents of the ZIP that goes to the Web Store.
const ext = process.env.EXTENSION_DIR
    ? path.resolve(process.env.EXTENSION_DIR)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const HOSTS = { site: "blog.example.com", other: "news.example.net", unlisted: "wiki.example.org" };
const url = (host) => `http://${host}:${DEMO_PORT}/`;
const TIMEOUT = { timeout: 60000 };

let server, browser, extId, worker, page;

before(async () => {
    server = await serveDemo();
    browser = await launchBrowser({
        args: [`--host-resolver-rules=${Object.values(HOSTS).map((h) => `MAP ${h} 127.0.0.1`).join(", ")}`],
    });
    extId = await browser.loadExtension(ext);
    worker = await browser.extensionWorker(extId);
    page = await browser.newPage();
    await page.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    // Trusted mouse and key events only reach a focused, painted page; a fresh
    // headless tab can drop the first ones otherwise.
    await page.send("Page.bringToFront");
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
});

after(async () => {
    await browser?.close();
    server?.close();
});

/** Open `host` and wait until the late paragraph (added 1 s after load) is there. */
async function open(host) {
    await page.goto(url(host));
    await page.waitFor("document.getElementById('late')", { what: "the demo page" });
    await page.settle();
}

/** Run in the extension's service worker, the way the popup and the shortcut do. */
const inWorker = (expression) => worker.evaluate(expression);
const setStorage = (values) => inWorker(`chrome.storage.local.set(${JSON.stringify(values)}).then(() => loadState())`);

async function mouse(type, x, y, button, buttons) {
    await page.send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: 1 });
}

async function box(selector) {
    return page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
}

/** Drag across an element with the real (trusted) mouse; returns how many characters got selected. */
async function dragSelect(selector) {
    const r = await box(selector);
    await page.evaluate("getSelection().removeAllRanges()");
    await mouse("mousePressed", r.x + 2, r.y + r.h / 4, "left", 1);
    await mouse("mouseMoved", r.x + r.w - 4, r.y + (r.h * 3) / 4, "left", 1);
    await mouse("mouseReleased", r.x + r.w - 4, r.y + (r.h * 3) / 4, "left", 0);
    const n = await page.evaluate("getSelection().toString().length");
    await page.evaluate("getSelection().removeAllRanges()");
    return n;
}

/**
 * A real right-click. Returns which of the page's blockers saw it: its
 * contextmenu listeners, and its right-button mousedown listener.
 */
async function rightClickReachesPage(selector) {
    const r = await box(selector);
    const counts = "[__pageSaw.contextmenu + __pageSaw.contextmenuWindow, __pageSaw.rightMousedown]";
    const [menuBefore, pressBefore] = await page.evaluate(counts);
    // Input.dispatchMouseEvent returns once the browser has handled the event,
    // contextmenu included (it fires on press or release depending on the OS).
    await mouse("mousePressed", r.x + 10, r.y + 5, "right", 2);
    await mouse("mouseReleased", r.x + 10, r.y + 5, "right", 0);
    const [menu, press] = await page.evaluate(counts);
    return { rightClick: menu > menuBefore, rightButton: press > pressBefore };
}

/** A real Ctrl+C key press; true when the page's keydown blocker saw it. */
async function ctrlCReachesPage() {
    const before = await page.evaluate("__pageSaw.keydownCopy");
    const key = { key: "c", code: "KeyC", windowsVirtualKeyCode: 67, modifiers: 2 }; // 2 = Ctrl
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    return (await page.evaluate("__pageSaw.keydownCopy")) > before;
}

/** What a visitor runs into on the open page right now. */
async function blockers() {
    return {
        selection: (await dragSelect("#para")) === 0,
        ...(await rightClickReachesPage("#para")),
        copyKey: await ctrlCReachesPage(),
        ...(await page.evaluate(`(() => {
            const para = document.getElementById("para");
            const dt = new DataTransfer();
            const copyKept = para.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: dt }));
            return {
                css: getComputedStyle(para).userSelect === "none",
                copy: !copyKept || dt.getData("text/plain") !== "",
                selectstart: !para.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true })),
                dragstart: !para.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true })),
                inline: ["oncontextmenu", "onselectstart", "oncopy", "ondragstart"].some((a) => document.body.hasAttribute(a)),
                lateParagraph: document.getElementById("late").hasAttribute("oncopy"),
            };
        })()`)),
    };
}

const ALL_BLOCKED = { selection: true, rightClick: true, rightButton: true, copyKey: true, css: true, copy: true, selectstart: true, dragstart: true, inline: true, lateParagraph: true };
const UNLOCKED = { ...ALL_BLOCKED, selection: false, rightClick: false, rightButton: false, css: false, copy: false, selectstart: false, dragstart: false, inline: false, lateParagraph: false };

test("without Let's Copy, the demo page blocks everything", TIMEOUT, async () => {
    await setStorage({ enabledHosts: [], alwaysOn: false });
    await open(HOSTS.site);
    assert.deepEqual(await blockers(), ALL_BLOCKED);
});

test("switching a site on unlocks it straight away, except a blocker registered earlier on window", TIMEOUT, async () => {
    await open(HOSTS.site);
    await inWorker("toggleCurrentTab()");
    await page.waitFor("window.__letsCopyActive", { what: "the unlock script" });
    // The demo page cancels contextmenu on window before Let's Copy arrives; the
    // popup's Reload button exists for this case.
    assert.deepEqual(await blockers(), { ...UNLOCKED, rightClick: true });
});

test("after a reload the unlock runs first, so right-click works too", TIMEOUT, async () => {
    await open(HOSTS.site);
    assert.deepEqual(await blockers(), UNLOCKED);
});

test("switching the site off reloads it and the blockers come back", TIMEOUT, async () => {
    const loadId = await page.evaluate("__loadId");
    await inWorker("toggleCurrentTab()");
    await page.waitFor(`window.__loadId && window.__loadId !== ${JSON.stringify(loadId)} && document.getElementById('late')`, { what: "the reload" });
    await page.settle();
    assert.deepEqual(await blockers(), ALL_BLOCKED);
});

test("Always on unlocks a site that was never switched on", TIMEOUT, async () => {
    await setStorage({ enabledHosts: [], alwaysOn: true });
    await open(HOSTS.unlisted);
    assert.deepEqual(await blockers(), UNLOCKED);
    await setStorage({ alwaysOn: false });
});

// ── The per-site "Unblock Ctrl+C / ⌘C" option ───────────────────────────────

/**
 * The real popup, in a background tab next to the demo page. The popup reports
 * on the active tab, so make the demo page active first: other extensions in
 * the browser profile may open tabs of their own (welcome pages) at any time.
 */
async function openPopupFor(host) {
    await browser.send("Target.activateTarget", { targetId: page.targetId });
    const popup = await browser.newPage({ url: `chrome-extension://${extId}/popup.html`, background: true });
    try {
        await popup.waitFor(`document.getElementById("hostname").textContent === ${JSON.stringify(host)}`, { what: "the popup" });
    } catch (err) {
        const shown = await popup.evaluate('document.getElementById("hostname").textContent').catch(() => "?");
        const active = await inWorker("getActiveTab().then((t) => t && t.url)").catch(() => "?");
        throw new Error(`${err.message}: popup shows "${shown}", active tab ${active}`);
    }
    return popup;
}
const OPTION = '[data-option="copyShortcut"]';

test("an unlocked site still sees Ctrl+C until its option is switched on", TIMEOUT, async () => {
    await setStorage({ enabledHosts: [HOSTS.site, HOSTS.other], alwaysOn: false, copyShortcutHosts: [] });
    await open(HOSTS.site);
    assert.equal(await ctrlCReachesPage(), true);
    const popup = await openPopupFor(HOSTS.site);
    assert.equal(await popup.evaluate(`getComputedStyle(document.querySelector(".hero-option")).display`), "flex");
    assert.equal(await popup.evaluate(`document.querySelector('${OPTION}').checked`), false);
    await popup.close();
});

test("switching the option on in the popup hides Ctrl+C from the page at once and after reloads", TIMEOUT, async () => {
    await open(HOSTS.site);
    const popup = await openPopupFor(HOSTS.site);
    await popup.evaluate(`document.querySelector('${OPTION}').click()`);
    // Keep the popup open until the page has the change: closing it early can
    // drop the popup's message to the worker (a person's popup stays open too).
    await page.waitFor("window.__letsCopyOptions?.copyShortcut === true", { what: "the option on the open page" });
    assert.equal(await popup.evaluate(`document.querySelector('${OPTION}').checked`), true);
    await popup.close();
    assert.deepEqual(await blockers(), { ...UNLOCKED, copyKey: false });
    await open(HOSTS.site); // a new visit gets it from the registered scripts
    assert.deepEqual(await blockers(), { ...UNLOCKED, copyKey: false });
});

test("another unlocked site keeps its own setting", TIMEOUT, async () => {
    await open(HOSTS.other);
    assert.deepEqual(await blockers(), UNLOCKED);
});

test("switching the option off gives the page its Ctrl+C back without a reload", TIMEOUT, async () => {
    await open(HOSTS.site);
    const loadId = await page.evaluate("__loadId");
    const popup = await openPopupFor(HOSTS.site);
    await popup.evaluate(`document.querySelector('${OPTION}').click()`);
    await page.waitFor("window.__letsCopyOptions?.copyShortcut === false", { what: "the option on the open page" });
    assert.equal(await popup.evaluate(`document.querySelector('${OPTION}').checked`), false);
    await popup.close();
    assert.equal(await page.evaluate("__loadId"), loadId);
    assert.deepEqual(await blockers(), UNLOCKED);
});
