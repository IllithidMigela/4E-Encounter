// 批 2-2：触发系统纯函数层（借机双触发源 + 灵气/zone 辅助）
// 借机：移动离开威胁格 / 使用远程/区域/近程威能时被邻接敌人借机。
// 约定：全部纯函数、不突变入参；骰子经参数注入（d20 返回 1..20，damage 返回掷骰点数）。
// 复用 engine 的 reachCells/closeBurstCells/affectedIn/centerOf/parseRange/computeDamage/threatCells/threatReachOf
// 与 resolve 的 applyEffectToCombatant。
import type { AttackOption, BattlePhase, Combatant, ConditionKey, EffectApplyTarget, EffectSpec, PhaseTriggerHit, Zone } from "../types";
import {
  affectedIn,
  auraRadius,
  closeBurstCells,
  computeDamage,
  condUntilOf,
  dealDamage,
  fmtMod,
  isDead,
  parseRange,
  parseTargetSpec,
  sameTeam,
  threatCells,
  threatReachOf,
  zoneCellsOf,
  zonesAt,
  type Point,
} from "../engine";
import { applyEffectToCombatant } from "./resolve";
import { maxDamage, parseDiceExpr } from "../dice";

/** 触发检测上下文（不变数据；App 每次调用时从当前状态装配） */
export interface TriggerCtx {
  /** 全体参战者（含发起者/移动者） */
  combatants: Combatant[];
  cols: number;
  rows: number;
  obstacles: Set<string>;
}

/** 一次借机触发（谁、用什么威能、在哪一步、停点参考） */
export interface OAProvoker {
  enemyCid: string;
  /** 借机威能（已由 oaPowerOf 选定） */
  power: AttackOption;
  /** 移动触发：离开威胁格的步进下标（path 内，0=第一步进入；停点=该步之前所在格） */
  atIndex: number;
  /** 离开威胁格时的位置（命中即停的落点参考） */
  fromCell: Point;
  /** DM 裁决标注（目盲/被支配等无法自动判定的敌人） */
  dmNote?: string;
}

/** 一次借机结算结果 */
export interface OAResult {
  provoker: OAProvoker;
  enemyName: string;
  d20: number;
  attackBonus: number;
  /** 被标记目标 → 借机攻击 +2（即目标 -2 惩罚） */
  markedBonus: number;
  total: number;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
  defense: number;
  defenseLabel: string;
  /** 命中后的实际伤害（已按 computeDamage 管线修正；未命中/失手 = 0） */
  damage: number;
  /** 是否实际生效（命中即停：仅最早命中那一步的借机生效，更晚的步进不触发） */
  applied: boolean;
}

/** 借机威能选择：优先 kind=immediate 且 trigger 含「借机」条目；回退近战基本攻击；无 → null（DM 裁决）。 */
export function oaPowerOf(c: Pick<Combatant, "attacks">): AttackOption | null {
  const attacks = c.attacks ?? [];
  const imm = attacks.find((a) => a.kind === "immediate" && (a.trigger ?? "").includes("借机") && a.attack !== null);
  if (imm) return imm;
  // 回退：射程最近战、有攻加的威能（视作基本攻击）；射程大的优先
  const melee = attacks
    .filter((a) => a.attack !== null && /^近战\d+/.test(a.range ?? ""))
    .sort((a, b) => (reachOf(a) - reachOf(b)));
  return melee[0] ?? null;
}

function reachOf(a: AttackOption): number {
  const m = (a.range ?? "").match(/近战(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** 敌人能否自动结算借机：无助/失去意识/震慑/石化/被支配 不能（被支配标注 DM 裁决）；目盲标注 DM 裁决。 */
function oaEligible(e: Combatant, dm: string[]): boolean {
  if (e.conditions.some((k) => k === "helpless" || k === "unconscious" || k === "stunned" || k === "petrified")) return false;
  if (e.conditions.includes("dominated")) {
    dm.push(`${e.name} 被支配（DM 裁决是否借机）`);
    return false;
  }
  if (e.conditions.includes("blinded")) dm.push(`${e.name} 目盲（DM 裁决借机）`);
  return true;
}

/** 移动者占格集合（占地 size×size，左上角 pos） */
function occupiedCells(m: Pick<Combatant, "pos" | "size">): Set<string> {
  const out = new Set<string>();
  if (!m.pos) return out;
  for (let dy = 0; dy < (m.size ?? 1); dy++) {
    for (let dx = 0; dx < (m.size ?? 1); dx++) out.add(m.pos.x + dx + "," + (m.pos.y + dy));
  }
  return out;
}

/** 某位置（新左上角）的占格是否与威胁格集相交 */
function spaceIntersects(pos: Point, size: number, threat: Set<string>): boolean {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (threat.has(pos.x + dx + "," + (pos.y + dy))) return true;
    }
  }
  return false;
}

/** 检测移动借机：逐格扫 path，mover 占地与敌人威胁格相交 → 下一步不相交 ⇒ 触发（离开威胁格）。
 * 排除 forced/shift（调用方保证不发：forcedMove 不调本函数，shift 时 oaPlan=[]）。
 * 返回借机触发列表（按步进顺序）。 */
export function detectMoveOA(mover: Combatant, path: Point[], ctx: TriggerCtx): OAProvoker[] {
  if (!mover.pos || path.length === 0) return [];
  const out: OAProvoker[] = [];
  const dm: string[] = [];
  const byCid = new Map(ctx.combatants.map((c) => [c.cid, c]));
  const enemies = ctx.combatants.filter(
    (c) => c.cid !== mover.cid && c.pos && !sameTeam(c, mover, byCid) && c.hp > 0,
  );
  for (const e of enemies) {
    if (!oaEligible(e, dm)) continue;
    const reach = threatReachOf(e);
    const threat = threatCells(e.pos!, e.size, reach, ctx.cols, ctx.rows);
    let prevSpace = mover.pos;
    let prevHit = spaceIntersects(prevSpace, mover.size, threat);
    for (let i = 0; i < path.length; i++) {
      const next = path[i];
      const nextHit = spaceIntersects(next, mover.size, threat);
      if (prevHit && !nextHit) {
        const power = oaPowerOf(e);
        if (power) {
          out.push({ enemyCid: e.cid, power, atIndex: i, fromCell: { ...prevSpace } });
        } else {
          dm.push(`${e.name} 无借机威能（DM 裁决）`);
        }
      }
      prevSpace = next;
      prevHit = nextHit;
    }
  }
  // 目盲/被支配/无借机威能的 DM 标注：附加到第一个 provoker 上（供结算条提示）
  if (dm.length > 0 && out.length > 0) out[0].dmNote = dm.join("；");
  return out;
}

/** 检测威能借机：usePower 且 parseRange(range).type ∈ {ranged, area, close} 且敌人威胁格 ∩ 使用者占地 ≠ ∅ ⇒ 触发。
 * 近战/快步/无射程不触发。 */
export function detectPowerOA(actor: Combatant, power: AttackOption, ctx: TriggerCtx): OAProvoker[] {
  const pr = parseRange(power.range);
  if (pr.type !== "ranged" && pr.type !== "area" && pr.type !== "close") return [];
  if (!actor.pos) return [];
  const actorCells = occupiedCells(actor);
  const out: OAProvoker[] = [];
  const dm: string[] = [];
  const byCid = new Map(ctx.combatants.map((c) => [c.cid, c]));
  for (const e of ctx.combatants) {
    if (e.cid === actor.cid || !e.pos || sameTeam(e, actor, byCid) || e.hp <= 0) continue;
    if (!oaEligible(e, dm)) continue;
    const reach = threatReachOf(e);
    const threat = threatCells(e.pos!, e.size, reach, ctx.cols, ctx.rows);
    let adjacent = false;
    for (const k of actorCells) {
      if (threat.has(k)) { adjacent = true; break; }
    }
    if (adjacent) {
      const p = oaPowerOf(e);
      if (p) out.push({ enemyCid: e.cid, power: p, atIndex: 0, fromCell: { ...actor.pos } });
      else dm.push(`${e.name} 无借机威能（DM 裁决）`);
    }
  }
  if (dm.length > 0 && out.length > 0) out[0].dmNote = dm.join("；");
  return out;
}

/**
 * 统一结算一批借机（统一掷骰）：每个 provoker 独立 d20；命中即停取最小 atIndex。
 * 最早命中步之后的借机（atIndex 更大）不生效（applied=false），只展示骰值。
 * damage 由调用方注入点数（App 统一掷）；crit 时按威能伤害表达式取最大。 */
export function settleOABatch(
  provokers: OAProvoker[],
  target: Combatant,
  ctx: TriggerCtx,
  roll: { d20: () => number; damage: (expr: string) => number },
): { results: OAResult[]; stopIndex: number | null } {
  const results: OAResult[] = [];
  let stopIndex: number | null = null;
  for (const p of provokers) {
    const enemy = ctx.combatants.find((c) => c.cid === p.enemyCid);
    if (!enemy) continue;
    const d20 = roll.d20();
    const crit = d20 === 20;
    const fumble = d20 === 1;
    const markedBonus = target.conditions.includes("marked") ? 2 : 0;
    const attackBonus = (p.power.attack ?? 0) + markedBonus;
    const total = d20 + attackBonus;
    const defense = target[p.power.defense];
    const hit = crit || (!fumble && total >= defense);
    // 伤害：重击取最大；无伤害表达式 → 仍按注入点数（DM 手填）
    const expr = p.power.damageExpr.trim();
    const exprValid = !!expr && !!parseDiceExpr(expr);
    const raw = hit ? (crit && exprValid ? maxDamage(expr) : roll.damage(expr)) : 0;
    const dmgResult = raw > 0 ? computeDamage(target, raw, { type: p.power.damageType }) : null;
    results.push({
      provoker: p,
      enemyName: enemy.name,
      d20,
      attackBonus,
      markedBonus,
      total,
      hit,
      crit,
      fumble,
      defense,
      defenseLabel: p.power.defense.toUpperCase(),
      damage: dmgResult ? dmgResult.actual : 0,
      applied: false,
    });
  }
  // 命中即停：最早命中步（atIndex 最小）
  const hits = results.filter((r) => r.hit);
  if (hits.length > 0) {
    stopIndex = Math.min(...hits.map((r) => r.provoker.atIndex));
    for (const r of results) r.applied = r.hit && r.provoker.atIndex === stopIndex;
  } else {
    for (const r of results) r.applied = false;
  }
  return { results, stopIndex };
}

/** 语义化效果规格 → 可挂载效果（不含强制移动：推拉滑已在地图完成）。
 * 无效果可自动挂载 → null。含 manual 时走弹窗兜底。供触发/灵气/zone 自动结算与 App 共用。
 * source 为施放者名（标记/状态来源，随 condUntil 记录展示）。 */
export function specsToApplyTarget(c: Combatant, specs: EffectSpec[], source?: string): EffectApplyTarget | null {
  const out: EffectApplyTarget = { cid: c.cid, conditions: [] };
  let has = false;
  // 批 4e：状态/标记呼出的时长 → condUntil 到期清理条目（at 按「开始/结束」映射，与详情页手动加状态一致）。
  // 条目构造统一走 engine.condUntilOf（单一事实来源：source/dur 任一存在才写，source 归属统一在此记录）。
  const stampCond = (k: ConditionKey, dur?: string) => {
    const entry = condUntilOf(dur, source);
    if (!entry) return;
    out.condUntil = { ...(out.condUntil ?? {}), [k]: entry };
  };
  for (const s of specs) {
    switch (s.kind) {
      case "condition":
      case "prone":
        if (s.condition && !out.conditions.includes(s.condition)) {
          out.conditions.push(s.condition);
          stampCond(s.condition, s.duration);
          has = true;
        }
        break;
      case "mark":
        if (!out.conditions.includes("marked")) {
          out.conditions.push("marked");
          // 标记来源：4e 需知道被谁标记（source 归属已并入 stampCond，影响状态展示与到期归属）
          stampCond("marked", s.duration);
          has = true;
        }
        break;
      case "ongoing":
        if ((s.value ?? 0) > 0) {
          out.ongoingDamage = { value: s.value!, saveOn: s.saveOn ?? "end", ...(s.type ? { type: s.type } : {}) };
          has = true;
        }
        break;
      case "regeneration":
        if (s.value !== undefined && s.value !== 0) {
          out.regeneration = s.value;
          has = true;
        }
        break;
      case "tempHp":
        if ((s.value ?? 0) > 0) {
          out.tempHp = s.value;
          has = true;
        }
        break;
      case "heal":
        if ((s.value ?? 0) > 0) {
          out.heal = s.value;
          has = true;
        }
        break;
      // 批 4c-1：buff（防御/攻击骰修正）/ grantCA（提供战斗优势）/ hidden（隐形隐蔽）→ 挂载为 ActiveEffect
      case "grantCA":
        out.effects = out.effects ?? [];
        out.effects.push({
          kind: "other",
          label: s.label ?? "提供战斗优势",
          raw: s.raw,
          grantCA: true,
          ...(s.duration || s.saveOn ? { duration: s.duration ?? (s.saveOn ? "豁免终止" : undefined) } : {}),
        });
        has = true;
        break;
      case "buff":
        // 批 5：放宽支持 dmgMods（伤害骰修正）与纯 label 描述性条目（额外伤害/支配盟友等条件性效果，挂载供 DM 参考）
        if (s.defMods || s.atkMods || s.dmgMods !== undefined || s.label) {
          out.effects = out.effects ?? [];
          out.effects.push({
            kind: "buff",
            label: s.label ?? "属性修正",
            raw: s.raw,
            ...(s.defMods ? { defMods: s.defMods } : {}),
            ...(s.atkMods ? { atkMods: s.atkMods } : {}),
            ...(s.dmgMods !== undefined ? { dmgMods: s.dmgMods } : {}),
            ...(s.duration || s.saveOn ? { duration: s.duration ?? (s.saveOn ? "豁免终止" : undefined) } : {}),
          });
          has = true;
        }
        break;
      case "transform":
        out.effects = out.effects ?? [];
        out.effects.push({
          kind: "other",
          label: s.label ?? "变形（改变形态）",
          raw: s.raw,
        });
        has = true;
        break;
      case "hidden":
        out.effects = out.effects ?? [];
        out.effects.push({
          kind: "other",
          label: s.label ?? "隐形",
          raw: s.raw,
          ...(s.duration || s.saveOn ? { duration: s.duration ?? (s.saveOn ? "豁免终止" : undefined) } : {}),
        });
        has = true;
        break;
      case "resist":
        // 批 4c-1 生成的无消费 kind：临时抗力。类型为占位「触发类型」（对触发的伤害类型减免，需 DM 依当期伤害类型裁决），
        // 不能静态并入 c.resistances → 挂载为带时长的效果条目供展示 / DM 按可能触发类型应用，避免静默丢弃。
        if ((s.value ?? 0) > 0) {
          out.effects = out.effects ?? [];
          out.effects.push({
            kind: "other",
            label: s.label ?? `抗力（${s.type ?? "触发类型"}）${s.value}`,
            raw: s.raw,
            ...(s.duration || s.saveOn ? { duration: s.duration ?? (s.saveOn ? "豁免终止" : undefined) } : {}),
          });
          has = true;
        }
        break;
      case "removeCondition":
        // 22 行动恢复类（特性常驻在持有者自身上，多作用于施放者自身）：回合结束时移除自身指定状态。
        // 本回合暂无对应回合末自动清除机制 → 挂载为效果条目供 DM 卸载，raw 内注明被清状态与规则来源，避免静默丢弃。
        out.effects = out.effects ?? [];
        out.effects.push({
          kind: "other",
          label: s.label ?? "行动恢复：回合结束移除自身状态",
          raw: s.raw,
          duration: "回合结束",
        });
        has = true;
        break;
      case "push":
      case "pull":
      case "slide":
      case "teleport":
      case "manual":
        break; // 地图/弹窗处理，不在此挂载
      case "auraDamage":
        // 灵气回合触发伤害：即时扣血（触发时点/阵营/重伤条件由 auraDamageTick 判断，不挂载为持久效果）
        if ((s.value ?? 0) > 0) {
          out.damage = s.value;
          if (s.type) out.damageType = s.type;
          if (s.bloodiedValue) out.damageBloodied = s.bloodiedValue;
          has = true;
        }
        break;
    }
  }
  return has ? out : null;
}

// ---------- 批 2b 预留：灵气 / zone 辅助（纯函数，未接线则零副作用） ----------

/** 灵气覆盖格：以持有者整个空间为中心、半径 radius 的填满区域（近程爆发语义，含自身占地） */
export function auraCellsOf(holder: Combatant, power: AttackOption, cols: number, rows: number): Set<string> {
  const r = auraRadius(power.range);
  if (r === null || !holder.pos) return new Set();
  return closeBurstCells(holder.pos, holder.size, r, cols, rows);
}

/** 灵气命中效果（auto=可直接挂载；manual=null → 日志标注 + EffectDialog 兜底） */
export function auraEffectTargets(holder: Combatant, power: AttackOption): EffectApplyTarget | null {
  const specs = power.effectSpecs ?? [];
  if (specs.length === 0 || specs.some((s) => s.kind === "manual")) return null;
  return specsToApplyTarget(holder, specs);
}

/** 灵气是否「进入触发」（trigger/效果原文含「进入」） */
export function auraTriggersOnEnter(power: AttackOption): boolean {
  return /进入/.test(power.trigger ?? "") || /进入/.test(power.effectText ?? "");
}

/** zone 对范围内棋子结算（trigger=enter/start/end 时调用）：
 * auto → applyEffectToCombatant 返回新副本；manual → 返回需 DM 裁决的棋子列表。不突变入参。 */
export function zoneTickEffects(
  z: Zone,
  combatants: Combatant[],
): { auto: Combatant[]; manual: Combatant[] } {
  const cells = zoneCellsOf(z);
  const inside = affectedIn(combatants, cells);
  const auto: Combatant[] = [];
  const manual: Combatant[] = [];
  for (const c of inside) {
    if (z.effect.kind === "auto") {
      auto.push(applyEffectToCombatant(c, { ...z.effect.target, cid: c.cid }));
    } else {
      manual.push(c);
    }
  }
  return { auto, manual };
}

// ---------- 批 2b-1：灵气 / zone 进入检测（纯函数，供落子副作用与回合开始接线） ----------

/** 移动占格差集：从 from 移动到 to 后「新进入」的格（旧占格不再计入）。 */
export function enterCellsOf(from: Point, to: Point, size: number): Set<string> {
  const oldSet = new Set<string>();
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) oldSet.add(from.x + dx + "," + (from.y + dy));
  }
  const out = new Set<string>();
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const k = to.x + dx + "," + (to.y + dy);
      if (!oldSet.has(k)) out.add(k);
    }
  }
  return out;
}

/** 移动后新进入的 zone（trigger=enter 且新占格覆盖其格；不突变入参） */
export function zoneEnterDetect(from: Point, to: Point, size: number, zones: Zone[]): Zone[] {
  const entered = enterCellsOf(from, to, size);
  return zonesAt(zones, entered).filter((z) => z.trigger === "enter");
}

/** 移动后新进入的灵气（持有者 ≠ mover、进入触发型灵气、新占格与其灵气格相交）。 */
export function auraEnterDetect(
  mover: Combatant,
  from: Point,
  to: Point,
  combatants: Combatant[],
  cols: number,
  rows: number,
): { owner: Combatant; power: AttackOption }[] {
  const entered = enterCellsOf(from, to, mover.size ?? 1);
  const out: { owner: Combatant; power: AttackOption }[] = [];
  for (const c of combatants) {
    if (c.cid === mover.cid || !c.pos || c.hp <= 0) continue;
    const aura = (c.attacks ?? []).find((a) => auraRadius(a.range) !== null);
    if (!aura || !auraTriggersOnEnter(aura)) continue;
    const cells = auraCellsOf(c, aura, cols, rows);
    let enter = false;
    for (const k of entered) {
      if (cells.has(k)) { enter = true; break; }
    }
    if (enter) out.push({ owner: c, power: aura });
  }
  return out;
}

/** 回合开始灵气结算检测：返回灵气威能 + 覆盖范围内目标棋子 + 可自动挂载效果。
 * inside=需结算的棋子（已按目标词条阵营/死亡过滤）；eff=可自动挂载效果（null=含 manual → 需 DM 裁决）。
 * 不突变入参；App 侧按增量应用（applyEffectToCombatant(cur, eff)），避免覆盖同单元前序修改。 */
export function auraTurnStartTick(
  holder: Combatant,
  combatants: Combatant[],
  cols: number,
  rows: number,
): { aura: AttackOption; inside: Combatant[]; eff: EffectApplyTarget | null } | null {
  if (!holder.pos) return null;
  const aura = (holder.attacks ?? []).find((a) => auraRadius(a.range) !== null);
  if (!aura) return null;
  // 批 6/6b/6c/6d：含 auraDamage/auraHeal/auraOngoing/auraCondition 的灵气由目标回合开始/结束触发
  // （auraDamageTick/auraHealTick/auraOngoingTick/auraConditionTick），不由持有者回合开始触发，避免错时点重复结算
  if ((aura.effectSpecs ?? []).some((s) =>
    s.kind === "auraDamage" || s.kind === "auraHeal" || s.kind === "auraOngoing" || s.kind === "auraCondition",
  )) return null;
  const cells = auraCellsOf(holder, aura, cols, rows);
  const spec = parseTargetSpec(aura.target);
  const byCid = new Map(combatants.map((c) => [c.cid, c]));
  const inside = affectedIn(combatants, cells, holder.cid).filter((c) => {
    if (c.hp <= 0) return false;
    if (spec.faction === "enemy") return !sameTeam(c, holder, byCid);
    if (spec.faction === "ally") return sameTeam(c, holder, byCid);
    return true;
  });
  return { aura, inside, eff: auraEffectTargets(holder, aura) };
}

// ---------- 批 7：阶段检查 · 效应触发器接口（灵光 + 反应类威能统一触发） ----------

/** EffectSpec.trigger（start/end/enter）→ 战斗阶段（BattlePhase）映射；enter 由移动时点独立处理，返回 null。 */
export function specTriggerPhase(trigger?: EffectSpec["trigger"]): BattlePhase | null {
  if (trigger === "start") return "turnStart";
  if (trigger === "end") return "turnEnd";
  return null;
}

/** 反应威能触发阶段分类：从「触发：」原文判定——
 * 含「借机」→ oa（由借机系统承接）；含「命中」→ hit（被命中反应，自动结算）；
 * 含「开始其回合/开始回合」→ turnStart；含「结束其回合/结束回合」→ turnEnd；
 * 其余（「攻击你」中断类、「受到X伤害」类、无时点）→ null（DM 裁决，避免错误时点）。 */
export function immediateTriggerPhase(power: AttackOption): BattlePhase | "oa" | null {
  const t = power.trigger ?? "";
  if (/借机/.test(t)) return "oa";
  if (/命中/.test(t)) return "hit";
  if (/开始其回合|开始回合/.test(t)) return "turnStart";
  if (/结束其回合|结束回合/.test(t)) return "turnEnd";
  return null;
}

/** 两棋子占格间的最小切比雪夫距离（1=邻接；任一无位置 → Infinity） */
function spaceDist(a: Combatant, b: Combatant): number {
  if (!a.pos || !b.pos) return Infinity;
  let min = Infinity;
  for (let dy = 0; dy < (a.size ?? 1); dy++) {
    for (let dx = 0; dx < (a.size ?? 1); dx++) {
      for (let py = 0; py < (b.size ?? 1); py++) {
        for (let px = 0; px < (b.size ?? 1); px++) {
          const d = Math.max(Math.abs(a.pos.x + dx - (b.pos.x + px)), Math.abs(a.pos.y + dy - (b.pos.y + py)));
          if (d < min) min = d;
        }
      }
    }
  }
  return min;
}

/** 反应威能触发的位置条件轻量判定：触发原文含「邻近」→ 邻接；含「离此X格内」→ 距离 ≤ X；否则放行。 */
export function immediateRangeOk(triggerText: string, owner: Combatant, target: Combatant): boolean {
  if (/邻近/.test(triggerText)) return spaceDist(owner, target) <= 1;
  const m = triggerText.match(/离此[^，。；]{0,6}?(\d+)格内/);
  if (m) return spaceDist(owner, target) <= parseInt(m[1], 10);
  return true;
}

/**
 * 阶段检查（核心接口）：target 处于战斗阶段 phase（回合开始/回合结束/被命中）时，
 * 收集当前影响它的全部效应触发：
 * 1. 灵气回合触发——遍历所有持有者灵气（spec.trigger 与 phase 匹配、灵气格覆盖、阵营/重伤条件通过），
 *    返回**数组**（同一时点多个持有者的全部命中载荷，修复多重灵气叠加只结算一者的缺陷）。
 * 2. 反应威能（immediate）——`immediateTriggerPhase(power) === phase` 且位置条件满足（供回合边界类触发提示 DM 裁决）。
 * auraCondition 中 ownerTrigger（持有者回合开始侧）在此跳过，由 ownerTriggerCheck 承接。
 * 不突变入参；伤害/治疗/状态挂载由调用方 apply。 */
export function phaseTriggerCheck(
  phase: BattlePhase,
  target: Combatant,
  combatants: Combatant[],
  cols: number,
  rows: number,
): PhaseTriggerHit[] {
  const out: PhaseTriggerHit[] = [];
  if (!target.pos || target.hp <= 0) return out;
  const byCid = new Map(combatants.map((c) => [c.cid, c]));
  for (const h of combatants) {
    if (h.cid === target.cid || !h.pos || h.hp <= 0) continue;
    // --- 灵气回合触发 ---
    for (const power of h.attacks ?? []) {
      if (power.kind !== "aura" || auraRadius(power.range) === null) continue;
      const cells = auraCellsOf(h, power, cols, rows);
      if (affectedIn([target], cells, h.cid).length === 0) continue; // target 的占格与灵气格相交
      const bloodied = h.hp > 0 && h.hp <= h.bloodied;
      for (const spec of power.effectSpecs ?? []) {
        if (spec.kind !== "auraDamage" && spec.kind !== "auraHeal" && spec.kind !== "auraOngoing" && spec.kind !== "auraCondition") continue;
        if (spec.ownerTrigger) continue; // 持有者侧检查承接
        if (specTriggerPhase(spec.trigger) !== phase) continue;
        if (spec.faction === "enemy" && sameTeam(target, h, byCid)) continue; // 「敌人」排除同队
        if (spec.faction === "ally" && !sameTeam(target, h, byCid)) continue; // 「盟友」排除异队
        if (spec.bloodiedOnly && !bloodied) continue; // 前置「在该X重伤期间」持有者须重伤
        switch (spec.kind) {
          case "auraDamage": {
            const dmg = spec.bloodiedValue && bloodied ? spec.bloodiedValue : (spec.value ?? 0);
            if (dmg <= 0) continue;
            out.push({ kind: "auraDamage", owner: h, power, spec, target, dmg, ...(spec.type ? { type: spec.type } : {}), bloodied });
            break;
          }
          case "auraHeal": {
            if (spec.targetBloodied && !(target.hp > 0 && target.hp <= target.bloodied)) continue; // 目标须重伤
            const heal = spec.value ?? 0;
            if (heal <= 0) continue;
            out.push({ kind: "auraHeal", owner: h, power, spec, target, heal, targetBloodied: !!spec.targetBloodied });
            break;
          }
          case "auraOngoing": {
            const value = spec.value ?? 0;
            if (value <= 0) continue;
            out.push({
              kind: "auraOngoing",
              owner: h,
              power,
              spec,
              target,
              value,
              ...(spec.type ? { type: spec.type } : {}),
              saveOn: spec.saveOn ?? "end",
              bloodied,
            });
            break;
          }
          case "auraCondition": {
            if (!spec.condition) continue;
            out.push({
              kind: "auraCondition",
              owner: h,
              power,
              spec,
              target,
              condition: spec.condition,
              expires: spec.expires ?? "start",
              expiryOwner: spec.expiryOwner === true,
              ...(spec.note ? { note: spec.note } : {}),
            });
            break;
          }
        }
      }
    }
    // --- 反应威能（immediate；命中类由 hitReactionDetect 经借机结算条自动结算，此处承接回合边界类供 DM 裁决提示） ---
    for (const power of h.attacks ?? []) {
      if (power.kind !== "immediate") continue;
      if (immediateTriggerPhase(power) !== phase) continue;
      if (!immediateRangeOk(power.trigger ?? "", h, target)) continue;
      if (/敌人/.test(power.trigger ?? "") && sameTeam(target, h, byCid)) continue;
      if (/盟友/.test(power.trigger ?? "") && !sameTeam(target, h, byCid)) continue;
      out.push({ kind: "immediate", owner: h, power, target });
    }
  }
  return out;
}

/** 持有者回合开始侧检查（批 7/17b-6）：holder 的灵气中 ownerTrigger 的 auraCondition 效果，
 * 对灵气内满足阵营的存活目标各返回一条触发（「任何在该X回合开始时位于该灵气内的敌人被标记…」）。
 * 不突变入参；状态与到期信息由调用方 applyAuraCondition 应用（source=holder，phase=1：下回合边界到期）。 */
export function ownerTriggerCheck(
  holder: Combatant,
  combatants: Combatant[],
  cols: number,
  rows: number,
): PhaseTriggerHit[] {
  const out: PhaseTriggerHit[] = [];
  if (!holder.pos || holder.hp <= 0) return out;
  for (const power of holder.attacks ?? []) {
    if (power.kind !== "aura" || auraRadius(power.range) === null) continue;
    const specs = (power.effectSpecs ?? []).filter((s) => s.kind === "auraCondition" && s.ownerTrigger);
    if (specs.length === 0) continue;
    const cells = auraCellsOf(holder, power, cols, rows);
    const byCid = new Map(combatants.map((c) => [c.cid, c]));
    const inside = affectedIn(combatants, cells, holder.cid).filter((c) => {
      if (c.hp <= 0) return false;
      for (const spec of specs) {
        if (spec.faction === "enemy" && sameTeam(c, holder, byCid)) return false;
        if (spec.faction === "ally" && !sameTeam(c, holder, byCid)) return false;
      }
      return true;
    });
    for (const t of inside) {
      for (const spec of specs) {
        if (!spec.condition) continue;
        out.push({
          kind: "auraCondition",
          owner: holder,
          power,
          spec,
          target: t,
          condition: spec.condition,
          expires: spec.expires ?? "start",
          expiryOwner: spec.expiryOwner === true,
          ...(spec.note ? { note: spec.note } : {}),
        });
      }
    }
  }
  return out;
}

/** 被命中反应检测（批 7）：victim 被命中后，收集其 immediate「被命中」威能（自带攻击线）。
 * 返回 OAProvoker 结构以复用 settleOABatch 统一掷骰（enemyCid=victim.cid=反应者、atIndex=0）；
 * 近战威能要求 attacker 位于威胁格内，否则 DM 标注；不突变入参。 */
export function hitReactionDetect(victim: Combatant, attacker: Combatant, ctx: TriggerCtx): OAProvoker[] {
  const out: OAProvoker[] = [];
  const dm: string[] = [];
  if (!victim.pos || !attacker.pos || victim.hp <= 0) return out;
  if (!oaEligible(victim, dm)) return out;
  const powers = (victim.attacks ?? []).filter(
    (a) => a.kind === "immediate" && a.attack !== null && immediateTriggerPhase(a) === "hit",
  );
  for (const p of powers) {
    const reach = reachOf(p);
    if (reach > 0) {
      const threat = threatCells(victim.pos, victim.size, reach, ctx.cols, ctx.rows);
      if (!spaceIntersects(attacker.pos, attacker.size, threat)) {
        dm.push(`${victim.name} 的【${p.name}】超出射程（DM 裁决）`);
        continue;
      }
    }
    out.push({ enemyCid: victim.cid, power: p, atIndex: 0, fromCell: { ...victim.pos } });
  }
  if (dm.length > 0 && out.length > 0) out[0].dmNote = dm.join("；");
  return out;
}

/** 借机/被命中反应伤害的纯结算（阶段 0 重构，抽自 App.applyOaTo）：对 victim 逐一应用「实际生效」的借机伤害，
 * 累积到新副本并做死亡判定，返回逐项命中信息供 App 写日志/发 battleBus 事件。不触达 React 状态 / 事件 / 日志。
 * - hits：各命中的 {amount, enemyName, provoker, rollText(完整命中描述)}；
 * - died：结算后是否死亡（怪物/召唤兽由 App 决定离场与级联）。 */
export function applyOaDamage(victim: Combatant, results: OAResult[], kind: "oa" | "reaction"): {
  next: Combatant;
  hits: { amount: number; enemyName: string; provoker: OAProvoker; rollText: string }[];
  died: boolean;
} {
  let next = { ...victim };
  const hits: { amount: number; enemyName: string; provoker: OAProvoker; rollText: string }[] = [];
  for (const r of results) {
    if (!r.applied || r.damage <= 0) continue;
    dealDamage(next, r.damage);
    // 与 App 原文案逐字一致：reaction 含【威能名】，oa 不含
    const actionPre = kind === "reaction" ? `被命中反应【${r.provoker.power.name}】` : `借机攻击`;
    const rollText =
      `${r.enemyName} 对 ${victim.name} ${actionPre}：d20 ${r.d20} ${fmtMod(r.attackBonus)} = ${r.total} vs ${r.defenseLabel} ${r.defense}，命中 ${r.damage} 点伤害（HP ${next.hp}/${next.maxHp}）。`;
    hits.push({ amount: r.damage, enemyName: r.enemyName, provoker: r.provoker, rollText });
  }
  return { next, hits, died: isDead(next) };
}
