import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ABILITY_LABELS, ABILITY_KEYS } from "./character";
import type { Entry } from "../data/types";
import { useIncremental } from "../lib/incremental";
import { DeepSearchField, matchByName, matchDeep } from "./DeepSearch";

export interface RestrictInfo {
  level: number;
  raceNames: string[];
  classNames: string[];
  myNames: string[];
}

interface Props {
  title: string;
  entries: Entry[];
  loading?: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onClear?: () => void; // 提供时在头部显示「清除选择」按钮（仅在已选择时）
  renderSub?: (e: Entry) => string | undefined;
  abilityFilter?: boolean;
  restrict?: RestrictInfo;
}

// 独立词匹配（避免「半精灵」误匹配「精灵」）
function containsWord(text: string, word: string): boolean {
  let idx = text.indexOf(word);
  while (idx >= 0) {
    const before = idx > 0 ? text[idx - 1] : "";
    const after = idx + word.length < text.length ? text[idx + word.length] : "";
    const isCn = (ch: string) => ch !== "" && /[\u4e00-\u9fff]/.test(ch);
    if (!isCn(before) && !isCn(after)) return true;
    idx = text.indexOf(word, idx + 1);
  }
  return false;
}

// 种族属性增益是否包含指定属性（abilityTwo 为「或」列表）
function raceGrants(entry: Entry, ability: string): boolean {
  if (entry.abilityOne === ability) return true;
  const two = (entry.abilityTwo ?? "").split(/或|\//).map((s) => s.trim());
  return two.includes(ability);
}

export default function PickerModal({ title, entries, loading, selectedId, onSelect, onClose, onClear, renderSub, abilityFilter, restrict }: Props) {
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false); // 全文搜索开关
  const [abilFilter, setAbilFilter] = useState<string[]>([]);

  function toggleAbility(a: string) {
    setAbilFilter((sel) => {
      if (sel.includes(a)) return sel.filter((x) => x !== a);
      if (sel.length >= 2) return sel; // 已选两个，提示用户取消一个
      return [...sel, a];
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (abilFilter.length > 0 && !abilFilter.every((a) => raceGrants(e, a))) return false;
      if (restrict) {
        const pre = e.prerequisite ?? "";
        // 等级前置：如「21级」
        const lvM = pre.match(/(\d+)级/);
        if (lvM && restrict.level < parseInt(lvM[1], 10)) return false;
        // 种族/职业前置：提及但当前角色不满足 → 限制
        const found: string[] = [];
        for (const n of restrict.raceNames) if (n && containsWord(pre, n)) found.push(n);
        for (const n of restrict.classNames) if (n && containsWord(pre, n)) found.push(n);
        if (found.length && !found.some((n) => restrict.myNames.includes(n))) return false;
      }
      if (q && !(deep ? matchDeep(e, q) : matchByName(e, q))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query, deep, abilFilter, restrict]);

  const { visible, sentinelRef, done } = useIncremental(filtered, 80);
  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">{title}</span>
          <div className="picker-head-btns">
            {onClear && selectedId && (
              <button type="button" className="crop-btn" onClick={() => { onClear(); onClose(); }}>清除选择</button>
            )}
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        {abilityFilter && (
          <div className="slot-filter">
            <div className="slot-filter-row">
              <span className="sf-label">属性筛选</span>
              {ABILITY_KEYS.map((k) => (
                <button key={k} type="button" className={abilFilter.includes(ABILITY_LABELS[k].zh) ? "sf-chip active" : "sf-chip"} onClick={() => toggleAbility(ABILITY_LABELS[k].zh)}>
                  {ABILITY_LABELS[k].zh}
                </button>
              ))}
            </div>
            <div className="slot-filter-row">
              <span className="sf-hint">
                {abilFilter.length === 2 ? "最多只能同时选择两个属性，点击已选属性可取消一个" : abilFilter.length === 1 ? "已选「" + abilFilter[0] + "」，可再选一个（共两个）" : "点选一至两个属性，筛选可获得对应属性增益的种族"}
              </span>
            </div>
          </div>
        )}
        <DeepSearchField value={query} deep={deep} onChange={setQuery} onToggleDeep={() => setDeep((d) => !d)} />
        <div className="picker-table">
          {loading && entries.length === 0 && <p className="hint">正在加载数据…</p>}
          {!loading && visible.map((e) => (
            <button key={e.id} type="button" className={e.id === selectedId ? "picker-row selected" : "picker-row"} onClick={() => { onSelect(e.id); onClose(); }}>
              <span className="picker-row-name">{e.name}{e.nameEn ? " " + e.nameEn : ""}</span>
              {renderSub && <span className="picker-row-sub">{renderSub(e)}</span>}
            </button>
          ))}
          {!done && <div ref={sentinelRef} className="incremental-sentinel">滚动加载更多…</div>}
          {filtered.length === 0 && <p className="hint">无匹配条目。</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
