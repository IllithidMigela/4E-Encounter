// 临时扫描：全库灵气中「恢复/回复 N点生命值」句式（治疗型灵气）的数量与原文
import { readFileSync } from "node:fs";
import { parseCreature } from "../src/monsterParse.ts";

const creatures = JSON.parse(readFileSync("public/data/creature.json", "utf8"));
const hits = [];

for (const entry of creatures) {
  const s = parseCreature(entry);
  if (!s) continue;
  for (const a of s.attacks ?? []) {
    if (a.kind !== "aura") continue;
    const t = (a.effectText ?? "") + (a.hit ?? "") + (a.trigger ?? "");
    if (!/恢复|回复/.test(t)) continue;
    const clauses = t.split(/[，。；]/).filter((c) => c.includes("恢复") || c.includes("回复"));
    for (const clause of clauses) {
      hits.push({ creature: s.name ?? "?", power: a.name ?? "?", text: clause });
    }
  }
}

console.log(`灵气中「恢复/回复」句子总数: ${hits.length}`);
for (const h of hits) console.log(`  [${h.creature}] ${h.power}: ${h.text}`);
