import type { Entry } from "../data/types";

interface Props {
  entries: Entry[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  renderSub?: (e: Entry) => string | undefined;
}

export default function PickList({ entries, selected, onToggle, renderSub }: Props) {
  return (
    <div className="pick-list">
      {entries.map((e) => {
        const on = selected.has(e.id);
        const sub = renderSub ? renderSub(e) : undefined;
        return (
          <button key={e.id} type="button" className={on ? "pick-item selected" : "pick-item"} onClick={() => onToggle(e.id)}>
            <span className="pick-check">{on ? "✓" : ""}</span>
            <span className="pick-text">
              <span className="pick-name">{e.name}{e.nameEn ? " " + e.nameEn : ""}</span>
              {sub ? <span className="pick-sub">{sub}</span> : null}
            </span>
          </button>
        );
      })}
      {entries.length === 0 && <p className="hint">无可用条目。</p>}
    </div>
  );
}
