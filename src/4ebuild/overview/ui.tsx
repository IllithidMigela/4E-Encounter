// 速览页通用小部件：紧凑卡片壳、资源计数器、圆点计数、复制提示。
// 全部走 MD3 语义色与全局字重变量，样式定义在 styles.glance.css。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function fmtMod(n: number): string {
  return n >= 0 ? "+" + n : String(n);
}

/** 居中提示条（复制骰子指令、休整完成等操作反馈）。 */
export function useToast(): { toast: string | null; show: (msg: string) => void } {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 1800);
  }, []);
  return { toast, show };
}

export function GlanceToast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="gl-toast" role="status">
      <span className="material-symbols-outlined">check_circle</span>
      {text}
    </div>
  );
}

/** 复制文本到剪贴板（Clipboard API 不可用时回退 execCommand），并反馈结果。 */
export async function copyText(text: string, show: (msg: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    show("已复制 " + text);
    return;
  } catch {
    /* 继续走回退方案 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    show("已复制 " + text);
  } catch {
    show("复制失败，请手动选中指令");
  }
}

/** 面板分区：整块面板内用小标题分隔，不再各自成卡（MD3 filled surface + subhead + divider 分组）。 */
export function GlanceZone(props: {
  label: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={"gl-zone" + (props.className ? " " + props.className : "")}>
      <div className="gl-zone-head">
        <span className="gl-zone-label">{props.label}</span>
        {/* meta / acts 里会放计数器（div），必须用 div 承载：div 套在 span 里是非法嵌套 */}
        {props.meta !== undefined && <div className="gl-zone-meta">{props.meta}</div>}
        {props.actions !== undefined && <div className="gl-zone-acts">{props.actions}</div>}
      </div>
      <div className="gl-zone-body">{props.children}</div>
    </section>
  );
}

/** 资源计数器：标签 + 大数字 + 加减 + 可选重置。 */
export function GlanceCounter(props: {
  label: string;
  value: number | string;
  title?: string;
  onDec?: () => void;
  onInc?: () => void;
  onReset?: () => void;
  resetTitle?: string;
  tone?: "accent" | "plain";
}) {
  return (
    <div className={"gl-counter" + (props.tone === "accent" ? " accent" : "")} title={props.title}>
      <span className="gl-counter-label">{props.label}</span>
      <span className="gl-counter-ctl">
        <button type="button" className="gl-step" onClick={props.onDec} disabled={!props.onDec} aria-label={props.label + " 减少"}>−</button>
        <span className="gl-counter-value">{props.value}</span>
        <button type="button" className="gl-step" onClick={props.onInc} disabled={!props.onInc} aria-label={props.label + " 增加"}>＋</button>
        {props.onReset && (
          <button type="button" className="gl-step gl-step-reset" title={props.resetTitle ?? "重置"} onClick={props.onReset} aria-label={props.label + " 重置"}>↺</button>
        )}
      </span>
    </div>
  );
}

/** 圆点计数（回复力 / 死亡豁免）：点击第 i 个圆点把剩余数设为 i+1，点最后一个亮点则减 1。 */
export function GlancePips(props: {
  total: number;
  filled: number;
  onPick: (n: number) => void;
  tone?: "surge" | "death";
  label: string;
}) {
  const cap = 14; // 超过 14 个不再画圆点，改由数字表示，避免挤爆版面
  if (props.total > cap) return null;
  return (
    <div className="gl-pips" role="group" aria-label={props.label}>
      {Array.from({ length: props.total }, (_, i) => {
        const on = i < props.filled;
        return (
          <button
            key={i}
            type="button"
            className={"gl-pip" + (on ? " on" : "") + (props.tone === "death" ? " death" : "")}
            title={props.label + " " + (i + 1)}
            aria-label={props.label + " " + (i + 1)}
            aria-pressed={on}
            onClick={() => props.onPick(on && i + 1 === props.filled ? i : i + 1)}
          />
        );
      })}
    </div>
  );
}
