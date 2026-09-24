// 效果文本实时校验 / 建议 / 输入预测（effectValidation）
// ============================================================
// 复用 monsterParse 的逐句语义化（matchEffectSentence / parsePowerEffects）：
//  - validateEffectText   → 逐句报告（每句 coverage + 未识别短语），供 UI 高亮
//  - computeCoverage      → 整体 coverage + unparsed，供写回 AttackOption 字段
//  - suggestForSentence   → 对未识别句给"是否想写…"建议（按积木 pattern 前缀重叠度）
//  - predict              → 输入预测：光标前片段前缀匹配积木 pattern + 归一词典同义前缀
import type { EffectSpec } from "./types";
import { parsePowerEffects, matchEffectSentence } from "./monsterParse";
import { EFFECT_BLOCKS } from "./effectTemplates";

export interface SentenceReport {
  /** 句原文（含引导词，如「命中：…」） */
  text: string;
  specs: EffectSpec[];
  cov: "fully" | "partial" | "manual";
  /** 未识别短语（manual 的 raw） */
  unparsed: string[];
}

/** 复制 parsePowerEffects 的括号保护 + 切句逻辑，逐句出报告（不含「攻击：」攻击行）。 */
export function validateEffectText(text: string): SentenceReport[] {
  const guards: string[] = [];
  const masked = (text ?? "").replace(/（[^）]*）/g, (m) => {
    guards.push(m);
    return `\u0000${guards.length - 1}\u0000`;
  });
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => guards[+i] ?? "");
  return masked
    .split(/[。；;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(restore)
    .map((raw) => {
      const specs = matchEffectSentence(raw);
      const manuals = specs.filter((s) => s.kind === "manual");
      const cov: SentenceReport["cov"] =
        specs.length === 0 || manuals.length === 0
          ? "fully"
          : manuals.length === specs.length
            ? "manual"
            : "partial";
      return { text: raw, specs, cov, unparsed: manuals.map((s) => s.raw) };
    });
}

/** 整体 coverage（规则与 monsterParse.setAuraSpecs 一致），用于写回 AttackOption。 */
export function computeCoverage(text: string): {
  coverage: "fully" | "partial" | "manual";
  unparsed?: string[];
} {
  const { specs } = parsePowerEffects(text);
  const manuals = specs.filter((s) => s.kind === "manual");
  if (specs.length === 0 || manuals.length === 0) return { coverage: "fully" };
  if (manuals.length === specs.length) return { coverage: "manual", unparsed: manuals.map((s) => s.raw) };
  return { coverage: "partial", unparsed: manuals.map((s) => s.raw) };
}

/** 积木 pattern 的短语骨架（去 {param} 占位） */
function skeleton(b: { pattern: string }): string {
  return b.pattern.replace(/\{[^}]+\}/g, "").trim();
}

/** 对一句文本给"是否想写…"建议：manual/partial 句 → 按积木骨架前缀重叠 + 句中动词短语命中取 Top N。 */
export function suggestForSentence(sentence: string, limit = 3): { block: string; label: string; insert: string }[] {
  const s = sentence
    .replace(/^命中：|^效果：|^未命中：|^失手：|^后续效果：|^维持(?:次要)?：|^次要维持[^：:]*：/, "")
    .trim();
  if (!s) return [];
  const scored = EFFECT_BLOCKS.map((b) => {
    const pat = skeleton(b);
    // 骨架去掉尾部「格」后的动词短语核（如「目标被推离」），句中命中即高权重
    const core = pat.replace(/格$/, "");
    let score = 0;
    const max = Math.min(s.length, pat.length);
    for (let i = 0; i < max && s[i] === pat[i]; i++) score++;
    if (s.length > 0 && pat.startsWith(s)) score += pat.length;
    if (core.length >= 3 && s.includes(core)) score += pat.length;
    return { b, score };
  })
    .filter((x) => x.score >= 4)
    .sort((a, b2) => b2.score - a.score);
  return scored.slice(0, limit).map((x) => ({ block: x.b.name, label: x.b.name, insert: x.b.toText(x.b.defaults) }));
}

/** 归一词典同义前缀（扩大预测召回：击退/推动=推离、滑动=滑移、瞬移=传送…） */
const SYN_ALIASES: { key: string; id: string; label: string; insert: string }[] = [
  { key: "推", id: "push", label: "推离（推）", insert: "目标被推离" },
  { key: "击退", id: "push", label: "推离（击退）", insert: "目标被推离" },
  { key: "推动", id: "push", label: "推离（推动）", insert: "目标被推离" },
  { key: "拉", id: "pull", label: "拉近（拉）", insert: "目标被拉近" },
  { key: "拖近", id: "pull", label: "拉近（拖近）", insert: "目标被拉近" },
  { key: "滑", id: "slide", label: "滑移（滑）", insert: "目标被滑移" },
  { key: "滑动", id: "slide", label: "滑移（滑动）", insert: "目标被滑移" },
  { key: "瞬移", id: "teleport", label: "传送（瞬移）", insert: "目标被传送" },
];

export interface PredictItem {
  id: string;
  label: string;
  insert: string;
}

/** 输入预测：取光标前最后一句片段，去掉引导词前缀后前缀匹配积木 pattern（双向）+ 同义前缀。 */
export function predict(text: string, cursor: number, limit = 5): PredictItem[] {
  const before = (text ?? "").slice(0, cursor);
  const fragment = before
    .split(/[。；;]/)
    .pop()?.trim()
    .replace(/^命中：|^效果：|^未命中：|^失手：|^后续效果：|^维持(?:次要)?：|^次要维持[^：:]*：/, "")
    .trim() ?? "";
  if (!fragment) return [];
  const out: PredictItem[] = [];
  for (const b of EFFECT_BLOCKS) {
    const pat = skeleton(b);
    if (pat.startsWith(fragment) || fragment.startsWith(pat)) {
      out.push({ id: b.id, label: b.name, insert: b.toText(b.defaults) });
      if (out.length >= limit) return out;
    }
  }
  for (const a of SYN_ALIASES) {
    if (out.length >= limit) break;
    if (fragment.startsWith(a.key)) out.push({ id: a.id, label: a.label, insert: a.insert });
  }
  return out.slice(0, limit);
}

/** 语法提示的占位符 → 中文友好显示 */
export const PLACEHOLDER_ZH: Record<string, string> = {
  v: "N",
  type: "类型",
  state: "状态",
};

export interface GrammarHint {
  id: string;
  /** 积木名（如 推离 / 持续伤害） */
  label: string;
  /** 积木 pattern 骨架（含 {v}/{type} 占位），即模拟器可识别的语法 */
  pattern: string;
  /** 已输入前缀命中的字符数（相对骨架），用于高亮"已写到哪" */
  cover: number;
  /** 点按后追加的规范句 */
  insert: string;
}

/** 语法提示：取光标前片段 → 正在书写的积木语法骨架（含占位符），预览"下一步写什么"。 */
export function grammarHints(text: string, cursor: number, limit = 3): GrammarHint[] {
  const before = (text ?? "").slice(0, cursor);
  const fragment = before
    .split(/[。；;]/)
    .pop()?.trim()
    .replace(/^命中：|^效果：|^未命中：|^失手：|^后续效果：|^维持(?:次要)?：|^次要维持[^：:]*：/, "")
    .trim() ?? "";
  if (!fragment) return [];
  const out: GrammarHint[] = [];
  for (const b of EFFECT_BLOCKS) {
    const sk = skeleton(b);
    if (sk.startsWith(fragment) || fragment.startsWith(sk)) {
      let cover = 0;
      const max = Math.min(fragment.length, sk.length);
      for (let i = 0; i < max && fragment[i] === sk[i]; i++) cover = i + 1;
      out.push({ id: b.id, label: b.name, pattern: b.pattern, cover, insert: b.toText(b.defaults) });
      if (out.length >= limit) break;
    }
  }
  return out;
}
