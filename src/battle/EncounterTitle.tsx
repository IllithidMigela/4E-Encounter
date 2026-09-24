// 顶栏中央·当前遭遇名称：单击「修改」按钮进入内联编辑，回车/失焦确认、Esc 取消
import { useState } from "react";

interface Props {
  name: string;
  onRename: (name: string) => void;
}

export default function EncounterTitle({ name, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);

  const commit = () => {
    setEditing(false);
    const n = val.trim();
    if (n && n !== name) onRename(n);
    else setVal(name);
  };

  if (editing) {
    return (
      <div className="es-enc-name">
        <input
          className="es-enc-input"
          value={val}
          autoFocus
          placeholder="输入遭遇名称"
          maxLength={40}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setVal(name);
              setEditing(false);
            }
          }}
          onBlur={commit}
        />
      </div>
    );
  }

  return (
    <div className="es-enc-name" title="当前遭遇名称">
      <span className="es-enc-name-label">{name}</span>
      <button className="es-enc-edit" onClick={() => { setVal(name); setEditing(true); }} title="修改遭遇名称">
        <span className="material-symbols-outlined">edit</span>
      </button>
    </div>
  );
}
