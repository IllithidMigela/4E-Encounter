// 预处理《万律书》(4e Rules Compendium) HTML → public/data/rules/*.json
// 生成：
//   index.json   —— 层级规则数据库（章节→h1/h2/h3/h4 树），含正文、关键词、交叉引用
//   toc.json     —— 轻量目录（不含正文），供 UI 侧栏 & 快速浏览
//   keywords.json—— 关键词 → 条目 id 索引（供搜索 / 查询工具 / AI 定位）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "..", "4e Rules Compendium — 万律书.html");
const destDir = join(root, "public", "data", "rules");

// 章节固定顺序与稳定 id（文档结构以此为准）
const CHAPTERS = [
  { title: "第一章：基本", id: "ch1" },
  { title: "第二章：冒险者与怪物", id: "ch2" },
  { title: "第三章：理解威能", id: "ch3" },
  { title: "第四章：技能", id: "ch4" },
  { title: "第五章：探索与环境", id: "ch5" },
  { title: "第六章：战斗", id: "ch6" },
  { title: "第七章：装备", id: "ch7" },
  { title: "附录1：构建战斗遭遇", id: "app1" },
  { title: "附录2：奖励", id: "app2" },
  { title: "附录3：地形特征", id: "app3" },
];

if (!src) {
  console.error("[build-rules] 未找到万律书文件: " + src);
  process.exit(1);
}
const html = readFileSync(src, "utf8");

// 还原常见 HTML 实体
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, (m) => String.fromCharCode(+m.slice(2, -1)));
}

// 剥离标签得到纯文本（<a> 只留文字；<br>→换行）
function inlineText(raw) {
  return decodeEntities(
    raw
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/''/g, "")
      .replace(/\\"/g, '"')
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

// 清洗并过滤「可用关键词」：去除数值/货币、纯符号、超长短语等无检索价值的噪声
function cleanTerm(raw) {
  let t = (raw || "")
    .replace(/[\u3000\u00a0]/g, " ")
    .replace(/[。．.!！?？：:]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!t) return null;
  // 必须含中文或英文字母（纯数字/纯符号无检索价值）
  if (!/[\u4e00-\u9fffA-Za-z]/.test(t)) return null;
  // 纯数值/货币（如 100gp、1,000gp、50000金币）
  if (/^\d[\d,]*(gp|sp|cp|gm|金币|银币|铜币)?$/i.test(t)) return null;
  // 超过 10 字视为整句/短语，不作为关键词（正文仍在 node.body，可被全文检索到）
  if (t.length > 10) return null;
  return t;
}

// 抽取 <strong> 关键词
function extractKeywords(raw) {
  const kws = [];
  const re = /<strong\b[^>]*>([\s\S]*?)<\/strong>/gi;
  let m;
  while ((m = re.exec(raw))) {
    const t = cleanTerm(inlineText(m[1]));
    if (t) kws.push(t);
  }
  return [...new Set(kws)];
}

// 抽取内部交叉引用（# 锚点链接 → 目标标题与显示文字）
function extractRefs(raw) {
  const refs = [];
  const re = /<a\b[^>]*href="[^"]*#([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(raw))) {
    const label = inlineText(m[2]).trim();
    const target = decodeURIComponent(m[1]).trim();
    if (label && target) refs.push({ target, label });
  }
  // 去重（target+label）
  const seen = new Set();
  return refs.filter((r) => {
    const k = r.target + "|" + r.label;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 表格行 → 各单元格文本（空格分隔）
function rowText(trRaw) {
  const cells = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(trRaw))) cells.push(inlineText(m[1]));
  return cells.join("  ").trim();
}

// 按 data-tiddler-title 精确切分出某章节的 tiddler body（不含标题栏/控件）
function chapterBody(title) {
  const mark = `data-tiddler-title="${title}"`;
  const start = html.indexOf(mark);
  if (start < 0) return null;
  const bodyMark = "tc-tiddler-body tc-reveal";
  const bs = html.indexOf(bodyMark, start);
  if (bs < 0) return null;
  const bodyStart = bs + bodyMark.length;
  const bodyEnd = html.indexOf("</div>", bodyStart);
  // 找真正闭合的 body 外层 div：截到下一个 tiddler 帧开始或文档末尾
  const nextT = html.indexOf('data-tiddler-title="', bodyStart);
  const endPos = nextT > bodyStart ? nextT : html.length;
  return html.slice(bodyStart, endPos);
}

// 主抽取
const rawById = new Map();
CHAPTERS.forEach((c) => {
  const body = chapterBody(c.title);
  rawById.set(c.id, body ?? "");
});

const blocksRe =
  /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<tr\b[^>]*>([\s\S]*?)<\/tr>|<p\b[^>]*>([\s\S]*?)<\/p>|<li\b[^>]*>([\s\S]*?)<\/li>|<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>|<dt\b[^>]*>([\s\S]*?)<\/dt>|<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;

const chapters = [];
const keywordMap = new Map(); // term -> ids

function indexKeyword(term, id) {
  if (!term) return;
  const arr = keywordMap.get(term) ?? [];
  if (!arr.includes(id)) arr.push(id);
  keywordMap.set(term, arr);
}

CHAPTERS.forEach((c) => {
  const body = rawById.get(c.id) ?? "";
  const tree = [];
  const root = { level: 0, children: tree };
  let cur = root;
  let intro = "";

  const nextId = (() => {
    const used = new Set();
    return (title) => {
      let base = encodeURIComponent(title.replace(/\s+/g, ""));
      let id = base;
      let n = 2;
      while (used.has(id)) id = `${base}-${n++}`;
      used.add(id);
      return `${c.id}/${id}`;
    };
  })();

  const finishNode = (n) => {
    // 压缩行内多余空格，保留段落换行（\n 分隔自然段）
    n.body = n.body
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    n.keywords = [...new Set(n.keywords)];
    n.refs = n.refs ?? [];
  };

  let m;
  blocksRe.lastIndex = 0;
  while ((m = blocksRe.exec(body)) !== null) {
    if (m[1]) {
      // 标题：新节点
      const level = parseInt(m[1].replace(/\D/g, ""), 10); // m[1] 为 "h1"... → 1
      const title = inlineText(m[2]);
      if (!title) continue;
      const node = { id: nextId(title), level, title, body: "", keywords: [], refs: [], children: [] };
      while (cur.level >= level) cur = cur.parent ?? root;
      cur.children.push(node);
      node.parent = cur;
      cur = node;
      // 节点标题本身作为关键词（便于精确定位，如 借机攻击/困难地形/濒死），并作为该条目的首个 chip
      const tkw = cleanTerm(title);
      if (tkw) {
        indexKeyword(tkw, node.id);
        node.keywords.push(tkw);
      }
    } else {
      let text = "";
      let kwRaw = "";
      const block = m[3] ? "tr" : m[4] ? "p" : m[5] ? "li" : m[6] ? "blockquote" : m[7] ? "dt" : "dd";
      let raw = m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8];
      raw = raw ?? "";
      if (block === "tr") {
        text = rowText(raw);
        kwRaw = raw;
      } else {
        text = inlineText(raw);
        kwRaw = raw;
      }
      if (!text) continue;
      if (cur === root) {
        intro = intro ? intro + "\n\n" + text : text;
        for (const t of extractKeywords(kwRaw)) indexKeyword(t, c.id);
      } else {
        cur.body = cur.body ? cur.body + "\n\n" + text : text;
        for (const t of extractKeywords(kwRaw)) {
          if (!cur.keywords.includes(t)) cur.keywords.push(t);
          indexKeyword(t, cur.id);
        }
        for (const r of extractRefs(raw)) {
          if (!cur.refs.some((x) => x.target === r.target && x.label === r.label)) cur.refs.push(r);
        }
      }
    }
  }

  // 清理节点（去掉 parent 引用、收尾）
  const clean = (n) => {
    finishNode(n);
    n.children.forEach(clean);
    delete n.parent;
  };
  tree.forEach(clean);

  // 章节本身标题作为关键词方便定位（经 cleanTerm 清洗）
  for (const t of [c.title, c.title.replace(/^第[一二三四五六七八九十]+章[：:]/, "")]) {
    const ct = cleanTerm(t);
    if (ct) indexKeyword(ct, c.id);
  }

  chapters.push({ id: c.id, order: chapters.length + 1, title: c.title, intro, tree });
});

// ---- 输出 toc.json：轻量目录，含层级 & 祖先路径 ----
const tocChapters = chapters.map((c) => {
  const nodes = [];
  const walk = (n, path) => {
    const p = path ? `${path}#${n.title}` : n.title;
    nodes.push({ id: n.id, level: n.level, title: n.title, path: p });
    n.children.forEach((k) => walk(k, p));
  };
  c.tree.forEach((n) => walk(n, ""));
  return { id: c.id, order: c.order, title: c.title, hasIntro: !!c.intro, nodes };
});

// ---- 输出 keywords.json ----
const keywords = Object.fromEntries([...keywordMap.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh")));

const title = "4E 万律书 · 规则速查";
mkdirSync(destDir, { recursive: true });
writeFileSync(join(destDir, "index.json"), JSON.stringify({ title, chapters }));
writeFileSync(join(destDir, "toc.json"), JSON.stringify({ title, chapters: tocChapters }));
writeFileSync(join(destDir, "keywords.json"), JSON.stringify(keywords));

const nodeCount = chapters.reduce((s, c) => s + countNodes(c.tree), 0);
console.log(
  `[build-rules] 生成 rules/(index/toc/keywords).json\n` +
    `  章节=${chapters.length}  条目节点=${nodeCount}  关键词=${Object.keys(keywords).length}`
);

function countNodes(list) {
  return list.reduce((s, n) => s + 1 + countNodes(n.children), 0);
}