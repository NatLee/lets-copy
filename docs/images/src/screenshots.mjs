// Real screenshots for the README, taken with the unpacked extension loaded and
// the demo page (scripts/demo-server.mjs) open on example hostnames.
//
//   node docs/images/src/screenshots.mjs
//
// Writes docs/images/popup-{light,dark}.png and docs/images/src/shots/page-{before,after}.png
// (the inputs of hero.html). The example hostnames are mapped to 127.0.0.1, so nothing
// leaves the machine. Browser selection and settings: see scripts/lib/browser.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../../../scripts/lib/browser.mjs";
import { DEMO_PORT, serveDemo } from "../../../scripts/demo-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const ext = path.join(root, "src");
const SITE = "blog.example.com"; // the site the shots are taken on
const ALREADY_ON = ["docs.example.org", "news.example.net"]; // so the popup's list isn't empty
const PAGE_SIZE = { width: 900, height: 560 };
const POPUP_SCALE = 2;
const SCHEMES = ["light", "dark"];
const url = (host) => `http://${host}:${DEMO_PORT}/`;

const server = await serveDemo();
const browser = await launchBrowser({
    args: [`--host-resolver-rules=${[SITE, ...ALREADY_ON].map((h) => `MAP ${h} 127.0.0.1`).join(", ")}`],
});
try {
    const id = await browser.loadExtension(ext);
    const worker = await browser.extensionWorker(id);
    const page = await browser.newPage();
    await page.send("Emulation.setDeviceMetricsOverride", { ...PAGE_SIZE, deviceScaleFactor: 1, mobile: false });
    const save = async (file, png) => { writeFileSync(file, png); console.log(path.relative(root, file)); };
    const dragSelect = async (selector) => {
        const r = await page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
        const mouse = (type, x, y, buttons) => page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
        await mouse("mousePressed", r.x + 1, r.y + r.h / 4, 1);
        await mouse("mouseMoved", r.x + r.w - 3, r.y + r.h * 3 / 4, 1);
        await mouse("mouseReleased", r.x + r.w - 3, r.y + r.h * 3 / 4, 0);
        await page.settle();
    };

    for (const host of ALREADY_ON) {
        await page.goto(url(host));
        await worker.evaluate("toggleCurrentTab()");
    }

    mkdirSync(path.join(here, "shots"), { recursive: true });
    await page.goto(url(SITE));
    await dragSelect("#para");
    await save(path.join(here, "shots", "page-before.png"), await page.screenshot());

    await worker.evaluate("toggleCurrentTab()");
    await page.waitFor("getComputedStyle(document.getElementById('__letscopy_toast__') || document.body).opacity === '1'", { what: "the enabled toast" });
    await dragSelect("#para");
    await save(path.join(here, "shots", "page-after.png"), await page.screenshot());

    // The popup page in a background tab of the same window: the demo page stays the active
    // tab, so the popup shows its real state. (chrome.action.openPopup() works headless too,
    // but its window is too short to capture whole.) One fresh tab per colour scheme, set
    // before the page loads, so no theme transition is caught half-way.
    for (const scheme of SCHEMES) {
        const popup = await browser.newPage({ background: true });
        await popup.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
        await popup.goto(`chrome-extension://${id}/popup.html`);
        await popup.waitFor(`document.getElementById('hostname').textContent === ${JSON.stringify(SITE)} && document.querySelectorAll('.site-item').length === ${ALREADY_ON.length + 1}`, { what: "the popup to show the demo site" });
        // The popup's width comes from its CSS; the height from its content.
        const size = await popup.evaluate("({ width: Math.ceil(document.body.getBoundingClientRect().width), height: Math.ceil(document.querySelector('.app').getBoundingClientRect().bottom) })");
        await popup.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: POPUP_SCALE, mobile: false });
        // No settle() here: a background tab runs no animation frames. The screenshot
        // itself lays out and paints the page.
        await save(path.join(root, "docs", "images", `popup-${scheme}.png`), await popup.screenshot());
        await popup.close();
    }
} finally {
    await browser.close();
    server.close();
}
