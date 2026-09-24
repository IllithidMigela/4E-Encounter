// 灵能点（每日灵能资源）推导：灵能职业按等级阶梯表，混职按「灵能强化」特性与可强化随意威能折算。
// 人物页与速览页共用（速览页长休需要把灵能点恢复到上限）。
import type { Entry } from "../data/types";
import type { PowerSlots } from "./character";

// 灵能职业（每日灵能点来源）：炽念使/战魂/心灵术士共用同一阶梯表；武僧不消耗灵能点，故排除。
const PSIONIC_PP_CLASSES = new Set(["炽念使 Ardent", "战魂 Battlemind", "心灵术士 Psion"]);

// 按当前等级返回该灵能职业的每日灵能点，非灵能职业返回 undefined
export function psionicPowerPoints(classId: string | undefined, level: number): number | undefined {
  if (!classId || !PSIONIC_PP_CLASSES.has(classId)) return undefined;
  if (level <= 2) return 2;
  if (level <= 6) return 4;
  if (level <= 12) return 6;
  if (level <= 16) return 7;
  if (level <= 20) return 9;
  if (level <= 22) return 11;
  if (level <= 26) return 13;
  return 15;
}

// 混职灵能点选项：当角色职业能力面板中存在「灵能强化（混职）」特性（即某个混职职业为灵能职业）时启用。
// 灵能点 = Σ(每门「可强化」(keywords 含该词) 的随意攻击威能按等级折算：≤10→2，≤20→4，否则→6)。
function entryGrantsPsionicAugmentation(entry: Entry | undefined): boolean {
  return !!entry && /^!!\s*灵能强化/m.test(entry.sourceText || "");
}

export function hybridPowerPoints(
  clazz: { classId?: string; classId2?: string; powerSlots: PowerSlots },
  resolveClass: (id: string) => Entry | undefined,
  resolvePower: (id: string) => Entry | undefined
): number | undefined {
  if (!clazz.classId2) return undefined; // 非混职
  const e1 = clazz.classId ? resolveClass(clazz.classId) : undefined;
  const e2 = clazz.classId2 ? resolveClass(clazz.classId2) : undefined;
  if (!entryGrantsPsionicAugmentation(e1) && !entryGrantsPsionicAugmentation(e2)) return undefined;
  let sum = 0;
  for (const id of clazz.powerSlots.atWill) {
    if (!id) continue;
    const pw = resolvePower(id);
    if (!pw || !(pw.keywords || "").split(/[,，]/).map((s) => s.trim()).includes("可强化")) continue;
    const lv = parseInt(String(pw.level ?? ""), 10);
    sum += Number.isNaN(lv) ? 2 : lv <= 10 ? 2 : lv <= 20 ? 4 : 6;
  }
  return sum;
}

/** 每日可使用的魔法物品每日威能次数：英雄层 1 / 典范层 2 / 传奇层 3，每达成一个里程碑再 +1。 */
export function magicItemDailyUses(level: number, milestones: number): number {
  const tier = level <= 10 ? 1 : level <= 20 ? 2 : 3;
  return tier + Math.max(0, milestones);
}
