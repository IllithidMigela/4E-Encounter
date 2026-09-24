// 临时诊断：逐个 manual 灵气，逐句调用 matchEffectSentence 输出解析结果，定位失败句
import { readFileSync } from "node:fs";
import { parseCreature } from "../src/monsterParse.ts";
import { matchEffectSentence } from "../src/monsterParse.ts";

const creatures = JSON.parse(readFileSync("public/data/creature.json", "utf8"));
const guards = [];
const masked = (text) => (text ?? "").replace(/（[^）]*）/g, (m) => {
  guards.push(m);
  return `\u0000${guards.length - 1}\u0000`;
});
const restore = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => guards[+i] ?? "");

let manualCount = 0;
for (const entry of creatures) {
  const s = parseCreature(entry);
  if (!s) continue;
  for (const a of s.attacks ?? []) {
    if (a.kind !== "aura") continue;
    const specs = a.effectSpecs ?? [];
    if (specs.length === 0 || specs.some((x) => x.kind === "manual")) {
      manualCount++;
      const t = (a.effectText ?? "") + (a.hit ?? "") + (a.trigger ?? "");
      guards.length = 0;
      const sentences = masked(t).split(/[。；;]/).map((x) => x.trim()).filter(Boolean).map(restore);
      console.log(`\n### [${entry.name}] ${a.name}`);
      for (const raw of sentences) {
        const found = matchEffectSentence(raw);
        const kinds = found.map((f) => f.kind).join("|") || (found.length === 0 ? "∅(纯伤害)" : "");
        console.log(`  ${kinds.padEnd(16)} ← ${raw.slice(0, 90)}`);
      }
    }
  }
}
console.log(`\nmanual 灵气总数: ${manualCount}`);
