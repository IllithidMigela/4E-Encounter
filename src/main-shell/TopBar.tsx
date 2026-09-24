// 顶部操作栏：品牌（图标列→左导航、标题→左栏）+ 随视图切换的操作按钮（由 children 注入）
// 进行遭遇阶段启用 align：按钮区与中间栏对齐；end 为顶栏最右端元素（结束遭遇按钮）
import type { ReactNode } from "react";

interface Props {
  /** 顶部操作区内容（battle 视图为地图尺寸 + 布置/回合/棋子栏开关；其它视图可为空或全局动作） */
  actions?: ReactNode;
  /** 与下方三栏对齐的参数：leftW=左栏宽度、rightW=右栏宽度（仅在 battle 运行阶段传入） */
  align?: { leftW: number; rightW: number };
  /** 顶栏最右端元素（仅 battle 运行阶段传入「结束遭遇」按钮，置于右栏列内右对齐） */
  end?: ReactNode;
}

export default function TopBar({ actions, align, end }: Props) {
  const brand = (
    <>
      <span className="es-brand-icon-col">
        <span className="es-brand-icon material-symbols-outlined">swords</span>
      </span>
      <span className="es-brand-text">D&D 4E 遭遇战模拟器</span>
    </>
  );

  // 对齐模式：grid 4 列 = 导航(76) + 左栏 + 中栏(flex) + 右栏列（end 元素右对齐于最右端）
  if (align) {
    return (
      <header
        className="es-topbar es-topbar--aligned"
        style={{ gridTemplateColumns: `76px ${align.leftW}px minmax(0, 1fr) ${align.rightW}px` }}
      >
        {brand}
        <div className="es-top-actions">{actions}</div>
        <div className="es-top-end">{end}</div>
      </header>
    );
  }

  return (
    <header className="es-topbar">
      <div className="es-brand">{brand}</div>
      <div className="es-top-actions">{actions}</div>
    </header>
  );
}