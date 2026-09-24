// 底栏·全员数据：遭遇中所有参战者的速查表格（先攻/防御/生命/回复力/异常状态）
// 底栏形态同屏最多显示约 5 行，超出可滚动；表头最右角格按钮可将表格展开填满中间内容栏（不覆盖左右栏）。
// 掷过先攻后按先攻轮序展示；未掷则保持加入顺序。点击行可查看该棋子的详情。
// 批 1-9 交互：HP 列点击浮层微调（伤害/治疗）；状态列点击浮层快捷切换状态；持续伤害列显示完整信息（类型+豁免终止）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActiveEffect, Combatant, ConditionKey, DamageType } from "../types";
import { ALL_CONDITIONS, CONDITION_LABEL, DAMAGE_TYPE_LABEL } from "../types";
import { fmtMod } from "../engine";
import CombatantDetail from "./CombatantDetail";

interface Props {
  combatants: Combatant[];
  turnOrder: string[];
  turnIndex: number;
  onSelect: (cid: string) => void;
  /** 按棋子扣血/治疗（HP 微调浮层用） */
  onApplyDamageTo: (cid: string, n: number) => void;
  onApplyHealTo: (cid: string, n: number) => void;
  /** 快捷切换棋子状态（状态浮层用） */
  onToggleCondition: (cid: string, k: ConditionKey) => void;
  /** 按 cid 打补丁（详情页快捷操作：临时 HP / 再生 / 持续伤害） */
  onPatchCid: (cid: string, patch: Partial<Combatant>) => void;
  /** 是否处于展开状态（填满中间内容栏） */
  expanded: boolean;
  /** 展开/收起切换 */
  onToggleExpanded: () => void;
  /** 移除指定棋子（每行移除按钮用） */
  onRemove: (cid: string) => void;
}

/** 持续伤害的完整展示：持续[类型]伤害 N（豁免终止；saveOn=start 为回合开始豁免） */
export function ongoingText(d: { type?: string; value: number; saveOn?: "end" | "start" }): string {
  const t = d.type ? DAMAGE_TYPE_LABEL[d.type as DamageType] ?? d.type : "";
  return `持续${t}伤害 ${d.value}（${d.saveOn === "start" ? "回合开始豁免" : "豁免终止"}）`;
}

/** 已挂载效果的一行文本：标签 · 时长（来源）（批 4b-4：当前效果列表集中展示用） */
export function effectText(e: ActiveEffect): string {
  const parts = [e.label];
  // 时长若已写进标签（旧数据/别名），不再追加，避免两边重复
  if (e.duration && !e.label.includes(e.duration)) parts.push(e.duration);
  const base = parts.join(" · ");
  return e.source ? `${base}（${e.source}）` : base;
}

/** 效果芯片的缩略版（数据栏空间有限）：不显示持续时长（时长只在详情页/悬浮提示），剥离旧式时长括号后缩略。 */
export function effectBrief(e: ActiveEffect): string {
  const label = (e.label ?? "").replace(/\s*（[^（）]*?(?:回合|结束|豁免|遭遇)[^（）]*?）/g, "").trim();
  const text = e.source ? `${label}（${e.source}）` : label;
  return text
    .replace(/全伤害抗力/g, "全抗力")
    .replace(/攻击骰和伤害骰/g, "攻伤骰")
    .replace(/伤害骰/g, "伤骰")
    .replace(/攻击骰/g, "攻骰");
}

/** 浮层触发点（fixed 定位：记录触发格相对视口的坐标） */
interface PopAnchor {
  cid: string;
  x: number;
  y: number;
}

export default function RosterPanel({ combatants, turnOrder, turnIndex, onSelect, onApplyDamageTo, onApplyHealTo, onToggleCondition, onPatchCid, expanded, onToggleExpanded, onRemove }: Props) {
  /** HP 微调浮层锚点（null = 收起） */
  const [hpEdit, setHpEdit] = useState<PopAnchor | null>(null);
  /** 状态快捷面板锚点（null = 收起） */
  const [condEdit, setCondEdit] = useState<PopAnchor | null>(null);
  /** 全屏详情页目标 cid（null = 收起） */
  const [detailCid, setDetailCid] = useState<string | null>(null);
  /** 精确修改量输入（HP 浮层内） */
  const [hpDelta, setHpDelta] = useState("");
  /** 底栏可调高度（null = 自动填满剩余空间） */
  const [rosterH, setRosterH] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  /** 把当前底栏实际高度同步为全局 CSS 变量，供悬浮结算条（攻击/借机等）按其避让定位 */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--es-roster-h", `${barRef.current?.offsetHeight ?? rosterH ?? 176}px`);
    return () => {
      root.style.removeProperty("--es-roster-h");
    };
  }, [rosterH, expanded]);

  /** 拖动顶栏手柄调整底栏高度；拖动结束瞬间吞掉误触发的模拟点击，避免弹起 HP/状态浮层 */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略：部分环境不支持手动捕获 */
    }
    const startY = e.clientY;
    const startH = barRef.current?.offsetHeight ?? 240;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 3) dragged = true;
      // 手柄位于底栏顶缘：向上拖 = 变高（顶缘跟随鼠标），向下拖 = 变矮
      setRosterH(Math.max(60, startH + (startY - ev.clientY)));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      // 仅当确实拖拽过才吞掉紧随其后的那一次 click（限时 300ms，之后自动放弃）
      if (dragged) {
        const swallow = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          document.removeEventListener("click", swallow, true);
        };
        requestAnimationFrame(() => document.addEventListener("click", swallow, true));
        window.setTimeout(() => document.removeEventListener("click", swallow, true), 300);
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    document.body.style.cursor = "row-resize";
  };

  // 所见即所得：仅展示已在地图上落位的棋子（有 pos）；未放置的棋子不进入数据栏
  const placed = useMemo(() => combatants.filter((c) => c.pos), [combatants]);

  // 已掷先攻：按先攻轮序排列；否则保持加入顺序
  const sorted = useMemo(() => {
    if (turnOrder.length > 0 && placed.every((c) => turnOrder.includes(c.cid))) {
      const idx = new Map(turnOrder.map((cid, i) => [cid, i]));
      return [...placed].sort((a, b) => (idx.get(a.cid) ?? 0) - (idx.get(b.cid) ?? 0));
    }
    return placed;
  }, [placed, turnOrder]);

  const curCid = turnOrder[turnIndex];

  /** 当前异常状态：条件状态 + 持续伤害（重伤由生命值自动体现，不列出） */
  const statusText = (c: Combatant): string => {
    const parts: string[] = [];
    for (const k of c.conditions) {
      if (k === "bloodied" || k === "dying") continue;
      const src = c.condUntil?.[k]?.source ? `（${c.condUntil[k].source}）` : "";
      parts.push((CONDITION_LABEL[k] ?? k) + src);
    }
    for (const d of c.ongoingDamage ?? []) parts.push(ongoingText(d));
    return parts.join("、") || "—";
  };

  /** HP 微调：按增量统一入口（正=治疗 / 负=扣血） */
  const adjustHp = (cid: string, delta: number) => {
    if (delta === 0) return;
    if (delta < 0) onApplyDamageTo(cid, -delta);
    else onApplyHealTo(cid, delta);
    setHpDelta("");
  };

  /** 点击单元格 → 打开浮层（fixed 锚点=触发格坐标，向上弹出） */
  const openPop = (e: React.MouseEvent, cid: string, setter: React.Dispatch<React.SetStateAction<PopAnchor | null>>, other: React.Dispatch<React.SetStateAction<PopAnchor | null>>) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const anchor = { cid, x: r.left + r.width / 2, y: r.top };
    // 同一行再次点击 = 收起；点其它行 = 切换
    other(null);
    setter((prev) => (prev && prev.cid === cid ? null : anchor));
    setHpDelta("");
  };

  const hpTarget = hpEdit ? combatants.find((c) => c.cid === hpEdit.cid) : null;
  const condTarget = condEdit ? combatants.find((c) => c.cid === condEdit.cid) : null;

  return (
    <div className="es-roster-bar" ref={barRef} style={!expanded && rosterH !== null ? { height: rosterH, flex: "none" } : undefined}>
        {/* 拖拽手柄：置于底栏顶端正中，拖动调整底栏高度；双击恢复自动高度 */}
        <div
          className="es-roster-resize"
          title="拖动调整高度，双击恢复"
          onPointerDown={startResize}
          onDoubleClick={() => setRosterH(null)}
        >
          <span className="material-symbols-outlined">drag_handle</span>
        </div>
        <div className="es-roster-scroll">
        <table className="es-roster-table">
          <thead>
            <tr>
              <th className="c-details">详情</th>
              <th className="c-name">姓名</th>
              <th>先攻</th>
              <th>等级</th>
              <th>AC</th>
              <th>强韧</th>
              <th>反射</th>
              <th>意志</th>
              <th className="c-hp">生命值</th>
              <th>临时</th>
              <th>恢复力</th>
              <th>能力补充</th>
              <th className="c-conds">当前异常状态</th>
              <th className="c-effects">当前效果</th>
              <th className="c-full">
                  <button
                    className={"es-roster-full" + (expanded ? " on" : "")}
                    onClick={onToggleExpanded}
                    title={expanded ? "收起战斗数据栏" : "展开战斗数据栏"}
                  >
                    <span className="material-symbols-outlined">{expanded ? "fullscreen_exit" : "fullscreen"}</span>
                  </button>
                </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const dead = c.hp <= 0;
              const bloodied = !dead && c.hp <= c.bloodied;
              return (
                <tr
                  key={c.cid}
                  className={c.kind + (c.cid === curCid ? " cur" : "") + (dead ? " dead" : "")}
                  onClick={() => onSelect(c.cid)}
                  title={`点击查看 ${c.name} 的详情`}
                >
                  <td className="c-details">
                    <button
                      className="es-detail-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        // 打开详情的同时选中该棋子，让右栏棋子栏同步展示它的数据
                        onSelect(c.cid);
                        setDetailCid(c.cid);
                      }}
                      title={`全屏查看 ${c.name} 的数据与状态`}
                    >
                      详情
                    </button>
                  </td>
                  <td className="c-name">{c.name}</td>
                  <td>{c.initResult != null ? c.initResult : fmtMod(c.init)}</td>
                  <td>{c.level ?? "—"}</td>
                  <td>{c.ac}</td>
                  <td>{c.fort}</td>
                  <td>{c.ref}</td>
                  <td>{c.will}</td>
                  {/* HP 列：点击浮层微调 */}
                  <td
                    className={"c-hp es-roster-interact" + (dead ? " hp-dead" : bloodied ? " hp-low" : "")}
                    onClick={(e) => openPop(e, c.cid, setHpEdit, setCondEdit)}
                  >
                    <b>{c.hp}</b>/{c.maxHp}
                  </td>
                  <td>{c.tempHp > 0 ? "+" + c.tempHp : "—"}</td>
                  <td>{c.surges !== undefined ? c.surgeValue : "—"}</td>
                  <td>{c.surges !== undefined ? `${c.surgesLeft}/${c.surges}` : "—"}</td>
                  {/* 状态列：点击浮层快捷切换 */}
                  <td
                    className={"c-conds es-roster-interact" + (c.conditions.length > 0 ? " has-conds" : "")}
                    onClick={(e) => openPop(e, c.cid, setCondEdit, setHpEdit)}
                  >
                    {statusText(c)}
                  </td>
                  {/* 效果列（批 4b-4）：已挂载效果集中展示（类型+豁免终止+来源） */}
                  <td className={"c-effects" + ((c.effects?.length ?? 0) > 0 ? " has-effects" : "")}>
                    {c.effects && c.effects.length > 0 ? (
                      c.effects.map((e, i) => (
                        <span key={i} className="es-eff" title={effectText(e)}>
                          {effectBrief(e)}
                        </span>
                      ))
                    ) : (
                      "—"
                    )}
                  </td>
                  {/* 移除按钮：放在最右角格列（与表头展开按钮同一列），每行一个删指定怪物（stopPropagation 避免误选） */}
                  <td className="c-full">
                    <button
                      className="es-row-del"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(c.cid);
                      }}
                      title={`移除 ${c.name} 出遭遇`}
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* HP 微调浮层（fixed 定位，避开滚动容器裁剪；渲染在表格外层） */}
      {hpEdit && hpTarget && (
        <div
          className="es-roster-pop"
          style={{ left: hpEdit.x, top: hpEdit.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="es-roster-pop-title">调整 {hpTarget.name} 的生命值</div>
          <div className="es-roster-pop-hp">{hpTarget.hp}/{hpTarget.maxHp}（当前）</div>
          <div className="es-roster-hp-btns">
            {[-10, -5, -1, 1, 5, 10].map((d) => (
              <button key={d} className={d < 0 ? "dmg" : "heal"} onClick={() => adjustHp(hpTarget.cid, d)}>
                {d > 0 ? "+" : ""}{d}
              </button>
            ))}
          </div>
          <div className="es-roster-hp-exact">
            <input
              type="number"
              value={hpDelta}
              placeholder="精确修改量（负=扣血）"
              onChange={(e) => setHpDelta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n = parseInt(hpDelta.replace(/\s+/g, ""), 10);
                  if (!isNaN(n) && n !== 0) adjustHp(hpTarget.cid, n);
                }
              }}
            />
            <button
              className="es-roster-hp-go"
              disabled={isNaN(parseInt(hpDelta.replace(/\s+/g, ""), 10)) || parseInt(hpDelta.replace(/\s+/g, ""), 10) === 0}
              onClick={() => {
                const n = parseInt(hpDelta.replace(/\s+/g, ""), 10);
                if (!isNaN(n) && n !== 0) adjustHp(hpTarget.cid, n);
              }}
            >
              应用
            </button>
          </div>
          <button className="es-roster-pop-close" onClick={() => setHpEdit(null)}>关闭 ✕</button>
        </div>
      )}

      {/* 状态快捷面板（fixed 定位） */}
      {condEdit && condTarget && (
        <div
          className="es-roster-pop es-roster-pop-cond"
          style={{ left: condEdit.x, top: condEdit.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="es-roster-pop-title">切换 {condTarget.name} 的状态</div>
          <div className="es-roster-conds">
            {ALL_CONDITIONS.filter((k) => k !== "bloodied" && k !== "dying").map((k) => (
              <button
                key={k}
                className={"es-cond" + (condTarget.conditions.includes(k) ? " on" : "")}
                onClick={() => onToggleCondition(condTarget.cid, k)}
              >
                {CONDITION_LABEL[k]}
              </button>
            ))}
          </div>
          <button className="es-roster-pop-close" onClick={() => setCondEdit(null)}>关闭 ✕</button>
        </div>
      )}
    {/* 全屏详情页 */}
      {detailCid && (() => {
        const c = combatants.find((x) => x.cid === detailCid);
        return c ? (
          <CombatantDetail
            c={c}
            onClose={() => setDetailCid(null)}
            onApplyDamageTo={onApplyDamageTo}
            onApplyHealTo={onApplyHealTo}
            onPatchCid={onPatchCid}
            onToggleCondition={onToggleCondition}
          />
        ) : null;
      })()}
    </div>
  );
}
