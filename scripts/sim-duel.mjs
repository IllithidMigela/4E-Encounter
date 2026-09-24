// 巴菲门特 vs 格拉兹特 互斗模拟（代码级验证）：解析数据 → 引擎/结算纯函数
// 运行：npx tsx scripts/sim-duel.mjs
import { readFileSync } from "node:fs";
import { parseCreature } from "../src/monsterParse.ts";
import { rangeStatus, dealDamage } from "../src/engine.ts";
import { maxDamage } from "../src/dice.ts";
import {
  freshActionBudget,
  applyEffectToCombatant,
  applyOngoingAtTurnStart,
  rollSavesAtTurnEnd,
  spendAction,
} from "../src/battle/resolve.ts";

const creatures = JSON.parse(readFileSync(new URL("../public/data/creature.json", import.meta.url), "utf8"));
const find = (needle) => creatures.find((e) => (e.name ?? "").includes(needle) || (e.nameEn ?? "").includes(needle));

const baphE = find("巴菲门特") ?? find("Baphomet");
const grazE = find("格拉兹特") ?? find("Graz");
if (!baphE) { console.log("❌ 找不到巴菲门特"); process.exit(1); }
if (!grazE) { console.log("❌ 找不到格拉兹特"); process.exit(1); }

const mk = (stats, cid, pos) => ({
  ...stats,
  cid,
  pos,
  conditions: [],
  initResult: 10,
  actionBudget: freshActionBudget(),
  effects: [],
  ongoingDamage: [],
});

const baph = mk(parseCreature(baphE), "b1", { x: 0, y: 0 }); // 体型4
const graz = mk(parseCreature(grazE), "g1", { x: 4, y: 0 }); // 体型1，紧贴巴菲门特右侧

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
};
const atkOf = (c, name) => c.attacks.find((a) => a.name.includes(name));

console.log("======== 1. 数据完整性 ========");
ok("巴菲门特 HP 1295 / 重伤 647", baph.maxHp === 1295 && baph.bloodied === Math.floor(1295 / 2), `hp=${baph.maxHp} bloodied=${baph.bloodied}`);
ok("巴菲门特 防御 AC42/强44/反41/意40 体型4 速度8", baph.ac === 42 && baph.fort === 44 && baph.ref === 41 && baph.will === 40 && baph.size === 4 && baph.speed === 8, `ac=${baph.ac} fort=${baph.fort} ref=${baph.ref} will=${baph.will} size=${baph.size} spd=${baph.speed}`);
ok("格拉兹特 HP 1430 / 重伤 715", graz.maxHp === 1430 && graz.bloodied === Math.floor(1430 / 2), `hp=${graz.maxHp} bloodied=${graz.bloodied}`);
ok("格拉兹特 防御 AC48/强45/反48/意48 体型1 速度6", graz.ac === 48 && graz.fort === 45 && graz.ref === 48 && graz.will === 48 && graz.size === 1 && graz.speed === 6, `ac=${graz.ac} fort=${graz.fort} ref=${graz.ref} will=${graz.will} size=${graz.size} spd=${graz.speed}`);

console.log("======== 2. 巴菲门特威能 ========");
const qxz = atkOf(baph, "切心者");
ok("切心者：随意 标准 近战3 +32 vs AC 3d12+10", qxz?.freq === "随意" && qxz?.kind === "standard" && qxz?.range === "近战3" && qxz?.attack === 32 && qxz?.defense === "ac" && qxz?.damageExpr === "3d12+10", `range=${qxz?.range} +${qxz?.attack} ${qxz?.damageExpr}`);
ok("切心者：命中挂 AC-2（豁免终止）", qxz?.effectSpecs?.some((s) => s.kind === "buff" && s.defMods?.AC === -2 && s.saveOn === "end"), JSON.stringify(qxz?.effectSpecs));
ok("切心者：解析出重击表达式 9d12+46（当前应存在 critExpr 字段）", !!qxz?.critExpr && qxz.critExpr.replace(/\s+/g, "") === "9d12+46", `critExpr=${qxz?.critExpr ?? "（缺失，命中文本中的重击被丢弃）"}`);
const jz = atkOf(baph, "角撞");
ok("角撞：随意 标准 近战2 +31 vs AC 4d8+10 滑2", jz?.kind === "standard" && jz?.range === "近战2" && jz?.attack === 31 && jz?.damageExpr === "4d8+10" && jz?.forcedDist === 2, `+${jz?.attack} ${jz?.damageExpr} forcedDist=${jz?.forcedDist}`);
ok("角撞：滑动2格 + 冲锋附带倒地", jz?.effectSpecs?.some((s) => s.kind === "slide" && s.value === 2) && jz?.effectSpecs?.some((s) => s.kind === "prone"), JSON.stringify(jz?.effectSpecs));
const kblj = atkOf(baph, "狂暴乱击");
ok("狂暴乱击：分目标多重攻击（切心者→目标A，角撞→目标B）", kblj?.multiSplit === true && kblj?.multiRefs?.length === 2 && kblj.multiRefs[0].name === "切心者" && kblj.multiRefs[1].name === "角撞" && kblj.multiRefs.every((r) => r.count === 1), JSON.stringify(kblj?.multiRefs));
const xxkn = atkOf(baph, "血腥狂怒");
ok("血腥狂怒：近程爆发2 +29 vs 强韧 4d8+10 推3+倒地", xxkn?.kind === "standard" && xxkn?.range === "近程爆发2" && xxkn?.attack === 29 && xxkn?.defense === "fort" && xxkn?.damageExpr === "4d8+10" && xxkn?.effectSpecs?.some((s) => s.kind === "push" && s.value === 3) && xxkn?.effectSpecs?.some((s) => s.kind === "prone"), `range=${xxkn?.range} +${xxkn?.attack} ${xxkn?.damageExpr}`);
const symg = atkOf(baph, "深渊迷宫");
ok("深渊迷宫：次要动作 区域10墙4（墙效果）", symg?.kind === "minor" && symg?.range === "区域10墙4" && symg?.effectSpecs?.some((s) => s.kind === "zone"), `range=${symg?.range}`);
const kbkl = atkOf(baph, "可变抗力");
ok("可变抗力：每遭遇3次 即时反应 抗力20", kbkl?.freq === "每遭遇3次" && kbkl?.kind === "immediate" && kbkl?.effectSpecs?.some((s) => s.kind === "resist" && s.value === 20), `freq=${kbkl?.freq}`);
const nh = atkOf(baph, "怒吼");
ok("怒吼：充能(首次重伤) 近程爆发6 +29 vs 意志 7d8+6 雷鸣 晕眩", nh?.range === "近程爆发6" && nh?.attack === 29 && nh?.defense === "will" && nh?.damageType === "thunder" && nh?.effectSpecs?.some((s) => s.kind === "condition" && s.condition === "dazed"), `range=${nh?.range} +${nh?.attack} ${nh?.damageType}`);
const xdxd = atkOf(baph, "鲜血之地");
ok("鲜血之地：灵气5 重伤目标+5伤害(重伤时+10)", xdxd?.aura === true && xdxd?.effectSpecs?.some((s) => s.kind === "buff" && s.dmgMods === 5), `aura=${xdxd?.aura}`);

console.log("======== 3. 格拉兹特威能 ========");
const bszl = atkOf(graz, "悲伤之浪");
ok("悲伤之浪：随意 标准 近战2 +37 vs AC 4d10+27 强酸", bszl?.kind === "standard" && bszl?.range === "近战2" && bszl?.attack === 37 && bszl?.defense === "ac" && bszl?.damageExpr === "4d10+27" && bszl?.damageType === "acid", `range=${bszl?.range} +${bszl?.attack} ${bszl?.damageExpr}`);
ok("悲伤之浪：20点持续强酸伤害（豁免终止）", bszl?.effectSpecs?.some((s) => s.kind === "ongoing" && s.value === 20 && s.type === "acid" && s.saveOn === "end"), JSON.stringify(bszl?.effectSpecs));
ok("悲伤之浪：传送至邻近目标一格", bszl?.effectSpecs?.some((s) => s.kind === "teleport" && s.value === 1), JSON.stringify(bszl?.effectSpecs?.find((s) => s.kind === "teleport")));
ok("悲伤之浪：解析出重击表达式 6d10+67（当前应存在 critExpr 字段）", !!bszl?.critExpr && bszl.critExpr.replace(/\s+/g, "") === "6d10+67", `critExpr=${bszl?.critExpr ?? "（缺失）"}`);
const scgj = atkOf(graz, "双重攻击");
ok("双重攻击：使用2次悲伤之浪", scgj?.multiRefs?.length === 1 && scgj.multiRefs[0].name === "悲伤之浪" && scgj.multiRefs[0].count === 2, JSON.stringify(scgj?.multiRefs));
const wzp = atkOf(graz, "无拒支配");
ok("无拒支配：充能 标准 远程20 +35 vs 意志 支配(豁免-4) + 后效意志-4", wzp?.range === "远程20" && wzp?.attack === 35 && wzp?.defense === "will" && wzp?.effectSpecs?.some((s) => s.kind === "condition" && s.condition === "dominated" && s.saveOn === "end") && wzp?.effectSpecs?.some((s) => s.kind === "buff" && s.saveMods === -4) && wzp?.effectSpecs?.some((s) => s.kind === "buff" && s.defMods?.["意志"] === -4), JSON.stringify(wzp?.effectSpecs));
const bxxf = atkOf(graz, "悲伤旋风");
ok("悲伤旋风：近程爆发2 对每个目标使用悲伤之浪", bxxf?.kind === "standard" && bxxf?.range === "近程爆发2" && bxxf?.multiRefs?.length === 1 && bxxf.multiRefs[0].name === "悲伤之浪", `range=${bxxf?.range}`);
const xekw = atkOf(graz, "邪恶枯萎");
ok("邪恶枯萎：充能 标准 区域10爆发5 +35 vs 反射 5d12+27 虚弱", xekw?.kind === "standard" && xekw?.range === "区域10爆发5" && xekw?.attack === 35 && xekw?.defense === "ref" && xekw?.damageExpr === "5d12+27" && xekw?.effectSpecs?.some((s) => s.kind === "condition" && s.condition === "weakened"), `range=${xekw?.range} +${xekw?.attack} ${xekw?.damageExpr}`);
const gbx = atkOf(graz, "改变形态");
ok("改变形态：次要 变形", gbx?.kind === "minor" && gbx?.effectSpecs?.some((s) => s.kind === "transform"), JSON.stringify(gbx?.effectSpecs));
const xznq = atkOf(graz, "邪恶扭曲");
ok("邪恶扭曲：即时反应 命中后+25额外伤害", xznq?.kind === "immediate" && xznq?.trigger?.includes("命中") && xznq?.effectSpecs?.some((s) => s.kind === "buff" && s.label?.includes("额外伤害")), JSON.stringify(xznq?.effectSpecs));

console.log("======== 4. 射程判定 ========");
const rs1 = rangeStatus("近战2", graz.pos, baph.pos, undefined, 1, 4);
ok("格拉兹特(4,0) 悲伤之浪(近战2) 对 巴菲门特(0,0,体型4)：射程内", rs1?.ok === true, rs1?.label);
const rs2 = rangeStatus("近战3", baph.pos, graz.pos, undefined, 4, 1);
ok("巴菲门特 切心者(近战3) 对 格拉兹特：射程内", rs2?.ok === true, rs2?.label);
const rs3 = rangeStatus("远程20", graz.pos, baph.pos, undefined, 1, 4);
ok("无拒支配(远程20)：射程内", rs3?.ok === true);

console.log("======== 5. 攻击结算（固定骰） ========");
const rollFixed = (expr, vals) => {
  const s = expr.trim().replace(/[，。]/g, "");
  const m = s.match(/^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i);
  if (!m) return parseInt(s, 10) || 0;
  const n = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const bonus = m[3] ? parseInt(m[3].replace(/\s+/g, ""), 10) : 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.min(vals[i] ?? 1, sides);
  return sum + bonus;
};

// 悲伤之浪：d20=15 命中（15+37=52 ≥ AC42）
const b1 = { ...baph };
{
  const d20 = 15, crit = d20 === 20, fumble = d20 === 1;
  const total = d20 + bszl.attack;
  const hit = crit || (!fumble && total >= b1.ac);
  ok("悲伤之浪 d20=15 → 命中", hit, `15+37=${total} vs AC${b1.ac}`);
  const dmg = hit ? (crit ? maxDamage(bszl.critExpr ?? bszl.damageExpr) : rollFixed(bszl.damageExpr, [4, 4, 4, 4])) : 0;
  const before = b1.hp;
  dealDamage(b1, dmg);
  ok("悲伤之浪 命中伤害 4d10+27(全4)=43 → HP 1295→1252", dmg === 43 && b1.hp === 1252, `dmg=${dmg} hp=${b1.hp}`);
}
// 持续强酸
{
  const t1 = applyEffectToCombatant(b1, { cid: b1.cid, conditions: [], ongoingDamage: { type: "acid", value: 20, saveOn: "end" } });
  ok("命中后挂 20 持续强酸（豁免终止）", t1.ongoingDamage?.some((o) => o.type === "acid" && o.value === 20 && o.saveOn === "end"), JSON.stringify(t1.ongoingDamage));
  const t2 = applyOngoingAtTurnStart(t1);
  ok("回合开始自动结算持续强酸 20 → HP 减 20", t2.total === 20 && t2.next.hp === 1232, `total=${t2.total} hp=${t2.next.hp}`);
  const t3 = rollSavesAtTurnEnd(t2.next, () => 5);
  ok("豁免 d20=5 失败 → 持续伤害保留", t3.success === 0 && t3.next.ongoingDamage?.length === 1, JSON.stringify(t3.rolls));
  const t4 = rollSavesAtTurnEnd(t2.next, () => 12);
  ok("豁免 d20=12 成功 → 持续伤害移除", t4.success === 1 && (t4.next.ongoingDamage ?? []).length === 0, JSON.stringify(t4.rolls));
}
// 切心者：d20=20 重击
{
  const b2 = { ...baph };
  const d20 = 20, crit = d20 === 20, fumble = d20 === 1;
  const total = d20 + qxz.attack;
  const hit = crit || (!fumble && total >= graz.ac);
  ok("切心者 d20=20 → 重击命中", hit && crit, `${total} vs AC${graz.ac}`);
  const dmg = hit ? (crit ? maxDamage(qxz.critExpr ?? qxz.damageExpr) : rollFixed(qxz.damageExpr, [3, 3, 3])) : 0;
  const before = b2.hp;
  dealDamage(b2, dmg);
  const expectCrit = qxz.critExpr ? 9 * 12 + 46 : 3 * 12 + 10; // 154（重击表达式） vs 46（普通最大化）
  ok(`切心者 重击伤害最大化 = ${expectCrit}（4E：用重击表达式 9d12+46 取最大）`, dmg === expectCrit && b2.hp === 1295 - expectCrit, `dmg=${dmg} hp=${b2.hp} 期望=${expectCrit}`);
}
// 无拒支配：支配
{
  const g2 = { ...graz };
  const t1 = applyEffectToCombatant(g2, { cid: g2.cid, conditions: ["dominated"] });
  ok("无拒支配命中 → 支配状态", t1.conditions.includes("dominated"), JSON.stringify(t1.conditions));
  const t2 = applyEffectToCombatant(g2, { cid: g2.cid, conditions: ["weakened"] });
  ok("邪恶枯萎命中 → 虚弱状态", t2.conditions.includes("weakened"), JSON.stringify(t2.conditions));
}
// AC-2 效果挂载
{
  const t1 = applyEffectToCombatant({ ...baph }, { cid: baph.cid, conditions: [], effects: [{ kind: "buff", label: "AC-2", raw: "", defMods: { AC: -2 }, duration: "豁免终止" }] });
  ok("切心者命中 → AC-2 效果挂载", t1.effects?.some((e) => e.label === "AC-2" && e.defMods?.AC === -2), JSON.stringify(t1.effects));
}

console.log("======== 6. 伤害修正管线 ========");
// 可变抗力：对酸获得 20 抗力后，43 点酸伤 → 23
{
  const b3 = { ...baph, resistances: { ...(baph.resistances ?? {}), acid: 20 } };
  const r = dealDamage(b3, 43, { type: "acid" });
  ok("巴菲门特 可变抗力(酸20) → 43点酸伤减至 23", r === 23 && b3.hp === 1295 - 23, `applied=${r} hp=${b3.hp}`);
}
// 无抗力时 43 点酸伤全额
{
  const b4 = { ...baph };
  const r = dealDamage(b4, 43, { type: "acid" });
  ok("无抗力 → 43 点酸伤全额", r === 43 && b4.hp === 1295 - 43, `applied=${r}`);
}

console.log("======== 7. 动作预算 ========");
const bd = { ...baph, actionBudget: freshActionBudget() };
const sp1 = spendAction(bd.actionBudget, "standard");
ok("切心者(标准动作) 消耗标准槽", sp1 !== null && sp1.standard === false && sp1.move === true);
const sp2 = spendAction(sp1, "standard");
ok("双重标准动作 → 预算不足拦截", sp2 === null);
const sp3 = spendAction(sp1, "move");
ok("移动可由标准替代", sp3 !== null && sp3.standard === false && sp3.move === false);

console.log(`\n======== 结果：通过 ${pass} / 失败 ${fail} ========`);
