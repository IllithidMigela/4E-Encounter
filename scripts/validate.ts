// 临时验证脚本：用真实数据校验怪物解析与角色派生（打包后 node 运行，验证完删除）
import { readFileSync } from "node:fs";
import { parseMonsterLibrary } from "../src/data";
import { buildCharacterCombatant } from "../src/characterParse";
import { rollDiceExpr, maxDamage } from "../src/dice";
import { buildPath, gridDistance } from "../src/engine";

const creatures = JSON.parse(readFileSync(new URL("../public/data/creature.json", import.meta.url), "utf8"));
const classes = JSON.parse(readFileSync(new URL("../public/data/class.json", import.meta.url), "utf8"));
const races = JSON.parse(readFileSync(new URL("../public/data/race.json", import.meta.url), "utf8"));

const monsters = parseMonsterLibrary(creatures);
console.log("== 怪物解析 ==");
console.log("总条目:", creatures.length, "→ 有属性块:", monsters.length);

const baphomet = monsters.find((m) => m.name.includes("巴菲门特"));
if (baphomet) {
  console.log("样例 巴菲门特:", JSON.stringify({ level: baphomet.level, role: baphomet.role, size: baphomet.size, maxHp: baphomet.maxHp, bloodied: baphomet.bloodied, ac: baphomet.ac, fort: baphomet.fort, ref: baphomet.ref, will: baphomet.will, init: baphomet.init, speed: baphomet.speed, attackCount: baphomet.attacks.length }, null, 1));
  for (const a of baphomet.attacks.slice(0, 3)) {
    console.log("  攻击:", a.name, "|", a.kind, "|", a.range, "|", a.attack !== null ? "+" + a.attack + " vs " + a.defense : "效果", "|", a.damageExpr || "(无伤害)");
  }
} else {
  console.log("!! 未解析出巴菲门特");
}

// 统计攻击解析成功率
const withAtk = monsters.filter((m) => m.attacks.some((a) => a.attack !== null));
console.log("有攻击项的怪物:", withAtk.length, "/", monsters.length);

// 空值防御兜底检查
const bad = monsters.filter((m) => m.ac <= 10 && m.maxHp > 0);
console.log("AC<=10 的怪物(可能解析失败):", bad.length, bad.slice(0, 5).map((m) => m.name));

console.log("\n== 角色派生 ==");
// 找一个战士职业与人类种族
const fighter = classes.find((c: any) => c.name.includes("战士"));
const human = races.find((r: any) => r.name.includes("人类"));
console.log("找到职业:", fighter?.name, "| 种族:", human?.name);
if (fighter && human) {
  const classMap = new Map(classes.map((c: any) => [c.id, c]));
  const raceMap = new Map(races.map((r: any) => [r.id, r]));
  const mockChar = {
    name: "测试战士",
    level: 1,
    abilities: { str: 18, con: 14, dex: 12, int: 10, wis: 10, cha: 8 },
    raceId: human.id,
    classId: fighter.id,
    hybrid: false,
    speedMods: { power: 0, feat: 0, armor: 0, item: 0, other: 0 },
    defenseMods: { ac: { feat: 0, enhance: 0, armor: 2, shield: 0, other: 0 }, fort: { feat: 0, enhance: 0, armor: 0, shield: 0, other: 0 }, ref: { feat: 0, enhance: 0, armor: 0, shield: 0, other: 0 }, will: { feat: 0, enhance: 0, armor: 0, shield: 0, other: 0 } },
    equipmentSlots: ["长剑 Longsword"],
    trainedSkills: ["运动", "地城"],
  };
  const s = buildCharacterCombatant(mockChar, classMap, raceMap);
  console.log("姓名:", s.name, "| 等级:", s.level, "| 体型:", s.size);
  console.log("AC/强韧/反射/意志:", s.ac, s.fort, s.ref, s.will);
  console.log("HP:", s.maxHp, "重伤:", s.bloodied, "回复力:", s.surges, "回复值:", s.surgeValue);
  console.log("先攻:", s.init, "速度:", s.speed);
  for (const a of s.attacks) console.log("  攻击:", a.name, "|", a.range, "| +" + a.attack + " vs " + a.defense, "|", a.damageExpr);
}

console.log("\n== 工具函数 ==");
console.log("rollDiceExpr('3d6+2'):", rollDiceExpr("3d6+2"));
console.log("rollDiceExpr('+3'):", rollDiceExpr("+3"));
console.log("rollDiceExpr('5'):", rollDiceExpr("5"));
console.log("maxDamage('2d8+4'):", maxDamage("2d8+4"));
console.log("buildPath((0,0)->(4,2), speed 5):", JSON.stringify(buildPath({ x: 0, y: 0 }, { x: 4, y: 2 }, 5)));
console.log("gridDistance((0,0),(3,4)):", gridDistance({ x: 0, y: 0 }, { x: 3, y: 4 }));
