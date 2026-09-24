// 临时检查脚本：挑一只怪物，打印原始 HTML + parseCreature 解析结果，人工核对解析是否正确
import { readFileSync } from "node:fs";
import { parseCreature } from "../src/monsterParse.ts";

const creatures = JSON.parse(readFileSync("public/data/creature.json", "utf8"));

// 挑选的怪物（可改名字切换）
const TARGET = process.argv[2] ?? "铁魔像 Iron Golem";

const entry = creatures.find((e) => e.name === TARGET);
if (!entry) {
  console.log(`未找到「${TARGET}」，可用怪物名示例：`);
  const names = creatures.filter((e) => /生命值/.test(e.sourceText ?? "")).map((e) => e.name);
  console.log(names.slice(0, 40).join("\n"));
  console.log(`...共 ${names.length} 个可解析怪物`);
  process.exit(1);
}

console.log("================ 原始 HTML（sourceText） ================\n");
console.log(entry.sourceText);
console.log("\n\n================ 解析结果 ================\n");
const s = parseCreature(entry);
if (!s) {
  console.log("解析失败（非属性块怪物）");
  process.exit(0);
}
console.log("【基础属性】");
console.log(JSON.stringify({
  name: s.name,
  level: s.level, tier: s.tier, role: s.role, tierTags: s.tierTags,
  size: s.size, sizeClass: s.sizeClass, origin: s.origin, category: s.category, species: s.species,
  xp: s.xp, maxHp: s.maxHp, bloodied: s.bloodied, init: s.init,
  ac: s.ac, fort: s.fort, ref: s.ref, will: s.will, speed: s.speed,
  resistances: s.resistances, vulnerabilities: s.vulnerabilities, immunities: s.immunities,
  insubstantial: s.insubstantial, summoned: s.summoned,
}, null, 1));

console.log("\n【威能 / 特性 逐条】");
for (const a of s.attacks) {
  console.log("----------------------------------------");
  console.log(`■ ${a.name}  [${a.kind}] ${a.freq ? "频率=" + a.freq : ""}`);
  console.log(`  射程: "${a.range}"   目标: "${a.target}"`);
  console.log(`  攻击: ${a.attack} vs ${a.defense}   伤害: "${a.damageExpr}"${a.critExpr ? "   重击: " + a.critExpr : ""}`);
  if (a.trigger) console.log(`  触发: ${a.trigger}`);
  if (a.multiHits) console.log(`  多重攻击: ${a.multiHits} 段${a.multiCond ? "（仅单目标时）" : ""}`);
  if (a.multiRefs) console.log(`  引用多重: ${JSON.stringify(a.multiRefs)}${a.multiSplit ? "（分目标）" : ""}`);
  if (a.halfDamageOnMiss) console.log(`  失手半伤: true`);
  console.log(`  命中段: "${a.hit ?? ""}"`);
  if (a.second) console.log(`  次命中段: "${a.second}"`);
  if (a.miss) console.log(`  未命中段: "${a.miss}"`);
  if (a.effect) console.log(`  效果段: "${a.effect}"`);
  if (a.sustain) console.log(`  维持段: "${a.sustain}"`);
  if (a.damageType) console.log(`  伤害类型: ${a.damageType}`);
  if (a.forcedDist) console.log(`  强制移动距离: ${a.forcedDist}`);
  console.log(`  覆盖率: ${a.coverage}${a.unparsed ? "  [未解析短语]: " + a.unparsed.join(" ； ") : ""}`);
  if (a.effectSpecs && a.effectSpecs.length) {
    console.log(`  语义化效果 ${a.effectSpecs.length} 条:`);
    for (const es of a.effectSpecs) {
      console.log(`    - kind=${es.kind}${es.condition ? " condition=" + es.condition : ""}${es.value !== undefined ? " value=" + es.value : ""}${es.type ? " type=" + es.type : ""}${es.saveOn ? " saveOn=" + es.saveOn : ""}${es.duration ? " duration=" + es.duration : ""}${es.defMods ? " defMods=" + JSON.stringify(es.defMods) : ""}${es.atkMods ? " atkMods=" + es.atkMods : ""}${es.grantCA ? " grantCA" : ""}${es.trigger ? " trigger=" + es.trigger : ""}${es.bloodiedValue !== undefined ? " bloodiedValue=" + es.bloodiedValue : ""}${es.bloodiedOnly ? " bloodiedOnly" : ""}${es.faction ? " faction=" + es.faction : ""}${es.targetBloodied ? " targetBloodied" : ""}${es.note ? " note=" + es.note : ""}`);
      console.log(`        raw: "${es.raw}"`);
    }
  }
}
console.log("\n========================================\n");
