#!/usr/bin/env node
// Sanity checks for the unpacked extension in src/, run in CI next to the unit
// tests. It catches the mistakes that only show up after uploading to the
// Chrome Web Store or loading the extension:
//   - a broken manifest, or a version or description the store rejects
//   - a file that the manifest, a page or a script refers to but isn't there
//   - an icon whose pixel size differs from the size the manifest gives it
//   - inline or remote scripts (Manifest V3 blocks both), and syntax errors
//   - permissions or remote hosts that aren't in scripts/extension-policy.json,
//     so the install prompt and the privacy policy can't change by accident
//
// usage: node scripts/check-extension.js [srcDir]
// The same file is used in other extension repos; only extension-policy.json differs.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// https://developer.chrome.com/docs/extensions/reference/manifest/description
const STORE_DESCRIPTION_MAX = 132;
// https://developer.chrome.com/docs/extensions/reference/manifest/version
const VERSION_PARTS_MAX = 4;
const VERSION_PART_MAX = 65535;

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(path.join(here, "extension-policy.json"), "utf8"));
const srcDir = path.resolve(process.argv[2] || path.join(here, "..", "src"));
const errors = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, "/");
const isRemote = (ref) => /^([a-z]+:)?\/\//i.test(ref);

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const p = path.join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/** Resolve `ref` against `base` and report it if it leaves src/ or doesn't exist. */
function mustExist(fromFile, ref, base = path.dirname(fromFile)) {
    const target = path.resolve(base, ref.split(/[?#]/)[0]);
    if (!target.startsWith(srcDir)) fail(`${rel(fromFile)} points outside src/: ${ref}`);
    else if (!existsSync(target)) fail(`${rel(fromFile)} points at a missing file: ${ref}`);
    return target;
}

function validVersion(v) {
    const parts = String(v).split(".");
    return parts.length <= VERSION_PARTS_MAX
        && parts.every((p) => /^(0|[1-9]\d*)$/.test(p) && Number(p) <= VERSION_PART_MAX);
}

/** Width and height of a PNG, read from its IHDR chunk, or null if it isn't a PNG. */
function pngSize(file) {
    const b = readFileSync(file);
    const signature = "89504e470d0a1a0a";
    if (b.length < 24 || b.subarray(0, 8).toString("hex") !== signature) return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// 1. Manifest
const manifestPath = path.join(srcDir, "manifest.json");
let manifest = {};
try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (err) {
    fail(`manifest.json is not valid JSON: ${err.message}`);
}
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
for (const key of ["name", "version", "description"]) {
    if (!manifest[key]) fail(`manifest.json is missing "${key}"`);
}
if (manifest.description && manifest.description.length > STORE_DESCRIPTION_MAX) {
    fail(`description is ${manifest.description.length} characters; the Web Store allows ${STORE_DESCRIPTION_MAX}`);
}
if (manifest.version && !validVersion(manifest.version)) {
    fail(`version "${manifest.version}" must be 1-${VERSION_PARTS_MAX} dot-separated numbers up to ${VERSION_PART_MAX}`);
}
const notAllowed = (list, allowed) => (list || []).filter((p) => !allowed.includes(p));
for (const p of notAllowed(manifest.permissions, policy.permissions)) {
    fail(`permission "${p}" isn't in extension-policy.json`);
}
for (const p of notAllowed(manifest.host_permissions, policy.hostPermissions)) {
    fail(`host permission "${p}" isn't in extension-policy.json`);
}

const iconMaps = [manifest.icons, manifest.action?.default_icon].filter(Boolean);
const referenced = [
    manifest.action?.default_popup,
    manifest.options_page,
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    ...iconMaps.flatMap((m) => Object.values(m)),
].filter(Boolean);
for (const ref of referenced) mustExist(manifestPath, ref);

const iconsChecked = new Set();
for (const map of iconMaps) {
    for (const [size, ref] of Object.entries(map)) {
        const file = path.resolve(srcDir, ref);
        if (iconsChecked.has(`${size} ${file}`) || !existsSync(file)) continue;
        iconsChecked.add(`${size} ${file}`);
        const dims = pngSize(file);
        if (!dims) fail(`${ref} isn't a PNG`);
        else if (dims.width !== Number(size) || dims.height !== Number(size)) {
            fail(`${ref} is listed as ${size}x${size} but is ${dims.width}x${dims.height}`);
        }
    }
}

const files = walk(srcDir);

// 2. Which scripts are ES modules: the module service worker, <script type="module">
//    entries, and everything they import. All other scripts are classic.
const modules = new Set();
if (manifest.background?.type === "module" && manifest.background.service_worker) {
    modules.add(path.resolve(srcDir, manifest.background.service_worker));
}

// 3. HTML pages: local scripts and styles only, no inline code.
for (const file of files.filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1];
        if (!src) {
            if (m[2].trim()) fail(`${rel(file)} has an inline <script>; Manifest V3 blocks it`);
            continue;
        }
        if (isRemote(src)) {
            fail(`${rel(file)} loads remote code: ${src}`);
            continue;
        }
        const target = mustExist(file, src);
        if (/\btype\s*=\s*["']module["']/i.test(m[1])) modules.add(target);
    }
    for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        if (!/rel\s*=\s*["']stylesheet["']/i.test(m[0])) continue;
        if (isRemote(m[1])) fail(`${rel(file)} loads a remote stylesheet: ${m[1]}`);
        else mustExist(file, m[1]);
    }
    const inlineHandler = /<[a-z][^>]*\s(on[a-z]+)\s*=/i.exec(html);
    if (inlineHandler) fail(`${rel(file)} has an inline ${inlineHandler[1]}= handler; Manifest V3 blocks it`);
}

const importsOf = (file) => [...readFileSync(file, "utf8").matchAll(/\bimport\s[^"']*?from\s*["'](\.[^"']+)["']/g)].map((m) => m[1]);
for (const queue = [...modules]; queue.length;) {
    const file = queue.shift();
    if (!existsSync(file)) continue;
    for (const ref of importsOf(file)) {
        const target = mustExist(file, ref);
        if (!modules.has(target)) {
            modules.add(target);
            queue.push(target);
        }
    }
}

// 4. JavaScript: valid syntax for what each file is, and every file that a
//    script hands to the extension APIs (injected scripts, icons, pages) exists.
//    `node --check file.js` lets module syntax errors through (Node 22), so
//    modules go to node on stdin with an explicit type; classic scripts compile in vm.
for (const file of files.filter((f) => f.endsWith(".js"))) {
    const js = readFileSync(file, "utf8");
    try {
        if (modules.has(file)) execFileSync(process.execPath, ["--input-type=module", "--check"], { input: js, stdio: "pipe" });
        else new vm.Script(js, { filename: rel(file) });
    } catch (err) {
        fail(`${rel(file)} has a syntax error:\n${err.stderr || err.message}`);
    }
    for (const m of js.matchAll(/["']((?:[\w-]+\/)*[\w.-]+\.(?:js|png|html|css))["']/g)) {
        if (!m[1].startsWith(".")) mustExist(file, m[1], srcDir);
    }
}

// 5. No new third parties: every http(s) host in the code must be in the policy.
for (const file of files.filter((f) => /\.(js|html|css|json)$/.test(f))) {
    for (const m of readFileSync(file, "utf8").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = m[1].toLowerCase();
        if (!policy.remoteHosts.includes(host)) {
            fail(`${rel(file)} refers to ${host}, which isn't in extension-policy.json (and PRIVACY.md)`);
        }
    }
}

if (errors.length) {
    console.error(`check-extension: ${errors.length} problem(s)\n- ${errors.join("\n- ")}`);
    process.exit(1);
}
console.log(`check-extension: OK (${manifest.name} ${manifest.version}, ${files.length} files, ${modules.size} modules)`);
