// Real screenshots for the README, taken in Edge (or Chromium) with the
// unpacked extension loaded and demo-page.html served locally.
//
//   node docs/images/src/screenshots.mjs [path to msedge/chrome]
//   node docs/images/src/screenshots.mjs --serve      # only serve the demo page on :18006
//
// Writes docs/images/popup-{light,dark}.png and docs/images/src/shots/page-{before,after}.png
// (the inputs of effect.html). Example hostnames (*.example.com/.org/.net) are mapped to
// 127.0.0.1, so nothing leaves the machine. Needs a browser that still honours
// --load-extension (Edge does; branded Chrome 137+ does not). Set BROWSER_PROFILE to
// use a given empty profile folder instead of a temporary one.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const ext = path.join(root, "src");
const PORT = 18006;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(path.join(here, "demo-page.html")));
}).listen(PORT, "::");
console.log(`demo page on http://localhost:${PORT}/`);
if (process.argv[2] === "--serve") await new Promise(() => {});

const browser = process.argv[2] || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const debugPort = 9400 + Math.floor(Math.random() * 400);

function extensionId(dir) {
    let p = path.resolve(dir);
    let bytes = Buffer.from(p);
    if (process.platform === "win32") {
        p = p[0].toUpperCase() + p.slice(1);
        bytes = Buffer.from(p, "utf16le");
    }
    const hex = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

async function cdpConnect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && pending.has(msg.id)) {
            const { res, rej } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        }
    };
    return (method, params = {}, sessionId) => new Promise((res, rej) => {
        pending.set(++id, { res, rej });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
}

const ownProfile = !process.env.BROWSER_PROFILE;
const profile = process.env.BROWSER_PROFILE || mkdtempSync(path.join(tmpdir(), "lets-copy-shots-"));
const proc = spawn(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `--load-extension=${ext}`, `--disable-extensions-except=${ext}`,
    "--host-resolver-rules=MAP *.example.com 127.0.0.1, MAP *.example.org 127.0.0.1, MAP *.example.net 127.0.0.1",
    "about:blank",
], { stdio: "ignore" });

try {
    let info;
    for (let i = 0; i < 100 && !info; i++) {
        try { info = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { await sleep(200); }
    }
    const send = await cdpConnect(info.webSocketDebuggerUrl);
    const id = extensionId(ext);
    const attach = async (targetId) => (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    const evaluate = async (sessionId, expression) => {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
    };
    const shoot = async (sessionId, file, clip) => {
        const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, sessionId);
        writeFileSync(file, Buffer.from(r.data, "base64"));
        console.log(path.relative(root, file));
    };

    let swTarget;
    for (let i = 0; i < 30 && !swTarget; i++) {
        swTarget = (await send("Target.getTargets")).targetInfos.find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${id}/`));
        if (!swTarget) await sleep(300);
    }
    const sw = await attach(swTarget.targetId);

    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const page = await attach(targetId);
    await send("Page.enable", {}, page);
    await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 560, deviceScaleFactor: 1, mobile: false }, page);
    const go = async (url, wait = 1800) => { await send("Page.navigate", { url }, page); await sleep(wait); };
    const drag = async (sel) => {
        const r = await evaluate(page, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
        const m = (type, x, y, buttons) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 }, page);
        await m("mousePressed", r.x + 1, r.y + 8, 1);
        for (let i = 1; i <= 6; i++) await m("mouseMoved", r.x + 1 + (r.w - 4) * i / 6, r.y + r.h - 6, 1);
        await m("mouseReleased", r.x + r.w - 3, r.y + r.h - 6, 0);
        await sleep(80);
    };

    // A couple of sites already in the list, so the popup has something to show.
    for (const host of ["docs.example.org", "news.example.net"]) {
        await go(`http://${host}:${PORT}/`, 1200);
        await evaluate(sw, "toggleCurrentTab()");
    }

    mkdirSync(path.join(here, "shots"), { recursive: true });
    await go(`http://blog.example.com:${PORT}/`);
    await drag("#para");
    await shoot(page, path.join(here, "shots", "page-before.png"));

    await evaluate(sw, "toggleCurrentTab()");
    await sleep(320); // the "enabled" toast is fully faded in by now
    await drag("#para");
    await shoot(page, path.join(here, "shots", "page-after.png"));
    await evaluate(page, "getSelection().removeAllRanges()");
    await sleep(1800);

    // The popup page, opened as a background tab in the same window: the demo page stays the
    // active tab, so the popup shows its real state. (chrome.action.openPopup() works headless
    // too, but its window is too short to capture whole.)
    const { targetId: popupTarget } = await send("Target.createTarget", { url: `chrome-extension://${id}/popup.html`, background: true });
    const popup = await attach(popupTarget);
    await send("Page.enable", {}, popup);
    for (const scheme of ["light", "dark"]) {
        await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, popup);
        await send("Emulation.setDeviceMetricsOverride", { width: 340, height: 400, deviceScaleFactor: 2, mobile: false }, popup);
        await sleep(600);
        const height = await evaluate(popup, "Math.ceil(document.querySelector('.app').getBoundingClientRect().bottom)");
        await send("Emulation.setDeviceMetricsOverride", { width: 340, height, deviceScaleFactor: 2, mobile: false }, popup);
        await sleep(400);
        const host = await evaluate(popup, "document.getElementById('hostname').textContent");
        if (host !== "blog.example.com") throw new Error(`popup shows "${host}", not the demo page`);
        await shoot(popup, path.join(root, "docs", "images", `popup-${scheme}.png`));
    }
    await send("Browser.close").catch(() => {});
} finally {
    server.close();
    await sleep(500);
    proc.kill();
    await sleep(500);
    if (ownProfile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
