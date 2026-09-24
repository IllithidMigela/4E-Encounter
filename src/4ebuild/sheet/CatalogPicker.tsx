import { useMemo, useState } from "react";
import { FilledTextField, FilledSelect, SelectOption } from "../components/md";
import type { Entry } from "../data/types";
import PickList from "./PickList";

interface Props {
  entries: Entry[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  filterLabel: string;
  getFilter: (e: Entry) => string | undefined;
  renderSub?: (e: Entry) => string | undefined;
}

export default function CatalogPicker({ entries, selected, onToggle, filterLabel, getFilter, renderSub }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");

  const filterValues = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      const v = getFilter(e);
      if (v) set.add(v);
    }
    return [...set].sort();
  }, [entries, getFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter && getFilter(e) !== filter) return false;
      if (q && !(e.name + " " + (e.nameEn ?? "")).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, query, filter, getFilter]);

  return (
    <div>
      <div className="picker-head">
        <FilledTextField value={query} label="搜索" onInput={(e) => setQuery((e.target as any).value ?? "")} />
        <FilledSelect value={filter} label={filterLabel} onChange={(e) => setFilter((e.target as any).value ?? "")}>
          <SelectOption value="">全部</SelectOption>
          {filterValues.map((v) => <SelectOption key={v} value={v}>{v}</SelectOption>)}
        </FilledSelect>
      </div>
      <div className="picker-count">显示 {filtered.length} / {entries.length}</div>
      <PickList entries={filtered} selected={selected} onToggle={onToggle} renderSub={renderSub} />
    </div>
  );
}
