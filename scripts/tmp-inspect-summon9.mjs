// 临时检查 10：全库标题含「召唤生物」的怪物
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("../public/data/powers.json", import.meta.url), "utf8"));
const monos = Object.values(d.monsters);
const hits = [];
for (const m of monos) {
  const rt = (m.rawText || "").replace(/<[^>]+>/g, "");
  if (rt.slice(0, 400).includes("召唤生物")) hits.push({ name: m.name, atkCount: (m.attacks || []).length, hasCat: /bg-category/.test(m.rawText || ""), hp: m.maxHp, ac: m.ac });
}
console.log("标题含召唤生物:", hits.length);
console.table(hits);
