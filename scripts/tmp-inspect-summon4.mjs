// 临时检查 5：全库无攻击解析的怪物盘点（紧凑格式 vs 真无攻击）
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("../public/data/powers.json", import.meta.url), "utf8"));
const monos = Object.values(d.monsters);
let noAtk = [];
for (const m of monos) {
  const rt = (m.rawText || "").replace(/<[^>]+>/g, "");
  if (!(m.attacks || []).length && /vs\.?\s*(AC|强韧|反射|意志)/.test(rt)) {
    // 该怪物原文含 vs. 但未解析出攻击 → 紧凑格式受害者
    noAtk.push(m.name);
  }
}
console.log("无攻击解析但原文含 vs. 的怪物:", noAtk.length);
console.log(noAtk.join(" / "));
