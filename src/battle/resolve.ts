// 战斗结算纯函数（批 1-11 并行工程：resolve.ts + events.ts）
// 把可抽的结算逻辑从 App.tsx 抽出为纯函数：App 只做状态装配（undo 快照 + 写回 + 日志），
// 计算全部收敛到这里。批 2 触发系统（借机/灵气/zone）将在此挂载。
// 约定：所有函数不突变入参，返回「下一状态的 combatant 副本 + 结算结果」。
import type { AttackKind, Combatant, DamageType, EffectApplyTarget, EffectSpec, OngoingDamage, TargetResolution } from "../types";
import { DAMAGE_TYPE_LABEL, CONDITION_LABEL } from "../types";
import { addOngoingDamage, dealDamage, fmtMod, heal, isDead, setTempHp } from "../engine";

// ---------- 动作预算（批 3-3a：回合节拍与动作预算） ----------

/** 动作槽位 */
export type ActionSlot = "standard" | "move" | "minor";

/** 动作预算形状 */
export type ActionBudget = { standard: boolean; move: boolean; minor: boolean };

/** 新回合动作预算（标准/移动/次要全可用）。自由动作不计数。 */
export function freshActionBudget(): ActionBudget {
  return { standard: true, move: true, minor: true };
}

/** 动作类型 → 消耗槽位；自由/触发/灵气/特性不消耗动作预算。返回 null = 不消耗。 */
export function actionSlotOf(kind: AttackKind): ActionSlot | null {
  if (kind === "standard") return "standard";
  if (kind === "move") return "move";
  if (kind === "minor") return "minor";
  return null;
}

/**
 * 为一次动作付费（含替代规则）：移动可由标准替、次要可由移动/标准替。
 * 返回扣除后的新预算副本；预算不足返回 null。纯函数，不突变入参。
 */
export function spendAction(budget: ActionBudget, slot: ActionSlot): ActionBudget | null {
  const b = { ...budget };
  const chain: ActionSlot[] =
    slot === "standard" ? ["standard"] : slot === "move" ? ["move", "standard"] : ["minor", "move", "standard"];
  for (const s of chain) {
    if (b[s]) {
      b[s] = false;
      return b;
    }
  }
  return null;
}

/** 能否支付一次动作（只探测不突变）：动作预算检查用 */
export function canSpendAction(budget: ActionBudget | undefined, slot: ActionSlot): boolean {
  return spendAction(budget ?? freshActionBudget(), slot) !== null;
}

// ---------- 效果应用 ----------

/**
 * 把 EffectApplyTarget 应用到棋子副本：条件/持续伤害/再生/临时生命/治疗/挂载效果（批 4c-1：buff/grantCA/hidden）。
 * 返回新副本（不突变）。这是「流程结算」路径（攻击/灵气/zone 自动结算）。
 * 边界约定见 engine.addEffect 的注释：手动挂载走 addEffect（按 label 附加、不写 condUntil），二者对同 label 均「新值替换旧值」去重。
 */
export function applyEffectToCombatant(c: Combatant, t: EffectApplyTarget): Combatant {
  const next = { ...c };
  for (const k of t.conditions) if (!next.conditions.includes(k)) next.conditions.push(k);
  // 批 4e：状态/标记到期边界（condUntil）随效果一起写入，供回合边界到期清理
  if (t.condUntil) next.condUntil = { ...(next.condUntil ?? {}), ...t.condUntil };
  if (t.ongoingDamage) addOngoingDamage(next, t.ongoingDamage);
  if (t.regeneration !== undefined && t.regeneration !== 0) next.regeneration = t.regeneration;
  if (t.tempHp !== undefined && t.tempHp > 0) setTempHp(next, t.tempHp);
  if (t.heal !== undefined && t.heal > 0) heal(next, t.heal);
  if (t.effects && t.effects.length > 0) {
    const list = [...(next.effects ?? [])];
    for (const e of t.effects) {
      const i = list.findIndex((x) => x.label === e.label);
      if (i >= 0) list[i] = e;
      else list.push(e);
    }
    next.effects = list;
  }
  // 批 6：直接伤害（auraDamage 灵气回合触发即时扣血；经 dealDamage 完整管线：临时生命吸收/重伤同步/怪物 0 即死）
  if (t.damage && t.damage > 0) dealDamage(next, t.damage, t.damageType ? { type: t.damageType } : undefined);
  return next;
}

/** 效果应用后的展示摘要（日志用：「受【威能】影响：…」） */
export function effectApplyParts(t: EffectApplyTarget): string[] {
  const parts: string[] = [];
  if (t.conditions.length)
    parts.push(
      t.conditions
        .map((k) => {
          const label = CONDITION_LABEL[k] ?? k;
          const src = t.condUntil?.[k]?.source;
          // 被谁标记/被谁施加状态：来源随 condUntil 记录
          return src ? `${label}（${src}）` : label;
        })
        .join("、"),
    );
  if (t.ongoingDamage) {
    const t0 = t.ongoingDamage.type ? DAMAGE_TYPE_LABEL[t.ongoingDamage.type as DamageType] ?? t.ongoingDamage.type : "";
    parts.push(`持续${t0}伤害 ${t.ongoingDamage.value}（${t.ongoingDamage.saveOn === "start" ? "回合开始豁免" : "豁免终止"}）`);
  }
  if (t.regeneration !== undefined && t.regeneration !== 0)
    parts.push(t.regeneration > 0 ? `再生 ${t.regeneration}` : `强制扣血 ${-t.regeneration}`);
  if (t.tempHp !== undefined && t.tempHp > 0) parts.push(`临时生命 +${t.tempHp}`);
  if (t.heal !== undefined && t.heal > 0) parts.push(`恢复 ${t.heal} 点生命`);
  if (t.damage && t.damage > 0) {
    const d0 = t.damageType ? DAMAGE_TYPE_LABEL[t.damageType as DamageType] ?? t.damageType : "";
    parts.push(`受到 ${t.damage}${d0}伤害`);
    if (t.damageBloodied) parts.push(`（持有者重伤时 ${t.damageBloodied}${d0}伤害）`);
  }
  for (const e of t.effects ?? []) parts.push(e.label);
  return parts;
}

// ---------- 攻击伤害结算 ----------

/** 攻击对单个战斗员目标的伤害+死亡判定纯函数（抽自 App.resolveAttackBody）：
 * 不死之盾（主人灵气减半）以注入的半伤函数传入（依赖 combatants/地图等 App 状态，故不进纯函数）。
 * 返回 { next, dealt, absorbed, died }，不触达 React 状态 / 事件 / 日志。 */
export function applyCombatantHitDamage(
  c: Combatant,
  damageTotal: number,
  halfDamage: (target: Combatant, raw: number) => number | null,
): { next: Combatant; dealt: number; absorbed: number; died: boolean } {
  const shield = halfDamage(c, damageTotal);
  const next = { ...c };
  const dealt = dealDamage(next, shield !== null ? shield : damageTotal);
  return { next, dealt, absorbed: damageTotal - dealt, died: isDead(next) };
}

/** 单个攻击骰（含多重攻击分段）的命中日志文案（纯函数，抽自 App.resolveAttackBody 命中判定段）：
 * 重击（⚡）/失手（✗）为固定短文案；普通为带读数的模板。单段与分段两套模板逐字与原版一致。 */
export function attackRollLogText(a: {
  attackerName: string;
  targetName: string;
  power: string;
  seg?: { n: number; name: string };
  crit: boolean;
  fumble: boolean;
  roll: number;
  attackBonus: number;
  modTotal: number;
  total: number;
  defenseLabel: string;
  defense: number;
  hit: boolean;
}): string {
  const seg = a.seg;
  if (a.crit) {
    return seg
      ? `⚡ ${a.attackerName} 对 ${a.targetName} 第${seg.n}段掷出天然20，【${a.power}】重击命中！`
      : `⚡ ${a.attackerName} 对 ${a.targetName} 掷出天然20，【${a.power}】重击命中！`;
  }
  if (a.fumble) {
    return seg
      ? `✗ ${a.attackerName} 对 ${a.targetName} 第${seg.n}段掷出天然1，【${a.power}】失手！`
      : `✗ ${a.attackerName} 对 ${a.targetName} 掷出天然1，【${a.power}】失手！`;
  }
  const adj = a.modTotal !== 0 ? ` ${fmtMod(a.modTotal)}（调整值）` : "";
  if (seg) {
    return `${a.attackerName} 对 ${a.targetName}【${a.power}】第${seg.n}段（${seg.name}）：d20 ${a.roll} ${fmtMod(a.attackBonus)}${adj} = ${a.total} vs ${a.defenseLabel} ${a.defense}，${a.hit ? "命中" : "未命中"}。`;
  }
  return `${a.attackerName} 对 ${a.targetName}：d20 ${a.roll} ${fmtMod(a.attackBonus)}${adj} = ${a.total} vs ${a.defenseLabel} ${a.defense}，【${a.power}】${a.hit ? "命中" : "未命中"}。`;
}

/** 物体目标命中伤害文案 + 本轮 HP（纯函数，抽自 App 对象伤害段）：HP 按 0 钳制，被摧毁标注。 */
export function objectHitLogText(
  name: string,
  damage: number,
  hp: number,
  maxHp: number,
): { text: string; level: "crit" | "warn"; hp: number } {
  const nhp = Math.max(0, hp - damage);
  return { text: `${name} 受到 ${damage} 点伤害，HP ${nhp}/${maxHp}${nhp <= 0 ? "，被破坏摧毁！" : ""}`, level: nhp <= 0 ? "crit" : "warn", hp: nhp };
}

/** 物体目标免疫文案（纯函数）：意志攻击一律「对抗意志的攻击」，其余按伤害类型标签。 */
export function objectImmuneLogText(name: string, defense: string, damageType: string | undefined): string {
  const dmg = defense === "will" ? "对抗意志的攻击" : `${DAMAGE_TYPE_LABEL[damageType as DamageType] ?? "该类型"}伤害`;
  return `${name} 免疫${dmg}，不受影响。`;
}

export interface HitDamageOutcome {
  t: TargetResolution;
  c: Combatant;
  dealt: number;
  absorbed: number;
  died: boolean;
}

/** 多重命中伤害合计编排（纯函数，抽自 App 攻击伤害结算）：对命中且伤害>0 的战斗员目标逐个结算伤害+死亡判定，
 * 返回各目标的新状态/吸收/致死，供 App 只做 undo/事件/日志/级联/写回副作用。对象目标由调用方过滤。 */
export function resolveCombatantHitDamages(
  targets: TargetResolution[],
  findByCid: (cid: string) => Combatant | undefined,
  halfDamage: (target: Combatant, raw: number) => number | null,
): HitDamageOutcome[] {
  const out: HitDamageOutcome[] = [];
  for (const t of targets) {
    const r = applyCombatantHitDamageFor(t, findByCid, halfDamage);
    if (r) out.push(r);
  }
  return out;
}

function applyCombatantHitDamageFor(
  t: TargetResolution,
  findByCid: (cid: string) => Combatant | undefined,
  halfDamage: (target: Combatant, raw: number) => number | null,
): HitDamageOutcome | undefined {
  if (!t.hit || t.damageTotal <= 0) return undefined;
  const c = findByCid(t.cid);
  if (!c) return undefined;
  const { next, dealt, absorbed, died } = applyCombatantHitDamage(c, t.damageTotal, halfDamage);
  return { t, c: next, dealt, absorbed, died };
}

/** 攻击效果段拆分（纯函数，抽自 App tail() 效果挂载判定）：
 * 4e 分段语义——命中/失手段按命中与否生效，效果段恒生效（when 缺省 = 命中&未命中都挂载）。
 * 返回：hitSpecs（非 miss 才挂载）、missSpecs（非 hit 才挂载）、fmSpecs（命中段中的推拉滑强制移动）。 */
export function splitAttackSpecs(allSpecs: EffectSpec[]): {
  hitSpecs: EffectSpec[];
  missSpecs: EffectSpec[];
  fmSpecs: EffectSpec[];
} {
  const hitSpecs = allSpecs.filter((s) => s.when !== "miss");
  const missSpecs = allSpecs.filter((s) => s.when !== "hit");
  const fmSpecs = hitSpecs.filter((s) => s.kind === "push" || s.kind === "pull" || s.kind === "slide");
  return { hitSpecs, missSpecs, fmSpecs };
}

/** 攻击效果可挂载判定（纯函数，抽自 App.afterResolveApplyEffects）：
 * 需有目标对象且有效果段，且存在任一目标被语义挂载应用到（注入的 applies 返回非 null）。 */
export function hasMountableEffect<T>(targets: Combatant[], specs: EffectSpec[], applies: (c: Combatant) => T | null): boolean {
  if (targets.length === 0 || specs.length === 0) return false;
  return targets.some((c) => applies(c) !== null);
}

/** 被命中反应收集（纯函数，抽自 App 攻击尾部挂载判定）：
 * 仅对存活的命中目标（hp>0）逐个调用注入的检测器，汇总其触发的反应（如 immediate「被命中」威能）。 */
export function collectHitReactions<T>(hurt: HitDamageOutcome[], detect: (target: Combatant) => T[]): T[] {
  const out: T[] = [];
  for (const h of hurt) {
    if (h.c.hp <= 0) continue;
    out.push(...detect(h.c));
  }
  return out;
}

/** 单目标命中伤害日志文案（纯函数，抽自 App 多目标伤害汇总写回段）：含临时生命吸收注记（>0 时）、掷骰注记，与伤势推导（濒死/重伤）。 */
export function hitDamageLogText(
  name: string,
  damageTotal: number,
  absorbed: number,
  hp: number,
  maxHp: number,
  bloodied: number,
  damageParts: readonly (string | number)[],
): string {
  const parts = damageParts.length ? `（骰子：${damageParts.join(", ")}）` : "";
  const absorbNote = absorbed > 0 ? `（${absorbed} 点被临时生命吸收）` : "";
  const wound = hp <= 0 ? "（濒死）" : hp <= bloodied ? "（重伤）" : "";
  return `${name} 受到 ${damageTotal} 点伤害${absorbNote}${parts}，HP ${hp}/${maxHp}${wound}`;
}

// ---------- 回合开始结算 ----------

/** 回合开始：再生。healed 为正=回血，负=强制扣血；0=无再生。返回新副本（不突变）。 */
export function applyRegenAtTurnStart(c: Combatant): { next: Combatant; healed: number } {
  const regen = c.regeneration ?? 0;
  if (regen === 0) return { next: c, healed: 0 };
  const next = { ...c };
  if (regen > 0) heal(next, regen);
  else dealDamage(next, -regen);
  return { next, healed: regen };
}

/** 回合开始：持续伤害逐项结算（相同类型取最高已由 addOngoingDamage 保证）。返回新副本 + 总伤害 + 摘要。 */
export function applyOngoingAtTurnStart(c: Combatant): { next: Combatant; total: number; parts: string[] } {
  const olist = c.ongoingDamage ?? [];
  if (olist.length === 0) return { next: c, total: 0, parts: [] };
  const next = { ...c };
  let total = 0;
  const parts: string[] = [];
  for (const od of olist) {
    dealDamage(next, od.value, { type: od.type });
    total += od.value;
    const t = od.type ? DAMAGE_TYPE_LABEL[od.type as DamageType] ?? od.type : "";
    parts.push(`持续${t}伤害 ${od.value}`);
  }
  return { next, total, parts };
}

// ---------- 回合结束结算 ----------

/** 回合结束：逐项独立豁免（d20 ≥ 10 成功，豁免终止）。返回新副本 + 成功数 + 逐项掷骰结果。 */
export function rollSavesAtTurnEnd(
  c: Combatant,
  d20: () => number,
): {
  next: Combatant;
  success: number;
  rolls: { d20: number; ok: boolean; label: string }[];
} {
  const ongoing = c.ongoingDamage ?? [];
  const kept: OngoingDamage[] = [];
  const rolls: { d20: number; ok: boolean; label: string }[] = [];
  let success = 0;
  for (const v of ongoing) {
    const roll = d20();
    const ok = roll >= 10;
    const t = v.type ? DAMAGE_TYPE_LABEL[v.type as DamageType] ?? v.type : "";
    rolls.push({ d20: roll, ok, label: `持续${t}伤害 ${v.value}` });
    if (ok) success++;
    else kept.push(v);
  }
  const next = success > 0 ? { ...c, ongoingDamage: kept } : c;
  return { next, success, rolls };
}

// ---------- 批 3-3c：死亡豁免 ----------

/**
 * 死亡豁免（4E）：濒死者在回合开始掷 d20——
 * - 天然 20：花费 1 次回复力回血脱离濒死（无回复力则稳定在 0：清零失败计数，不再累计死亡豁免）；
 * - 天然 1：2 次失败；2–9：1 次失败；10–19：无变化；
 * - 累计 3 次失败 → 死亡（失败计数清零，由调用方落实 HP ≤ -重伤值）。
 * 不突变入参，返回下一状态副本 + 掷骰结果。
 */
export function rollDeathSave(
  c: Combatant,
  d20: () => number,
): {
  next: Combatant;
  d20: number;
  outcome: "revive" | "none" | "fail" | "fail2" | "dead";
  fails: number;
  dead: boolean;
  surgeUsed: boolean;
} {
  const roll = d20();
  if (roll === 20) {
    if ((c.surgesLeft ?? 0) > 0) {
      const next = { ...c };
      next.surgesLeft = (next.surgesLeft ?? 0) - 1;
      heal(next, c.surgeValue); // heal 会把负数生命先视为 0、脱离濒死并清零失败
      return { next, d20: roll, outcome: "revive", fails: 0, dead: false, surgeUsed: true };
    }
    const next = { ...c, deathSaveFails: 0 }; // 无回复力：稳定在 0，不再累计失败
    return { next, d20: roll, outcome: "revive", fails: 0, dead: false, surgeUsed: false };
  }
  const prev = c.deathSaveFails ?? 0;
  const fails = prev + (roll === 1 ? 2 : roll <= 9 ? 1 : 0);
  const dead = fails >= 3;
  const next = { ...c, deathSaveFails: dead ? 0 : fails };
  return { next, d20: roll, outcome: dead ? "dead" : roll === 1 ? "fail2" : roll <= 9 ? "fail" : "none", fails, dead, surgeUsed: false };
}
