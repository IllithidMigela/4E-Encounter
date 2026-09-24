// MD3 水波纹（ink ripple）：事件委托实现。
// 为自定义交互元素补充按压反馈；@material/web 组件（md-*）自带官方水波纹，此处跳过。
//
// 原理：pointerdown 时在目标元素内注入一个 .md3-ink 圆形节点，
// 按指针落点定位，执行 styles.css 中的 md3-ink 关键帧（scale 0→1 + 淡出，
// duration-long1 + standard 缓动），animationend 后自动移除。

const INK_SELECTOR = "button, .compact-row, .portrait-frame";

// 水波纹只对「页面 light DOM」中的自定义交互元素注入；
// 事件源位于 md-* 组件内部 shadow DOM 时跳过（官方组件自带水波纹）。
// 注意：slotted 到 md-dialog 等组件里的 light DOM 按钮 getRootNode() 仍是 document，正常保留波纹。
function insideMdShadow(el: HTMLElement | null): boolean {
  return !!el && el.getRootNode() !== document;
}

function spawnInk(target: HTMLElement, x: number, y: number): void {
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const size = Math.max(rect.width, rect.height) * 2.4;
  const ink = document.createElement("span");
  ink.className = "md3-ink";
  ink.style.width = size + "px";
  ink.style.height = size + "px";
  ink.style.left = x - rect.left - size / 2 + "px";
  ink.style.top = y - rect.top - size / 2 + "px";
  target.appendChild(ink);
  ink.addEventListener("animationend", () => ink.remove(), { once: true });
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return; // 仅主键
  const origin = e.target as HTMLElement | null;
  if (!origin || !origin.closest) return;
  const target = origin.closest<HTMLElement>(INK_SELECTOR);
  if (!target) return;
  if (insideMdShadow(origin)) return; // md-* 组件自带水波纹
  if ((target as HTMLButtonElement).disabled) return;
  spawnInk(target, e.clientX, e.clientY);
}

export function initRipple(): void {
  document.addEventListener("pointerdown", onPointerDown, { passive: true });
}
