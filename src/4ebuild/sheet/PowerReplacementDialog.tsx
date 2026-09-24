import { createPortal } from "react-dom";
import EntryCard from "./EntryCard";
import { SmartHover } from "./SmartHover";
import type { PowerSlots, SlotLevel } from "./character";
import type { Entry } from "../data/types";

export interface ReplSlotGroup {
  key: keyof PowerSlots;
  label: string;
  color: string;
  // 每个可点选的格子：id 为威能 id（空串表示空位）；level 用于空位显示「N级」标签（种族/职业威能无等级概念；典范/传奇无等级数字）
  items: { id: string; level: SlotLevel | undefined }[];
}

interface Props {
  newPower: Entry;
  hint: string;
  groups: ReplSlotGroup[];
  powerOf: (id: string) => Entry | undefined;
  onPick: (cat: keyof PowerSlots, index: number) => void;
  onClose: () => void;
}

// 空位标签：数字 →「N级」；典范/传奇 →「典范/传奇」（无等级数字）；无 → 仅类别名
function levelLabel(level: SlotLevel | undefined, label: string): string {
  if (level === "paragon") return "选择典范" + label;
  if (level === "legendary") return "选择传奇" + label;
  if (typeof level === "number") return "选择" + level + "级" + label;
  return "选择" + label;
}

// 替换型专长弹窗：告知玩家该专长授予的新威能，并列出威能面板全部格子（含空位），
// 由玩家决定将新威能填入哪个格子。
export default function PowerReplacementDialog({ newPower, hint, groups, powerOf, onPick, onClose }: Props) {
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">替换威能</span>
          <div className="picker-head-btns">
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <p className="hint">该专长授予新威能（{hint}）。请选择要将它填入的威能格子：</p>
        <div className="repl-new-power"><EntryCard entry={newPower} /></div>
        <div className="repl-slot-list">
          {groups.map((g) => (
            <div key={g.key} className="repl-slot-group">
              <div className="repl-slot-group-title">
                <span className="sg-dot" style={{ background: g.color }} />
                {g.label}
              </div>
              <div className="repl-slot-row">
                {g.items.map((it, i) => {
                  const p = it.id ? powerOf(it.id) : undefined;
                  // 已有威能的槽位：悬停预览威能卡片，显示中文名 + 右侧类型（如【牧师攻击1】），不显示英文名
                  if (p) {
                    const typeLabel = (p.powerType ?? "") + (p.level ?? "");
                    return (
                      <SmartHover key={i} className="repl-slot" popClass="repl-slot-pop" portal pop={<EntryCard entry={p} />} onClick={() => onPick(g.key, i)} title="点击填入此槽位">
                        <span className="repl-slot-name">{p.name}</span>
                        {typeLabel && <span className="repl-slot-type">{typeLabel}</span>}
                      </SmartHover>
                    );
                  }
                  return (
                    <button key={i} type="button" className="repl-slot" onClick={() => onPick(g.key, i)}>
                      <span className="repl-slot-empty">{levelLabel(it.level, g.label)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {groups.every((g) => g.items.length === 0) && <p className="hint">当前无威能格子，可先到威能面板添加。</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
