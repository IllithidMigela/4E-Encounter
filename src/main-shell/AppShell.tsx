// 顶层框架：顶部操作栏 + 左导航 + 内容区（children 为当前视图，需自带 flex:1 或占满）
import type { ReactNode } from "react";
import type { AppView } from "../types";
import NavRail from "./NavRail";
import TopBar from "./TopBar";

interface Props {
  view: AppView;
  onView: (v: AppView) => void;
  /** 随视图切换的顶部操作按钮（battle 视图为地图尺寸+三栏开关等） */
  topActions?: ReactNode;
  /** 顶栏与下方三栏对齐（battle 运行阶段传入：leftW/rightW） */
  topAlign?: { leftW: number; rightW: number };
  /** 顶栏最右端元素（battle 运行阶段为「结束遭遇」按钮） */
  topEnd?: ReactNode;
  children: ReactNode;
}

export default function AppShell({ view, onView, topActions, topAlign, topEnd, children }: Props) {
  return (
    <div className="app">
      <TopBar actions={topActions} align={topAlign} end={topEnd} />
      <div className="es-shell">
        <NavRail view={view} onView={onView} />
        {children}
      </div>
    </div>
  );
}