// 先攻栏（顶栏）：未掷先攻时显示「投掷先攻 / 以突袭轮开始」按钮；掷过先攻后按钮消失、轮形先攻填满顶栏（当前行动者最大、越远越小、可见边缘贴合 1px）；右侧为「下一回合」按钮；点击条目联动棋子栏
import type { Combatant } from "../types";
import { freshActionBudget } from "./resolve";
import { isDead } from "../engine";

interface Props {
  turnOrder: string[];
  turnIndex: number;
  round: number;
  combatants: Combatant[];
  canRoll: boolean;
  onRollInitiative: () => void;
  onSurprise: () => void;
  onSelectCombatant: (cid: string) => void;
  onEndTurn: () => void;
  /** 动作预算开关：关闭时动作槽不限预算 */
  autoActionBudget: boolean;
  /** 批 3-3c：手动死亡豁免 / 行动点 */
  onDeathSave: () => void;
  onSpendActionPoint: () => void;
}

/** 当前行动者 index 到环形距离（取最短环距） */
function ringDist(i: number, cur: number, n: number): number {
  if (n <= 1) return 0;
  const d = Math.abs(i - cur) % n;
  return Math.min(d, n - d);
}

export default function InitiativeBar({ turnOrder, turnIndex, round, combatants, canRoll, onRollInitiative, onSurprise, onSelectCombatant, onEndTurn, autoActionBudget, onDeathSave, onSpendActionPoint }: Props) {
  const n = turnOrder.length;

  // 以当前行动者为中心的环形展开序列（每个角色出现一次，cur 居中；越远环距越大）
  const seq: { cid: string; dist: number }[] = [];
  if (n > 0) {
    const start = -Math.floor((n - 1) / 2);
    const end = Math.ceil((n - 1) / 2);
    for (let off = start; off <= end; off++) {
      const idx = ((turnIndex + off) % n + n) % n;
      seq.push({ cid: turnOrder[idx], dist: ringDist(idx, turnIndex, n) });
    }
  }

  return (
    <div className="es-initiative">
      {/* 未掷先攻（含突袭轮未开启）时显示两个准备按钮；掷过先攻后整行消失，先攻轮填满顶栏 */}
      {n === 0 && (
      <div className="es-init-top">
        <div className="es-init-actions">
          <button className="md-btn" onClick={onRollInitiative} disabled={!canRoll} title="所有参战者掷 d20+先攻 排序">
            <span className="material-symbols-outlined">casino</span> 投掷先攻
          </button>
          <button className="md-btn" onClick={onSurprise} title="选择突袭者并进入突袭轮（后续里程碑）">
            <span className="material-symbols-outlined">hourglass_top</span> 以突袭轮开始
          </button>
        </div>
      </div>
      )}

      <div className="es-init-main">
        {/* 左侧对称占位：显示当前轮数（不可按），与右侧「下一回合」按钮等宽，使先攻轮相对整条顶栏居中 */}
        {n > 0 && (
          <button className="es-init-side" disabled title="当前轮数">
            第 {round} 轮
          </button>
        )}
        <div className="es-init-carousel">
          {n === 0 ? (
            <div className="es-init-empty">未掷先攻 —— 地图上放置至少两名参战者后点「投掷先攻」或「以突袭轮开始」</div>
          ) : (
            seq.map(({ cid, dist }) => {
              const c = combatants.find((x) => x.cid === cid);
              const isCur = cid === turnOrder[turnIndex];
              const scale = 1 / (1 + dist * 0.45);
              // 卡片在固定盒内做 transform:scale 缩放，盒内左右留白各为 (W-W·s)/2；
              // 用相等的负外边距补偿，使任意缩放卡的可见边缘都贴合到 flex gap（约 1px 描边）
              const pad = (86 * (1 - scale)) / 2;
              return (
                <button
                  key={cid}
                  data-cid={cid}
                  className={"es-init-item" + (isCur ? " cur" : "") + (c?.kind === "pc" ? " pc" : " monster")}
                  style={{ transform: `scale(${scale})`, marginLeft: -pad, marginRight: -pad }}
                  onClick={() => c && onSelectCombatant(c.cid)}
                  title={c?.name}
                >
                  <span className="es-init-name">{c?.name ?? cid}</span>
                  <span className="es-init-hp">{c ? (c.hp <= 0 ? "死亡" : c.hp + "/" + c.maxHp) : ""}</span>
                </button>
              );
            })
          )}
        </div>

        {n > 0 && (
          <button className="es-init-next" onClick={onEndTurn} title="结束当前行动者回合，进入下一位行动者">
            <span className="material-symbols-outlined">skip_next</span> 下一回合
          </button>
        )}
      </div>

      {/* 批 3-3a：当前行动者动作槽（标准/移动/次要）+ 行动点（强制移动/借机不消耗；关闭「回合动作预算」则全亮展示） */}
      {n > 0 &&
        (() => {
          const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
          if (!cur) return null;
          const b = cur.actionBudget ?? freshActionBudget();
          const budgetOn = autoActionBudget;
          const slots: { key: "standard" | "move" | "minor"; label: string; ok: boolean }[] = [
            { key: "standard", label: "标准", ok: budgetOn ? b.standard : true },
            { key: "move", label: "移动", ok: budgetOn ? b.move : true },
            { key: "minor", label: "次要", ok: budgetOn ? b.minor : true },
          ];
          const ap = typeof cur.actionPoints === "number" ? cur.actionPoints : 0;
          const dying = cur.kind === "pc" && cur.hp <= 0 && !isDead(cur);
          const dsFails = cur.deathSaveFails ?? 0;
          return (
            <>
              <div className="es-init-budget" title="当前行动者本回合剩余动作（替代规则：移动替标准、次要替移动）">
                <span className="es-init-budget-label">动作槽</span>
                {slots.map((s) => (
                  <span key={s.key} className={"es-action-slot" + (s.ok ? " ok" : " used")} title={s.ok ? "本回合可用" : "本回合已用尽"}>
                    {s.label}
                  </span>
                ))}
                <button
                  className={"es-init-budget-ap" + (ap > 0 && !cur.apUsedThisRound ? " ok" : "")}
                  onClick={onSpendActionPoint}
                  disabled={ap <= 0 || !!cur.apUsedThisRound}
                  title="行动点：花费 1 点获得一个额外标准动作（每回合最多一次；长休息后恢复 1 点）"
                >
                  行动点 ×{ap}
                </button>
              </div>
              {dying && (
                <div className="es-init-death" title="濒死：每回合开始掷死亡豁免；3 次失败死亡，天然20 花回复力求生，天然1 记 2 次失败">
                  <span className={"es-init-death-fail" + (dsFails >= 2 ? " danger" : "")}>死亡豁免失败 {dsFails}/3</span>
                  <button className="es-act-btn danger" onClick={onDeathSave} title="手动掷一次死亡豁免（自动开关关闭时由 DM 点掷）">掷豁免</button>
                </div>
              )}
            </>
          );
        })()}
    </div>
  );
}