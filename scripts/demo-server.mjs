// Serves test/fixtures/demo-page.html, a page that blocks copying in the usual
// ways, on DEMO_PORT (any path, IPv4 and IPv6). Used by the browser tests and
// the README screenshots; `npm run demo` starts it for trying Let's Copy by hand.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEMO_PORT = Number(process.env.DEMO_PORT || 18006);
const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "demo-page.html");

/** Start the server; resolves once it listens. */
export function serveDemo(port = DEMO_PORT) {
    const server = createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(readFileSync(PAGE));
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "::", () => resolve(server));
    });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    await serveDemo();
    console.log(`demo page on http://localhost:${DEMO_PORT}/ (Ctrl+C to stop)`);
}
