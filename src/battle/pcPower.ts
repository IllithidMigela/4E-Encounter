// 车卡器角色威能 → 遭遇攻击选项（AttackOption）转换。
// 角色（速览面板里的威能 chip）仅有 usage/展示数据，不带攻击行为；
// 此模块把威能条目的 details 表格（目标/攻击/命中/效果…）解析成可进入地图瞄准→攻击结算条的 AttackOption，
// 攻加/伤害从速览推导层（GlanceData）取值，保证与角色卡数字一致。DM 仍可在结算条微调。
import type { Entry } from "../4ebuild/data/types";
import type { GlanceData } from "../4ebuild/overview/derive";
import type { AbilityKey } from "../4ebuild/sheet/character";
import type { AttackKind, AttackOption, DefenseKey } from "../types";
import { DAMAGE_TYPE_ZH } from "../types";
import { stripTags, parsePowerEffects } from "../monsterParse";

/** 中文属性名 → AbilityKey（与 character.ts 同口径） */
const ABIL_ZH: Record<string, AbilityKey> = {
  力量: "str",
  体质: "con",
  敏捷: "dex",
  智力: "int",
  感知: "wis",
  魅力: "cha",
};

const DEF_ZH: Record<string, DefenseKey> = { AC: "ac", 强韧: "fort", 反射: "ref", 意志: "will" };

const ACTION_KIND: Record<string, AttackKind> = {
  标准动作: "standard",
  移动动作: "move",
  次要动作: "minor",
  自由动作: "free",
  触发: "immediate",
  特性: "trait",
  特质: "trait",
  灵气: "aura",
};

/** 把 details 的 `<th>标签</th><td>正文</td>` 表行解析成 label → 纯文本。PC 威能用此格式（sourceText 只是 <<power-format>>）。 */
function detailMap(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /<th>([^<]+)<\/th>\s*<td>([\s\S]*?)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const k = stripTags(m[1]).replace(/[：:]/g, "").replace(/\s+/g, "").trim();
    const v = stripTags(m[2]).trim();
    if (k && v) map[k] = v;
  }
  return map;
}

/** 是否是可发起攻击的威能（details 里有「攻击：…vs…」行）。纯支持/效果型威能不返回。 */
export function pcPowerHasAttack(p: Entry): boolean {
  if (!p.details) return false;
  return /vs/i.test(detailMap(p.details)["攻击"] ?? "");
}

/** 射程归一化：把「近战武器/远程武器」等 4e 简记补成 parseRange 可解析的数字形式；已含数字的保持原样。 */
function normalRange(range: string | undefined): string {
  const r = (range ?? "").trim();
  if (/近程爆发|近程冲击|近距喷吐|区域|范围|近战\d|远程\d|灵气\d/.test(r)) return r;
  if (!r || r === "近战武器" || r === "近战") return "近战1";
  if (r === "远程武器" || r === "远程") return "远程10";
  return r;
}

/** 把「N[W]」（武器伤害）展开为实际骰数；无 [W] 时从命中句提取显式骰式（如 2d8）。 */
function weaponDamage(hit: string, baseDice: string): { dice: string; isWeapon: boolean } {
  const mW = hit.match(/(\d*)\[W\]/);
  if (mW) {
    const n = parseInt(mW[1] || "1", 10);
    const bd = baseDice.match(/(\d+)d(\d+)/);
    if (bd) return { dice: `${parseInt(bd[1], 10) * n}d${bd[2]}`, isWeapon: true };
    return { dice: baseDice || "1d8", isWeapon: true };
  }
  const mExplicit = hit.match(/\b(\d+d\d+)\b/);
  if (mExplicit) return { dice: mExplicit[1], isWeapon: false };
  return { dice: baseDice || "", isWeapon: false };
}

function statMod(k: AbilityKey, d: GlanceData): number {
  return d.mods?.[k] ?? 0;
}

/** 从命中句构造伤害表达式：取到「伤害」为止的从句，展开 [W]→武器骰、置换「能力调整值」为实际加值。
 *  加值取角色卡该属性伤害行「完整伤害修正」（能力调整+增强+专长+其他），与速览面板 2d6+12 一致；
 *  无对应伤害行时退化为裸属性调整。 */
function damageExprOf(hit: string, d: GlanceData, weapon: string): string {
  const idx = hit.indexOf("伤害");
  const clause = idx >= 0 ? hit.slice(0, idx) : hit;
  let expr = clause.replace(/[后时及之的]/g, "").replace(/\s+/g, " ").trim();
  expr = expr.replace(/(\d*)\[W\]/g, () => weapon || "1d8");
  for (const [zh, k] of Object.entries(ABIL_ZH)) {
    const mod = d.damages.find((dm) => dm.ability === k)?.total ?? statMod(k, d);
    expr = expr.split(zh + "调整值").join(String(mod));
  }
  // 裸属性名（未带「调整值」）也置换其伤害加值，避免「4d6 + 力量」漏算而残留悬空 +
  for (const [zh, k] of Object.entries(ABIL_ZH)) {
    if (!expr.includes(zh)) continue;
    const mod = d.damages.find((dm) => dm.ability === k)?.total ?? statMod(k, d);
    expr = expr.split(zh).join(String(mod));
  }
  // 负数调整值：把「+ -2」归并为「- 2」；去掉首尾多余算符与残余中文
  expr = expr.replace(/\+\s*(-)/g, "$1").replace(/[+ ]+$/, "").replace(/^[+ ]+/, "");
  expr = expr.replace(/[\u4e00-\u9fa5]+$/, "");
  return expr.replace(/\s+/g, " ").trim();
}

/** 从攻击线「感知 vs. AC」解析属性与防御；解析不出则回退主利手攻加/AC。 */
function parseAttackLine(line: string): { ability?: AbilityKey; defense: DefenseKey } {
  const m = line.match(/(力量|敏捷|体质|智力|感知|魅力)(?:或(力量|敏捷|体质|智力|感知|魅力))?\s*vs\.?\s*(AC|强韧|反射|意志)/i);
  if (!m) return { defense: "ac" };
  return { ability: ABIL_ZH[m[1]] ?? ABIL_ZH[m[2]], defense: DEF_ZH[m[3]] ?? "ac" };
}

/** 从命中/效果句识别伤害类型（中文词 → 标准键）。 */
function typeOf(txt: string): string | undefined {
  for (const zh of Object.keys(DAMAGE_TYPE_ZH)) {
    if (txt.includes(zh) && /伤害|攻击/.test(txt)) return DAMAGE_TYPE_ZH[zh];
  }
  return undefined;
}

/** 把 PC 威能条目转成可瞄准的攻击选项；威能无敌的目标（纯支持/效果型）返回 null。 */
export function pcPowerToAttack(p: Entry, d: GlanceData): AttackOption | null {
  const map = detailMap(p.details ?? "");
  const attackLine = map["攻击"] ?? "";
  if (!/vs/i.test(attackLine)) return null;

  const { ability, defense } = parseAttackLine(attackLine);
  const hit = map["命中"] ?? "";
  const kind: AttackKind =
    ACTION_KIND[(p.actionType ?? "").trim()] ?? (p.keywords && /灵气/.test(p.keywords) ? "aura" : "standard");

  // 攻加：优先取角色攻击面板里同属性那一行（含 ½ 等级+属性+熟练+增强+专长+其他），保证与卡上数字一致
  const row = ability ? d.attacks.find((a) => a.ability === ability) : undefined;
  const attack = ability ? (row ? row.total : d.halfLevel + statMod(ability, d) + d.enhanceOf(0)) : d.halfLevel + d.enhanceOf(0);

  // 伤害骰：取角色攻击面板同属性伤害行的基础武器骰
  const baseDice = ability
    ? d.damages.find((dm) => dm.ability === ability)?.dice ?? d.damages[0]?.dice ?? ""
    : d.damages[0]?.dice ?? "";
  const w = weaponDamage(hit, baseDice);
  const damageExpr = damageExprOf(hit, d, w.dice);

  const effectText = [hit, map["次命中"], map["未命中"], map["失手"], map["效果"], map["维持"], map["特殊"]]
    .filter((s): s is string => !!s)
    .join(" ");

  const freq = (p.usageZh ?? "").trim() || undefined;

  // 解析前把「等同于{属性}调整值的(加值|减值)」代成字面数值（原始 effectText 仍作展示）。
  // 例：魅力mod=+4 → 「在伤害骰上受到等同于你魅力调整值的减值」→「在伤害骰上受到-4减值」，由 monsterParse 正则 12c 解析。
  const parsedText = effectText
    // 加值/减值：带上符号（减值取负），交 parsePowerEffects 按「加值/减值」再判号
    .replace(/等同于(?:你|其)?(力量|敏捷|体质|智力|感知|魅力)调整值的(加值|减值)/g, (_m, zh: string, modType: string) => {
      const mod = statMod(ABIL_ZH[zh], d);
      return modType === "加值" ? `+${mod}加值` : `-${Math.abs(mod)}减值`;
    })
    // 抗力：无语义化同学（例如「获得等同于你体质调整值的全伤害抗力」）→ 代成「N点全伤害抗力」
    .replace(/等同于(?:你|其)?(力量|敏捷|体质|智力|感知|魅力)调整值的(全伤害抗力|全[^，。；]{0,3}抗力|抗力)/g, (_m, zh: string) => {
      return `${Math.abs(statMod(ABIL_ZH[zh], d))}点全伤害抗力`;
    });

  let specs: AttackOption["effectSpecs"] = [];
  try {
    const r = parsePowerEffects(parsedText);
    if (r.specs.length) specs = r.specs;
  } catch {
    /* 解析异常不阻断攻击 */
  }

  return {
    key: "pcp-" + p.id,
    name: p.name,
    kind,
    range: normalRange(p.range),
    target: map["目标"] || "一个生物",
    attack,
    attackVar: false,
    defense,
    damageExpr,
    effectText,
    freq,
    hit,
    second: map["次命中"],
    miss: map["未命中"] || map["失手"],
    effect: map["效果"],
    sustain: map["维持"],
    aura: kind === "aura",
    damageType: typeOf(hit + (map["效果"] ?? "")),
    effectSpecs: specs,
    coverage: p.powerKind === "attack" ? "partial" : "manual",
  };
}