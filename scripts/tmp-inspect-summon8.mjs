// 临时检查 9：召出者标记 vs 先攻行对比
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("../public/data/powers.json", import.meta.url), "utf8"));
const monos = Object.values(d.monsters);
let a = [], b = [];
for (const m of monos) {
  const rt = (m.rawText || "").replace(/<[^>]+>/g, "");
  if (rt.includes("召出者")) a.push(m.name);
  if (/先攻[\s\S]{0,3}和召出者一样/.test(rt)) b.push(m.name);
}
console.log("含召出者:", a.length);
console.log("先攻行和召出者一样:", b.length);
console.log("差异(在a不在b):", a.filter(x=>!b.includes(x)).join(' / '));
console.log("差异(在b不在a):", b.filter(x=>!a.includes(x)).join(' / '));
