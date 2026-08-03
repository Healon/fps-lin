// 零 runtime dependency 守門：package.json 的 dependencies 必須為空物件。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const deps = pkg.dependencies ?? {};
const keys = Object.keys(deps);

if (keys.length > 0) {
  console.error("check:deps 失敗，package.json 的 dependencies 非空：");
  for (const k of keys) console.error(`  ${k}: ${deps[k]}`);
  process.exit(1);
}

console.log("check:deps 通過：零 runtime dependency。");
