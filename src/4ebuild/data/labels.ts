// 分类展示顺序（与词条页 / manifest 一致），供私设页分类管理与统计复用
export const CATEGORY_ORDER: string[] = [
  "race", "class", "paragon-path", "epic-destiny", "feat", "power", "equipment",
  "item-set", "ritual", "theme", "domain", "magic-school", "pact", "vice",
  "virtue", "bloodline", "creature", "reference", "dictionary",
];

export const CATEGORY_LABELS: Record<string, string> = {
  race: "种族",
  class: "职业",
  "paragon-path": "典范之道",
  "epic-destiny": "传奇天命",
  feat: "专长",
  power: "威能",
  equipment: "装备",
  "item-set": "物品套装",
  ritual: "仪式",
  theme: "主题",
  domain: "领域",
  "magic-school": "魔法学派",
  pact: "契约",
  vice: "败德",
  virtue: "美德",
  bloodline: "血统",
  creature: "生物",
  reference: "术语",
  dictionary: "译名字典",
};
