// Drives a Chromium-based browser (Edge, Chrome, Chromium) over the DevTools
// protocol for the repo's tooling: README screenshots and icon rendering.
//
// - Which browser: an explicit path, else the BROWSER env var, else the first
//   one found in BROWSER_PATHS for this platform.
// - The protocol runs over a pipe (--remote-debugging-pipe), so there is no
//   port to pick or collide on.
// - Extensions load through the public Extensions.loadUnpacked command, which
//   returns their ID. It works in branded Chrome, which no longer honours
//   --load-extension.
// - BROWSER_PROFILE picks the profile folder (default: a temporary one) and
//   BROWSER_ARGS adds flags, e.g. BROWSER_ARGS=--no-sandbox in a container.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Usual install locations, per platform. */
export const BROWSER_PATHS = {
    win32: [
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
    ],
    darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"],
};

/** How long waitFor() polls before giving up. */
export const WAIT_TIMEOUT_MS = 20000;
const POLL_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser(explicit = process.env.BROWSER) {
    if (explicit) return explicit;
    const candidates = BROWSER_PATHS[process.platform] || [];
    const found = candidates.find((p) => existsSync(p));
    if (!found) throw new Error(`No Chromium-based browser found in ${candidates.join(", ") || "(none for this platform)"}; set BROWSER`);
    return found;
}

export async function launchBrowser({ browser = findBrowser(), args = [] } = {}) {
    const ownProfile = !process.env.BROWSER_PROFILE;
    const profile = process.env.BROWSER_PROFILE || mkdtempSync(path.join(tmpdir(), "devtools-profile-"));
    const extra = (process.env.BROWSER_ARGS || "").split(/\s+/).filter(Boolean);
    const proc = spawn(browser, [
        "--headless=new", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
        "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
        `--user-data-dir=${profile}`, ...extra, ...args, "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    const [, , , toBrowser, fromBrowser] = proc.stdio;

    // The pipe carries JSON messages separated by NUL bytes.
    let buffer = "";
    let lastId = 0;
    const pending = new Map();
    const listeners = new Set();
    fromBrowser.on("data", (chunk) => {
        buffer += chunk.toString();
        for (let end; (end = buffer.indexOf("\0")) >= 0;) {
            const msg = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
            } else if (msg.method) {
                for (const fn of listeners) fn(msg);
            }
        }
    });
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        pending.set(++lastId, { resolve, reject });
        toBrowser.write(JSON.stringify({ id: lastId, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
    const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

    async function session(targetId) {
        const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
        const s = (method, params) => send(method, params, sessionId);
        const evaluate = async (expression) => {
            const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
            return r.result.value;
        };
        return {
            targetId, sessionId, send: s, evaluate,
            /** Poll `expression` until it is truthy; returns its value. */
            async waitFor(expression, { timeout = WAIT_TIMEOUT_MS, what = expression } = {}) {
                const deadline = Date.now() + timeout;
                for (;;) {
                    try {
                        const v = await evaluate(expression);
                        if (v) return v;
                    } catch (err) {
                        if (Date.now() > deadline) throw err;
                    }
                    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
                    await sleep(POLL_MS);
                }
            },
            /** Wait until two animation frames have passed, so layout and paint are done. */
            settle: () => evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))"),
            async goto(url) {
                await s("Page.navigate", { url });
                await evaluate("document.readyState === 'complete' || new Promise((r) => addEventListener('load', r, { once: true }))").catch(() => {});
            },
            async screenshot(clip) {
                const r = await s("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { scale: 1, ...clip } } : {}) });
                return Buffer.from(r.data, "base64");
            },
            close: () => send("Target.closeTarget", { targetId }),
        };
    }

    return {
        send, on, session,
        /** Load an unpacked extension and return its ID. */
        async loadExtension(dir) {
            return (await send("Extensions.loadUnpacked", { path: path.resolve(dir) })).id;
        },
        /** Open a tab (optionally in the background) and attach to it. */
        async newPage({ url = "about:blank", background = false } = {}) {
            const { targetId } = await send("Target.createTarget", { url: "about:blank", background });
            const page = await session(targetId);
            await page.send("Page.enable");
            if (url !== "about:blank") await page.goto(url);
            return page;
        },
        /** Attach to the first target matching `predicate` once it exists. */
        async waitForTarget(predicate, { timeout = WAIT_TIMEOUT_MS } = {}) {
            const deadline = Date.now() + timeout;
            for (;;) {
                const target = (await send("Target.getTargets")).targetInfos.find(predicate);
                if (target) return session(target.targetId);
                if (Date.now() > deadline) throw new Error("timed out waiting for a target");
                await sleep(POLL_MS);
            }
        },
        async close() {
            await send("Browser.close").catch(() => {});
            await Promise.race([exited, sleep(3000)]);
            if (proc.exitCode === null) proc.kill();
            if (ownProfile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        },
    };
}
