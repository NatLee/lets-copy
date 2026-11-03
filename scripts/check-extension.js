#!/usr/bin/env node
// Sanity checks for the unpacked extension in src/, run in CI next to the unit
// tests. It catches the mistakes that only show up after uploading to the
// Chrome Web Store or loading the extension: a broken manifest, a file the
// manifest, the popup or the service worker points at that isn't there,
// remote or inline scripts (blocked by Manifest V3), syntax errors, and
// permissions that changed without anyone meaning to.
//
// usage: node scripts/check-extension.js [srcDir]

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

// Changing what the extension may access changes the install prompt users
// see, so it should be a deliberate edit here, not a side effect.
const ALLOWED_PERMISSIONS = ["storage", "scripting"];
const ALLOWED_HOST_PERMISSIONS = ["<all_urls>"];
// Hosts the code may mention. Anything else would be a new third party the
// privacy policy has to name. (www.w3.org is only the SVG XML namespace.)
const ALLOWED_REMOTE_HOSTS = ["www.w3.org", "github.com"];

const srcDir = path.resolve(process.argv[2] || "src");
const errors = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, "/");

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const p = path.join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

// Paths in the manifest and in chrome.* calls are relative to the extension root.
function mustExist(fromFile, ref, base = path.dirname(fromFile)) {
    const target = path.resolve(base, ref.split(/[?#]/)[0]);
    if (!target.startsWith(srcDir)) fail(`${rel(fromFile)} points outside src/: ${ref}`);
    else if (!existsSync(target)) fail(`${rel(fromFile)} points at a missing file: ${ref}`);
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
if (manifest.description && manifest.description.length > 132) {
    fail(`description is ${manifest.description.length} characters; the Web Store allows 132`);
}
if (manifest.version && !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(manifest.version)) {
    fail(`version "${manifest.version}" must be 1-4 dot-separated numbers`);
}
const extra = (list, allowed) => (list || []).filter((p) => !allowed.includes(p));
for (const p of extra(manifest.permissions, ALLOWED_PERMISSIONS)) {
    fail(`unexpected permission "${p}" (update ALLOWED_PERMISSIONS if this is intended)`);
}
for (const p of extra(manifest.host_permissions, ALLOWED_HOST_PERMISSIONS)) {
    fail(`unexpected host permission "${p}" (update ALLOWED_HOST_PERMISSIONS if this is intended)`);
}
const referenced = [
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
].filter(Boolean);
for (const ref of referenced) mustExist(manifestPath, ref);

const files = walk(srcDir);
const moduleScripts = new Set();
if (manifest.background?.type === "module" && manifest.background.service_worker) {
    moduleScripts.add(path.resolve(srcDir, manifest.background.service_worker));
}

// 2. HTML pages: local scripts and styles only, no inline code.
for (const file of files.filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1];
        if (!src) {
            if (m[2].trim()) fail(`${rel(file)} has an inline <script>; Manifest V3 blocks it`);
            continue;
        }
        if (/^(https?:)?\/\//i.test(src)) fail(`${rel(file)} loads remote code: ${src}`);
        else {
            mustExist(file, src);
            if (/\btype\s*=\s*["']module["']/i.test(m[1])) moduleScripts.add(path.resolve(path.dirname(file), src));
        }
    }
    for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        if (/rel\s*=\s*["']stylesheet["']/i.test(m[0])) {
            if (/^(https?:)?\/\//i.test(m[1])) fail(`${rel(file)} loads a remote stylesheet: ${m[1]}`);
            else mustExist(file, m[1]);
        }
    }
    const inlineHandler = /<[a-z][^>]*\s(on[a-z]+)\s*=/i.exec(html);
    if (inlineHandler) fail(`${rel(file)} has an inline ${inlineHandler[1]}= handler; Manifest V3 blocks it`);
}

// 3. JavaScript: valid syntax, and every file a script hands to chrome.*
//    (injected scripts, toolbar icons) or imports exists.
for (const file of files.filter((f) => f.endsWith(".js"))) {
    const js = readFileSync(file, "utf8");
    if (moduleScripts.has(file)) {
        // vm can't compile modules without a flag; a classic compile of a module
        // would reject import/export, so only look for obvious breakage here.
        for (const m of js.matchAll(/\bimport\s[^"']*?from\s*["'](\.[^"']+)["']/g)) mustExist(file, m[1]);
    } else {
        try {
            new vm.Script(js, { filename: rel(file) });
        } catch (err) {
            fail(`${rel(file)} has a syntax error: ${err.message}`);
        }
    }
    for (const m of js.matchAll(/["']((?:[\w-]+\/)*[\w.-]+\.(?:js|png|html))["']/g)) {
        if (!/^https?:/.test(m[1])) mustExist(file, m[1], srcDir);
    }
}

// 4. No new third parties: every http(s) URL in the code must be on a known host.
for (const file of files.filter((f) => /\.(js|html|css|json)$/.test(f))) {
    for (const m of readFileSync(file, "utf8").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = m[1].toLowerCase();
        if (!ALLOWED_REMOTE_HOSTS.includes(host)) {
            fail(`${rel(file)} refers to ${host} (add it to ALLOWED_REMOTE_HOSTS and PRIVACY.md if intended)`);
        }
    }
}

if (errors.length) {
    console.error(`check-extension: ${errors.length} problem(s)\n- ${errors.join("\n- ")}`);
    process.exit(1);
}
console.log(`check-extension: OK (${manifest.name} ${manifest.version}, ${files.length} files)`);
