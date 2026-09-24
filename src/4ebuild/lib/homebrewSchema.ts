import type { Entry } from "../data/types";
import { wikiToHtml } from "./wikirender";
import { mdToHtml } from "./markdown";

// 私设编辑器：schema 驱动的表单定义。每种分类对应一批可表单化的标量字段。
// 正文统一走 sourceText，默认 Markdown（bodyFormat="md"）；旧条目的 wikitext 正文（bodyFormat="wiki"）继续按原语法渲染。
// 保存时派生 details，使 EntryCard 与预览都能完整渲染。

/** 按正文格式渲染 HTML。 */
export function renderBody(src: string, format: "md" | "wiki", fields: Record<string, string> = {}): string {
  return format === "wiki" ? wikiToHtml(src, fields) : mdToHtml(src);
}

const WIKI_MARKS = [/^!{1,4}\s/m, /''[^']+''/, /\/\/[^/\n]+\/\//, /\[\[[^\]]+\]\]/, /\{\{!!/];

/** 判断条目正文格式：优先看标记，其次按旧 wikitext 特征推断。 */
export function detectBodyFormat(entry: Entry): "md" | "wiki" {
  if (entry.bodyFormat === "md" || entry.bodyFormat === "wiki") return entry.bodyFormat;
  const src = entry.sourceText ?? "";
  return WIKI_MARKS.some((re) => re.test(src)) ? "wiki" : "md";
}

export type FieldType = "text" | "longtext" | "select" | "tags";

export interface SheetField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  required?: boolean;
}

const COMMON: SheetField[] = [
  { key: "name", label: "名称", type: "text", placeholder: "必填", required: true },
  { key: "nameEn", label: "英文名", type: "text", placeholder: "可选" },
  { key: "category", label: "分类", type: "select", required: true },
  { key: "tags", label: "标签", type: "tags", placeholder: "用逗号分隔" },
  { key: "source", label: "出处", type: "text", placeholder: "默认：私设" },
  { key: "sourceText", label: "正文", type: "longtext", placeholder: "支持 Markdown 语法使用。" },
];

const CATEGORY_FIELDS: Record<string, SheetField[]> = {
  power: [
    { key: "powerType", label: "类型", type: "select", options: ["攻击", "辅助"] },
    { key: "usageZh", label: "再生频率", type: "text", placeholder: "如：随意" },
    { key: "usage", label: "频率代码", type: "select", options: ["at-will", "encounter", "daily", "utility"] },
    { key: "actionType", label: "动作", type: "text", placeholder: "如：标准动作" },
    { key: "level", label: "等级", type: "text" },
    { key: "keywords", label: "关键词", type: "text" },
    { key: "range", label: "射程/范围", type: "text" },
  ],
  equipment: [
    { key: "itemCategory", label: "类别", type: "select", options: ["武器", "护甲", "法器", "消耗品", "冒险装备", "座驾", "奇物"] },
    { key: "itemLevel", label: "物品等级", type: "text" },
    { key: "rarity", label: "稀有度", type: "select", options: ["常见", "珍稀", "稀有"] },
    { key: "group", label: "分类组", type: "text", placeholder: "如：重型刀剑" },
    { key: "enh", label: "增强加值", type: "text" },
    { key: "cost", label: "价格", type: "text" },
    { key: "weight", label: "重量", type: "text" },
    { key: "critical", label: "重击", type: "text" },
    { key: "power", label: "威能", type: "longtext" },
  ],
  feat: [
    { key: "tierZh", label: "层级", type: "select", options: ["英雄", "典范", "天命", "史诗"] },
    { key: "featType", label: "专长类型", type: "text", placeholder: "如：职业专长" },
  ],
  race: [
    { key: "size", label: "体型", type: "text" },
    { key: "speed", label: "速度", type: "text" },
    { key: "vision", label: "视觉", type: "text" },
    { key: "abilityOne", label: "出生奖励属性1", type: "text" },
    { key: "abilityTwo", label: "出生奖励属性2", type: "text" },
    { key: "skill", label: "技能", type: "text" },
  ],
  class: [
    { key: "role", label: "职责", type: "text" },
    { key: "powerSource", label: "威能来源", type: "text" },
    { key: "keySkill", label: "关键技能", type: "text" },
  ],
};

// 分类下拉：官方主要分类（顺序与词条页一致）
export const CATEGORY_LIST: string[] = [
  "power", "equipment", "feat", "race", "class", "paragon-path", "epic-destiny",
  "item-set", "ritual", "theme", "domain", "magic-school", "pact", "vice",
  "virtue", "bloodline", "creature", "reference", "dictionary",
];

export function fieldsFor(cat: string): SheetField[] {
  return [...COMMON, ...(CATEGORY_FIELDS[cat] ?? [])];
}

function splitTags(s: string): string[] {
  return s
    .split(/[，,、]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// 草稿/表单值 → Entry。existingId 用于编辑时保留原 id。
export function buildEntry(form: Record<string, string>, existingId?: string): { ok: true; entry: Entry } | { ok: false; error: string } {
  const name = (form.name ?? "").trim();
  const cat = (form.category ?? "").trim();
  if (!name) return { ok: false, error: "请填写名称" };
  if (!cat) return { ok: false, error: "请选择分类" };

  const extras: Record<string, string> = {};
  for (const f of fieldsFor(cat)) {
    const v = (form[f.key] ?? "").trim();
    if (f.type === "tags" || f.key === "name" || f.key === "nameEn" || f.key === "category" || f.key === "source" || f.key === "sourceText" || !v) continue;
    extras[f.key] = v;
  }
  for (const f of CATEGORY_FIELDS[cat] ?? []) {
    const v = (form[f.key] ?? "").trim();
    if (v) extras[f.key] = v;
  }

  const sourceText = form.sourceText ?? "";
  const bodyFormat: "md" | "wiki" = form.bodyFormat === "wiki" ? "wiki" : "md";
  const entry: Entry = {
    id: existingId?.trim() || name,
    name,
    nameEn: (form.nameEn ?? "").trim() || undefined,
    category: cat,
    tags: splitTags(form.tags ?? ""),
    origin: "user",
    source: (form.source ?? "").trim() || "私设",
    sourceText,
    bodyFormat,
    fields: extras,
    wiki: { transclusions: [], links: [], macros: [], headings: [] },
    details: sourceText ? renderBody(sourceText, bodyFormat, extras) : undefined,
    ...extras,
  };
  return { ok: true, entry };
}

export function draftToForm(entry: Entry): Record<string, string> {
  const form: Record<string, string> = {
    name: entry.name ?? "",
    nameEn: entry.nameEn ?? "",
    category: entry.category ?? "",
    tags: (entry.tags ?? []).join(", "),
    source: entry.source ?? "",
    sourceText: entry.sourceText ?? "",
    bodyFormat: detectBodyFormat(entry),
  };
  for (const f of CATEGORY_FIELDS[entry.category] ?? []) {
    const v = (entry as Record<string, unknown>)[f.key];
    form[f.key] = typeof v === "string" ? v : "";
  }
  return form;
}