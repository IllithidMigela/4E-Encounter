// 车卡器主题作用域容器：ThemeProvider + 主题变量隔离。
// 问题：4ebuild 的 ThemeProvider（applyCssVars）把 --md-sys-color-* 写到 document.documentElement，
// 覆盖宿主遭遇模拟器的 :root 配色。本组件作为 ThemeProvider 的父级，effect 晚于子级执行，
// 挂载后把这些内联变量搬到自身容器 div；同时镜像一份给 portal 弹窗
// （渲染在 body 下、继承不到容器变量的元素）。
// 镜像目标：.picker-overlay/.crop-overlay（选择器/裁剪弹窗）、
// md-dialog.sheet-dialog 与 .gl-toast（速览页 OverviewView 的弹窗/提示条）。
// 使用：CarBuildView（车卡视图）、CharacterCard（只读人物卡）、CharactersView（角色卡速览）共用。
import { useEffect, useRef, type ReactNode } from "react";
import { ThemeProvider } from "../4ebuild/ThemeProvider";

const PORTAL_VAR_STYLE_ID = "es-4e-portal-vars";
// 接收主题变量镜像的 body 级 portal 元素（速览 SheetDialog 渲染为 body 下的 md-dialog.sheet-dialog）
const PORTAL_VAR_TARGETS = ".picker-overlay,.crop-overlay,md-dialog.sheet-dialog,.gl-toast";

export default function ThemeScope({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 每次渲染后搬移：ThemeProvider 的主题切换 effect 先执行（写 :root），这里随后搬走
  useEffect(() => {
    const root = document.documentElement;
    const container = containerRef.current;
    if (!container) return;
    const moved: string[] = [];
    for (let i = root.style.length - 1; i >= 0; i--) {
      const prop = root.style[i];
      if (prop.startsWith("--md-sys-color-")) {
        container.style.setProperty(prop, root.style.getPropertyValue(prop));
        root.style.removeProperty(prop);
        moved.push(prop);
      }
    }
    if (moved.length === 0) return;
    let styleEl = document.getElementById(PORTAL_VAR_STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = PORTAL_VAR_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    const decls = moved.map((p) => `${p}:${container.style.getPropertyValue(p)};`).join("");
    styleEl.textContent = `${PORTAL_VAR_TARGETS}{${decls}}`;
  });

  // 卸载清理：移除 portal 变量镜像；容错清扫根元素残留内联变量（容器随组件卸载自动消失）
  useEffect(() => {
    return () => {
      document.getElementById(PORTAL_VAR_STYLE_ID)?.remove();
      const root = document.documentElement;
      for (let i = root.style.length - 1; i >= 0; i--) {
        const prop = root.style[i];
        if (prop.startsWith("--md-sys-color-")) root.style.removeProperty(prop);
      }
    };
  }, []);

  return (
    <div ref={containerRef}>
      <ThemeProvider>{children}</ThemeProvider>
    </div>
  );
}
