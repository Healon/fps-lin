// 產線建置：esbuild bundle src/main.ts（minify）後，把 JS inline 進單一 dist/index.html。
// 單檔精神：輸出無任何外部資源（無外部 js/css/字型/圖檔），favicon 用程式生成 data URI。
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");

function generateFaviconDataUri() {
  // 程式生成：深色底加能源青十字，對應 PLAN §5.1 色票，不依賴任何素材檔。
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="#08090B"/>' +
    '<rect x="14" y="4" width="4" height="24" fill="#35E0FF"/>' +
    '<rect x="4" y="14" width="24" height="4" fill="#35E0FF"/>' +
    "</svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

export async function build() {
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

  const metafile = path.join(distDir, "meta.json");

  const result = await esbuild.build({
    entryPoints: [path.join(root, "src", "main.ts")],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2022",
    platform: "browser",
    write: false,
    metafile: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "info",
  });

  writeFileSync(metafile, JSON.stringify(result.metafile, null, 2), "utf8");

  const jsOutput = result.outputFiles.find((f) => f.path.endsWith(".js") || !f.path.endsWith(".map"));
  const scriptText = jsOutput.text;

  const template = readFileSync(path.join(root, "src", "index.html"), "utf8");
  const html = template
    .replace("__FAVICON__", generateFaviconDataUri())
    // scriptText 可能含 </script> 字面字串（幾乎不會，但保險跳脫）
    .replace("__SCRIPT__", () => scriptText.replace(/<\/script/gi, "<\\/script"));

  writeFileSync(path.join(distDir, "index.html"), html, "utf8");

  console.log(`build 完成：dist/index.html（${Buffer.byteLength(html, "utf8")} bytes 未壓縮）`);
  return { html, metafile: result.metafile };
}

// 若直接執行（非被 import）才跑。用 pathToFileURL 而非手動字串拼接比對，
// 避免路徑含空白（如本機外接 SSD 的「MAC SSD」）時 percent-encoding 不一致導致判斷恆假。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
