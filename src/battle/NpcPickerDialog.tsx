// 添加 NPC 悬浮窗：检索怪物数据并选入队伍
import { useMemo, useState } from "react";
import type { CombatantStats } from "../types";

interface Props {
  monsters: CombatantStats[];
  onPick: (stats: CombatantStats) => void;
  onClose: () => void;
}

export default function NpcPickerDialog({ monsters, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let arr = monsters;
    if (kw)
      arr = arr.filter(
        (m) => m.name.toLowerCase().includes(kw) || (m.role ?? "").includes(kw) || String(m.level ?? "").includes(kw),
      );
    return arr.slice(0, 300);
  }, [monsters, q]);

  return (
    <>
      <div className="es-dialog-overlay" onClick={onClose} />
      <div className="es-dialog es-dialog-npc">
        <div className="es-dialog-head">
          <span className="es-dialog-title">添加 NPC（怪物）</span>
          <button className="es-dialog-close" onClick={onClose}>×</button>
        </div>
        <input className="es-search" placeholder="搜索怪物…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="es-dialog-body">
          {list.length === 0 && <div className="es-library-empty">未找到匹配的怪物</div>}
          {list.map((m) => (
            <div key={m.id ?? m.name} className="es-library-item" onClick={() => onPick(m)}>
              <div className="es-library-item-name">
                {m.name}
                {m.level !== undefined && <span className="es-library-item-level">{m.level}级</span>}
              </div>
              <div className="es-library-item-sub">
                {m.role ? m.role + " · " : ""}HP {m.maxHp} · AC {m.ac}/{m.fort}/{m.ref}/{m.will} · 速 {m.speed}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}