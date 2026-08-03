// 零素材檔守門：git ls-files（含 untracked，尊重 .gitignore）過濾禁用副檔名，命中即 exit 1。
import { execFileSync } from "node:child_process";

const FORBIDDEN = /\.(png|jpe?g|gif|webp|svg|wav|mp3|ogg|flac|glb|gltf|fbx|obj|ttf|otf|woff2?)$/i;

function listTrackedFiles() {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

const files = listTrackedFiles();
const hits = files.filter((f) => FORBIDDEN.test(f));

if (hits.length > 0) {
  console.error("check:assets 失敗，偵測到素材檔（違反零素材檔鐵則）：");
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log("check:assets 通過：repo 內零素材檔。");
