// 从车卡器 .d4e.json 导入角色，重算战斗属性（与车卡器 deriveStats 保持一致）
import { BASE_WEAPONS } from "./baseWeapons";
import type { AttackOption, CharacterSummary, CombatantStats, DefenseKey } from "./types";

export type AbilityKey = "str" | "con" | "dex" | "int" | "wis" | "cha";
export const ABILITY_KEYS: AbilityKey[] = ["str", "con", "dex", "int", "wis", "cha"];
const ABILITY_ZH: Record<string, AbilityKey> = { 力量: "str", 体质: "con", 敏捷: "dex", 智力: "int", 感知: "wis", 魅力: "cha" };
const ABILITY_NAMES: Record<AbilityKey, string> = { str: "力量", con: "体质", dex: "敏捷", int: "智力", wis: "感知", cha: "魅力" };

const DEFENSE_SOURCES = ["feat", "enhance", "armor", "shield", "other"] as const;

export interface ClassStats {
  baseHp: number;
  hpPerLevel: number;
  surges: number;
  fort: number;
  ref: number;
  will: number;
}

export interface RaceDefenseBonus {
  fort?: number;
  ref?: number;
  will?: number;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function parseClassStats(text: string): ClassStats {
  const pick = (re: RegExp): number => {
    const m = text.match(re);
    return m ? parseFloat(m[1]) : 0;
  };
  return {
    baseHp: pick(/起始HP：[^0-9]*(\d+(?:\.\d+)?)/),
    hpPerLevel: pick(/每级增加HP：[^0-9]*(\d+(?:\.\d+)?)/),
    surges: pick(/每日回复力：[^0-9]*(\d+(?:\.\d+)?)/),
    fort: pick(/\+(\d+(?:\.\d+)?)强韧/),
    ref: pick(/\+(\d+(?:\.\d+)?)反射/),
    will: pick(/\+(\d+(?:\.\d+)?)意志/),
  };
}

export function parseRaceDefenses(text: string): RaceDefenseBonus {
  const out: RaceDefenseBonus = {};
  const grab = (k: keyof RaceDefenseBonus, zh: string) => {
    const m = text.match(new RegExp("你在" + zh + "上获得\\+?(\\d+)种族加值"));
    if (m) out[k] = parseInt(m[1], 10);
  };
  grab("fort", "强韧");
  grab("ref", "反射");
  grab("will", "意志");
  return out;
}

function parseRaceAbilities(race?: { abilityOne?: string; abilityTwo?: string }): { one?: AbilityKey; two: AbilityKey[] } {
  const one = race?.abilityOne ? ABILITY_ZH[race.abilityOne] : undefined;
  const two = (race?.abilityTwo ?? "")
    .split("或")
    .map((s) => ABILITY_ZH[s.trim()])
    .filter((k): k is AbilityKey => !!k);
  return { one, two };
}

function racialBonus(race: { abilityOne?: string; abilityTwo?: string } | undefined, choice?: AbilityKey): Partial<Record<AbilityKey, number>> {
  const { one, two } = parseRaceAbilities(race);
  const bonus: Partial<Record<AbilityKey, number>> = {};
  if (one) bonus[one] = 2;
  const picked = choice ?? two[0];
  if (picked) bonus[picked] = (bonus[picked] ?? 0) + 2;
  return bonus;
}

function applyAbilityBonus(abilities: Record<AbilityKey, number>, bonus: Partial<Record<AbilityKey, number>>): Record<AbilityKey, number> {
  const out = { ...abilities };
  for (const [k, v] of Object.entries(bonus)) {
    if (v) out[k as AbilityKey] += v;
  }
  return out;
}

function sumDefenseMods(m: Record<string, number> | undefined): number {
  if (!m) return 0;
  let s = 0;
  for (const src of DEFENSE_SOURCES) s += Number(m[src] ?? 0);
  return s;
}

/** 体型中文 → 占格数 */
function sizeToSquares(sizeText: string | undefined): number {
  if (!sizeText) return 1;
  if (/超巨型/.test(sizeText)) return 9;
  if (/巨型/.test(sizeText)) return 4;
  if (/大型/.test(sizeText)) return 2;
  return 1;
}

/** .d4e.json 存档的角色对象（宽松索引签名；车卡器 Character 序列化后同构） */
export interface RawD4e {
  [k: string]: unknown;
}

/** 解析 .d4e.json 存档，返回角色对象（兼容结构校验） */
export function parseD4eJson(json: string): { ok: boolean; char?: RawD4e; error?: string } {
  try {
    const data = JSON.parse(json);
    if (!data || data.app !== "dnd4e-kcc" || !data.pages?.character) {
      return { ok: false, error: "文件格式不正确（请使用车卡器导出的 .d4e.json）。" };
    }
    return { ok: true, char: data.pages.character };
  } catch {
    return { ok: false, error: "文件无法解析为 JSON。" };
  }
}

/** 生成导入角色的基础近战/远程攻击 */
function buildBasicAttacks(c: RawD4e, mods: Record<AbilityKey, number>, halfLevel: number): AttackOption[] {
  const attacks: AttackOption[] = [];
  const slots: unknown[] = Array.isArray(c.equipmentSlots) ? (c.equipmentSlots as unknown[]) : [];

  // 匹配装备里的武器：取每把武器中文名（空格前）与条目名比较
  const chineseName = (item: unknown): string => {
    const s = String(item ?? "").trim();
    const idx = s.search(/[A-Za-z]/);
    return (idx > 0 ? s.slice(0, idx) : s).trim();
  };
  let meleeDice: string | undefined;
  let meleeReach = false;
  let rangedDice: string | undefined;
  for (const item of slots) {
    if (!item) continue;
    const cn = chineseName(item);
    for (const w of BASE_WEAPONS) {
      const wCn = w.name.split(" ")[0];
      if (wCn && cn.includes(wCn)) {
        if (/远程/.test(w.category) || /重投/.test(w.traits) || /弓|弩|投石索/.test(w.name)) {
          rangedDice = w.dice;
        } else {
          meleeDice = w.dice;
          if (/触及/.test(w.traits)) meleeReach = true;
        }
        break;
      }
    }
  }

  // 基本近战攻击：攻击 = ½等级 + 力量 + 2(熟练)
  const meleeAttack = halfLevel + mods.str + 2;
  attacks.push({
    key: "basic-melee",
    name: "基本近战攻击",
    kind: "standard",
    range: meleeReach ? "近战2" : "近战1",
    target: "一个生物",
    attack: meleeAttack,
    defense: "ac",
    damageExpr: (meleeDice ?? "1d8") + (mods.str >= 0 ? "+" : "") + mods.str,
    effectText: "由导入角色自动生成，可在右侧面板编辑。",
  });

  // 基本远程攻击：攻击 = ½等级 + 敏捷 + 2
  const rangedAttack = halfLevel + mods.dex + 2;
  attacks.push({
    key: "basic-ranged",
    name: "基本远程攻击",
    kind: "standard",
    range: "远程10",
    target: "一个生物",
    attack: rangedAttack,
    defense: "ac",
    damageExpr: (rangedDice ?? "1d8") + (mods.dex >= 0 ? "+" : "") + mods.dex,
    effectText: "由导入角色自动生成，可在右侧面板编辑。",
  });
  return attacks;
}

/** 由 .d4e.json 角色对象重算战斗属性 */
export function buildCharacterCombatant(
  c: RawD4e,
  classMap: Map<string, unknown>,
  raceMap: Map<string, unknown>,
): CombatantStats {
  const abilities = (c.abilities ?? {}) as Partial<Record<AbilityKey, number>>;
  const level = Math.max(1, Number(c.level ?? 1) || 1);
  const halfLevel = Math.floor(level / 2);

  const raceId = c.raceId as string | undefined;
  const race = raceId ? raceMap.get(raceId) : undefined;
  const raceEntry = race as { abilityOne?: string; abilityTwo?: string; speed?: string; size?: string; name?: string } | undefined;

  const classId = c.classId as string | undefined;
  const classEntry = classId ? (classMap.get(classId) as { sourceText?: string; name?: string } | undefined) : undefined;
  const classId2 = c.classId2 as string | undefined;
  const classEntry2 = c.hybrid && classId2 ? (classMap.get(classId2) as { sourceText?: string; name?: string } | undefined) : undefined;

  // 种族属性加值
  const bonus = racialBonus(raceEntry, c.raceAbility2Choice as AbilityKey | undefined);
  const effRaw: Record<AbilityKey, number> = { str: 10, con: 10, dex: 10, int: 10, wis: 10, cha: 10 };
  for (const k of ABILITY_KEYS) {
    const v = abilities[k];
    if (typeof v === "number") effRaw[k] = v;
  }
  const eff = applyAbilityBonus(effRaw, bonus);
  const mods = ABILITY_KEYS.reduce(
    (acc, k) => {
      acc[k] = abilityModifier(eff[k]);
      return acc;
    },
    {} as Record<AbilityKey, number>,
  );

  // 职业数值（混职合并）
  const a = classEntry ? parseClassStats(classEntry.sourceText ?? "") : { baseHp: 0, hpPerLevel: 0, surges: 0, fort: 0, ref: 0, will: 0 };
  let cls: ClassStats = a;
  if (classEntry2) {
    const b = parseClassStats(classEntry2.sourceText ?? "");
    cls = {
      baseHp: Math.floor(a.baseHp + b.baseHp),
      hpPerLevel: Math.floor(a.hpPerLevel + b.hpPerLevel),
      surges: Math.floor(a.surges + b.surges),
      fort: a.fort + b.fort,
      ref: a.ref + b.ref,
      will: a.will + b.will,
    };
  }

  const rd = parseRaceDefenses((race as { sourceText?: string } | undefined)?.sourceText ?? "");
  const dm = (c.defenseMods ?? {}) as Partial<Record<DefenseKey, Record<string, number>>>;

  const ac = 10 + halfLevel + Math.max(mods.dex, mods.int) + sumDefenseMods(dm.ac);
  const fort = 10 + halfLevel + Math.max(mods.str, mods.con) + cls.fort + sumDefenseMods(dm.fort) + (rd.fort ?? 0);
  const ref = 10 + halfLevel + Math.max(mods.dex, mods.int) + cls.ref + sumDefenseMods(dm.ref) + (rd.ref ?? 0);
  const will = 10 + halfLevel + Math.max(mods.wis, mods.cha) + cls.will + sumDefenseMods(dm.will) + (rd.will ?? 0);
  const initiative = mods.dex + halfLevel;

  const maxHpBase = cls.baseHp + (eff.con ?? 10) + cls.hpPerLevel * Math.max(0, level - 1);
  const hpBonus = Number(c.hpBonus ?? 0) || 0;
  // 混职/半值职业可能出现小数，最终值一律向下取整为整数
  const maxHp = Math.max(1, Math.floor(maxHpBase + hpBonus));
  const bloodied = Math.floor(maxHp / 2);
  const surgeValueBase = Math.floor(maxHp / 4) + (Number(c.surgeValueBonus ?? 0) || 0);
  const surgesTotal = Math.floor(cls.surges + (eff.con ?? 10) + (Number(c.surgeBonus ?? 0) || 0));

  // hpNow 覆盖
  const hpNow = (c.hpNow ?? {}) as Partial<Record<"max" | "bloodied" | "surgeValue" | "surges", number | undefined>>;
  const finalMax = hpNow.max !== undefined ? Math.max(1, Math.floor(Number(hpNow.max) || 1)) : maxHp;
  const finalBloodied = hpNow.bloodied !== undefined ? Math.max(1, Math.floor(Number(hpNow.bloodied) || 1)) : bloodied;
  const finalSurgeValue = hpNow.surgeValue !== undefined ? Math.max(0, Math.floor(Number(hpNow.surgeValue) || 0)) : surgeValueBase;
  const finalSurges = hpNow.surges !== undefined ? Math.max(0, Math.floor(Number(hpNow.surges) || 0)) : surgesTotal;

  // 速度 = 种族基础速度 + 修正
  const speedMods = (c.speedMods ?? {}) as Record<string, number>;
  const speedNum = parseInt(String(raceEntry?.speed ?? ""), 10);
  const speedTotal = (speedMods.power ?? 0) + (speedMods.feat ?? 0) - (speedMods.armor ?? 0) + (speedMods.item ?? 0) + (speedMods.other ?? 0);
  const speed = Number.isNaN(speedNum) ? 6 : speedNum + speedTotal;

  // 角色摘要（展示车卡信息）
  const summary: CharacterSummary = {
    race: raceEntry?.name,
    className: classEntry?.name,
    abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [ABILITY_NAMES[k], eff[k]])) as Record<string, number>,
    trainedSkills: Array.isArray(c.trainedSkills) ? (c.trainedSkills as string[]).filter(Boolean) : [],
    powerNames: flattenPowerNames(c),
    featNames: (Array.isArray(c.featSlots) ? (c.featSlots as unknown[]).filter(Boolean) : []).map(String),
    equipmentNames: (Array.isArray(c.equipmentSlots) ? (c.equipmentSlots as unknown[]).filter(Boolean) : []).map(String),
    paragon: (c.paragonPathId as string) || undefined,
    epic: (c.epicDestinyId as string) || undefined,
  };

  return {
    kind: "pc",
    name: String(c.name ?? "未命名角色"),
    level,
    size: sizeToSquares(raceEntry?.size),
    maxHp: finalMax,
    bloodied: finalBloodied,
    hp: finalMax,
    tempHp: Math.max(0, Number(c.tempHp ?? 0) || 0),
    surges: finalSurges,
    surgesLeft: finalSurges,
    surgeValue: finalSurgeValue,
    ac,
    fort,
    ref,
    will,
    init: initiative,
    speed: Math.max(1, speed),
    attacks: buildBasicAttacks(c, mods, halfLevel),
    char: summary,
  };
}

function flattenPowerNames(c: RawD4e): string[] {
  const slots = c.powerSlots as { atWill?: unknown[]; encounter?: unknown[]; daily?: unknown[]; utility?: unknown[]; special?: unknown[] } | undefined;
  if (!slots) return [];
  const arr: string[] = [];
  for (const key of ["atWill", "encounter", "daily", "utility", "special"]) {
    const list = slots[key as keyof typeof slots];
    if (Array.isArray(list)) {
      for (const p of list) if (p) arr.push(String(p));
    }
  }
  return arr;
}
