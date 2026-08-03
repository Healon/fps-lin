// 開發用 esbuild context serve：埠 8330，servedir 指向即時建置輸出（.dev-dist/）。
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const devDir = path.join(root, ".dev-dist");

function generateFaviconDataUri() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="#08090B"/>' +
    '<rect x="14" y="4" width="4" height="24" fill="#35E0FF"/>' +
    '<rect x="4" y="14" width="24" height="4" fill="#35E0FF"/>' +
    "</svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

if (!existsSync(devDir)) mkdirSync(devDir, { recursive: true });

const template = readFileSync(path.join(root, "src", "index.html"), "utf8");
const devHtml = template
  .replace("__FAVICON__", generateFaviconDataUri())
  .replace("__SCRIPT__", "")
  .replace("</body>", '<script src="/main.js"></script>\n</body>');
writeFileSync(path.join(devDir, "index.html"), devHtml, "utf8");

const ctx = await esbuild.context({
  entryPoints: [path.join(root, "src", "main.ts")],
  bundle: true,
  outfile: path.join(devDir, "main.js"),
  format: "iife",
  target: "es2022",
  platform: "browser",
  sourcemap: "inline",
  logLevel: "info",
});

await ctx.watch();
const { host, port } = await ctx.serve({ port: 8330, servedir: devDir });

console.log(`dev server 已啟動：http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
