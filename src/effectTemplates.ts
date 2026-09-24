// 效果积木模板库（effectTemplates）
// ============================================================
// 把「中文效果短语」做成可拼装的积木块：
//  - toText(params)   → 生成规范中文句（保证被 monsterParse.matchEffectSentence 识别）
//  - pattern          → 输入预测用短语骨架（{param} 占位当通配）
//  - assertKind       → 自检断言：生成句应被识别为哪些 kind
// 语料依据：《怪物卡文本语法与例外.md》§5.2 引导词 / §5.3 目标前缀 / 归一词典。
import { DAMAGE_TYPE_ZH } from "./types";
import { matchEffectSentence } from "./monsterParse";

export type BlockCategory =
  | "伤害"
  | "持续"
  | "移动"
  | "状态"
  | "增益"
  | "治疗"
  | "灵气"
  | "区域"
  | "传送"
  | "临时"
  | "特殊";

export interface BlockParam {
  key: string;
  label: string;
  type: "number" | "select" | "text";
  options?: string[];
}

export interface EffectBlock {
  id: string;
  name: string;
  category: BlockCategory;
  params: BlockParam[];
  defaults: Record<string, string | number>;
  /** 预测用短语骨架：{param} 占位当通配 */
  pattern: string;
  /** 参数 → 规范中文句 */
  toText: (p: Record<string, string | number>) => string;
  /** 生成句应被识别为的 kind（自检断言） */
  assertKind: string[];
}

/** 伤害类型选项（取 DAMAGE_TYPE_ZH 键，归一词典已归一） */
export const DAMAGE_OPTIONS = Object.keys(DAMAGE_TYPE_ZH);

/** 可施放状态子集（中文名，须命中 monsterParse.CONDITION_ZH） */
export const CONDITION_OPTIONS = [
  "晕眩",
  "定身",
  "迟缓",
  "束缚",
  "目盲",
  "支配",
  "石化",
  "虚弱",
  "耳聋",
  "被标记",
  "震慑",
];

/** 首批 16 块积木：全部落在 matchEffectSentence 已支持的语义 */
export const EFFECT_BLOCKS: EffectBlock[] = [
  {
    id: "ongoing",
    name: "持续伤害",
    category: "持续",
    params: [
      { key: "v", label: "数值", type: "number" },
      { key: "type", label: "伤害类型", type: "select", options: DAMAGE_OPTIONS },
    ],
    defaults: { v: 5, type: "火焰" },
    pattern: "目标受到{v}点持续{type}伤害",
    toText: (p) => `目标受到${p.v}点持续${p.type}伤害（豁免终止）`,
    assertKind: ["ongoing"],
  },
  {
    id: "push",
    name: "推离",
    category: "移动",
    params: [{ key: "v", label: "格数", type: "number" }],
    defaults: { v: 2 },
    pattern: "目标被推离{v}格",
    toText: (p) => `目标被推离${p.v}格`,
    assertKind: ["push"],
  },
  {
    id: "pull",
    name: "拉近",
    category: "移动",
    params: [{ key: "v", label: "格数", type: "number" }],
    defaults: { v: 2 },
    pattern: "目标被拉近{v}格",
    toText: (p) => `目标被拉近${p.v}格`,
    assertKind: ["pull"],
  },
  {
    id: "slide",
    name: "滑移",
    category: "移动",
    params: [{ key: "v", label: "格数", type: "number" }],
    defaults: { v: 2 },
    pattern: "目标被滑移{v}格",
    toText: (p) => `目标被滑移${p.v}格`,
    assertKind: ["slide"],
  },
  {
    id: "prone",
    name: "击倒",
    category: "状态",
    params: [],
    defaults: {},
    pattern: "目标倒地",
    toText: () => "目标倒地",
    assertKind: ["prone"],
  },
  {
    id: "tempHp",
    name: "临时生命",
    category: "临时",
    params: [{ key: "v", label: "数值", type: "number" }],
    defaults: { v: 5 },
    pattern: "目标获得{v}点临时生命值",
    toText: (p) => `目标获得${p.v}点临时生命值`,
    assertKind: ["tempHp"],
  },
  {
    id: "regeneration",
    name: "再生",
    category: "临时",
    params: [{ key: "v", label: "数值", type: "number" }],
    defaults: { v: 5 },
    pattern: "目标获得{v}点再生",
    toText: (p) => `目标获得${p.v}点再生`,
    assertKind: ["regeneration"],
  },
  {
    id: "heal",
    name: "治疗",
    category: "治疗",
    params: [{ key: "v", label: "数值", type: "number" }],
    defaults: { v: 5 },
    pattern: "目标恢复{v}点生命值",
    toText: (p) => `目标恢复${p.v}点生命值`,
    assertKind: ["heal"],
  },
  {
    id: "mark",
    name: "标记",
    category: "状态",
    params: [],
    defaults: {},
    pattern: "目标被标记",
    toText: () => "目标被标记（豁免终止）",
    assertKind: ["mark"],
  },
  {
    id: "teleport",
    name: "传送",
    category: "传送",
    params: [{ key: "v", label: "格数", type: "number" }],
    defaults: { v: 3 },
    pattern: "目标被传送{v}格",
    toText: (p) => `目标被传送${p.v}格`,
    assertKind: ["teleport"],
  },
  {
    id: "condition",
    name: "状态",
    category: "状态",
    params: [{ key: "state", label: "状态", type: "select", options: CONDITION_OPTIONS }],
    defaults: { state: "晕眩" },
    pattern: "目标获得{state}",
    toText: (p) => `目标获得${p.state}（豁免终止）`,
    assertKind: ["condition"],
  },
  {
    id: "grantCA",
    name: "战斗优势",
    category: "增益",
    params: [],
    defaults: {},
    pattern: "目标提供战斗优势",
    toText: () => "目标提供战斗优势（豁免终止）",
    assertKind: ["grantCA"],
  },
  {
    id: "defBuff",
    name: "全防加值",
    category: "增益",
    params: [{ key: "v", label: "数值", type: "number" }],
    defaults: { v: 2 },
    pattern: "目标在所有防御上获得+{v}加值",
    toText: (p) => `目标在所有防御上获得+${p.v}加值`,
    assertKind: ["buff"],
  },
  {
    id: "defPenalty",
    name: "全防减值",
    category: "增益",
    params: [{ key: "v", label: "数值", type: "number" }],
    defaults: { v: 2 },
    pattern: "目标在所有防御上受到-{v}减值",
    toText: (p) => `目标在所有防御上受到-${p.v}减值（豁免终止）`,
    assertKind: ["buff"],
  },
  {
    id: "atkPenalty",
    name: "攻击骰减值",
    category: "增益",
    params: [{ key: "v", label: "数值", type: "number" }],
    defaults: { v: 2 },
    pattern: "目标的攻击骰受到-{v}减值",
    toText: (p) => `目标的攻击骰受到-${p.v}减值（豁免终止）`,
    assertKind: ["buff"],
  },
  {
    id: "auraDamage",
    name: "灵气回合伤害",
    category: "灵气",
    params: [
      { key: "v", label: "数值", type: "number" },
      { key: "type", label: "伤害类型", type: "select", options: DAMAGE_OPTIONS },
    ],
    defaults: { v: 5, type: "火焰" },
    pattern: "任何在该灵气内开始回合的敌人受到{v}点{type}伤害",
    toText: (p) => `任何在该灵气内开始回合的敌人受到${p.v}点${p.type}伤害`,
    assertKind: ["auraDamage"],
  },
];

/** 按类别分组（保持 EFFECT_BLOCKS 内顺序） */
export function blocksByCategory(): { category: BlockCategory; blocks: EffectBlock[] }[] {
  const order: BlockCategory[] = ["伤害", "持续", "移动", "状态", "增益", "治疗", "灵气", "区域", "传送", "临时", "特殊"];
  const map = new Map<BlockCategory, EffectBlock[]>();
  for (const b of EFFECT_BLOCKS) {
    const arr = map.get(b.category);
    if (arr) arr.push(b);
    else map.set(b.category, [b]);
  }
  return order.filter((c) => map.has(c)).map((c) => ({ category: c, blocks: map.get(c)! }));
}

/**
 * 积木自检：每块用 defaults 生成句跑 matchEffectSentence，
 * 比对 assertKind 是否命中（用于开发期确认积木句措辞可被解析器识别）。
 */
export function selfCheckTemplates(): { block: string; got: string[]; ok: boolean }[] {
  return EFFECT_BLOCKS.map((b) => {
    const sentence = b.toText(b.defaults);
    const got = matchEffectSentence(sentence).map((s) => s.kind);
    const ok = b.assertKind.some((k) => got.includes(k as never));
    return { block: `${b.name}（${sentence}）`, got, ok };
  });
}
