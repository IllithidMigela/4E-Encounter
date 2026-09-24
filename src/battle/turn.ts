// 回合推进：阶段 0 架构重构——把 App.tsx 中「回合推进」的纯状态计算抽离为可单测的纯函数。
// 约定：纯函数、不突变入参、不触达 React 状态；副作用（setCombatants/setTurnIndex/日志）仍由 App 编排。

import type { Combatant } from "../types";
import { clearExpiredAuraConditions, forcedMoveReach, isDead, type Point } from "../engine";
import { applyOngoingAtTurnStart, applyRegenAtTurnStart, rollSavesAtTurnEnd } from "./resolve";

/** 计算下一个行动者（纯函数）：从 turnIndex 下一位起循环，跳过已死棋子；全灭则停在原下一位。
 * @returns nextIndex 目标先攻序下标；cid 目标棋子；wrapped 是否跨过 0（进入新回合）；newRound 目标回合数。 */
export function advanceActor(
  combatants: Combatant[],
  turnOrder: string[],
  turnIndex: number,
  round: number,
): { nextIndex: number; cid: string; wrapped: boolean; newRound: number } {
  const len = turnOrder.length;
  if (len === 0) return { nextIndex: 0, cid: "", wrapped: false, newRound: round };
  let next = (turnIndex + 1) % len;
  let wrapped = next === 0; // 是否已跨过 0（进入新回合）
  let guard = 0;
  while (guard < len) {
    const cand = combatants.find((c) => c.cid === turnOrder[next]);
    if (!cand || !isDead(cand)) break;
    next = (next + 1) % len;
    if (next === 0) wrapped = true;
    guard++;
  }
  return { nextIndex: next, cid: turnOrder[next], wrapped, newRound: wrapped ? round + 1 : round };
}

/** 回合边界状态到期清理（纯函数，复用 engine.clearExpiredAuraConditions）：返回「确实发生状态到期移除」的棋子列表。
 * 读入会是原对象引用（未变可不写）；调用方据此决定是否 snapBefore/patch。抽离 runTurnStart/runTurnEnd 重复的清状态拼装。 */
export function expiredConditionTargets(combatants: Combatant[], actorCid: string, at: "start" | "end"): Combatant[] {
  const afterClear = clearExpiredAuraConditions(combatants, actorCid, at);
  return afterClear.filter((nc) => {
    const old = combatants.find((x) => x.cid === nc.cid);
    return old ? nc !== old : true;
  });
}

/** 回合开始自动结算的纯计算（仅当前行动者 c，不触达 combatants 数组/日志）：
 * 再生 + 持续伤害一次算全，供 App.runTurnStart 编排 side-effect 时复用，消除对 applyOngoingAtTurnStart 的重复调用。
 * 语义保持原样：
 * - ongoingOnly：仅持续伤害 on 原始 c（App 的「持续伤害致死」判定用，不含再生，行为与改前一致）；
 * - curState：再生+持续伤害 最终状态（死亡豁免状态判定用）。 */
export function settleTurnStart(c: Combatant): {
  regenHealed: number;
  ongoingTotal: number;
  ongoingParts: string[];
  ongoingOnly: Combatant;
  curState: Combatant;
} {
  const regen = applyRegenAtTurnStart(c);
  const od = applyOngoingAtTurnStart(c);
  const curState = applyOngoingAtTurnStart(regen.next).next;
  return { regenHealed: regen.healed, ongoingTotal: od.total, ongoingParts: od.parts, ongoingOnly: od.next, curState };
}

/** 回合结束豁免的纯计算（复用 resolve.rollSavesAtTurnEnd）：先把「无持续伤害」短路与掷骰封装为一体。
 * hasOngoing=false 表示无持续伤害（App 据此走「无可豁免」分支）；否则返回逐项骰面/成功数/豁免后状态。 */
export function rollEndSaves(c: Combatant, d20: () => number): {
  hasOngoing: boolean;
  rolls: { d20: number; ok: boolean; label: string }[];
  success: number;
  next: Combatant;
} {
  const ongoing = c.ongoingDamage ?? [];
  if (ongoing.length === 0) return { hasOngoing: false, rolls: [], success: 0, next: c };
  const r = rollSavesAtTurnEnd(c, d20);
  return { hasOngoing: true, rolls: r.rolls, success: r.success, next: r.next };
}

/** 强制移动单步目标（纯函数，抽自 App.handleForcedMoveDir）：计算该方向**最远可达格数** reach 与**本步目标格** to。
 * 阻塞判定：界外/墙体障碍/其它存在棋子的占格（排除自身）。App 据此决定是否可移 + 落格，不触达棋盘状态。 */
export function forcedStep(
  mover: Pick<Combatant, "cid" | "pos" | "size">,
  dir: { dx: number; dy: number },
  maxDist: number,
  cols: number,
  rows: number,
  obstacles: ReadonlySet<string>,
  combatants: Pick<Combatant, "cid" | "pos" | "size">[],
): { reach: number; to: Point } {
  const mpos = mover.pos!;
  const isBlocked = (x: number, y: number): boolean => {
    if (obstacles.has(x + "," + y)) return true;
    return combatants.some(
      (o) => o.pos && o.cid !== mover.cid && x >= o.pos.x && x < o.pos.x + o.size && y >= o.pos.y && y < o.pos.y + o.size,
    );
  };
  const reach = forcedMoveReach(mpos, mover.size, dir, maxDist, cols, rows, isBlocked);
  return { reach, to: { x: mpos.x + dir.dx, y: mpos.y + dir.dy } };
}