import { useEffect, useRef, useState } from "react";

// 大列表增量渲染：先渲染前 page 条，滚动到底部哨兵时追加（懒加载，避免一次性渲染数千卡片卡死）
export function useIncremental<T>(list: T[], page = 80): { visible: T[]; sentinelRef: React.RefObject<HTMLDivElement | null>; done: boolean } {
  const [count, setCount] = useState(page);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setCount(page);
  }, [list, page]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting) setCount((c) => Math.min(list.length, c + page));
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [list, page]);
  return { visible: list.slice(0, count), sentinelRef, done: count >= list.length };
}
