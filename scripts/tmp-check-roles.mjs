// 临时：批量检查不同职能怪物的威能解析概况（压缩输出，供架构结论核验）
import { readFileSync } from "node:fs";
import { parseCreature } from "../src/monsterParse.ts";

const creatures = JSON.parse(readFileSync("public/data/creature.json", "utf8"));
const TARGETS = process.argv.slice(2);
const seen = new Set();
const kindsCount = {};
const manualCount = {};
let totalPowers = 0;
for (const name of TARGETS) {
  const entry = creatures.find((e) => e.name === name);
  if (!entry || seen.has(name)) continue;
  seen.add(name);
  const s = parseCreature(entry);
  console.log(`\n==== ${name}  [${s ? s.role + " / " + (s.tier || "") : "解析失败"}] ====`);
  if (!s) continue;
  for (const a of s.attacks) {
    totalPowers++;
    const kinds = (a.effectSpecs || []).map((e) => e.kind).join(",") || "(无效果spec)";
    kindsCount[kinds] = (kindsCount[kinds] || 0) + 1;
    const unparsed = a.unparsed && a.unparsed.length ? "  [未解析]: " + a.unparsed.join(" ; ") : "";
    const mv = a.multiRefs ? `  multiRefs=${JSON.stringify(a.multiRefs)}` : "";
    console.log(`  ■ ${a.name}  [${a.kind}] cov=${a.coverage}${unparsed}${mv}`);
    console.log(`      specs: ${kinds}`);
    for (const es of a.effectSpecs || []) {
      manualCount[es.kind] = (manualCount[es.kind] || 0);
      if (es.kind === "manual") console.log(`        → MANUAL: ${es.raw}`);
    }
  }
}
console.log(`\n\n==== 合计 ${TARGETS.length} 只怪，${totalPowers} 个威能 ====`);
console.log("按效应kind组合分布:", JSON.stringify(kindsCount, null, 1));