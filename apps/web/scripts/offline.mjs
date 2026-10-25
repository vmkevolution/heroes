// Turns `dist/` into `dist-offline/`, a copy that opens by double-clicking index.html (file://):
// browsers refuse module scripts from file://, so the bundle becomes a classic script.
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "dist");
const out = join(root, "dist-offline");
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
const assets = join(out, "assets");
const bundles = readdirSync(assets).filter((f) => f.endsWith(".js"));
if (bundles.length !== 1) throw new Error(`expected one bundle, found ${bundles.join(", ")}`);
const code = readFileSync(join(assets, bundles[0]), "utf8");
if (/^\s*(import|export)\b/m.test(code) || code.includes("import.meta")) throw new Error("bundle still uses ES module syntax");
writeFileSync(join(assets, "app.js"), `(function(){"use strict";\n${code}\n})();\n`);
rmSync(join(assets, bundles[0]));
const html = readFileSync(join(out, "index.html"), "utf8")
  .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, '<script defer src="./assets/app.js"></script>')
  .replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"');
if (!html.includes("assets/app.js")) throw new Error("index.html script tag not found");
writeFileSync(join(out, "index.html"), html);
console.log(`offline build in ${out}`);
