// 回合栏（左栏）：按「轮 → 棋子」把每个棋子每一回合的经过组织成可折叠卡片；
// 段内先按阶段（回合开始 / 回合中 / 插入动作 / 回合结束）分区，回合中再按「动作-威能-命中-伤害-效果」分层。
import { useEffect, useMemo, useRef, useState } from "react";
import type { AttackKind, Combatant, LogEntry, Team } from "../types";
import { KIND_LABEL } from "../types";
import { formatCombatLog, formatProgramLog } from "../diagLog";

/** 触发浏览器下载一个文本文件 */
function downloadText(filename: string, text: string) {
  const blob = new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const PHASE_LABEL: Record<string, string> = {
  start: "回合开始",
  action: "回合中",
  end: "回合结束",
  interrupt: "插入动作",
  system: "系统",
};

interface Props {
  round: number;
  turnOrder: string[];
  turnIndex: number;
  combatants: Combatant[];
  log: LogEntry[];
  onUndoUnit: (unitId: number) => void;
  onUndoTurn: (cid: string, round: number) => void;
}

/** 一个棋子在某一回合的记录 */
interface TurnGroup {
  key: string;
  round: number;
  cid: string;
  name: string;
  init: number | null;
  kind: Team;
  hp: string;
  entries: LogEntry[];
}

/**
 * 把一段回合内的日志条目（已按时间排序）转成展示节点：
 * - 相邻阶段变化 → 输出「阶段」分隔头；
 * - 回合中的「带威能」条目 → 连续同威能条目聚合成一个「动作块」（先出动作+威能头，再出命中/伤害/效果行）；
 * - 其余（移动、手动改血等）→ 单行。
 */
type TurnNode =
  | { type: "phase"; phase: NonNullable<LogEntry["phase"]> }
  | { type: "action"; act: AttackKind | undefined; power: string; lines: LogEntry[]; tone: LogEntry["tone"] }
  | { type: "line"; e: LogEntry };

function buildNodes(entries: LogEntry[]): TurnNode[] {
  const nodes: TurnNode[] = [];
  let lastPhase = "";
  let block: { act: AttackKind | undefined; power: string; lines: LogEntry[] } | null = null;
  const flush = () => {
    if (block) {
      nodes.push({
        type: "action",
        act: block.act,
        power: block.power,
        lines: block.lines,
        tone: block.lines.reduce<LogEntry["tone"]>((m, l) => (l.tone === "crit" || m === "warn" ? "crit" : l.tone === "warn" ? "warn" : m), "normal"),
      });
      block = null;
    }
  };

  for (const e of entries) {
    // 「轮到 X 行动」等系统标记本身由卡片头承担，不再在体内重复渲染
    if (e.phase === "system") continue;
    const phase = e.phase ?? "";
    if (phase !== lastPhase) {
      if (lastPhase !== "" ) flush();
      nodes.push({ type: "phase", phase: e.phase ?? "system" });
      lastPhase = phase;
    }
    // 仅在「回合中」给有威能的连续条目聚合成动作块
    if (e.phase === "action" && e.power) {
      if (block && (block.power !== e.power || block.act !== e.act)) flush();
      if (!block) block = { act: e.act, power: e.power, lines: [] };
      block.lines.push(e);
    } else {
      flush();
      nodes.push({ type: "line", e });
    }
  }
  flush();
  return nodes;
}

export default function TurnPanel({ round, turnOrder, turnIndex, combatants, log, onUndoUnit, onUndoTurn }: Props) {
  const currentCid = turnOrder[turnIndex];
  const currentRound = round;

  // 按 轮 → 棋子 分组，保持出现顺序
  const groups = useMemo(() => {
    const byKey = new Map<string, TurnGroup>();
    const order: string[] = [];
    for (const e of log) {
      if (typeof e.round !== "number" || !e.turnCid) continue;
      const key = `${e.round}:${e.turnCid}`;
      let g = byKey.get(key);
      if (!g) {
        const c = combatants.find((x) => x.cid === e.turnCid);
        g = {
          key,
          round: e.round,
          cid: e.turnCid,
          name: c?.name ?? e.turnCid,
          init: c ? (c.initResult ?? c.init) : null,
          kind: c?.kind ?? "monster",
          hp: "",
          entries: [],
        };
        // 取该回合内第一条带 hp 快照的（通常是「轮到」标记）
        if (e.hp) g.hp = e.hp;
        byKey.set(key, g);
        order.push(key);
      } else if (!g.hp && e.hp) {
        g.hp = e.hp;
      }
      g.entries.push(e);
    }
    return order.map((k) => byKey.get(k)!);
  }, [log, combatants]);

  // 展开/折叠：未手动切换时，当前回合默认打开，其余默认收起
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggleCard = (key: string, isCurrent: boolean) =>
    setOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? isCurrent) }));

  // 轮到某行动者时自动展开其卡片，且回合一结束不自动收起（保持已展开状态）
  useEffect(() => {
    if (!currentCid) return;
    const key = `${currentRound}:${currentCid}`;
    setOpen((prev) => (prev[key] === true ? prev : { ...prev, [key]: true }));
  }, [currentCid, currentRound]);

  // 新回合 / 新动作进日志时，自动下滚到最新记录，保持能看到最新动作
  const scrRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  // 分轮：把连续同轮的卡片包在一个「第 N 轮」块里
  const rounds = useMemo(() => {
    const out: { round: number; groups: TurnGroup[] }[] = [];
    for (const g of groups) {
      const last = out[out.length - 1];
      if (!last || last.round !== g.round) out.push({ round: g.round, groups: [g] });
      else last.groups.push(g);
    }
    return out;
  }, [groups]);

  return (
    <div className="es-turn">
      <div className="es-turn-head">
        <span className="es-turn-round">第 {round} 轮</span>
        <span className="es-turn-headsp" />
        <button className="es-turn-export" onClick={() => downloadText("战斗日志.txt", formatCombatLog())} title="导出建立在完整诊断日志之上的战斗记录（操作轨迹+回合记录+画面快照+关键报错）">
          导出战斗日志
        </button>
        <button className="es-turn-export" onClick={() => downloadText("程序日志.txt", formatProgramLog())} title="导出完整的程序运行日志（含控制台与报错，供 AI 排查）">
          导出程序日志
        </button>
      </div>

      <div className="es-turn-log" ref={scrRef}>
        {groups.length === 0 && (
          <div className="es-turn-empty">每一轮、每个角色的回合内容将按 开始 / 回合中 / 结束 记录在这里……</div>
        )}

        {rounds.map((r, ri) => (
          <div key={"r" + r.round} className={ri > 0 ? "es-turn-rounddiv" : ""}>
            {ri > 0 && <div className="es-turn-roundtitle">第 {r.round} 轮</div>}
            {r.groups.map((g) => {
              const isCurrent = g.cid === currentCid && g.round === currentRound;
              const cardOpen = open[g.key] ?? isCurrent;
              const nodes = buildNodes(g.entries);
              // 该回合内最早的可撤回单元（整回合回滚以它为界）
              let turnUndoId: number | null = null;
              for (const e of g.entries) {
                if (e.undo !== undefined && (turnUndoId === null || e.undo < turnUndoId)) turnUndoId = e.undo;
              }
              return (
                <details
                  key={g.key}
                  className={"es-turn-card" + (isCurrent ? " cur" : "") + (g.kind === "pc" ? " pc" : "")}
                  open={cardOpen}
                >
                  <summary className="es-turn-summ" onClick={(e) => { e.preventDefault(); toggleCard(g.key, isCurrent); }}>
                    <span className="es-turn-chev">{cardOpen ? "▾" : "▸"}</span>
                    <span className="es-turn-hd">
                      <span className="es-turn-hdrow">
                        <span className="es-turn-cname">{g.name}</span>
                        <span className="es-turn-cinit">（{g.init ?? "—"}）</span>
                        {isCurrent && <span className="es-turn-chip acting">行动中</span>}
                      </span>
                      <span className="es-turn-hdrow">
                        {g.hp && <span className="es-turn-hprow">HP {g.hp}</span>}
                        <span className="es-turn-absp" />
                        {turnUndoId !== null && (
                          <button
                            className="es-turn-undo"
                            title={"回滚" + g.name + " 第" + g.round + "轮的全部操作（含其后所有操作）"}
                            onClick={(e) => { e.stopPropagation(); onUndoTurn(g.cid, g.round); }}
                          >
                            ↶ 回滚本回合
                          </button>
                        )}
                      </span>
                    </span>
                  </summary>
                  <div className="es-turn-body">
                    {nodes.map((n, i) => {
                      if (n.type === "phase") {
                        return <div className="es-turn-ph" key={i}>{PHASE_LABEL[n.phase] ?? n.phase}</div>;
                      }
                      if (n.type === "action") {
                        const blkUndo = n.lines[0].undo;
                        return (
                          <div className="es-turn-ablk" key={i}>
                            <div className="es-turn-abhead">
                              {n.act && <span className="es-turn-abtag">{KIND_LABEL[n.act]}</span>}
                              <span className="es-turn-absp" />
                              {blkUndo !== undefined && (
                                <button
                                  className="es-turn-undo-mini"
                                  title="撤回该操作（连同其后的所有操作）"
                                  onClick={(e) => { e.stopPropagation(); onUndoUnit(blkUndo); }}
                                >
                                  撤回
                                </button>
                              )}
                            </div>
                            {n.lines.map((l, j) => (
                              <TurnLine key={j} e={l} indent />
                            ))}
                          </div>
                        );
                      }
                      return (
                        <TurnLine
                          key={i}
                          e={n.e}
                          indent={false}
                          onUndo={n.e.undo !== undefined ? () => onUndoUnit(n.e.undo as number) : undefined}
                        />
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TurnLine({ e, indent, onUndo }: { e: LogEntry; indent: boolean; onUndo?: () => void }) {
  const btn = onUndo && (
    <button className="es-turn-undo-mini" title="撤回该操作（连同其后的所有操作）" onClick={onUndo}>
      撤回
    </button>
  );
  // 带动作类型（移动/次要/…）的单行：拆成「头行=动作类型+撤回」与「下一行=具体动作」两部分，与标准动作块同构
  if (e.act) {
    return (
      <div className={"es-turn-line act tone-" + e.tone + (indent ? " ind" : "")}>
        <div className="es-turn-line-hd">
          <span className="es-turn-act">{KIND_LABEL[e.act]}</span>
          <span className="es-turn-absp" />
          {btn}
        </div>
        <div className="es-turn-ltext">{e.text}</div>
      </div>
    );
  }
  return (
    <div className={"es-turn-line tone-" + e.tone + (indent ? " ind" : "")}>
      <span className="es-turn-ltext">{e.text}</span>
      {btn}
    </div>
  );
}