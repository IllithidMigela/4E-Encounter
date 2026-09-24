// 左侧导航栏（76px）：七视图切换
import type { AppView } from "../types";

const NAV: { view: AppView; icon: string; label: string }[] = [
  { view: "battle", icon: "map", label: "遭遇" },
  { view: "monsters", icon: "skull", label: "怪物" },
  { view: "characters", icon: "person", label: "角色卡" },
  { view: "carbuild", icon: "edit_note", label: "车卡" },
  { view: "builder", icon: "extension", label: "怪物构建" },
  { view: "rules", icon: "menu_book", label: "万律" },
  { view: "settings", icon: "settings", label: "设置" },
  { view: "export", icon: "ios_share", label: "导出" },
];

interface Props {
  view: AppView;
  onView: (v: AppView) => void;
}

export default function NavRail({ view, onView }: Props) {
  return (
    <nav className="es-nav">
      {NAV.map(({ view: v, icon, label }) => (
        <button key={v} className={"es-nav-item" + (view === v ? " on" : "")} onClick={() => onView(v)}>
          <span className="material-symbols-outlined">{icon}</span>
          <span className="es-nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}