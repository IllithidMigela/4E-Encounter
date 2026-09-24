// 万律数据库查询工具
// 用法：  node scripts/query-rules.mjs <词1> [词2…]
// 供开发者 / AI 在遇到「涉及万律规则」的需求时快速定位条目。
// 匹配优先级：关键词精确索引 > 标题/路径子串 > 正文子串。
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dir = join(root, "public", "data", "rules");

if (!existsSync(join(dir, "index.json"))) {
  console.error("[rules:query] 未找到万律数据库。请先运行: npm run rules:build");
  process.exit(1);
}

const terms = process.argv.slice(2).filter(Boolean);
if (terms.length === 0) {
  console.log("用法: node scripts/query-rules.mjs <词1> [词2…]");
  console.log("示例: node scripts/query-rules.mjs 借机攻击 | 困难地形 | 濒死");
  process.exit(0);
}

const keywords = existsSync(join(dir, "keywords.json")) ? JSON.parse(readFileSync(join(dir, "keywords.json"), "utf8")) : {};

// 展开章节树 → 扁平条目（保留祖先路径）
function flatten() {
  const { chapters } = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  const out = [];
  const chapterById = new Map(chapters.map((c) => [c.id, c]));
  const walk = (c, node, path) => {
    const p = path.length ? [...path, node.title] : [node.title];
    out.push({
      id: node.id,
      chapterId: c.id,
      path: p.join(" › "),
      title: node.title,
      body: node.body || "",
      keywords: node.keywords || [],
      intro: c.intro && path.length === 0 ? c.intro : "",
    });
    node.children?.forEach((k) => walk(c, k, p));
  };
  chapters.forEach((c) => c.tree.forEach((n) => walk(c, n, [])));
  return { out, chapterById };
}

const { out, chapterById } = flatten();

function excerpt(body) {
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

// 打分与排序
const scored = [];
for (const e of out) {
  const lowTitle = e.title.toLowerCase();
  const lowBody = e.body.toLowerCase();
  let score = 0;
  let hitKeyword = null;
  let titleHit = [];
  for (const t of terms) {
    const lt = t.toLowerCase();
    // 1) 关键词索引精确命中（含同义词正则不在此处理）
    const ids = keywords[t] ?? keywords[e.title] ?? null;
    if (ids && ids.includes(e.id)) {
      score += 100;
      hitKeyword = hitKeyword ?? t;
    }
    // 2) 标题/路径命中
    if (e.title.includes(t) || e.path.toLowerCase().includes(lt)) {
      score += 40;
      titleHit.push(t);
    }
    // 3) 关键词元数据命中
    if (e.keywords.some((k) => k.includes(t))) {
      score += 30;
      hitKeyword = hitKeyword ?? t;
    }
    // 4) 正文命中
    if (lowBody.includes(lt)) score += 10;
  }
  if (score > 0) scored.push({ e, score, hitKeyword, titleHit });
}

scored.sort((a, b) => b.score - a.score);
const results = scored.slice(0, 15);

if (results.length === 0) {
  console.log(`未找到匹配「${terms.join("、")}」的规则。可尝试：npm run rules:build 后重试，或换更短的词。`);
  process.exit(0);
}

console.log(`匹配 ${results.length} 条（共 ${out.length} 条目）：`);
results.forEach(({ e, score, hitKeyword }, i) => {
  const ch = chapterById.get(e.chapterId);
  const tag = hitKeyword ? ` [关键词:${hitKeyword}]` : e.titleHit?.length ? ` [标题]` : "";
  console.log(`\n${i + 1}. [${ch.title}] ${e.path}`);
  console.log(`    id: ${e.id}  相关度:${score}${tag}`);
  const src = e.body || e.intro;
  if (src) console.log(`    摘要: ${excerpt(src)}`);
  if (e.keywords?.length) console.log(`    关键词: ${e.keywords.slice(0, 8).join("、")}`);
});