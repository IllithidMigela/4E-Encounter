// 临时检查 8：全库召唤生物盘点（标题含「召唤生物」/先攻行「和召出者一样」）
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("../public/data/powers.json", import.meta.url), "utf8"));
const monos = Object.values(d.monsters);
const summons = [];
for (const m of monos) {
  const rt = (m.rawText || "").replace(/<[^>]+>/g, "");
  const isSum = /召唤生物/.test(rt.slice(0, 200)) || /先攻\s*和召出者一样/.test(rt);
  if (isSum) {
    const atkCount = (m.attacks || []).length;
    const hasCat = /bg-category/.test(m.rawText || "");
    summons.push({ name: m.name, atkCount, hasCat, hp: m.maxHp, ac: m.ac });
  }
}
console.log("召唤生物总数:", summons.length);
console.table(summons);
