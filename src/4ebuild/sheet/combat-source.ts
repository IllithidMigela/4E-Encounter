// 攻击/伤害面板的数值来源收集：职业特性（攻击骰）与已选专长（攻击骰/伤害骰），
// 供「职业加值」「专长加值」单元格点击后选择，自动把提取的数值填入单元格。
import type { Entry } from "../data/types";
import { parseFeatureSections } from "../lib/wikirender";
import { stripWiki } from "../lib/text";

// 一条可选来源（职业特性 / 专长）
export interface CombatSource {
  label: string; // 来源名称（职业特性标题 / 专长名）
  value: number; // 按角色等级选取的加值
  text?: string; // 完整描述（悬浮提示）
}

// 按标点切句（保留句读，便于定位含关键词的句子）
function sentencesOf(text: string): string[] {
  return text.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) ?? [text];
}

// 从整段文本提取加值：优先按角色等级取 11/21 级档位，否则取基础档（第一个 +/-数字）
export function extractBonus(text: string, level: number): number | undefined {
  const lv21 = text.match(/21级(?:时)?[:：为]?\s*([+-]?\d+)/);
  const lv11 = text.match(/11级(?:时)?[:：为]?\s*([+-]?\d+)/);
  if (level >= 21 && lv21) return parseInt(lv21[1], 10);
  if (level >= 11 && lv11) return parseInt(lv11[1], 10);
  const baseText = text.replace(/1[12]级(?:时)?[:：为]?\s*[+-]?\d+/g, "");
  const m = baseText.match(/[+\-]?\d+/);
  return m ? parseInt(m[0], 10) : undefined;
}

// 在含关键词的句子上提取加值；档位标注（11/21级）允许出现在整段的其他句子中
export function extractBonusNearKeyword(fullText: string, keyword: string, level: number): number | undefined {
  const sentences = sentencesOf(fullText);
  const target = sentences.find((s) => s.includes(keyword));
  if (!target) return undefined;
  const lv21 = fullText.match(/21级(?:时)?[:：为]?\s*([+-]?\d+)/);
  const lv11 = fullText.match(/11级(?:时)?[:：为]?\s*([+-]?\d+)/);
  if (level >= 21 && lv21) return parseInt(lv21[1], 10);
  if (level >= 11 && lv11) return parseInt(lv11[1], 10);
  const baseText = target.replace(/1[12]级(?:时)?[:：为]?\s*[+-]?\d+/g, "");
  const m = baseText.match(/[+\-]?\d+/);
  return m ? parseInt(m[0], 10) : undefined;
}

// 职业特性来源：解析「!! 标题」段，筛选正文含关键词的（如「攻击骰」）
export function collectClassSources(texts: (string | undefined)[], keyword: string, level: number): CombatSource[] {
  const out: CombatSource[] = [];
  for (const text of texts) {
    if (!text) continue;
    const { sections } = parseFeatureSections(text);
    for (const s of sections) {
      if (!s.body || !s.body.includes(keyword)) continue;
      const value = extractBonusNearKeyword(s.body, keyword, level);
      out.push({ label: s.title, value: value ?? 0, text: stripWiki(s.body) });
    }
  }
  return out;
}

// 已选专长来源：筛选 benefit 含关键词的（攻击面板用「攻击骰」，伤害面板用「伤害骰」）
export function collectFeatSources(feats: (Entry | undefined)[], keyword: string, level: number): CombatSource[] {
  const out: CombatSource[] = [];
  for (const f of feats) {
    if (!f) continue;
    const benefit = stripWiki(f.benefit ?? "").replace(/<br\s*\/?>/gi, " ");
    if (!benefit.includes(keyword)) continue;
    const value = extractBonusNearKeyword(benefit, keyword, level);
    out.push({ label: f.name, value: value ?? 0, text: benefit });
  }
  return out;
}
