// 官方规则色：威能/物品固定配色，不随全局动态取色变化
export const POWER_COLORS = {
  atWill: "#2aa738",      // 随意威能
  encounter: "#9d010a",   // 遭遇威能
  daily: "#776c66",       // 每日威能
  utility: "#1a1a1a",     // 辅助威能（官方深墨色，可调整）
} as const;

export const ITEM_COLOR = "#f39700"; // 物品

export const FEAT_COLOR = "#0c3388"; // 专长

export type PowerCategoryKey = "at-will" | "encounter" | "daily" | "utility" | "special" | "other";

export const POWER_CATEGORIES: { key: PowerCategoryKey; label: string; color: string }[] = [
  { key: "at-will", label: "随意威能", color: POWER_COLORS.atWill },
  { key: "encounter", label: "遭遇威能", color: POWER_COLORS.encounter },
  { key: "daily", label: "每日威能", color: POWER_COLORS.daily },
  { key: "utility", label: "辅助威能", color: POWER_COLORS.utility },
  { key: "special", label: "种族/职业威能", color: POWER_COLORS.daily },
  { key: "other", label: "其他威能", color: POWER_COLORS.daily },
];

export function powerCategory(usage?: string, powerKind?: string): PowerCategoryKey {
  // 特性类威能：种族威能 / 专长威能 / 特性威能 / 套装威能
  if (powerKind === "racial" || powerKind === "feat" || powerKind === "feature" || powerKind === "item-set") {
    return "special";
  }
  if (powerKind === "utility") return "utility";
  if (usage === "at-will") return "at-will";
  if (usage === "encounter") return "encounter";
  if (usage === "daily") return "daily";
  return "other";
}
