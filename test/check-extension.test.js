// The extension check must pass on src/ and fail on the mistakes it exists to catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(root, "scripts", "check-extension.js");

function check(mutate) {
    const dir = mkdtempSync(path.join(tmpdir(), "lets-copy-check-"));
    try {
        cpSync(path.join(root, "src"), dir, { recursive: true });
        if (mutate) mutate(dir);
        const r = spawnSync(process.execPath, [checker, dir], { encoding: "utf8" });
        return { code: r.status, out: r.stdout + r.stderr };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const edit = (dir, file, fn) => {
    const p = path.join(dir, file);
    writeFileSync(p, fn(readFileSync(p, "utf8")));
};
const editManifest = (dir, fn) => edit(dir, "manifest.json", (s) => JSON.stringify(fn(JSON.parse(s))));

test("src/ passes", () => {
    const r = check();
    assert.equal(r.code, 0, r.out);
});

test("fails on a missing toolbar icon", () => {
    const r = check((d) => rmSync(path.join(d, "icons", "icon32-disable.png")));
    assert.equal(r.code, 1);
    assert.match(r.out, /missing file: icons\/icon32-disable\.png/);
});

test("fails when the script the worker injects is missing", () => {
    const r = check((d) => rmSync(path.join(d, "enable.js")));
    assert.equal(r.code, 1);
    assert.match(r.out, /background\.js points at a missing file: enable\.js/);
});

test("fails on a permission nobody signed off on", () => {
    const r = check((d) => editManifest(d, (m) => ({ ...m, permissions: [...m.permissions, "cookies"] })));
    assert.equal(r.code, 1);
    assert.match(r.out, /unexpected permission "cookies"/);
});

// The tabs permission was dropped: <all_urls> already lets the worker read
// the current tab's address and icon. It shouldn't creep back in.
test("fails if the tabs permission comes back", () => {
    const r = check((d) => editManifest(d, (m) => ({ ...m, permissions: [...m.permissions, "tabs"] })));
    assert.equal(r.code, 1);
    assert.match(r.out, /unexpected permission "tabs"/);
});

test("fails on Manifest V2", () => {
    const r = check((d) => editManifest(d, (m) => ({ ...m, manifest_version: 2 })));
    assert.equal(r.code, 1);
    assert.match(r.out, /manifest_version must be 3/);
});

test("fails on inline or remote scripts in the popup", () => {
    const r = check((d) => edit(d, "popup.html", (s) => s.replace(
        "</body>",
        '<script>alert(1)</script><script src="https://cdn.example.com/x.js"></script><a onclick="x()"></a></body>',
    )));
    assert.equal(r.code, 1);
    assert.match(r.out, /inline <script>/);
    assert.match(r.out, /remote code/);
    assert.match(r.out, /inline onclick= handler/);
});

test("fails on a syntax error", () => {
    const r = check((d) => edit(d, "enable.js", (s) => s + "\n(() => {"));
    assert.equal(r.code, 1);
    assert.match(r.out, /enable\.js has a syntax error/);
});

// Regression: the popup asked Google's favicon service for an icon, sending
// it the hostname of the current tab. A new third-party host must be a
// deliberate change.
test("fails when the code talks to a host that isn't on the list", () => {
    const r = check((d) => edit(d, "popup.js", (s) => s + "\nconst x = `https://www.google.com/s2/favicons?domain=${host}`;\n"));
    assert.equal(r.code, 1);
    assert.match(r.out, /popup\.js refers to www\.google\.com/);
});
