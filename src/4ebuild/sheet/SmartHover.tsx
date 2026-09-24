import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode, MouseEvent } from "react";

// 通用「悬停弹出」：触发元素 + 弹出层。
// 鼠标进入时根据触发元素距视口的位置智能判断弹出方位：
//   .p-up    触发元素在下半屏且上方有空间 → 向上弹出
//   .p-right 触发元素靠右导致右侧放不下    → 向右对齐左边界（left:auto; right:0）
// 沿用各触发元素自身的 :hover 显隐规则，仅新增方位 class，无需改动显隐逻辑。
//
// portal=true：弹出层经 createPortal 渲染到 body 并用固定定位（坐标由 JS 计算），
// 用于弹出层位于 overflow:hidden 容器（如词条卡片、滚动列表）内的场景，避免被裁剪。
// 此时显隐由 onMouseEnter/onMouseLeave 控制（不再依赖 :hover 父子关系）。
export function SmartHover({
  className,
  popClass = "hp-pop",
  children,
  pop,
  onClick,
  title,
  portal,
}: {
  className?: string;   // 触发元素类（如 .wiki-ref / .cls-option / .cls-choice-power / .compact-row）
  popClass?: string;    // 弹出层类（如 .wiki-ref-pop）。缺省用统一 .hp-pop
  children: ReactNode;
  pop?: ReactNode;      // 弹出内容；空则不渲染弹出层
  onClick?: (e: MouseEvent) => void;
  title?: string;
  portal?: boolean;     // 弹出层通过 portal 固定定位渲染，避免被 overflow 容器裁剪
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const orient = () => {
    const el = ref.current;
    if (!el) return;
    const vr = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 预计弹出层宽度（样式上限 400px，再受视口宽度约束）
    const estW = Math.min(400, vw - 120);
    if (portal) {
      // 固定定位：直接按视口坐标摆放；优先下弹，底部放不下且上方有空间则上弹，右侧放不下则右对齐
      const up = vr.bottom + 8 + 280 > vh && vr.top - 8 - 280 > 8;
      let top = up ? Math.max(8, vr.top - 8 - 280) : vr.bottom + 8;
      if (!up && top + 8 > vh - 8) top = Math.max(8, vh - 8 - 280);
      const left = vr.left + estW > vw - 8 ? Math.max(8, vr.right - estW) : vr.left;
      setPos({ top, left });
      return;
    }
    const pc = popRef.current;
    if (!pc) return;
    // 下方放不下、且上方有足够余量 → 上弹
    const up = vr.bottom > vh / 2 && vr.top - estW > 8;
    // 右侧放不下 → 右对齐避免溢出窗口右缘
    const right = vr.left + estW > vw - 8;
    pc.classList.toggle("p-up", up);
    pc.classList.toggle("p-right", right);
  };

  if (pop == null) {
    return (
      <span className={className} onClick={onClick} title={title}>{children}</span>
    );
  }
  if (portal) {
    return (
      <span ref={ref} className={className} onMouseEnter={orient} onMouseLeave={() => setPos(null)} onClick={onClick} title={title}>
        {children}
        {pos && createPortal(
          <span className={popClass} style={{ display: "block", position: "fixed", top: pos.top, left: pos.left }}>
            {pop}
          </span>,
          document.body
        )}
      </span>
    );
  }
  return (
    <span ref={ref} className={className} onMouseEnter={orient} onClick={onClick} title={title}>
      {children}
      <span ref={popRef} className={popClass}>{pop}</span>
    </span>
  );
}
