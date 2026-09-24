// 批 4b-2：hover 联动万律——状态名/规则词 hover 弹迷你规则卡
// 数据源：public/data/rules/index.json（rules:build 产物，万律书数据库）；懒加载并缓存。
// 命中：关键词索引 → 标题精确/包含 → 正文首段含词（任中即取）；点击「查看全文」跳转万律全文。
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";

interface RuleNode {
  id: string;
  level: number;
  title: string;
  body: string;
  keywords: string[];
  refs: { target: string; label: string }[];
  children: RuleNode[];
}
interface Chapter {
  id: string;
  order: number;
  title: string;
  intro: string;
  tree: RuleNode[];
}
interface RulesData {
  title: string;
  chapters: Chapter[];
}

export interface RuleHit {
  id: string;
  title: string;
  excerpt: string;
  path: string;
  keyword: string;
}

let cachePromise: Promise<RulesData | null> | null = null;
let kwIndex: Map<string, string[]> | null = null; // 关键词(小写) → node ids
let titleIndex: Map<string, string[]> | null = null;

export function loadRules(): Promise<RulesData | null> {
  if (!cachePromise) {
    cachePromise = fetch(import.meta.env.BASE_URL + "data/rules/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return cachePromise;
}

/** 惰性构建 关键词/标题 索引（整树一次遍历） */
function ensureIndex(data: RulesData) {
  if (kwIndex) return;
  const kwIdx = new Map<string, string[]>();
  const ttIdx = new Map<string, string[]>();
  const walk = (n: RuleNode) => {
    for (const k of n.keywords ?? []) {
      const key = k.toLowerCase();
      const arr = kwIdx.get(key) ?? [];
      arr.push(n.id);
      kwIdx.set(key, arr);
    }
    const t = n.title.toLowerCase();
    const arr = ttIdx.get(t) ?? [];
    arr.push(n.id);
    ttIdx.set(t, arr);
    for (const ch of n.children ?? []) walk(ch);
  };
  for (const ch of data.chapters) for (const root of ch.tree) walk(root);
  kwIndex = kwIdx;
  titleIndex = ttIdx;
}

/** 查找一个规则词对应的最佳条目；找不到返回 null（静默，不打断操作） */
export async function findRuleForKeyword(rawKw: string): Promise<RuleHit | null> {
  const kw = rawKw.trim();
  if (!kw) return null;
  const data = await loadRules();
  if (!data) return null;
  ensureIndex(data);
  const low = kw.toLowerCase();
  const ids = new Set<string>([...(kwIndex!.get(low) ?? []), ...(titleIndex!.get(low) ?? [])]);
  if (ids.size === 0) {
    for (const [t, v] of titleIndex!) {
      if (t.includes(low)) v.forEach((id) => ids.add(id));
    }
  }
  if (ids.size === 0) return null;
  // 扁平收集命中节点（id → node + 章节路径）
  const byId = new Map<string, { node: RuleNode; path: string[] }>();
  const walkAll = (n: RuleNode, path: string[]) => {
    if (ids.has(n.id)) byId.set(n.id, { node: n, path });
    for (const ch of n.children ?? []) walkAll(ch, [...path, n.title]);
  };
  for (const ch of data.chapters) for (const root of ch.tree) walkAll(root, []);
  const first = byId.values().next().value;
  if (!first) return null;
  const body = first.node.body ?? "";
  const para = body.split("\n").map((s) => s.trim()).find((s) => s) ?? "";
  return {
    id: first.node.id,
    title: first.node.title,
    excerpt: para.length > 150 ? para.slice(0, 150) + "…" : para,
    path: first.path.join(" › "),
    keyword: kw,
  };
}

/** hover 迷你规则卡：悬停子元素 250ms 后查询规则库并弹出摘要；点击「查看全文」跳转万律 */
export function RuleTip({
  kw,
  children,
  onOpenRules,
  className,
}: {
  kw: string;
  children: ReactNode;
  onOpenRules?: (kw: string) => void;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const [hit, setHit] = useState<RuleHit | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timer = useRef<number | null>(null);

  const onEnter = useCallback(
    (e: React.MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPos({
        x: Math.min(r.left, window.innerWidth - 292),
        y: Math.min(r.bottom + 6, window.innerHeight - 120),
      });
      setShow(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        findRuleForKeyword(kw).then((h) => setHit(h));
      }, 250);
    },
    [kw],
  );

  const onLeave = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setShow(false);
    setHit(null);
  }, []);

  return (
    <>
      <span className={className} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        {children}
      </span>
      {show && (
        <div className="es-rule-tip" style={{ left: pos.x, top: pos.y }}>
          {!hit ? (
            <div className="es-rule-tip-loading">查询万律…</div>
          ) : (
            <>
              <div className="es-rule-tip-title">{hit.title}</div>
              {hit.path && <div className="es-rule-tip-path">{hit.path}</div>}
              {hit.excerpt ? (
                <div className="es-rule-tip-body">{hit.excerpt}</div>
              ) : (
                <div className="es-rule-tip-loading">（该词条无正文摘要）</div>
              )}
              {onOpenRules && (
                <button
                  className="es-rule-tip-open"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenRules(hit.keyword);
                  }}
                >
                  查看全文 →
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
