// 万律规则书：层级目录 + 全文搜索 + 条目阅读器（可读可查，供玩家/DM/开发者/AI）
import { useEffect, useMemo, useState } from "react";

interface Ref {
  target: string;
  label: string;
}
interface RuleNode {
  id: string;
  level: number;
  title: string;
  body: string;
  keywords: string[];
  refs: Ref[];
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

interface Entry {
  chapterId: string;
  pathAtoms: string[];
  node: RuleNode & { intro?: string };
}

const TITLE_FALLBACK = "万律书 · 规则速查";

interface Props {
  /** 外部触发时预填的搜索词（如场景棋子栏「万律条目」跳转） */
  prefill?: string;
}

export default function RulesView({ prefill }: Props) {
  const [ready, setReady] = useState(false);
  const [fail, setFail] = useState(false);
  const [data, setData] = useState<RulesData | null>(null);
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  // 目录展开集合：含章节 id 与节点 id
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 外部请求预填搜索词时，滚动到搜索框并应用
  useEffect(() => {
    if (!prefill) return;
    setQ(prefill);
  }, [prefill]);

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "data/rules/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((d) => {
        setData(d);
        const first = d?.chapters?.[0];
        if (first) {
          setActiveId(first.id);
          setExpanded(new Set([first.id]));
        }
        setReady(true);
      })
      .catch(() => {
        setFail(true);
        setReady(true);
      });
  }, []);

  // 扁平索引：id → 条目（含章节导言），便于阅读与导航
  const entries = useMemo(() => {
    const map = new Map<string, Entry>();
    if (!data) return map;
    for (const c of data.chapters) {
      map.set(c.id, { chapterId: c.id, pathAtoms: [], node: { id: c.id, level: 0, title: c.title, body: c.intro, keywords: [], refs: [], children: c.tree, intro: c.intro } });
      const walk = (n: RuleNode, path: string[]) => {
        map.set(n.id, { chapterId: c.id, pathAtoms: path, node: n });
        n.children.forEach((k) => walk(k, [...path, n.title]));
      };
      c.tree.forEach((n) => walk(n, []));
    }
    return map;
  }, [data]);

  // title → ids（用于交叉引用跳转）
  const byTitle = useMemo(() => {
    const m = new Map<string, string[]>();
    entries.forEach((e, id) => {
      const arr = m.get(e.node.title) ?? [];
      arr.push(id);
      m.set(e.node.title, arr);
    });
    return m;
  }, [entries]);

  const chapterById = useMemo(() => new Map(data?.chapters.map((c) => [c.id, c]) ?? []), [data]);

  const active = activeId ? entries.get(activeId) : null;

  // 全文搜索结果（搜索时展示平铺列表）
  const kw = q.trim();
  const results = useMemo(() => {
    if (!kw) return [];
    const low = kw.toLowerCase();
    const out: { entry: Entry; excerpt: string }[] = [];
    entries.forEach((e) => {
      const { title, body, keywords, intro } = {
        title: e.node.title,
        body: e.node.body || "",
        keywords: e.node.keywords || [],
        intro: (e.node as { intro?: string }).intro || "",
      };
      const hay = (title + "\n" + body + "\n" + intro + "\n" + keywords.join(" ")).toLowerCase();
      if (hay.includes(low)) {
        const src = body || intro;
        const s = src.replace(/\s+/g, " ").trim();
        out.push({ entry: e, excerpt: s.length > 160 ? s.slice(0, 160) + "…" : s });
      }
    });
    return out;
  }, [entries, kw]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const walkExpand = (s: Set<string>, e: Entry) => {
    // 从章节树中按路径找祖先并加入展开集合
    const c = chapterById.get(e.chapterId);
    if (!c) return;
    let siblings = c.tree;
    for (const atom of e.pathAtoms) {
      const found = siblings.find((n) => n.title === atom);
      if (!found) break;
      s.add(found.id);
      siblings = found.children;
    }
  };

  const openEntry = (id: string) => {
    setActiveId(id);
    // 展开祖先链，便于在目录中定位
    setExpanded((prev) => {
      const s = new Set(prev);
      const e = entries.get(id);
      if (e) {
        s.add(e.chapterId);
        walkExpand(s, e);
      }
      return s;
    });
    setQ("");
  };

  const resolveRef = (label: string, target: string) => {
    const ids = byTitle.get(label) ?? byTitle.get(target);
    return ids?.[0];
  };

  // 上一条 / 下一条（按章节树先序）
  const ordered = useMemo(() => {
    const arr: string[] = [];
    if (!data) return arr;
    data.chapters.forEach((c) => {
      const push = (n: RuleNode) => {
        arr.push(n.id);
        n.children.forEach(push);
      };
      c.tree.forEach(push);
    });
    return arr;
  }, [data]);

  const navIdx = activeId ? ordered.indexOf(activeId) : -1;
  const prevId = navIdx > 0 ? ordered[navIdx - 1] : null;
  const nextId = navIdx >= 0 && navIdx < ordered.length - 1 ? ordered[navIdx + 1] : null;

  const highlight = (text: string): React.ReactNode => {
    if (!kw) return text;
    const low = kw.toLowerCase();
    const i = text.toLowerCase().indexOf(low);
    if (i < 0) return text;
    return (
      <>
        {text.slice(0, i)}
        <mark>{text.slice(i, i + kw.length)}</mark>
        {text.slice(i + kw.length)}
      </>
    );
  };

  const renderTocNodes = (nodes: RuleNode[], indent: number): React.ReactNode => {
    return nodes.map((n) => {
      const hasKids = n.children.length > 0;
      const isOpen = expanded.has(n.id);
      const isActive = activeId === n.id;
      return (
        <div key={n.id} className="es-toc-group">
          <div
            className={"es-toc-item" + (isActive ? " on" : "") + (hasKids ? " haskids" : "")}
            style={{ paddingLeft: 8 + indent * 14 }}
            onClick={() => {
              setActiveId(n.id);
              setQ("");
            }}
          >
            {hasKids ? (
              <span className="es-toc-caret" onClick={(e) => { e.stopPropagation(); toggle(n.id); }}>{isOpen ? "▾" : "▸"}</span>
            ) : (
              <span className="es-toc-caret es-toc-blank" />
            )}
            <span className="es-toc-label">{n.title}</span>
          </div>
          {hasKids && isOpen && <div className="es-toc-children">{renderTocNodes(n.children, indent + 1)}</div>}
        </div>
      );
    });
  };

  const renderToc = (): React.ReactNode => {
    if (!data) return null;
    return data.chapters.map((c) => {
      const isOpen = expanded.has(c.id);
      const isActive = activeId === c.id;
      return (
        <div key={c.id} className="es-toc-chapter">
          <div className={"es-toc-chapter-title" + (isActive ? " on" : "")} onClick={() => { setActiveId(c.id); setQ(""); }}>
            <span className="es-toc-caret" onClick={(e) => { e.stopPropagation(); toggle(c.id); }}>{isOpen ? "▾" : "▸"}</span>
            <span className="es-toc-label">{c.title}</span>
          </div>
          {isOpen && (
            <div className="es-toc-children">
              {c.intro && <div className={"es-toc-item es-toc-intro" + (activeId === c.id ? " on" : "")} style={{ paddingLeft: 8 + 14 }} onClick={() => setActiveId(c.id)}>概览</div>}
              {renderTocNodes(c.tree, 1)}
            </div>
          )}
        </div>
      );
    });
  };

  // 阅读器主体
  const readerBody = (): React.ReactNode => {
    if (!active) return <div className="es-empty">从左侧目录选择条目，或输入关键词搜索。</div>;
    const ch = chapterById.get(active.chapterId);
    const breadcrumb = [ch?.title, ...active.pathAtoms].filter(Boolean).join(" › ");
    const isChapter = active.node.level === 0;
    const body = active.node.body || (active.node as { intro?: string }).intro || "";
    const paragraphs = body.split("\n\n").filter(Boolean);
    const hasKids = active.node.children.length > 0;

    return (
      <>
        <div className="es-book-nav">
          {prevId && <button className="es-book-nav-btn" onClick={() => openEntry(prevId)}>← 上一条</button>}
          <span className="es-book-nav-spacer" />
          {nextId && <button className="es-book-nav-btn" onClick={() => openEntry(nextId)}>下一条 →</button>}
        </div>
        <div className="es-book-breadcrumb">{breadcrumb}</div>
        <h3 className="es-book-title">{highlight(active.node.title)}</h3>
        {hasKids && (
          <div className="es-book-children">
            <div className="es-book-children-hint">子条目：</div>
            {active.node.children.map((k) => (
              <button key={k.id} className="es-book-child" onClick={() => openEntry(k.id)}>
                {k.title}
              </button>
            ))}
          </div>
        )}
        <div className="es-book-body">
          {paragraphs.length === 0 && !isChapter && <div className="es-empty">（此条目为分组标题，正文见其子条目。）</div>}
          {paragraphs.map((p, i) => (
            <p key={i}>{highlight(p)}</p>
          ))}
          {!isChapter && paragraphs.length === 0 && (
            <div className="es-empty">（此条目为分组标题，正文见其子条目。）</div>
          )}
        </div>
        {active.node.keywords.length > 0 && (
          <div className="es-book-keywords">
            <span className="es-book-label">关键词：</span>
            {active.node.keywords.map((k) => (
              <button key={k} className="es-book-chip" onClick={() => setQ(k)}>{k}</button>
            ))}
          </div>
        )}
        {active.node.refs.length > 0 && (
          <div className="es-book-refs">
            <span className="es-book-label">参见：</span>
            {active.node.refs.map((r, i) => {
              const targetId = resolveRef(r.label, r.target);
              return targetId ? (
                <button key={i} className="es-book-ref" onClick={() => openEntry(targetId)}>{r.label}</button>
              ) : (
                <span key={i} className="es-book-ref-plain">{r.label}</span>
              );
            })}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="es-view rules">
      <header className="es-view-head es-book-head">
        <h2>万律</h2>
        <span className="es-view-sub">{data?.title ?? TITLE_FALLBACK}</span>
      </header>
      <input className="es-search es-book-search" placeholder="搜索规则（如：借机攻击／困难地形／濒死）…" value={q} onChange={(e) => setQ(e.target.value)} />

      {!ready ? (
        <div className="es-loading">加载万律数据…</div>
      ) : fail ? (
        <div className="es-error">万律数据加载失败，请确认已运行 npm run rules:build 生成 data/rules/index.json。</div>
      ) : (
        <div className="es-book">
          <div className="es-book-toc">
            {kw ? (
              <div className="es-toc-results">
                <div className="es-rules-count">匹配 {results.length} 条条目标题/正文</div>
                {results.length === 0 && <div className="es-empty">没有匹配的规则。</div>}
                {results.map(({ entry, excerpt }, i) => {
                  const ch = chapterById.get(entry.chapterId);
                  const path = [ch?.title, ...entry.pathAtoms].filter(Boolean).join(" › ");
                  return (
                    <button key={entry.node.id + i} className="es-toc-result" onClick={() => openEntry(entry.node.id)}>
                      <div className="es-toc-result-title">{highlight(entry.node.title)}</div>
                      <div className="es-toc-result-path">{path}</div>
                      <div className="es-toc-result-excerpt">{highlight(excerpt)}</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="es-toc-tree">{renderToc()}</div>
            )}
          </div>
          <div className="es-book-main">{readerBody()}</div>
        </div>
      )}
    </div>
  );
}