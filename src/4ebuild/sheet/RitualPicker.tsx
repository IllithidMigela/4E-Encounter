import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useIncremental } from "../lib/incremental";
import type { Entry } from "../data/types";
import { SmartHover } from "./SmartHover";
import EntryCard from "./EntryCard";
import { DeepSearchField, matchByName, matchDeep } from "./DeepSearch";

// 从仪式正文解析「市场价格：N gp」（正文以 '' 粗体标记包裹数字，如「市场价格：''1,200gp」）
export function ritualMarketPrice(e?: Entry): number {
  if (!e) return 0;
  const m = e.sourceText.match(/市场价格：''?\s*([\d,]+)gp/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : 0;
}

// 关键技能：去掉「（无检定）」括注并按「或」拆分为基础技能集合（「神秘或自然」→ 神秘/自然）
function baseSkills(s: string | undefined): string[] {
  if (!s || s === "—") return [];
  return s.split("或").map((x) => x.replace(/（无检定）/, "").trim()).filter(Boolean);
}

// 与威能槽位选择一致：等级按「当前及以下 / 指定等级 / 全部等级」在顶部标签行筛选
const LEVEL_MODES = [
  { key: "current", label: "当前及以下" },
  { key: "range", label: "指定等级" },
  { key: "all", label: "全部等级" },
] as const;

interface Props {
  entries: Entry[];
  kind: "ritual" | "practice"; // 仪式魔法（其他来源）/ 武术奥义（MP/MP2 来源）
  currentLevel: number;
  currentId?: string;
  onSelect: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}

export default function RitualPicker({ entries, kind, currentLevel, currentId, onSelect, onClear, onClose }: Props) {
  const [cat, setCat] = useState<string>("");
  const [skill, setSkill] = useState<string>("");
  const [levelMode, setLevelMode] = useState<"current" | "range" | "all">("current");
  const [minLevel, setMinLevel] = useState(Math.max(1, currentLevel));
  const [maxLevel, setMaxLevel] = useState(Math.max(1, currentLevel));
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false); // 全文搜索开关

  const cats = useMemo(() => [...new Set(entries.map((e) => e.ritualCategory).filter((v): v is string => !!v))].sort(), [entries]);
  const skills = useMemo(() => [...new Set(entries.flatMap((e) => baseSkills(e.keySkill)))].sort(), [entries]);
  // 按等级升序排列，便于浏览（无等级的仪式恒排在前面）
  const sorted = useMemo(() => [...entries].sort((a, b) => (parseInt(a.ritualLevel ?? "0", 10) || 0) - (parseInt(b.ritualLevel ?? "0", 10) || 0)), [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((e) => {
      // 武术奥义 = MP/MP2 来源；仪式魔法 = 其余来源
      const isPractice = e.source === "MP" || e.source === "MP2";
      if (kind === "practice" ? !isPractice : isPractice) return false;
      if (cat && e.ritualCategory !== cat) return false;
      if (skill && !baseSkills(e.keySkill).includes(skill)) return false;
      const lv = parseInt(e.ritualLevel ?? "0", 10) || 0;
      // 无等级的仪式不被等级筛选排除；其余按模式过滤
      if (lv > 0) {
        if (levelMode === "current" && lv > currentLevel) return false;
        if (levelMode === "range" && (lv < minLevel || lv > maxLevel)) return false;
      }
      if (q && !(deep ? matchDeep(e, q) : matchByName(e, q))) return false;
      return true;
    });
  }, [sorted, kind, cat, skill, levelMode, minLevel, maxLevel, currentLevel, query, deep]);

  const { visible, sentinelRef, done } = useIncremental(filtered, 80);

  return createPortal(
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-dialog ritual-picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">{kind === "practice" ? "选择武术奥义" : "选择仪式"}</span>
          <div className="picker-head-btns">
            {currentId && onClear && <button type="button" className="crop-btn" onClick={() => { onClear(); onClose(); }}>清空槽位</button>}
            <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="ritual-picker-top">
          <div className="slot-filter-row">
            <span className="sf-label">类别</span>
            <button type="button" className={cat === "" ? "sf-chip active" : "sf-chip"} onClick={() => setCat("")}>全部</button>
            {cats.map((c) => (
              <button key={c} type="button" className={cat === c ? "sf-chip active" : "sf-chip"} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
          <div className="slot-filter-row">
            <span className="sf-label">关键技能</span>
            <button type="button" className={skill === "" ? "sf-chip active" : "sf-chip"} onClick={() => setSkill("")}>全部</button>
            {skills.map((s) => (
              <button key={s} type="button" className={skill === s ? "sf-chip active" : "sf-chip"} onClick={() => setSkill(s)}>{s}</button>
            ))}
          </div>
          <div className="slot-filter-row">
            <span className="sf-label">等级</span>
            {LEVEL_MODES.map((m) => (
              <button key={m.key} type="button" className={levelMode === m.key ? "sf-chip active" : "sf-chip"} onClick={() => setLevelMode(m.key)}>{m.label}</button>
            ))}
            {levelMode === "range" && (
              <span className="sf-range">
                <input type="number" min={1} max={30} value={minLevel} onChange={(e) => setMinLevel(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
                <span>—</span>
                <input type="number" min={1} max={30} value={maxLevel} onChange={(e) => setMaxLevel(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
              </span>
            )}
          </div>
        </div>
        <div className="ritual-picker-body">
          <div className="ritual-picker-main">
            <DeepSearchField value={query} deep={deep} onChange={setQuery} onToggleDeep={() => setDeep((d) => !d)} />
            <div className="meta">显示 {filtered.length} 条 · 点击条目填入当前槽位</div>
            <div className="picker-table">
              {visible.map((e) => {
                const sel = e.id === currentId;
                const price = ritualMarketPrice(e);
                return (
                  <SmartHover key={e.id} className="ritual-row-hover" popClass="wiki-ref-pop ritual-pop" portal pop={<EntryCard entry={e} />}>
                    <button type="button" className={"picker-row" + (sel ? " selected" : "")} onClick={() => { onSelect(e.id); onClose(); }}>
                      <span className="picker-row-name">
                        {sel && <span className="ritual-check">✓ </span>}
                        {e.name}{e.nameEn ? " " + e.nameEn : ""}
                      </span>
                      <span className="picker-row-sub">
                        {e.ritualLevel ? "Lv" + e.ritualLevel : ""}
                        {e.ritualCategory ? " · " + e.ritualCategory : ""}
                        {e.keySkill ? " · 关键技能 " + e.keySkill : ""}
                        {price > 0 ? " · " + price.toLocaleString("zh-CN") + "gp" : ""}
                      </span>
                    </button>
                  </SmartHover>
                );
              })}
              {!done && <div ref={sentinelRef} className="incremental-sentinel">滚动加载更多…</div>}
              {filtered.length === 0 && <p className="hint">{kind === "practice" ? "暂无武术奥义数据（MP/MP2 尚未导入）。" : "无匹配仪式。"}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
