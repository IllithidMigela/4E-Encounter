import { useMemo, useState } from "react";
import { useIncremental } from "../lib/incremental";
import { createPortal } from "react-dom";
import EntryCard from "./EntryCard";
import type { Entry } from "../data/types";
import { DeepSearchField, matchByName, matchDeep } from "./DeepSearch";

const SLOT_CATEGORY: Record<string, string> = {
  主手: "武器", 副手: "武器", 佩戴: "", 头部: "头部", 颈部: "颈部", 护甲: "护甲",
  腰部: "腰部", 臂部: "臂部", 手部: "手部", 戒指: "戒指", 足部: "足部", 奇物: "奇物",
  消耗品: "消耗品",
};

interface Props {
  entries: Entry[];
  loading?: boolean;
  slotName: string;
  currentId?: string;
  onSelect: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}

export default function ItemSlotPicker({ entries, loading, slotName, currentId, onSelect, onClear, onClose }: Props) {
  const [cat, setCat] = useState<string>(SLOT_CATEGORY[slotName] ?? "");
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false); // 全文搜索开关

  const cats = useMemo(() => [...new Set(entries.map((e) => e.itemCategory).filter((v): v is string => !!v))].sort(), [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (cat && e.itemCategory !== cat) return false;
      if (q && !(deep ? matchDeep(e, q) : matchByName(e, q))) return false;
      return true;
    });
  }, [entries, cat, query, deep]);
  const { visible, sentinelRef, done } = useIncremental(filtered, 90);

  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">选择{slotName}装备</span>
          <div className="picker-head-btns">
            {currentId && onClear && <button type="button" className="crop-btn" onClick={() => { onClear(); onClose(); }}>清空槽位</button>}
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="slot-filter-row">
          <span className="sf-label">类别</span>
          <button type="button" className={cat === "" ? "sf-chip active" : "sf-chip"} onClick={() => setCat("")}>全部</button>
          {cats.map((c) => (
            <button key={c} type="button" className={cat === c ? "sf-chip active" : "sf-chip"} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <DeepSearchField value={query} deep={deep} onChange={setQuery} onToggleDeep={() => setDeep((d) => !d)} />
        <div className="meta">显示 {filtered.length} 条</div>
        <div className="picker-cards">
          {loading && entries.length === 0 && <p className="hint">正在加载装备数据…</p>}
          {!loading && visible.map((e) => (
            <button key={e.id} type="button" className={e.id === currentId ? "picker-card selected" : "picker-card"} onClick={() => { onSelect(e.id); onClose(); }}>
              <EntryCard entry={e} />
            </button>
          ))}
          {!loading && filtered.length === 0 && <p className="hint">无匹配装备。</p>}
          {!done && !loading && <div ref={sentinelRef} className="incremental-sentinel">滚动加载更多…</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}
