// 临时：全库聚合——统计不同职能怪的威能被解析成 manual(→DM) 的规模与原因，供架构结论核验
import { readFileSync } from "node:fs";
import { parseCreature } from "../src/monsterParse.ts";

const creatures = JSON.parse(readFileSync("public/data/creature.json", "utf8"));
const parseable = creatures.filter((e) => /生命值/.test(e.sourceText ?? ""));
console.log(`可解析怪物: ${parseable.length} / ${creatures.length}`);

let totalPowers = 0, monstersWithManual = 0, powerWithManual = 0;
const covCount = { fully: 0, partial: 0, manual: 0, uncov: 0 };
const kindCount = {};          // effectSpec kind 出现次数
const manualRaw = {};          // manual 效果短语（去重计数）
const manualKinds = {};        // manual 所在威能有其它 kind 的情况
let powerWithZeroSpec = 0;

function firstPara(t){ const i = t.indexOf("。"); return (i>0? t.slice(0,i): t).slice(0,26); }

for (const e of parseable) {
  let s; try { s = parseCreature(e); } catch { continue; }
  if (!s || !Array.isArray(s.attacks)) continue;
  let hasManual = false;
  for (const a of s.attacks) {
    totalPowers++;
    covCount[a.coverage] = (covCount[a.coverage] || 0) + 1;
    const specs = a.effectSpecs || [];
    if (specs.length === 0) powerWithZeroSpec++;
    let pm = false;
    for (const es of specs) {
      kindCount[es.kind] = (kindCount[es.kind] || 0) + 1;
      if (es.kind === "manual") {
        pm = true; hasManual = true;
        const r = firstPara(es.raw || "");
        manualRaw[r] = (manualRaw[r] || 0) + 1;
      }
    }
    if (pm) powerWithManual++;
  }
  if (hasManual) monstersWithManual++;
}

console.log(`\n威能总数: ${totalPowers}`);
console.log(`coverage 分布: ${JSON.stringify(covCount)}`);
console.log(`无任何 effectSpec 的威能: ${powerWithZeroSpec}`);
console.log(`含 manual(→DM兜底) 的威能: ${powerWithManual} (${(100*powerWithManual/totalPowers).toFixed(1)}%)`);
console.log(`至少含一个 manual 威能的怪物: ${monstersWithManual} (${(100*monstersWithManual/parseable.length).toFixed(1)}%)`);

console.log(`\neffectSpec.kind 分布 (Top 25):`);
Object.entries(kindCount).sort((x,y)=>y[1]-x[1]).forEach(([k,v],i)=> i<25 && console.log(`  ${k}: ${v}`));

console.log(`\nmanual 去重短语 Top 30（能看出"模型不认识的语义"长什么样）:`);
Object.entries(manualRaw).sort((x,y)=>y[1]-x[1]).slice(0,30).forEach(([k,v])=>console.log(`  ${v}  ${k}`));