import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Switch } from "../components/md";
import { parseVariant } from "./character";
import type { Entry } from "../data/types";

const SOURCES = ["武术", "奥术", "神术", "原力", "灵能", "影能"];
const ROLES = ["防御者", "打击者", "控制者", "领导者"];

// 精华（Essentials）子职业：选择职业界面右下角打「精华」角标
const ESSENTIALS_VARIANTS = new Set([
  "战争祭司", "学派法师", "杀手", "骑士", "盗贼", "魔剑士", "圣骑兵", "斥候", "猎人",
  "哨兵", "吟唱诗人", "巫师", "保护者", "狂战士", "行刑者", "缚影师", "黑暗卫士",
  "元素法师", "元素使", "剑咏士",
]);

// 来源基础职业：剥掉「混职」前缀与「（变体）」括号，用于限制同一职业的多个混职版本不可同时选择
// （如「混职圣武士」与「混职圣武士（黑暗卫士）」同源 圣武士；「混职法师（秘法师）」源 法师）。
const sourceOf = (name: string) => {
  let n = name.startsWith("混职") ? name.slice(2) : name;
  const m = n.match(/^(.+?)（(.+)）$/);
  return (m ? m[1] : n).trim();
};

interface Props {
  entries: Entry[];
  hybrid: boolean;
  selectedIds: string[];
  onSelect: (ids: string[], isHybrid: boolean) => void;
  onClose: () => void;
}

export default function ClassPickerModal({ entries, hybrid, selectedIds, onSelect, onClose }: Props) {
  const [hybridMode, setHybridMode] = useState(hybrid);
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const [source, setSource] = useState("");
  const [role, setRole] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const visible = useMemo(() => {
    return entries.filter((e) => {
      const isHybrid = e.name.startsWith("混职");
      if (hybridMode !== isHybrid) return false;
      if (source && !String(e.powerSource ?? "").includes(source)) return false;
      if (role && !String(e.role ?? "").includes(role)) return false;
      return true;
    });
  }, [entries, hybridMode, source, role]);

  function switchHybrid(v: boolean) {
    setHybridMode(v);
    setSelected([]);
  }

  function toggle(id: string) {
    if (!hybridMode) {
      onSelect([id], false);
      onClose();
      return;
    }
    const has = selected.includes(id);
    let next: string[];
    if (has) {
      next = selected.filter((x) => x !== id);
      setSelected(next);
      return;
    }
    if (selected.length >= 2) {
      return;
    }
    // 限制同源混职：第二个选择必须与第一个来源基础职业不同，冲突时提示
    if (selected.length === 1) {
      const first = entries.find((e) => e.id === selected[0]);
      const cur = entries.find((e) => e.id === id);
      if (first && cur && sourceOf(first.name) === sourceOf(cur.name)) {
        const pv = parseVariant(first.name);
        showToast(`您已经选择了${pv.variant ?? pv.parent}，不能再选择来自同一职业的混职`);
        return;
      }
    }
    next = [...selected, id];
    setSelected(next);
    if (next.length === 2) {
      onSelect(next, true);
      onClose();
    }
  }

  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog class-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">{hybridMode ? "选择混职职业（选 2 个）" : "选择英雄职业"}</span>
          <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
        </div>
        <div className="class-layout">
          <div className="class-sources">
            <label className="hybrid-toggle">
              <span>混职</span>
              <Switch selected={hybridMode} onChange={(e) => switchHybrid((e.target as any).selected)} />
            </label>
            <button type="button" className={source === "" ? "cl-item active" : "cl-item"} onClick={() => setSource("")}>全部来源</button>
            {SOURCES.map((s) => (
              <button key={s} type="button" className={source === s ? "cl-item active" : "cl-item"} onClick={() => setSource(s)}>{s}</button>
            ))}
          </div>
          <div className="class-main">
            <div className="class-roles">
              <button type="button" className={role === "" ? "cr-item active" : "cr-item"} onClick={() => setRole("")}>全部职位</button>
              {ROLES.map((r) => (
                <button key={r} type="button" className={role === r ? "cr-item active" : "cr-item"} onClick={() => setRole(r)}>{r}</button>
              ))}
            </div>
            {hybridMode && (
              <div className="meta">已选 {selected.length}/2：{selected.map((id) => entries.find((e) => e.id === id)?.name).filter(Boolean).join(" + ") || "请选择两个混职职业"}</div>
            )}
            <div className="class-grid">
              {visible.map((e) => {
                const { parent, variant } = parseVariant(e.name);
                const isSel = selected.includes(e.id);
                const isEss = !!variant && ESSENTIALS_VARIANTS.has(variant);
                // 同源置灰只为混职服务：已选一个时，其余与首选项「来源基础职业」相同的卡片置灰
                // （混职不可再选同源版本）。常规单选模式下该规则不生效。
                const firstSel = hybridMode && selected.length === 1 ? entries.find((x) => x.id === selected[0]) : undefined;
                const blocked = !!firstSel && !isSel && sourceOf(firstSel.name) === sourceOf(e.name);
                return (
                  <button key={e.id} type="button" className={(isSel ? "class-card selected" : "class-card") + (isEss ? " ess" : "") + (blocked ? " blocked" : "")} onClick={() => toggle(e.id)}>
                    <span className="cc-head">
                      <span className="cc-name">{variant ?? parent}</span>
                      {variant && <span className="cc-parent">{parent}</span>}
                    </span>
                    <span className="cc-sub">{e.role}</span>
                    <span className="cc-src">
                      {e.powerSource}
                      {isEss && <span className="cc-ess">精华</span>}
                    </span>
                  </button>
                );
              })}
              {visible.length === 0 && <p className="hint">无匹配职业。</p>}
            </div>
          </div>
        </div>
        {toast && <div className="ct-toast" role="status">{toast}</div>}
      </div>
    </div>,
    document.body
  );
}
