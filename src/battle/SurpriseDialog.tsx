// 突袭轮：弹出选择哪些参战者拥有突袭（突袭者先动，被突袭者不能行动并提供战斗优势）
import { useState } from "react";
import type { Combatant } from "../types";

interface Props {
  combatants: Combatant[];
  onCancel: () => void;
  onConfirm: (attackers: string[]) => void;
}

export default function SurpriseDialog({ combatants, onCancel, onConfirm }: Props) {
  const [sel, setSel] = useState<Set<string>>(new Set());

  const toggle = (cid: string) => {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(cid)) n.delete(cid);
      else n.add(cid);
      return n;
    });
  };

  const active = combatants.length >= 2;

  return (
    <div className="es-overlay" onClick={onCancel}>
      <div className="es-dialog es-surprise" onClick={(e) => e.stopPropagation()}>
        <div className="es-dialog-head">
          <span className="es-dialog-title">进入突袭轮</span>
          <button className="es-dialog-close" onClick={onCancel}>×</button>
        </div>
        <div className="es-dialog-sub">
          勾选<strong>突袭方</strong>（拥有突袭优势、先动的参战者）。其余参战者为<strong>被突袭</strong>：
          突袭轮内不能行动、全程对攻击提供战斗优势，且每次只能做一个动作、不可用行动点。
        </div>
        {!active ? (
          <p className="es-modal-warn">至少需要两名参战者才能进入突袭轮。</p>
        ) : (
          <div className="es-surprise-list">
            {combatants.map((c) => (
              <label key={c.cid} className="es-surprise-item">
                <input type="checkbox" checked={sel.has(c.cid)} onChange={() => toggle(c.cid)} />
                <span className={"es-surprise-name" + (c.kind === "pc" ? " pc" : " monster")}>{c.name}</span>
                <span className="es-surprise-meta">{sel.has(c.cid) ? "突袭" : "被突袭"}</span>
              </label>
            ))}
          </div>
        )}
        <div className="es-dialog-actions">
          <button className="es-btn-cancel" onClick={onCancel}>取消</button>
          <button
            className="es-btn-apply"
            disabled={!active || sel.size === 0 || sel.size === combatants.length}
            title="突袭方不能为空也不能包含所有人"
            onClick={() => onConfirm([...sel])}
          >
            进入突袭轮
          </button>
        </div>
      </div>
    </div>
  );
}