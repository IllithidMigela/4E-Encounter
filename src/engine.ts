// 战斗引擎工具：移动路径、距离、射程解析、生命/状态处理、日志
import type { ActiveEffect, AttackOption, Combatant, ConditionKey, DefenseKey, LogEntry, MovePreview, OngoingDamage, Zone } from "./types";
import { DAMAGE_TYPE_ZH } from "./types";

export interface Point {
  x: number;
  y: number;
}

let logSeq = 0;
export function makeLog(
  text: string,
  tone: LogEntry["tone"] = "normal",
  meta?: Partial<Pick<LogEntry, "round" | "turnCid" | "phase" | "hp" | "act" | "power" | "undo">>,
): LogEntry {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    id: ++logSeq,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    text,
    tone,
    ...(meta ?? {}),
  };
}

export function fmtMod(v: number): string {
  return v >= 0 ? "+" + v : String(v);
}

/** 切比雪夫距离（含斜向，相邻格 = 1） */
export function gridDistance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 两枚棋子（左上角 + 各自占地 size）之间的最小切比雪夫距离：对大型棋子取其最近占用格 */
export function tokenDistance(a: Point, sizeA: number, b: Point, sizeB: number): number {
  let best = Infinity;
  for (let ay = 0; ay < sizeA; ay++) {
    for (let ax = 0; ax < sizeA; ax++) {
      for (let by = 0; by < sizeB; by++) {
        for (let bx = 0; bx < sizeB; bx++) {
          const d = gridDistance({ x: a.x + ax, y: a.y + ay }, { x: b.x + bx, y: b.y + by });
          if (d < best) best = d;
        }
      }
    }
  }
  return best;
}

/** 每格移动消耗：困难地形需额外 1 点移动力（进入耗 2），普通格耗 1 */
export function cellCostOf(difficult: Set<string>): (x: number, y: number) => number {
  const diff = difficult ?? new Set<string>();
  return (x, y) => (diff.has(x + "," + y) ? 2 : 1);
}

/** 一段路径的总移动消耗（大型棋子按其占地块内最困难的地形计） */
export function pathMoveCost(path: Point[], costOf: (x: number, y: number) => number, size = 1): number {
  let total = 0;
  for (const p of path) {
    let cell = costOf(p.x, p.y);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const c = costOf(p.x + dx, p.y + dy);
        if (c > cell) cell = c;
      }
    }
    total += cell;
  }
  return total;
}

/** 由状态推导实际可用移动力（点）。0 = 完全无法移动（定身/束缚）。 */
export function effectiveMoveLimit(c: Pick<Combatant, "conditions" | "speed" | "effects">): number {
  let s = c.speed;
  if (isRunning(c)) s += 2; // 奔跑（批 3-3b）：速度 +2
  if (c.conditions.includes("slowed")) s = Math.max(1, s - 2); // 迟缓：速度 -2
  if (c.conditions.includes("prone")) s = Math.max(1, Math.floor(s / 2)); // 倒地：只能爬行，速度减半
  if (c.conditions.includes("immobilized") || c.conditions.includes("restrained")) return 0; // 定身/束缚：无法移动
  return s;
}

/** 是否处于奔跑状态（批 3-3b）：速度 +2、全防御 -5、对敌提供战斗优势，至下回合开始 */
export function isRunning(c: Pick<Combatant, "effects">): boolean {
  return (c.effects ?? []).some((e) => e.runSpeed === true);
}

/** 防御修正合计（批 3-3b）：累加 effects 中 defMods 对应防御值 */
export function defModOf(c: Pick<Combatant, "effects">, key: DefenseKey): number {
  return (c.effects ?? []).reduce((sum, e) => sum + (e.defMods?.[key] ?? 0), 0);
}

/** 持有者是否对外提供战斗优势（奔跑）：被攻击时攻击方自动获得 +2 */
export function grantsCA(c: Pick<Combatant, "effects">): boolean {
  return (c.effects ?? []).some((e) => e.grantCA === true);
}

/** 棋子所属队伍标识（批 8）：显式 team 优先；召唤兽跟随召出者（沿链上溯）；否则按 kind 兜底
 * （pc→"pc" 玩家队，monster→"monster" 怪物队）。byCid 缺省时召唤兽仅按自身 team 兜底。 */
export function teamOf(c: Pick<Combatant, "team" | "kind" | "summonerCid">, byCid?: Map<string, Combatant>): string {
  if (c.summonerCid && byCid) {
    const s = byCid.get(c.summonerCid);
    if (s) return teamOf(s, byCid);
  }
  return c.team ?? (c.kind === "pc" ? "pc" : "monster");
}

/** 同队判定（批 8）：同队伍=盟友，不同队伍=敌人（4E 规则）。 */
export function sameTeam(
  a: Pick<Combatant, "team" | "kind" | "summonerCid">,
  b: Pick<Combatant, "team" | "kind" | "summonerCid">,
  byCid?: Map<string, Combatant>,
): boolean {
  return teamOf(a, byCid) === teamOf(b, byCid);
}

/**
 * 生成移动路径：**最短步数** BFS（8 向），不自动绕行。
 * - 仅寻找步数最少的、可通行的路径到达终点目标格（含困难地形也照走，是否超出移动力交由调用方校验）；
 * - 每步 ≤ 1 格，总步数不超过 moveLimit（作为格数上限）；
 * - 斜向移动不得斜穿障碍（墙）拐角，但可穿过生物（它们不填满格子）；
 * - blocked 为不允许进入的格（障碍 + 他棋占地），walls 为斜穿拐角判定的障碍格。
 * - 返回 cost 为按 costOf 计算的该路径总移动消耗（供调用方判断是否超预算）。
 * 无法在 moveLimit 步内到达终点时返回空路径并 limited=true。
 */
export function buildPath(
  start: Point,
  end: Point,
  moveLimit: number,
  cols: number,
  rows: number,
  blockedSet: Set<string>,
  walls?: Set<string>,
  costOf?: (x: number, y: number) => number,
  size = 1,
): { path: Point[]; cost: number; dist: number; limited: boolean } {
  const blocked = blockedSet ?? new Set<string>();
  const wall = walls ?? new Set<string>();
  const costFn = costOf ?? (() => 1);
  const key = (p: Point) => p.x + "," + p.y;
  const inBounds = (x: number, y: number, s: number) => x >= 0 && y >= 0 && x + s <= cols && y + s <= rows;

  if (moveLimit <= 0) return { path: [], cost: 0, dist: 0, limited: true };
  if (start.x === end.x && start.y === end.y) return { path: [], cost: 0, dist: 0, limited: false };
  if (!inBounds(end.x, end.y, size) || blocked.has(key(end))) {
    return { path: [], cost: 0, dist: 0, limited: true };
  }

  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  const parent = new Map<string, Point | null>();
  parent.set(key(start), null);
  let frontier: Point[] = [start];
  let found: Point | null = null;

  for (let step = 0; step < moveLimit && frontier.length > 0; step++) {
    const next: Point[] = [];
    for (const cur of frontier) {
      for (const [dx, dy] of dirs) {
        const np = { x: cur.x + dx, y: cur.y + dy };
        if (!inBounds(np.x, np.y, size)) continue;
        // 斜向：不得斜穿由障碍（墙）围成的拐角；穿过生物允许
        if (dx !== 0 && dy !== 0) {
          if (wall.has(cur.x + dx + "," + cur.y) && wall.has(cur.x + "," + (cur.y + dy))) continue;
        }
        const k = key(np);
        if (parent.has(k) || blocked.has(k)) continue;
        parent.set(k, cur);
        if (np.x === end.x && np.y === end.y) {
          found = np;
          break;
        }
        next.push(np);
      }
      if (found) break;
    }
    if (found) break;
    frontier = next;
  }

  if (!found) return { path: [], cost: 0, dist: 0, limited: true };

  const path: Point[] = [];
  let cur: Point | null = found;
  while (cur && (cur.x !== start.x || cur.y !== start.y)) {
    path.unshift(cur);
    cur = parent.get(key(cur)) ?? null;
  }
  return { path, cost: pathMoveCost(path, costFn, size), dist: path.length, limited: false };
}

/** 校验整条移动路径中每个位置的棋子是否合规。
 * 按棋子占地（size×size，左上角为 path[i]）逐格检查越界 / 遇障碍 / 占位；
 * 对单格棋子额外检查斜向穿角——只有障碍（墙）会围堵拐角，生物不填满格子，斜穿生物合法。
 * 返回第一个非法位置下标及原因；全合规则 ok=true。 */
export function validatePath(
  path: Point[],
  blockedSet: Set<string>,
  cols: number,
  rows: number,
  size = 1,
  walls?: Set<string>,
): { ok: boolean; index: number; reason?: string } {
  const wall = walls ?? blockedSet;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    // 整块占地逐格检查
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const gx = p.x + dx;
        const gy = p.y + dy;
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) {
          return { ok: false, index: i, reason: `第 ${i + 1} 步越出地图边界` };
        }
        if (blockedSet.has(gx + "," + gy)) {
          return { ok: false, index: i, reason: `第 ${i + 1} 步经过障碍或被其它棋子占据` };
        }
      }
    }
    // 斜向穿角（经典 4e 规则，仅单格棋子）：仅障碍围堵两侧才算无法斜穿
    if (size === 1 && i > 0) {
      const a = path[i - 1];
      if (a.x !== p.x && a.y !== p.y) {
        if (wall.has(a.x + "," + p.y) && wall.has(p.x + "," + a.y)) {
          return { ok: false, index: i, reason: `第 ${i + 1} 步斜穿障碍拐角，两侧被墙围堵无法通行` };
        }
      }
    }
  }
  return { ok: true, index: -1 };
}

/** 解析射程描述 → 结构化信息。
 * melee/ranged：dist=射程；close（近程爆发/冲击）：dist=半径/尺寸，冲击附带 areaKind=blast；
 * area（区域N爆发M / 范围N）：dist=施法距离，areaSize=爆发半径/冲击尺寸。 */
export interface RangeInfo {
  type: "melee" | "ranged" | "close" | "area" | "none";
  dist: number;
  areaSize?: number;
  areaKind?: "burst" | "blast";
}

export function parseRange(range: string): RangeInfo {
  const r = range ?? "";
  let m: RegExpMatchArray | null;
  // 射程词与数字间可能带空格（新库「远程 10」/「近程爆发 5」），用 \s* 兼容
  m = r.match(/近战\s*(\d+)/);
  if (m) return { type: "melee", dist: parseInt(m[1], 10) };
  m = r.match(/远程\s*(\d+)/);
  if (m) return { type: "ranged", dist: parseInt(m[1], 10) };
  // 射程 N：部分怪物/威能正文用「射程」而非「远程」（如矮人守卫「飞锤 射程 10」）→ 视为远程
  m = r.match(/射程\s*(\d+)/);
  if (m) return { type: "ranged", dist: parseInt(m[1], 10) };
  m = r.match(/近程爆发\s*(\d+)/);
  if (m) return { type: "close", dist: parseInt(m[1], 10) };
  m = r.match(/近程冲击\s*(\d+)|近距喷吐\s*(\d+)/);
  if (m) {
    const d = parseInt(m[1] ?? m[2], 10);
    return { type: "close", dist: d, areaSize: d, areaKind: "blast" };
  }
  m = r.match(/区域\s*(\d+)(?:内)?\s*爆发\s*(\d+)/);
  if (m) return { type: "area", dist: parseInt(m[1], 10), areaSize: parseInt(m[2], 10), areaKind: "burst" };
  m = r.match(/区域\s*(\d+)(?:内)?\s*冲击\s*(\d+)/);
  if (m) return { type: "area", dist: parseInt(m[1], 10), areaSize: parseInt(m[2], 10), areaKind: "blast" };
  m = r.match(/范围\s*(\d+)/);
  if (m) {
    const d = parseInt(m[1], 10);
    return { type: "area", dist: d, areaSize: d, areaKind: "burst" };
  }
  // 纯「区域N」（效果型 zone 威能，monsterParse 射程回退产物）：施法距离 N、覆盖 N 半径爆发
  m = r.match(/区域\s*(\d+)/);
  if (m) {
    const d = parseInt(m[1], 10);
    return { type: "area", dist: d, areaSize: d, areaKind: "burst" };
  }
  return { type: "none", dist: 0 };
}

/** 解析灵气半径「灵气N」：环绕该生物自身、填满 N 格区域；无匹配返回 null */
export function auraRadius(range: string): number | null {
  const m = (range ?? "").match(/灵气\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** 布雷森汉姆直线：a→b 之间（不含端点）是否有被遮挡的格子
 * 端点取整到最近格，避免 centerOf(偶数体型) 产生的小数坐标导致循环永远无法精确命中终点 */
export function losBlocked(a: Point, b: Point, blockedSet: Set<string>): boolean {
  let x0 = Math.round(a.x);
  let y0 = Math.round(a.y);
  const x1 = Math.round(b.x);
  const y1 = Math.round(b.y);
  const ox = x0;
  const oy = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if ((x0 !== ox || y0 !== oy) && blockedSet.has(x0 + "," + y0)) return true;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return false;
}

/** 双方（已放置）距离是否在攻击射程内；返回 null 表示无法判定（有一方未放置或射程无法解析） */
export function rangeStatus(
  rangeStr: string,
  a: Point | null,
  b: Point | null,
  blockedSet?: Set<string>,
  sizeA = 1,
  sizeB = 1,
): { ok: boolean; dist: number; rangeDist: number; label: string; losBlocked?: boolean } | null {
  if (!a || !b) return null;
  const pr = parseRange(rangeStr);
  if (pr.type === "none") return null;
  const gap = tokenDistance(a, sizeA, b, sizeB);
  const blocked = blockedSet ?? new Set<string>();
  // 效果线取双方占地中心（与地图预览一致；大型棋子左上角≠中心）
  const los = pr.type === "melee" ? false : losBlocked(centerOf(a, sizeA), centerOf(b, sizeB), blocked);
  const losNote = los ? "（视线被障碍遮挡）" : "";
  if (pr.type === "melee" || pr.type === "ranged") {
    const ok = gap <= pr.dist;
    const kind = pr.type === "melee" ? "近战" : "远程";
    return { ok, dist: gap, rangeDist: pr.dist, label: `${kind}范围 ${pr.dist} 格，双方距离 ${gap} 格${losNote}`, losBlocked: los };
  }
  // 爆发/喷吐/范围：以目标为中心 N 格，攻击者须在射程内
  const ok = gap <= pr.dist;
  return { ok, dist: gap, rangeDist: pr.dist, label: `范围 ${pr.dist} 格，双方距离 ${gap} 格${losNote}`, losBlocked: los };
}

/** 伤害修正管线参数 */
export interface DamageOpts {
  /** 伤害类型（标准键或中文原文；缺省 = 无类型） */
  type?: string;
  /** 是否可被抗力/易伤/免疫/减半修正（默认 true；数值伤害如持续伤害亦参与修正） */
  noMod?: boolean;
}

/** 伤害结算明细（供日志/结算条展示修正过程） */
export interface DamageResult {
  /** 原始伤害 */
  raw: number;
  /** 免疫短路（实际伤害 0） */
  immune: boolean;
  /** 被抗力削减的量 */
  resisted: number;
  /** 易伤额外伤害 */
  vulnBonus: number;
  /** 虚弱（weakened）减半 */
  weakenedHalf: boolean;
  /** 虚体（insubstantial）减半 */
  insubHalf: boolean;
  /** 实际扣除的生命值（临时生命吸收前） */
  actual: number;
  /** 临时生命吸收量 */
  absorbed: number;
}

/** 伤害类型归一化：中文/英文 → 标准键（DAMAGE_TYPE_ZH）；无法识别返回 undefined（无类型） */
export function normalizeDamageType(type?: string): string | undefined {
  if (!type) return undefined;
  const t = type.trim();
  if (!t) return undefined;
  if (DAMAGE_TYPE_ZH[t]) return DAMAGE_TYPE_ZH[t];
  return t; // 已是标准键或未知名词，原样返回
}

/** 防御修正：按「类型匹配 → 抗力/易伤 → 免疫短路 → 虚弱/虚体减半」顺序结算。
 * 返回修正后的实际伤害（≥0）。纯函数，不突变 combatant。 */
export function computeDamage(c: Pick<Combatant, "resistances" | "vulnerabilities" | "immunities" | "insubstantial" | "conditions">, amount: number, opts?: DamageOpts): DamageResult {
  const raw = Math.max(0, amount);
  const type = opts?.noMod ? undefined : normalizeDamageType(opts?.type);
  const out: DamageResult = { raw, immune: false, resisted: 0, vulnBonus: 0, weakenedHalf: false, insubHalf: false, actual: raw, absorbed: 0 };

  // 免疫短路：类型/原文命中免疫列表 → 伤害 0
  if (type) {
    const imm = c.immunities ?? [];
    if (imm.some((k) => k === type || k === opts?.type)) {
      out.immune = true;
      out.actual = 0;
      return out;
    }
  }

  // 抗力/易伤
  if (type) {
    const res = c.resistances?.[type] ?? 0;
    const vul = c.vulnerabilities?.[type] ?? 0;
    if (res > 0) out.resisted = Math.min(raw, res);
    if (vul > 0) out.vulnBonus = vul;
  }
  let dmg = raw - out.resisted + out.vulnBonus;

  // 虚弱：造成的伤害减半（向下取整）；虚体：受到的伤害减半
  if (c.conditions?.includes("weakened")) {
    dmg = Math.floor(dmg / 2);
    out.weakenedHalf = true;
  }
  if (c.insubstantial) {
    dmg = Math.floor(dmg / 2);
    out.insubHalf = true;
  }
  out.actual = Math.max(0, dmg);
  return out;
}

/** 造成伤害：先按伤害修正管线计算，再扣临时生命（临时生命只吸收一次、不累加），再扣生命。
 * PC 生命允许为负（到 -重伤值死亡）；怪物生命不进入负数（HP=0 即死）。
 * 濒死中再次受伤额外累计 1 次死亡豁免失败（批 3-3c）。
 * 自动打上/移除「重伤」「濒死」。返回实际打到生命值的伤害（临时生命吸收的部分不计入，供日志显示吸收量）。 */
export function dealDamage(c: Combatant, amount: number, opts?: DamageOpts): number {
  const r = computeDamage(c, amount, opts);
  let dmg = r.actual;
  if (c.tempHp > 0) {
    const absorb = Math.min(c.tempHp, dmg);
    c.tempHp -= absorb;
    dmg -= absorb;
    r.absorbed = absorb;
  }
  const wasDying = c.hp <= 0;
  c.hp = c.hp - dmg;
  if (c.kind !== "pc") c.hp = Math.max(0, c.hp); // 怪物 HP=0 直接死亡
  if (dmg > 0 && wasDying && c.kind === "pc") {
    c.deathSaveFails = (c.deathSaveFails ?? 0) + 1; // 濒死中受伤：额外 1 次死亡豁免失败
  }
  syncBloodied(c);
  syncDying(c);
  return dmg;
}

/** 追加持续伤害：同类型取最高（不同类型各自生效）；saveOn 缺省 end（豁免终止） */
export function addOngoingDamage(c: Combatant, od: OngoingDamage): void {
  const list = [...(c.ongoingDamage ?? [])];
  const typeKey = normalizeDamageType(od.type) ?? "none";
  const idx = list.findIndex((x) => (normalizeDamageType(x.type) ?? "none") === typeKey);
  if (idx >= 0) {
    if (od.value > list[idx].value) list[idx] = { ...od, type: list[idx].type };
  } else {
    list.push({ type: od.type, value: od.value, saveOn: od.saveOn ?? "end", ...(od.note ? { note: od.note } : {}) });
  }
  c.ongoingDamage = list;
}

// ---------- 批 6d：灵气状态（auraCondition）到期管理 ----------

/** 统一构造 condUntil 到期条目（单一事实来源）：把「时长文本」映射为边界（at 按是否含「开始」推导 + 可选来源）。
 * 无 dur 且无 source 时返回 undefined（不生成到期条目，供无时长、需手动清除的状态）。用于 triggers 自动结算与详情页手动加状态。 */
export function condUntilOf(dur?: string, source?: string): NonNullable<Combatant["condUntil"]>[ConditionKey] | undefined {
  if (!dur && !source) return undefined;
  return {
    at: dur && dur.includes("开始") ? ("start" as const) : ("end" as const),
    ...(dur ? { dur } : {}),
    ...(source ? { source } : {}),
  } as NonNullable<Combatant["condUntil"]>[ConditionKey];
}

/** 施加灵气回合触发状态：加入 conditions 并记录到期边界 condUntil（不突变入参，返回新副本）。
 * opts.source=持有者 cid（「直到该X下回合…」持有者锚定；缺省=目标自身锚定）；
 * opts.phase=1 下一次边界到期 / 2 跳过下一次边界（「直到其下回合结束」施加于回合开始时，当前回合结束不算「下回合」）。 */
export function applyAuraCondition(
  c: Combatant,
  condition: ConditionKey,
  expires: "start" | "end",
  opts?: { source?: string; phase?: 1 | 2; note?: string },
): Combatant {
  const conditions = c.conditions.includes(condition) ? c.conditions : [...c.conditions, condition];
  const condUntil = { ...(c.condUntil ?? {}) } as NonNullable<Combatant["condUntil"]>;
  condUntil[condition] = {
    at: expires,
    ...(opts?.source ? { source: opts.source } : {}),
    ...(opts?.phase ? { phase: opts.phase } : {}),
  };
  return { ...c, conditions, condUntil };
}

/** 回合边界清理 condUntil 状态：actor 为当前行动者（正在开始/结束回合的棋子），at=start 由 runTurnStart 调、at=end 由 runTurnEnd 调。
 * 锚定判定：持有者锚定（source）→ 当前行动者即持有者时到期；目标锚定 → 当前行动者即该棋子时到期。
 * phase=2 → 本次边界跳过（改为 1），下次边界再清；phase=1/缺省 → 移除状态与记录。返回新副本数组。 */
export function clearExpiredAuraConditions(combatants: Combatant[], actorCid: string, at: "start" | "end"): Combatant[] {
  return combatants.map((c) => {
    const until = c.condUntil;
    if (!until || Object.keys(until).length === 0) return c;
    let changed = false;
    const next = { ...until } as NonNullable<Combatant["condUntil"]>;
    for (const [key, meta] of Object.entries(until)) {
      const cond = key as ConditionKey;
      if (meta.at !== at) continue;
      const boundaryNow = meta.source ? meta.source === actorCid : c.cid === actorCid;
      if (!boundaryNow) continue;
      if (meta.phase === 2) {
        next[cond] = { ...meta, phase: 1 };
        changed = true;
      } else {
        delete next[cond];
        changed = true;
      }
    }
    if (!changed) return c;
    const conditions = c.conditions.filter((k) => !until[k] || next[k] !== undefined);
    return { ...c, conditions, condUntil: next };
  });
}

/** 临时生命值取最高（不累加；休息清空随批 3） */
export function setTempHp(c: Combatant, amount: number): void {
  c.tempHp = Math.max(c.tempHp, Math.max(0, amount));
}

/** 回复生命：最多回到上限，自动移除重伤/濒死。
 * 濒死者先视为 0 再治疗（负数生命不计入治疗收益）；脱离濒死时死亡豁免失败计数清零（批 3-3c）。 */
export function heal(c: Combatant, amount: number): void {
  c.hp = Math.min(c.maxHp, Math.max(0, c.hp) + Math.max(0, amount));
  syncBloodied(c);
  if (c.hp > 0) c.deathSaveFails = 0;
  syncDying(c);
}

/** 使用回复力：扣 1 次回复力 + surgeValue 生命（仅 pc） */
export function useSurge(c: Combatant): boolean {
  if (c.surgesLeft === undefined || c.surgesLeft <= 0) return false;
  c.surgesLeft -= 1;
  heal(c, c.surgeValue);
  return true;
}

// ---------- 批 3-3b：效果挂载与基础动作辅助 ----------

/**
 * DM 手动挂载效果（按 label 附加）：与流程结算的 resolve.applyEffectToCombatant 是两条独立写入路径，边界约定：
 * - 流程结算（攻击/灵气/zone 命中后）走 `applyEffectToCombatant`，按 EffectApplyTarget 合并、同 label 去重、随 condUntil/回合边界统一到期清理；
 * - 手动挂载（详情页「添加效果」/ DM 需求）走本函数，仅按 label 去重，不写 condUntil —— 到期清理由 DM 决定。
 * 两者对同 label 采用一致的「新值替换旧值」去重语义；手动挂载不参与流程内的自动到期清除时间点。
 */
export function addEffect(c: Combatant, effect: ActiveEffect): Combatant {
  const list = (c.effects ?? []).filter((e) => e.label !== effect.label);
  return { ...c, effects: [...list, effect] };
}

/** 按 label 移除效果（返回新副本） */
export function removeEffect(c: Combatant, label: string): Combatant {
  return { ...c, effects: (c.effects ?? []).filter((e) => e.label !== label) };
}

/** 回合开始清理：移除「直到下回合开始」的效果（奔跑/全防御/回气等，轮到自身时解除） */
export function clearTurnStartEffects(c: Combatant): Combatant {
  const effects = (c.effects ?? []).filter((e) => !e.untilNextTurn);
  return effects.length === (c.effects ?? []).length ? c : { ...c, effects };
}

// ---------- 批 3-3c：威能频率分类与休息 ----------

/** 威能频率分类：atwill=随意不限 / encounter=遭遇（每遭遇N次）/ daily=每日 / recharge=充能（条件重掷）/ aura=灵气（自动） */
export type PowerFreqKind = "atwill" | "encounter" | "daily" | "recharge" | "aura";

export function freqKindOf(freq: string | undefined): PowerFreqKind {
  if (!freq) return "atwill";
  if (/^灵气/.test(freq)) return "aura";
  if (/充能/.test(freq)) return "recharge";
  if (/每日/.test(freq)) return "daily";
  if (/遭遇/.test(freq)) return "encounter";
  return "atwill";
}

/** 遭遇威能次数上限：每遭遇N次 → N（缺省 1） */
export function freqLimitOf(freq: string | undefined): number {
  const m = /每遭遇(\d+)次/.exec(freq ?? "");
  return m ? parseInt(m[1], 10) : 1;
}

/** 频率中文展示（徽标短标签）：随意/遭遇/每日/充能/灵气 */
export function freqShortLabel(freq: string | undefined): string | null {
  const k = freqKindOf(freq);
  if (k === "atwill") return freq?.includes("每轮一次") ? "每轮一次" : null;
  if (k === "aura") return "灵气";
  if (k === "recharge") return "充能";
  return k === "encounter" ? "遭遇" : "每日";
}

/**
 * 短休息（批 3-3c）：回复力回满、遭遇/充能威能重置、回气与行动点本回合标记重置、临时生命清空、死亡豁免失败清零。
 * 不自动回血（玩家用「治疗回复力」自行花回复力）。纯函数，不突变入参。
 */
export function shortRest(c: Combatant): Combatant {
  const next: Combatant = {
    ...c,
    surgesLeft: c.surges ?? 0,
    secondWindUsed: false,
    apUsedThisRound: false,
    deathSaveFails: 0,
    tempHp: 0,
  };
  const uses = c.powerUses ? { ...c.powerUses } : undefined;
  if (uses) {
    for (const a of c.attacks ?? []) {
      const k = freqKindOf(a.freq);
      if (k === "encounter" || k === "recharge") delete uses[a.key];
    }
    next.powerUses = uses;
  }
  return next;
}

/** 长休息（批 3-3c）：短休息全部效果 + 生命回满 + 行动点恢复 1 + 每日威能/全部使用标记重置 */
export function longRest(c: Combatant): Combatant {
  const next = shortRest(c);
  next.hp = next.maxHp;
  next.actionPoints = 1;
  next.powerUses = undefined;
  return next;
}

/**
 * 基本攻击威能：优先取攻击列表里名字含「基本攻击」的条目（近战优先），
 * 找不到则合成默认条目（攻加/伤害取攻击列表首个近战威能，否则 0 / 1d8，DM 可在结算条手调）。
 */
export function basicAttackOf(c: Pick<Combatant, "attacks">): AttackOption {
  const attacks = c.attacks ?? [];
  const named = attacks.filter((a) => a.name.includes("基本攻击") || a.name.includes("基本近战") || a.name.includes("基本远程"));
  const melee = named.find((a) => a.range.startsWith("近战")) ?? named[0];
  if (melee) return melee;
  const ref = attacks.find((a) => a.range.startsWith("近战"));
  return {
    key: "es-act-basic",
    name: "基本攻击",
    kind: "standard",
    range: ref?.range ?? "近战1",
    target: "一个生物",
    attack: ref?.attack ?? 0,
    defense: "ac",
    damageExpr: ref?.damageExpr ?? "1d8",
    effectText: "基本攻击",
    coverage: "fully",
  };
}

/** 冲锋攻击条目（合成：近战基本攻击；冲锋移动后由 Charge 流程落子再结算） */
export function chargeAttackOf(c: Pick<Combatant, "attacks">): AttackOption {
  const b = basicAttackOf(c);
  return { ...b, key: "es-act-charge", name: "冲锋攻击", kind: "standard", coverage: "fully" };
}

/** 冲撞攻击条目（合成：力量 vs 强韧，命中推离 1 格；攻加默认 0 由 DM 在结算条手调） */
export function rushAttackOf(c: Pick<Combatant, "attacks">): AttackOption {
  const ref = (c.attacks ?? []).find((a) => a.range.startsWith("近战") && a.attack !== null);
  return {
    key: "es-act-rush",
    name: "冲撞",
    kind: "standard",
    range: "近战1",
    target: "一个生物",
    attack: ref?.attack ?? 0,
    defense: "fort",
    damageExpr: "",
    effectText: "命中：将目标推离 1 格。",
    effectSpecs: [{ kind: "push", value: 1, raw: "命中：将目标推离 1 格。" }],
    coverage: "fully",
  };
}

/**
 * 冲锋路径：从 start 到目标邻接格的可通行最短路径。
 * 规则：移动至多速度格；每格都必须使该生物离目标更近；离起始位置至少 2 格。
 * 返回 null = 无法冲锋（无合法路径 / 目标已在邻接 / 超过速度 / 不满足每格更近）。
 */
export function chargePathOf(
  start: Point,
  target: Point,
  targetSize: number,
  speed: number,
  cols: number,
  rows: number,
  blockedSet: Set<string>,
  walls: Set<string>,
  costOf: (x: number, y: number) => number,
  moverSize = 1,
): { path: Point[]; cost: number } | null {
  const blocked = new Set(blockedSet);
  const distTo = (p: Point) => tokenDistance(p, moverSize, target, targetSize);
  const candidates: Point[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const gx = start.x + dx;
      const gy = start.y + dy;
      // 邻接格需可通行且为空（不被占位/障碍）；目标自身占用格视为被占
      let free = true;
      for (let oy = 0; oy < moverSize && free; oy++) {
        for (let ox = 0; ox < moverSize; ox++) {
          const cx = gx + ox;
          const cy = gy + oy;
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows || blocked.has(cx + "," + cy)) { free = false; break; }
          for (let ty = 0; ty < targetSize; ty++) {
            for (let tx = 0; tx < targetSize; tx++) {
              if (cx === target.x + tx && cy === target.y + ty) { free = false; break; }
            }
            if (!free) break;
          }
        }
      }
      if (free) candidates.push({ x: gx, y: gy });
    }
  }
  // 已与目标邻接则无法冲锋（冲锋要求至少移动 2 格）
  if (distTo(start) <= 1) return null;
  let best: { path: Point[]; cost: number } | null = null;
  for (const cand of candidates) {
    const bp = buildPath(start, cand, speed, cols, rows, blocked, walls, costOf, moverSize);
    if (bp.limited || bp.path.length < 2) continue; // 至少离起始 2 格
    // 每格必须离目标更近
    let ok = true;
    let prevDist = distTo(start);
    for (const p of bp.path) {
      const d = distTo(p);
      if (d >= prevDist) { ok = false; break; }
      prevDist = d;
    }
    if (!ok) continue;
    if (!best || bp.cost < best.cost) best = { path: bp.path, cost: bp.cost };
  }
  return best;
}

/** 根据当前 HP 与重伤线同步「重伤」状态 */
export function syncBloodied(c: Combatant): void {
  if (c.hp > 0 && c.hp <= c.bloodied) {
    if (!c.conditions.includes("bloodied")) c.conditions.push("bloodied");
  } else {
    c.conditions = c.conditions.filter((x) => x !== "bloodied");
  }
}

/** 根据当前 HP 同步「濒死」状态（批 3-3c）：
 * - 怪物 HP=0 直接死亡（不进入濒死/死亡豁免流程，仅 HP 显示 0）；
 * - PC HP≤0 时自动打上 濒死+失去意识+无助+倒地，回复后移除（倒地保留，需起身）。 */
export function syncDying(c: Combatant): void {
  if (c.kind !== "pc") return;
  if (c.hp <= 0) {
    for (const k of ["dying", "unconscious", "helpless", "prone"] as const) {
      if (!c.conditions.includes(k)) c.conditions.push(k);
    }
  } else {
    c.conditions = c.conditions.filter((x) => x !== "dying" && x !== "unconscious" && x !== "helpless");
  }
}

/** 是否已死亡：PC 生命 ≤ -重伤值；怪物生命 ≤ 0（批 3-3c） */
export function isDead(c: Pick<Combatant, "kind" | "hp" | "bloodied">): boolean {
  return c.kind === "pc" ? c.hp <= -c.bloodied : c.hp <= 0;
}

/** 是否召唤兽（批 4-4a-2）：先攻行「和召出者一样」/ 标题含「召唤生物」标记的怪物；可绑定召出者、解除/死亡自动移除 */
export function isSummoned(c: Pick<Combatant, "summoned">): boolean {
  return c.summoned === true;
}

/** 已绑定召出者的召唤兽：返回召出者名字（未绑定返回 undefined） */
export function summonerNameOf(c: Pick<Combatant, "summonerCid">, all: Combatant[]): string | undefined {
  return c.summonerCid ? all.find((x) => x.cid === c.summonerCid)?.name : undefined;
}

export function toggleCondition(c: Combatant, key: ConditionKey): void {
  if (key === "bloodied") return; // 重伤为自动派生
  c.conditions = c.conditions.includes(key)
    ? c.conditions.filter((x) => x !== key)
    : [...c.conditions, key];
}

export function defenseOf(c: Combatant, key: DefenseKey): number {
  return c[key];
}

export const DEFENSE_LABEL_SHORT: Record<DefenseKey, string> = {
  ac: "AC",
  fort: "强韧",
  ref: "反射",
  will: "意志",
};

/** 生成一个稳定的本地 id */
let idSeq = 0;
export function nextCid(): string {
  return "c" + Date.now().toString(36) + (idSeq++).toString(36);
}

export function makeMovePreview(cid: string, path: Point[], dist: number, limited: boolean): MovePreview {
  return { cid, path, dist, limited };
}

/** 圆点序列（回合指示）复用 */
export function initials(name: string): string {
  const s = name.trim();
  return s ? s.slice(0, 2) : "?";
}

// ---------- 瞄准/范围可视化辅助 ----------

/** 矩形区域内的格子集合（含边界） */
export function cellsInRect(rect: { x: number; y: number; w: number; h: number }): Set<string> {
  const out = new Set<string>();
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) out.add(rect.x + dx + "," + (rect.y + dy));
  }
  return out;
}

/** 近战触及范围：攻击者占地外围 N 格（切比雪夫距离 1..dist，不含自身占地） */
export function reachCells(a: Point, size: number, dist: number, cols: number, rows: number): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let d = Infinity;
      for (let ay = 0; ay < size; ay++) {
        for (let ax = 0; ax < size; ax++) {
          d = Math.min(d, gridDistance({ x: a.x + ax, y: a.y + ay }, { x, y }));
        }
      }
      if (d >= 1 && d <= dist) out.add(x + "," + y);
    }
  }
  return out;
}

/** 爆发/范围区域：以 center 为中心、半径 radius 的正方形格集（切比雪夫距离 ≤ radius） */
export function burstCells(center: Point, radius: number, cols: number, rows: number): Set<string> {
  const out = new Set<string>();
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (x >= 0 && y >= 0 && x < cols && y < rows) out.add(x + "," + y);
    }
  }
  return out;
}

/** 近程冲击：把 N×N 正方形放在攻击者（取左上格）点击方向的相邻侧。
 * 万律书：冲击必须与起始格（使用者空间）相邻，即垂直于主轴的偏移须与使用者占地重叠。
 * 返回 null 表示超出地图或无相邻放置位置。 */
export function blastSquare(
  a: Point,
  size: number,
  n: number,
  click: Point,
  cols: number,
  rows: number,
): { x: number; y: number; w: number; h: number } | null {
  const ax = a.x;
  const ay = a.y;
  const bx = ax + size - 1;
  const by = ay + size - 1;
  const acx = ax + (size - 1) / 2;
  const acy = ay + (size - 1) / 2;
  const dx = click.x - acx;
  const dy = click.y - acy;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (Math.abs(dx) >= Math.abs(dy)) {
    // 左右放置：x 紧贴攻击者占地，y 限定在与占地重叠的条带内（保证相邻）
    const x0 = dx > 0 ? bx + 1 : ax - n;
    if (x0 < 0 || x0 + n > cols) return null;
    const yLo = Math.max(0, ay - n + 1);
    const yHi = Math.min(rows - n, by);
    if (yLo > yHi) return null;
    const y0 = clamp(click.y - Math.floor(n / 2), yLo, yHi);
    return { x: x0, y: y0, w: n, h: n };
  }
  // 上下放置：y 紧贴攻击者占地，x 限定在与占地重叠的条带内（保证相邻）
  const y0 = dy > 0 ? by + 1 : ay - n;
  if (y0 < 0 || y0 + n > rows) return null;
  const xLo = Math.max(0, ax - n + 1);
  const xHi = Math.min(cols - n, bx);
  if (xLo > xHi) return null;
  const x0 = clamp(click.x - Math.floor(n / 2), xLo, xHi);
  return { x: x0, y: y0, w: n, h: n };
}

/** 找出其任一占用格落在 cells 中的参战者（可排除某 cid） */
export function affectedIn(combatants: Combatant[], cells: Set<string>, excludeCid?: string): Combatant[] {
  return combatants.filter((c) => {
    if (!c.pos || c.cid === excludeCid) return false;
    for (let dy = 0; dy < c.size; dy++) {
      for (let dx = 0; dx < c.size; dx++) {
        if (cells.has(c.pos.x + dx + "," + (c.pos.y + dy))) return true;
      }
    }
    return false;
  });
}

/** 占地中心（效果线起终点用） */
export function centerOf(p: Point, size: number): Point {
  return { x: p.x + (size - 1) / 2, y: p.y + (size - 1) / 2 };
}

/** 目标词条解析（敌/友过滤 + forced + 条件/体型目标）：定义见 ./monsterParse.ts */
export { parseTargetSpec } from "./monsterParse";
export type { TargetSpec } from "./monsterParse";

/** 近程爆发：以使用者整个空间（size×size）为起始格，从每个占用格向所有方向延伸 radius。
 * 万律书：近程威能起始格 = 使用者空间；体型越大起始格越大，爆发也越大。 */
export function closeBurstCells(space: Point, size: number, radius: number, cols: number, rows: number): Set<string> {
  const out = new Set<string>();
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      for (const k of burstCells({ x: space.x + dx, y: space.y + dy }, radius, cols, rows)) out.add(k);
    }
  }
  return out;
}

/**
 * 强制移动方向可达距离（8 方向箭头实时校验）：
 * 沿 (dx,dy) 方向逐格推进，每格须满足——界内、isBlocked 判定为空（障碍/其它棋子）、
 * 且目标体型的整个 size×size 占地都能容纳（批 1 体型缺口 ③）。返回可移动的格数（≤maxDist）。
 * isBlocked(x,y) 由调用方给出（含障碍与占用），传入时不含目标自身起点。
 */
export function forcedMoveReach(
  from: Point,
  size: number,
  dir: { dx: number; dy: number },
  maxDist: number,
  cols: number,
  rows: number,
  isBlocked: (x: number, y: number) => boolean,
): number {
  if (dir.dx === 0 && dir.dy === 0 || maxDist <= 0) return 0;
  let n = 0;
  for (let i = 1; i <= maxDist; i++) {
    const x = from.x + dir.dx * i;
    const y = from.y + dir.dy * i;
    let ok = true;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const gx = x + dx;
        const gy = y + dy;
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) { ok = false; break; }
        if (isBlocked(gx, gy)) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) break;
    n = i;
  }
  return n;
}

// ---------- 批 2-1：威胁触及 / 掩护 / 墙几何 / zone 生命周期（纯函数） ----------

/** 威胁触及（借机范围）：数据优先——近战威能 range「近战N」中取最大 N（>1 用之）；
 * 否则按体型回落 {1:1, 2:2, 3:3, 4:4}（本工程 size=每边格数，Medium=1/Large=2/Huge=3/Gargantuan=4）。 */
export function threatReachOf(c: Pick<Combatant, "attacks" | "size">): number {
  let reach = 0;
  for (const a of c.attacks ?? []) {
    const m = (a.range ?? "").match(/近战(\d+)/);
    if (m) reach = Math.max(reach, parseInt(m[1], 10));
  }
  if (reach > 1) return reach;
  const size = c.size ?? 1;
  return size >= 4 ? 4 : size;
}

/** 威胁格集（不含自身占地）：攻击者占地外围 reach 格 */
export function threatCells(pos: Point, size: number, reach: number, cols: number, rows: number): Set<string> {
  return reachCells(pos, size, reach, cols, rows);
}

/** 掩护等级（障碍版） */
export type CoverLevel = "none" | "partial" | "superior" | "total";

/**
 * 掩护自动计算：4 条效果线（目标四角顶点 → 攻击者占地中心）经 losBlocked 的阻挡数。
 * 0=none / 1-2=partial(-2) / 3=superior(-5) / 4=total（无效果线，无法攻击）。
 * 纯函数，不突变任何入参。
 */
export function coverOf(
  a: Point,
  aSize: number,
  b: Point,
  bSize: number,
  obstacles: Set<string>,
): { cover: CoverLevel; blocked: number } {
  const atk = centerOf(a, aSize);
  const corners: Point[] = [
    { x: b.x, y: b.y },
    { x: b.x + bSize, y: b.y },
    { x: b.x, y: b.y + bSize },
    { x: b.x + bSize, y: b.y + bSize },
  ];
  let blocked = 0;
  for (const c of corners) {
    if (losBlocked(atk, c, obstacles)) blocked++;
  }
  const cover: CoverLevel = blocked === 0 ? "none" : blocked <= 2 ? "partial" : blocked === 3 ? "superior" : "total";
  return { cover, blocked };
}

/** 墙辅助：两点是否正交相邻（曼哈顿距离 = 1） */
export function wallAdjacent(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/** 墙辅助：序列中每格的正交邻居数（供分叉/连通判定） */
export function wallNeighborsIn(seq: Point[]): Map<string, number> {
  const out = new Map<string, number>();
  const key = (p: Point) => p.x + "," + p.y;
  for (const a of seq) {
    let n = 0;
    for (const b of seq) {
      if (a !== b && wallAdjacent(a, b)) n++;
    }
    out.set(key(a), n);
  }
  return out;
}

/** 墙几何三定律校验（批 2-2b）：
 * ① 连续含起始格：相邻格曼哈顿距离 = 1（只能沿边线直连，不允许斜连/跳格）；
 * ② 每格共享一边（由①递推：正交相邻即共享边）；
 * ③ 每格最多两条边（无分叉）。
 * 不能建在生物格由调用方校验。返回 {ok, reason}。 */
export function wallValidate(seq: Point[]): { ok: boolean; reason?: string } {
  if (seq.length < 2) return { ok: false, reason: "墙至少需要 2 格。" };
  for (let i = 1; i < seq.length; i++) {
    if (!wallAdjacent(seq[i - 1], seq[i])) {
      return { ok: false, reason: `第 ${i + 1} 格与上一格不相邻（墙必须沿边线连续直连）。` };
    }
  }
  const counts = wallNeighborsIn(seq);
  const key = (p: Point) => p.x + "," + p.y;
  for (let i = 0; i < seq.length; i++) {
    const n = counts.get(key(seq[i])) ?? 0;
    if (n > 2) return { ok: false, reason: `第 ${i + 1} 格出现分叉（墙不能分支）。` };
  }
  return { ok: true };
}

/** zone 覆盖格集合（wall 亦返回其塑形格集，供渲染/结算共用） */
export function zoneCellsOf(z: Zone): Set<string> {
  return new Set(z.cells);
}

/** zone 到期判定（纯函数）：untilOwnerTurnEnd/untilOwnerTurnStart 在「当前回合已越过创建回合」时到期；
 * untilOwnerTurnStart 由调用方在轮到持有者前检查，untilOwnerTurnEnd 由调用方在持有者回合结束时检查；
 * encounter/manual 永不过期（仅 DM 删除）。 */
export function zoneExpired(z: Zone, ctx: { round: number; turnIndex: number }): boolean {
  if (z.duration === "encounter" || z.duration === "manual") return false;
  return ctx.round > z.createdRound || (ctx.round === z.createdRound && ctx.turnIndex > z.createdTurnIndex);
}

/** 覆盖给定格子集合的 zone（进入检测差集用：新占格与旧占格各查一次取差） */
export function zonesAt(zones: Zone[], cells: Set<string>): Zone[] {
  return zones.filter((z) => z.cells.some((k) => cells.has(k)));
}

/** 被墙 zone 占用的格 → 引用计数（obstacles 全量由 zones 推导：
 * 某格被 N 道墙覆盖，移除 1 道墙时仅当计数归 0 才从 obstacles 清除） */
export function wallCellsOwnedBy(zones: Zone[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const z of zones) {
    if (z.kind !== "wall") continue;
    for (const k of z.cells) count.set(k, (count.get(k) ?? 0) + 1);
  }
  return count;
}
