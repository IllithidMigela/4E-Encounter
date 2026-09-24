// 把车卡器数据管线产物（4E-NEXT/out）同步到本项目的 public/data/
// 遭遇战模拟器需要：怪物 creature / 职业 class / 种族 race（根目录三个 JSON）
// 内嵌车卡器（src/4ebuild）需要：manifest / relations / categories 下 7 个词条分类
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "..", "4E-NEXT", "out", "categories");
const srcIndexDir = join(root, "..", "4E-NEXT", "out", "index");
const destDir = join(root, "public", "data");

// 遭遇模拟器直接读取（public/data 根下）
const rootFiles = ["creature.json", "class.json", "race.json"];
// 内嵌车卡器 fetch("data/manifest.json" / "data/search-index.json" / "data/relations.json" / "data/categories/<cat>.json")
const indexFiles = ["manifest.json", "search-index.json", "relations.json"];
// 车卡器 CharacterSheet 实际加载的全部分类（loadCategory 调用全集）
const categoryFiles = [
  "race", "class", "paragon-path", "epic-destiny", "feat", "equipment", "power",
  "ritual", "creature", "vice", "pact", "magic-school", "domain", "virtue", "theme",
];

if (!existsSync(srcDir)) {
  console.error("[copy-data] 未找到车卡器管线产物: " + srcDir);
  console.error("请先在 4E-NEXT 目录运行 pnpm pipeline（或 npm i && npx tsc && node dist/cli.js all）");
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

function copy(src, dest, label) {
  if (!existsSync(src)) {
    console.warn("[copy-data] 缺失 " + label + "，跳过");
    return;
  }
  // 用读写替代 cpSync：Windows 上 cpSync 遇非 ASCII 路径（如【4】）可能触发 Node 原生崩溃
  writeFileSync(dest, readFileSync(src));
  console.log("[copy-data] " + label + " -> " + dest.slice(destDir.length + 1));
}

for (const f of rootFiles) {
  copy(join(srcDir, f), join(destDir, f), f);
}

for (const f of indexFiles) {
  copy(join(srcIndexDir, f), join(destDir, f), f);
}

mkdirSync(join(destDir, "categories"), { recursive: true });
for (const cat of categoryFiles) {
  copy(join(srcDir, cat + ".json"), join(destDir, "categories", cat + ".json"), "categories/" + cat + ".json");
}
console.log("[copy-data] 完成");
