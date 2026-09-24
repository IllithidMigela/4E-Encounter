// 战斗事件类型与发射器（批 1-11 并行工程：resolve.ts + events.ts）
// 这是威能语义模型「第 3 层 · 触发系统」的挂载点：
// 批 1 先落地事件类型与发射器骨架，App 在关键节点 emit（使用威能/移动/受击/回合结束/HP归零）；
// 批 2 借机双触发源、灵气自动结算、区域效果 zone 将监听这些事件自动匹配响应，命中即弹出结算。
// 批 1 无监听者，emit 零副作用——为批 2 预留而不破坏现有流程。
import type { AttackOption } from "../types";
import type { Point } from "../engine";

export type BattleEvent =
  /** 棋子移动完成（forced=true 为强制移动，不引发借机）；path 为实际落子路径、shift=快步（批 2-2：供灵气/zone 进入检测与借机判定） */
  | { type: "move"; cid: string; from: Point; to: Point; forced: boolean; path?: Point[]; shift?: boolean }
  /** 使用威能（攻击或效果型） */
  | { type: "usePower"; cid: string; power: AttackOption; targetIds: string[] }
  /** 受到伤害（damageType 为修正后主类型；source 为攻击者 cid 或威能名） */
  | { type: "takeDamage"; cid: string; amount: number; damageType?: string; source?: string }
  /** 回合结束（供「回合结束」触发的反应/光环结算） */
  | { type: "turnEnd"; cid: string; round: number }
  /** HP 归零（濒死/死亡联动，批 3 死亡豁免倒计时） */
  | { type: "hpZero"; cid: string; hp: number }
  /** 进入灵气范围（批 2 灵气自动结算） */
  | { type: "enterAura"; cid: string; auraOwner: string; power: AttackOption }
  /** 状态获得/移除（批 2 可挂钩状态触发条件） */
  | { type: "condition"; cid: string; gained: string[]; lost: string[] };

type Listener = (e: BattleEvent) => void;

/** 战斗事件发射器：批 1 骨架；批 2 触发系统在此注册监听器 */
export class BattleBus {
  private listeners = new Set<Listener>();

  /** 注册监听，返回解绑函数 */
  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: BattleEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}

/** 全局战斗事件总线（App 持有单例） */
export const battleBus = new BattleBus();
