// 角色池悬浮窗：罗列已导入的角色条目，点击加入队伍；左上角「导入角色卡.json」多选批量导
import { useRef } from "react";
import type { CombatantStats } from "../types";

interface Props {
  pool: CombatantStats[];
  onPick: (stats: CombatantStats) => void;
  onImport: (files: File[]) => void;
  onClose: () => void;
}

export default function PartyPoolDialog({ pool, onPick, onImport, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="es-dialog-overlay" onClick={onClose} />
      <div className="es-dialog es-dialog-pool">
        <div className="es-dialog-head">
          <span className="es-dialog-title">角色池</span>
          <button className="md-btn" onClick={() => fileRef.current?.click()}>
            <span className="material-symbols-outlined">upload_file</span> 导入角色卡.json
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const fs = e.target.files ? [...e.target.files] : [];
              if (fs.length) onImport(fs);
              e.target.value = "";
            }}
          />
          <button className="es-dialog-close" onClick={onClose}>×</button>
        </div>
        <div className="es-dialog-body">
          {pool.length === 0 && <div className="es-library-empty">角色池为空。点左上角「导入角色卡.json」导入车卡（可多选）。</div>}
          {pool.map((s, i) => (
            <div key={i} className="es-library-item" onClick={() => onPick(s)}>
              <div className="es-library-item-name">
                {s.name}
                {s.level !== undefined && <span className="es-library-item-level">{s.level}级</span>}
              </div>
              <div className="es-library-item-sub">
                {s.char?.className ? s.char.className + " · " : ""}
                {s.char?.race ? s.char.race + " · " : ""}
                HP {s.maxHp} · AC {s.ac}/{s.fort}/{s.ref}/{s.will}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}