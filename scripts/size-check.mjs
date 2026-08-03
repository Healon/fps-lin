// 容量閘門：讀 budget.json 比對 dist/ 的 brotli 壓縮總量，超過當前里程碑上限即 exit 1。
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");
const budgetPath = path.join(root, "budget.json");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name !== "meta.json") out.push(full);
  }
  return out;
}

function brotliTotal() {
  let total = 0;
  for (const f of walk(distDir)) {
    const buf = readFileSync(f);
    total += brotliCompressSync(buf, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
  }
  return total;
}

if (!existsSync(distDir)) {
  console.error("size:check 失敗，dist/ 不存在，請先執行 npm run build");
  process.exit(1);
}

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
const total = brotliTotal();

console.log(`size:check：目前階段 ${budget.current}，上限 ${budget.limitBytes} bytes，實際 brotli 總量 ${total} bytes`);

if (total > budget.limitBytes) {
  console.error(`size:check 失敗：超過上限 ${total - budget.limitBytes} bytes`);
  process.exit(1);
}

console.log("size:check 通過。");
