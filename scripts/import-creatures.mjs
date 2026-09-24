// 怪物库导入 + 统一格式合并脚本
// 输入1：public/data/creature.json（旧库，4E-NEXT 管线产物或已合并过的版本）
// 输入2：../../怪物数据/mm1~3怪物/{MM,MM2,MM3}/*.json（最新 TiddlyWiki 导出）
// 处理：
//   新数据：渲染 {{!!字段}} 模板 → ''HP''→''生命值'' → tags 转数组 → title 拆 name/nameEn → 保留结构化字段
//   旧数据：从 HTML 属性块提取 level/role/specialty-role/size/origin/creature-type/xp，补齐到与新数据相同的统一格式
//   去重：新旧 title 冲突 → 双方都是完整属性块则视为同一只怪物留新；旧为召唤物则两条保留（旧 id 加「（召唤）」）
//         新库内部同 title → 保留更完整版本，丢弃清单写入报告
// 输出：public/data/creature.json（统一格式合并库）+ public/data/creature-import-report.md（差异 + 统计 + 处理清单）
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTags, parseCreature } from "../src/monsterParse.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const monsterRoot = join(root, "..", "怪物数据", "mm1~3怪物");
const destFile = join(root, "public", "data", "creature.json");
const reportFile = join(root, "public", "data", "creature-import-report.md");

const NEW_BOOKS = ["MM", "MM2", "MM3"];
const META_KEYS = ["level", "specialty-role", "role", "size", "origin", "creature-type", "xp"];
const SPECIALTY_WORDS = ["精英", "杂兵", "强者"];

if (!existsSync(destFile)) {
  console.error("[import-creatures] 未找到旧库 " + destFile);
  console.error("请先运行 npm run copy-data（或确保 public/data/creature.json 存在）");
  process.exit(1);
}
if (!existsSync(monsterRoot)) {
  console.error("[import-creatures] 未找到新数据目录 " + monsterRoot);
  process.exit(1);
}

// ---------- 工具 ----------

/** 标题「中文 English」拆名：以首个 ASCII 字母为分界（与 4E-NEXT parseName 一致） */
function splitName(title) {
  const m = /[A-Za-z]/.exec(title);
  if (!m || m.index === 0) return { name: title, nameEn: undefined };
  const zh = title.slice(0, m.index).trim();
  const en = title.slice(m.index).trim();
  return { name: zh || title, nameEn: en || undefined };
}

/** 渲染 TiddlyWiki 模板占位 + 生命值标签归一化 */
function renderText(text, fields) {
  return text
    .replace(/\{\{!!([^}]+)\}\}/g, (_m, k) => fields[k] ?? "")
    .replace(/''HP''/g, "''生命值''");
}

/** 从旧库 HTML 属性块提取统一元数据（与新数据结构对齐） */
function extractMetaFromHtml(html) {
  const meta = {};
  const titleMatch = html.match(/<div class="bold font-size-h4 bg-title">([\s\S]*?)<\/div>/);
  if (titleMatch) {
    const spans = [...titleMatch[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => stripTags(x[1]));
    const lvlRole = spans[1] ?? "";
    const lm = lvlRole.match(/(\d+)\s*级/);
    if (lm) meta.level = lm[1];
    const sp = lvlRole.match(new RegExp(SPECIALTY_WORDS.join("|")));
    meta["specialty-role"] = sp ? sp[0] : "";
    meta.role =
      lvlRole
        .replace(/\d+\s*级/, "")
        .replace(new RegExp(SPECIALTY_WORDS.join("|")), "")
        .trim() || undefined;
  }
  const sizeMatch = html.match(/<div class=bg-title>([\s\S]*?)<\/div>/);
  if (sizeMatch) {
    const spans = [...sizeMatch[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => stripTags(x[1]));
    const parts = (spans[0] ?? "").split(/\s+/).filter(Boolean);
    if (parts.length >= 1) meta.size = parts[0];
    if (parts.length >= 2) meta.origin = parts[1];
    if (parts.length >= 3) meta["creature-type"] = parts.slice(2).join(" ");
    const xpM = (spans[1] ?? "").match(/XP\s*([\d,]+)/);
    if (xpM) meta.xp = xpM[1].replace(/,/g, "");
  }
  return meta;
}

/** 旧库条目 → 统一格式（已有顶层字段则优先，否则从 HTML 提取） */
function legacyToEntry(e) {
  const meta = extractMetaFromHtml(e.sourceText);
  const out = {
    id: e.id,
    name: e.name,
    ...(e.nameEn ? { nameEn: e.nameEn } : {}),
    category: "creature",
    tags: Array.isArray(e.tags) ? e.tags : String(e.tags ?? "").split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    ...(e.source ? { source: e.source } : {}),
    ...(e.magazine ? { magazine: e.magazine } : {}),
    sourceText: e.sourceText,
  };
  for (const k of META_KEYS) {
    const top = e[k];
    const v = top !== undefined && top !== null && top !== "" ? String(top) : meta[k];
    if (v !== undefined) out[k] = v;
  }
  if (out["specialty-role"] === undefined) out["specialty-role"] = "";
  return out;
}

/** 新库原始条目 → 统一格式 */
function rawToEntry(t) {
  const { name, nameEn } = splitName(t.title);
  const out = {
    id: t.title,
    name,
    ...(nameEn ? { nameEn } : {}),
    category: "creature",
    tags: String(t.tags ?? "").split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    source: t.source,
    sourceText: renderText(t.text, t),
  };
  for (const k of META_KEYS) {
    const v = t[k];
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  if (out["specialty-role"] === undefined) out["specialty-role"] = "";
  return out;
}

// ---------- 读取输入 ----------

const legacyEntries = JSON.parse(readFileSync(destFile, "utf8")).map(legacyToEntry);

const newFiles = [];
for (const book of NEW_BOOKS) {
  const dir = join(monsterRoot, book);
  if (!existsSync(dir)) {
    console.warn("[import-creatures] 缺失分册目录 " + dir + "，跳过");
    continue;
  }
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const t = JSON.parse(readFileSync(join(dir, f), "utf8"))[0];
    if (!t || !t.title || !t.text) {
      console.warn("[import-creatures] 跳过无效文件 " + book + "/" + f);
      continue;
    }
    newFiles.push({ file: book + "/" + f, raw: t });
  }
}

// ---------- 新库内部去重（同 title 保留更完整版本） ----------

const groups = new Map();
for (const it of newFiles) {
  const arr = groups.get(it.raw.title) ?? [];
  arr.push(it);
  groups.set(it.raw.title, arr);
}

/** 评分：有效解析优先 > 威能数 > 速度值齐全 > 正文长度 */
function score(entry) {
  const s = parseCreature(entry);
  const powers = (entry.sourceText.match(/✦/g) ?? []).length;
  const speedOk = /''速度''\s*\d+/.test(entry.sourceText) ? 5 : 0;
  return (s ? 1000 : 0) + powers * 10 + speedOk + entry.sourceText.length / 100;
}

const newDedup = [];
const internalDrops = [];
for (const [title, arr] of groups) {
  if (arr.length === 1) {
    newDedup.push(arr[0]);
    continue;
  }
  const scored = arr
    .map((it) => {
      const entry = rawToEntry(it.raw);
      return { it, entry, sc: score(entry) };
    })
    .sort((a, b) => b.sc - a.sc);
  newDedup.push(scored[0].it);
  for (const rest of scored.slice(1)) {
    internalDrops.push({ title, file: rest.it.file, keepFile: scored[0].it.file });
  }
}

// ---------- 新旧合并（title 冲突判定） ----------

const map = new Map(); // id -> { entry, origin }
for (const e of legacyEntries) map.set(e.id, { entry: e, origin: "legacy" });

const overlapLog = [];
for (const it of newDedup) {
  const e = rawToEntry(it.raw);
  const prev = map.get(e.id);
  if (!prev) {
    map.set(e.id, { entry: e, origin: "new" });
    continue;
  }
  const oldStat = !!parseCreature(prev.entry);
  const newStat = !!parseCreature(e);
  if (oldStat && newStat) {
    // 双方都是完整属性块 → 同一只怪物，保留新数据（最新导出）
    overlapLog.push({
      id: e.id,
      action: "合并（旧→新）",
      reason: "旧库为完整属性块，与新库为同一只怪物，保留新数据",
      oldSource: prev.entry.source,
      newSource: e.source,
    });
    map.set(e.id, { entry: e, origin: "new" });
  } else if (!oldStat) {
    // 旧为召唤物/模板（非完整属性块）→ 数据不同，两条都保留，旧 id 加后缀
    const suffixed = prev.entry.id + "（召唤）";
    overlapLog.push({
      id: e.id,
      action: "两条保留",
      reason: "旧库为召唤物属性（非完整属性块），数据不同；旧条目 id 加「（召唤）」后缀保留",
      oldSource: prev.entry.source,
    });
    map.delete(e.id);
    map.set(suffixed, { entry: { ...prev.entry, id: suffixed }, origin: "legacy-summon" });
    map.set(e.id, { entry: e, origin: "new" });
  } else {
    // 两者都非完整属性块（罕见）→ 保留新
    overlapLog.push({ id: e.id, action: "保留新", reason: "旧库条目非完整属性块" });
    map.set(e.id, { entry: e, origin: "new" });
  }
}

// ---------- 输出 ----------

const merged = [...map.values()].map((x) => x.entry);
merged.sort((a, b) => String(a.source).localeCompare(String(b.source)) || a.id.localeCompare(b.id, "zh"));
mkdirSync(join(root, "public", "data"), { recursive: true });
writeFileSync(destFile, JSON.stringify(merged));

// ---------- 解析核对（供报告与人工复核） ----------

const parseOk = [];
const parseFail = [];
for (const e of merged) {
  const s = parseCreature(e);
  if (s) parseOk.push(e);
  else parseFail.push(e);
}

// ---------- 差异报告 ----------

const L = [];
L.push("# 怪物库导入报告（旧数据 与 最新怪物数据 格式统一）");
L.push("");
L.push(`生成时间：${new Date().toISOString()}`);
L.push("");
L.push("## 一、格式差异（旧 vs 新）");
L.push("");
L.push("| 维度 | 旧数据 creature.json | 新数据 怪物数据/*.json | 统一后 |");
L.push("| --- | --- | --- | --- |");
L.push("| 形态 | 单文件数组 | 每怪物一个 JSON 文件（TiddlyWiki 导出） | 单文件数组 |");
L.push("| 顶层字段 | id/name/nameEn/category/tags/source/sourceText/fields/wiki | title/text/level/role/specialty-role/size/origin/creature-type/xp/… | 统一为 id/name/nameEn/category/tags/source/sourceText + 7 个结构化字段 |");
L.push("| 正文 | sourceText 已渲染（值已烘焙） | text 含 `{{!!字段}}` 模板占位 | 全部已渲染、无占位 |");
L.push("| 生命值标签 | `''生命值''` | `''HP''` | 统一 `''生命值''`（解析器依赖） |");
L.push("| tags | 数组 | 字符串 | 统一数组 |");
L.push("| 结构化元数据（等级/角色/体型/起源/类型/XP） | 无，埋于 HTML | 有顶层字段 | 旧数据从 HTML 提取补齐，两库一致 |");
L.push("| 额外字段 | fields/wiki/magazine | created/creator/modified/…（wiki 元数据） | 仅保留 magazine（旧库有则留），其余为库无关元数据不保留 |");
L.push("");
L.push("## 二、导入统计");
L.push("");
L.push(`| 项目 | 数量 |`);
L.push(`| --- | --- |`);
L.push(`| 旧库条目 | ${legacyEntries.length} |`);
L.push(`| 新数据文件 | ${newFiles.length}（唯一标题 ${groups.size}） |`);
L.push(`| 新库内部重名（同 title） | ${internalDrops.length} 个（保留更完整版本） |`);
L.push(`| 新旧 title 冲突 | ${overlapLog.length} 个 |`);
L.push(`| 合并后总数 | ${merged.length} |`);
L.push(`| 解析成功（可加入遭遇） | ${parseOk.length} |`);
L.push(`| 解析失败（召唤物/模板等，仅存档） | ${parseFail.length} |`);
L.push("");
L.push("## 三、新旧 title 冲突处理明细");
L.push("");
if (overlapLog.length === 0) L.push("无。");
else {
  L.push("| 名称 | 处理 | 原因 |");
  L.push("| --- | --- | --- |");
  for (const o of overlapLog) L.push(`| ${o.id} | ${o.action} | ${o.reason}（旧源 ${o.oldSource ?? "-"}${o.newSource ? " / 新源 " + o.newSource : ""}） |`);
}
L.push("");
L.push("## 四、新库内部重名处理明细（保留更完整版本）");
L.push("");
if (internalDrops.length === 0) L.push("无。");
else {
  L.push("| 名称 | 保留 | 丢弃 |");
  L.push("| --- | --- | --- |");
  for (const d of internalDrops) L.push(`| ${d.title} | ${d.keepFile} | ${d.file} |`);
}
L.push("");
L.push("## 五、解析失败条目（仅存档、不可加入遭遇）");
L.push("");
const failSummary = parseFail.map((e) => `- ${e.id}（${e.source ?? "无来源"}）`).join("\n");
L.push(failSummary || "无。");
L.push("");
L.push("## 六、遗留说明");
L.push("");
L.push("- 杂兵（HP 1）解析修复：monsterParse.ts 已改为 bloodied 兜底 ≥1，杂兵可正常加入遭遇。");
L.push("- 新库正文的 `''豁免''/''行动点''`、`''感官''` 等行解析器暂不消费，不影响属性块主数据。");
L.push("- 解析失败项多为召唤物/模板（旧库原有行为），如需使用可后续单独补数据。");
writeFileSync(reportFile, L.join("\n"), "utf8");

// ---------- 控制台摘要 ----------

console.log(`[import-creatures] 旧库 ${legacyEntries.length} → 合并 ${merged.length}（新 ${groups.size} 唯一标题 / 新库内部去重 ${internalDrops.length} / 新旧冲突 ${overlapLog.length}）`);
console.log(`[import-creatures] 解析成功 ${parseOk.length}，失败 ${parseFail.length}`);
console.log(`[import-creatures] 已写出 ${destFile}`);
console.log(`[import-creatures] 报告 → ${reportFile}`);
