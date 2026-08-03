// 容量報告：對 dist 每個檔案用 brotli -q 11 計算壓縮後 bytes，輸出各檔與總量；
// 並讀 esbuild metafile 輸出模組分解前十名（依 bytes 由大到小）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name !== "meta.json") out.push(full);
  }
  return out;
}

function brotliSize(buf) {
  const compressed = brotliCompressSync(buf, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
  return compressed.length;
}

function formatBytes(n) {
  return `${n.toLocaleString("en-US")} bytes (${(n / 1024).toFixed(2)} KB)`;
}

function report() {
  if (!statSync(distDir, { throwIfNoEntry: false })) {
    console.error("dist/ 不存在，請先執行 npm run build");
    process.exit(1);
  }

  const files = walk(distDir);
  let total = 0;

  console.log("=== 各檔 brotli -q 11 壓縮後大小 ===");
  for (const f of files) {
    const buf = readFileSync(f);
    const size = brotliSize(buf);
    total += size;
    console.log(`  ${path.relative(distDir, f)}: ${formatBytes(size)}（原始 ${formatBytes(buf.length)}）`);
  }
  console.log(`=== 總量（brotli） ===\n  ${formatBytes(total)}`);

  const metaPath = path.join(distDir, "meta.json");
  const meta = statSync(metaPath, { throwIfNoEntry: false });
  if (meta) {
    const metafile = JSON.parse(readFileSync(metaPath, "utf8"));
    const inputs = Object.entries(metafile.inputs ?? {})
      .map(([file, info]) => ({ file, bytes: info.bytes }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10);
    console.log("=== 模組分解前十名（未壓縮原始 bytes，來自 esbuild metafile）===");
    for (const { file, bytes } of inputs) {
      console.log(`  ${file}: ${formatBytes(bytes)}`);
    }
  }

  return total;
}

// pathToFileURL 比對，避免路徑含空白（外接 SSD「MAC SSD」）造成 percent-encoding 不一致。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  report();
}

export { report, brotliSize, walk, distDir };
