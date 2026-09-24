// 临时分类：全库 manual 灵气句子按句式分类
import { readFileSync } from "node:fs";
import { parseCreature } from "../src/monsterParse.ts";

const creatures = JSON.parse(readFileSync("public/data/creature.json", "utf8"));
const cats = {};
const list = [];

for (const entry of creatures) {
  const s = parseCreature(entry);
  if (!s) continue;
  for (const a of s.attacks ?? []) {
    if (a.kind !== "aura") continue;
    const specs = a.effectSpecs ?? [];
    if (specs.length === 0 || specs.some((x) => x.kind === "manual")) {
      const t = (a.effectText ?? "") + (a.hit ?? "") + (a.trigger ?? "");
      const clauses = t.split(/[。；]/).filter((c) => c.includes("任何") || c.includes("每当") || c.includes("所有") || c.includes("该灵气") || c.includes("生物"));
      for (const clause of clauses) {
        const c0 = clause.slice(0, 60);
        let cat = "其他";
        if (/迟缓/.test(c0)) cat = "迟缓/状态";
        else if (/定身|束缚|眩晕|晕眩|震慑|受控/.test(c0)) cat = "定身/控制";
        else if (/持续伤害/.test(c0)) cat = "持续伤害";
        else if (/恢复|回复/.test(c0)) cat = "治疗";
        else if (/受到.*伤害/.test(c0)) cat = "伤害";
        else if (/倒地|击倒/.test(c0)) cat = "倒地";
        else if (/标记/.test(c0)) cat = "标记";
        else if (/拉|推|滑|移动|瞬移/.test(c0)) cat = "强制移动";
        else if (/临时生命/.test(c0)) cat = "临时生命";
        cats[cat] = (cats[cat] ?? 0) + 1;
        list.push({ cat, creature: s.name, power: a.name, text: c0 });
      }
    }
  }
}

console.log("=== 分类统计 ===");
for (const [k, v] of Object.entries(cats).sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`);
console.log("\n=== 明细（迟缓/状态 / 持续伤害 / 标记）===");
for (const x of list.filter((v) => ["迟缓/状态", "持续伤害", "标记", "定身/控制"].includes(v.cat))) console.log(`[${x.cat}] ${x.creature}·${x.power}: ${x.text}`);
