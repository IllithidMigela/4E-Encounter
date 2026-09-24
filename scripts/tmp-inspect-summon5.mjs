// 临时检查 6：非召唤怪物的紧凑攻击格式样例
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("../public/data/powers.json", import.meta.url), "utf8"));
const monos = Object.values(d.monsters);
for (const n of ["不死士兵", "暴风束", "神佣兵刽子手", "食魔者", "星羽蛇", "战弩手"]) {
  const m = monos.find((x) => x.name === n);
  if (!m) continue;
  console.log("### " + n);
  const blocks = (m.rawText || "").matchAll(/bg-power">([\s\S]*?)<\/div>\s*<div class=description>([\s\S]*?)<\/div>/g);
  for (const b of blocks) {
    const hdr = b[1].replace(/<[^>]+>/g, "").replace(/^\{\{[^}]*\}\}\s*/, "").trim();
    const desc = b[2].replace(/<[^>]+>/g, "").trim();
    console.log("  " + hdr.split("✦")[0] + " → " + desc.slice(0, 100));
  }
}
