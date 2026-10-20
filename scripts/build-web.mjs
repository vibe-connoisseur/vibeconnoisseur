// Copies the website into www/ for the iPhone app, with Leaflet bundled locally
// so the map code loads even on a weak connection. The website itself is unchanged.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "www");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "vendor/leaflet"), { recursive: true });

for (const file of ["app.js", "native.js", "styles.css", "privacy.html"]) cpSync(join(root, file), join(out, file));
cpSync(join(root, "assets"), join(out, "assets"), { recursive: true });

const leaflet = join(root, "node_modules/leaflet/dist");
cpSync(join(leaflet, "leaflet.js"), join(out, "vendor/leaflet/leaflet.js"));
cpSync(join(leaflet, "leaflet.css"), join(out, "vendor/leaflet/leaflet.css"));
cpSync(join(leaflet, "images"), join(out, "vendor/leaflet/images"), { recursive: true });

let html = readFileSync(join(root, "index.html"), "utf8");
const replacements = [
  [/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@[^"]+\/dist\/leaflet\.css"[^>]*>/, '<link rel="stylesheet" href="vendor/leaflet/leaflet.css" />'],
  [/<script src="https:\/\/unpkg\.com\/leaflet@[^"]+\/dist\/leaflet\.js"[^>]*><\/script>/, '<script src="vendor/leaflet/leaflet.js"></script>'],
];
for (const [pattern, value] of replacements) {
  if (!pattern.test(html)) throw new Error(`index.html no longer matches ${pattern}`);
  html = html.replace(pattern, value);
}
writeFileSync(join(out, "index.html"), html);
console.log("Built www/ for the app");
