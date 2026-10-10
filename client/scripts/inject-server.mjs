// Bakes the signalling server URL into the shipped receiver page.
//
// receiver.html runs in two very different places: a phone browser (where
// location.origin is the server) and the Capacitor WebView (where
// location.origin is always https://localhost). The baked meta tag covers the
// APK; a browser always has a correct origin, so this is a no-op for it.
//
// Only receiver.html is injected. The sender page is always served by the same
// server it signals to, so baking a URL into it could only ever mislead.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raw = (process.env.EARBRIDGE_SERVER || "").trim().replace(/\/+$/, "");

if (raw && !/^https?:\/\//i.test(raw)) {
  console.error(`EARBRIDGE_SERVER must start with http:// or https:// (got "${raw}")`);
  process.exit(1);
}

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "receiver.html");

let html;
try {
  html = readFileSync(target, "utf8");
} catch {
  console.error(`inject-server: ${target} not found — did vite build run?`);
  process.exit(1);
}

const PATTERN = /(<meta name="earbridge-server" content=")[^"]*(")/;
if (!PATTERN.test(html)) {
  console.error("inject-server: no <meta name=\"earbridge-server\"> tag in dist/receiver.html");
  process.exit(1);
}

// Function replacement: a URL containing "$" must not be treated as a pattern.
const out = html.replace(PATTERN, (_m, open, close) => open + raw + close);
writeFileSync(target, out);

console.log(
  raw
    ? `inject-server: baked "${raw}" into dist/receiver.html`
    : "inject-server: EARBRIDGE_SERVER unset — receiver falls back to location.origin"
);
