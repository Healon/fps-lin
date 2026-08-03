// 極簡靜態伺服器：供 dist/ 使用，埠 8331（Playwright webServer 用）。
// 單檔輸出：index.html 已內嵌所有 JS，本伺服器只需回應 index.html 本身即可，
// 但仍以路徑感知方式回應，避免任何路徑回 404 影響驗收。
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");
const indexPath = path.join(distDir, "index.html");
const PORT = 8331;

const server = createServer((req, res) => {
  if (!existsSync(indexPath)) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("dist/index.html 不存在，請先執行 npm run build");
    return;
  }
  const html = readFileSync(indexPath, "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html, "utf8"),
  });
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`serve.mjs 已啟動：http://localhost:${PORT}`);
});
