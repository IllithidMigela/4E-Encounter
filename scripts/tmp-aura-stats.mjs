// 临时统计：全库灵气（aura）的效果解析现状——auto vs manual、效果类型分布、触发时点句式
import { readFileSync } from "node:fs";
import { parseCreature } from "../src/monsterParse.ts";

const creatures = JSON.parse(readFileSync("public/data/creature.json", "utf8"));
let auraTotal = 0, auraAuto = 0, auraManual = 0;
const autoKinds = new Set();
const startTurnSentences = []; // 「开始回合」句式（当前解析不了的）
const endTurnSentences = [];   // 「结束回合」句式
const bloodiedBranch = [];     // 重伤分支句式

for (const entry of creatures) {
  const s = parseCreature(entry);
  if (!s) continue;
  for (const a of s.attacks ?? []) {
    if (a.kind !== "aura") continue;
    auraTotal++;
    const specs = a.effectSpecs ?? [];
    if (specs.length === 0 || specs.some((x) => x.kind === "manual")) {
      auraManual++;
      const t = (a.effectText ?? "") + (a.hit ?? "") + (a.trigger ?? "");
      if (/开始回合/.test(t)) startTurnSentences.push({ name: a.name, text: t });
      if (/结束其回合|结束回合/.test(t) && /受到|造成/.test(t)) endTurnSentences.push({ name: a.name, text: t });
      if (/重伤/.test(t)) bloodiedBranch.push({ name: a.name, text: t });
    } else {
      auraAuto++;
      for (const sp of specs) autoKinds.add(sp.kind);
    }
  }
}

console.log(`灵气总数: ${auraTotal}  已自动化(auto): ${auraAuto}  需 DM 裁决(manual): ${auraManual}`);
console.log(`auto 灵气用到的效果种类: ${[...autoKinds].join(", ")}`);
console.log(`\n--- manual 灵气中含「开始回合」句式: ${startTurnSentences.length} 条 ---`);
for (const x of startTurnSentences.slice(0, 12)) console.log(`  ${x.name}: ${x.text.slice(0, 80)}`);
console.log(`\n--- manual 灵气中含「结束回合+伤害」句式: ${endTurnSentences.length} 条 ---`);
for (const x of endTurnSentences.slice(0, 12)) console.log(`  ${x.name}: ${x.text.slice(0, 80)}`);
console.log(`\n--- manual 灵气中含「重伤」分支: ${bloodiedBranch.length} 条 ---`);
for (const x of bloodiedBranch.slice(0, 12)) console.log(`  ${x.name}: ${x.text.slice(0, 80)}`);
