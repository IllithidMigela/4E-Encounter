import { FilledTextField } from "../components/md";
import type { Entry } from "../data/types";

// 词条可搜索的详细内容（sourceText 已含详情/增益/前提等，另以 details/benefit 等兜底）
function entrySearchText(e: Entry): string {
  return [
    e.name,
    e.nameEn ?? "",
    e.sourceText ?? "",
    e.details ?? "",
    e.benefit ?? "",
    e.prerequisite ?? "",
    e.flavorText ?? "",
  ].join("\n");
}

// 默认匹配：仅名称 / 英文名
export function matchByName(e: Entry, q: string): boolean {
  return (e.name + " " + (e.nameEn ?? "")).toLowerCase().includes(q);
}

// 深度匹配：名称 + 详细内容（效果、增益、前提等）
export function matchDeep(e: Entry, q: string): boolean {
  return entrySearchText(e).toLowerCase().includes(q);
}

export interface DeepSearchFieldProps {
  value: string;
  deep: boolean;
  onChange: (v: string) => void;
  onToggleDeep: () => void;
}

// 搜索栏（上方）+ 「全文搜索」滑块开关（下方，滑块位置清晰指示开关状态）
export function DeepSearchField({ value, deep, onChange, onToggleDeep }: DeepSearchFieldProps) {
  return (
    <div className="deep-search-field">
      <FilledTextField value={value} label="搜索" onInput={(e) => onChange((e.target as any).value ?? "")} />
      <div className={"deep-search-toggle" + (deep ? " active" : "")} title={deep ? "全文搜索已开启；点击关闭，仅按名称搜索" : "全文搜索已关闭；点击开启，同时匹配名称与详细内容（效果、增益、前提等）"}>
        <span className="deep-search-label">全文搜索</span>
        <label className="deep-search-switch">
          <input type="checkbox" checked={deep} onChange={onToggleDeep} />
          <span className="deep-search-slider" />
        </label>
      </div>
    </div>
  );
}