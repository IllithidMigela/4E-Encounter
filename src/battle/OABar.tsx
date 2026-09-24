// 借机统一结算条（批 2-3）：检测在移动/攻击入口处同步完成，命中即弹本条暂停落子。
// DM 应用（Enter）后由 App 的 deferred 闭包完成「借机伤害 + 停点 + 落子/原攻击」；
// 右上角「跳过（DM 裁决）」（不结算借机，继续原动作）/「取消」（放弃原动作）。
// autoResolve=false（oppResolve 关）时 d20/伤害变输入框，DM 手填后应用。
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Combatant } from "../types";
import type { OAProvoker, OAResult, TriggerCtx } from "./triggers";
import { settleOABatch } from "./triggers";
import { fmtMod } from "../engine";
import { parseDiceExpr, rollD20, rollDiceExpr } from "../dice";

interface Props {
  kind: "move" | "power" | "reaction";
  /** 被借机者（移动者 / 威能使用者）；reaction 时=被反应攻击的对象 */
  mover: Combatant;
  provokers: OAProvoker[];
  ctx: TriggerCtx;
  /** settings.auto.trigger.oppResolve */
  autoResolve: boolean;
  rosterOpen?: boolean;
  onApply: (results: OAResult[]) => void;
  /** 跳过（DM 裁决）：不结算借机/反应，继续原动作 */
  onSkip: () => void;
  /** 取消：放弃原动作（reaction 时=跳过反应继续原攻击） */
  onCancel: () => void;
}

export default function OABar({ kind, mover, provokers, ctx, autoResolve, rosterOpen = false, onApply, onSkip, onCancel }: Props) {
  // 自动模式：打开即统一掷骰（每名借机者独立 d20 + 伤害）
  const [autoResults, setAutoResults] = useState<OAResult[] | null>(null);
  // 手动模式：d20 / 伤害 输入（key = enemyCid）
  const [manualD20, setManualD20] = useState<Record<string, string>>({});
  const [manualDmg, setManualDmg] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!autoResolve) return;
    const r = settleOABatch(provokers, mover, ctx, {
      d20: () => rollD20().total,
      damage: (expr) => (expr && parseDiceExpr(expr) ? rollDiceExpr(expr)?.total ?? 0 : 0),
    });
    setAutoResults(r.results);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applied = useMemo(() => autoResults?.filter((r) => r.applied) ?? [], [autoResults]);
  const anyHit = applied.length > 0;
  const stopNote = useMemo(() => {
    if (kind !== "move" || !anyHit) return null; // 威能借机无「命中即停」语义
    const first = applied[0];
    return `命中即停：${mover.name} 停在被离开的威胁格 (${first.provoker.fromCell.x + 1}, ${first.provoker.fromCell.y + 1})`;
  }, [kind, anyHit, applied, mover.name]);

  const apply = useCallback(() => {
    if (autoResolve && autoResults) {
      onApply(autoResults);
      return;
    }
    // 手动：按 provoker 顺序逐项取 d20/伤害输入
    const d20s = provokers.map((p) => {
      const v = parseInt(manualD20[p.enemyCid] ?? "", 10);
      return Number.isFinite(v) && v >= 1 && v <= 20 ? v : NaN;
    });
    let idx = 0;
    const r = settleOABatch(provokers, mover, ctx, {
      d20: () => d20s[idx] ?? 1,
      damage: (expr) => {
        const t = ((manualDmg[provokers[idx].enemyCid] ?? expr) || "").trim();
        idx++;
        if (!t) return 0;
        const rr = parseDiceExpr(t) ? rollDiceExpr(t) : null;
        return rr ? rr.total : parseInt(t.replace(/\D/g, "") || "0", 10);
      },
    });
    onApply(r.results);
  }, [autoResolve, autoResults, provokers, mover, ctx, manualD20, manualDmg, onApply]);

  const anyHitCount = autoResults?.filter((r) => r.hit).length ?? 0;
  const title =
    kind === "move"
      ? `移动离开威胁格：${mover.name} 被 ${provokers.length} 名敌人借机攻击`
      : kind === "power"
        ? `使用远程/区域威能：${mover.name} 被 ${provokers.length} 名邻接敌人借机攻击`
        : `${mover.name} 被命中，${provokers.length} 名棋子的被命中反应威能可触发`;

  return (
    <div className="es-settlebar es-oa-bar" style={{ bottom: rosterOpen ? "var(--es-roster-h, 176px)" : 0 }}>
      <div className="es-settlebar-main">
        <div className="es-settle-head">
          <div className="es-settle-power">
            <span className="es-settle-name">{kind === "reaction" ? "⚔ 被命中反应" : "⚔ 借机攻击"}</span>
            <span className="es-settle-range">{title}</span>
          </div>
          <div className={"es-settle-status" + (anyHit ? " hit" : "")}>
            {anyHit ? `⚠ 命中 ${applied.length} 次${kind === "move" ? "（停止移动）" : ""}` : anyHitCount > 0 ? `命中 ${anyHitCount} 次（未致停）` : "全部未命中"}
          </div>
          <div className="es-oa-actions">
            <button className="es-oa-skip" onClick={onSkip} title="不结算，继续原动作（DM 裁决）">
              跳过
            </button>
            <button className="es-oa-cancel" onClick={onCancel} title={kind === "reaction" ? "跳过反应，继续原攻击" : "放弃原动作"}>
              取消 <kbd>Esc</kbd>
            </button>
          </div>
        </div>

        <div className="es-settle-rows">
          {provokers.map((p) => {
            const res = autoResults?.find((r) => r.provoker.enemyCid === p.enemyCid);
            const d20 = res ? res.d20 : manualD20[p.enemyCid] ?? "";
            const dmg = res ? res.damage : 0;
            const total = res ? res.total : d20 !== "" ? (typeof d20 === "number" ? d20 : parseInt(String(d20), 10) || 0) + (p.power.attack ?? 0) : NaN;
            const hit = res ? res.hit : false;
            return (
              <div key={p.enemyCid} className={"es-settle-row" + (res ? (hit ? " hit" : " miss") : "")}>
                <div className="es-settle-row-line">
                  <span className="es-settle-row-name">{p.enemyCid === mover.cid ? "—" : provokerName(p, ctx)}</span>
                  <span className="es-settle-row-dice">
                    <b>{res ? d20 : "?"}</b>
                    <span className="es-settle-row-plus">{fmtMod(p.power.attack ?? 0)}</span>
                    {res && res.markedBonus > 0 && <span className="es-settle-row-plus">{fmtMod(res.markedBonus)}</span>}
                  </span>
                  <span className="es-settle-row-arrow">→</span>
                  <span className="es-settle-row-total">{res ? total : "…"}</span>
                  <span className="es-settle-row-vs">vs {p.power.defense.toUpperCase()} {targetDefense(p, mover)}</span>
                  <span className={"es-settle-row-state " + (res ? (hit ? "hit" : "miss") : "")}>
                    {res ? (res.crit ? "⚡重击" : res.fumble ? "✗失手" : hit ? "命中" : "未命中") : "待填"}
                  </span>
                  {res && hit && dmg > 0 && <span className="es-settle-row-dmg">{dmg} 伤害</span>}
                  {res && res.applied && <span className="es-oa-applied">✓ 生效</span>}
                </div>
                {!autoResolve && (
                  <div className="es-settle-row-edit">
                    <label>
                      d20
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={manualD20[p.enemyCid] ?? ""}
                        placeholder="1–20"
                        onChange={(e) => setManualD20((prev) => ({ ...prev, [p.enemyCid]: e.target.value }))}
                      />
                    </label>
                    <label>
                      伤害
                      <input
                        type="text"
                        value={manualDmg[p.enemyCid] ?? p.power.damageExpr}
                        placeholder={p.power.damageExpr || "点数"}
                        onChange={(e) => setManualDmg((prev) => ({ ...prev, [p.enemyCid]: e.target.value }))}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
          {provokers.some((p) => p.dmNote) && (
            <div className="es-oa-dmnote">⚠ {provokers.find((p) => p.dmNote)?.dmNote}</div>
          )}
          {stopNote && <div className="es-oa-stopnote">{stopNote}</div>}
        </div>

        <div className="es-settle-actions">
          <div className="es-settle-actions-left">
            <button className="es-settle-manual" onClick={() => onSkip()}>跳过（DM 裁决）</button>
          </div>
          <div className="es-settle-actions-right">
            <button className="es-settle-apply" onClick={apply} disabled={!autoResolve && provokers.some((p) => !manualD20[p.enemyCid])}>
              {kind === "move"
                ? anyHit
                  ? "应用借机并停止移动"
                  : autoResolve && autoResults
                    ? "应用（未命中）"
                    : "应用借机"
                : kind === "reaction"
                  ? "应用反应"
                  : "应用借机"}
              <kbd>Enter</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function provokerName(p: OAProvoker, ctx: TriggerCtx): string {
  return ctx.combatants.find((c) => c.cid === p.enemyCid)?.name ?? p.enemyCid;
}

function targetDefense(p: OAProvoker, mover: Combatant): number {
  return mover[p.power.defense];
}
