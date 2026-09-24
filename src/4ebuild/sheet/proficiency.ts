// 武器擅长判定：从职业/种族/专长收集"擅长"条目，再匹配到具体武器。
// 4E 的擅长按"类别（简易/军用/优异 + 近战/远程 + 单手/双手）"、"武器组"或"具体武器名"授予。
import { BASE_WEAPONS, BASE_IMPLEMENTS, type BaseWeapon } from "../lib/baseitems";

// 武器组集合（与 baseitems-data 的 group 字段一致，用于按组授予擅长）
const WEAPON_GROUPS = new Set([
  "硬头锤", "轻刃", "矛", "徒手", "杖", "重刃", "斧", "连枷", "锤", "镐",
  "长武器", "鞭", "绞索", "弩", "投石索", "弓", "吹箭筒",
]);
const DIFFICULTIES = ["简易", "军用", "优异"] as const;
const WEAPON_TYPES = ["近战", "远程"] as const;
const HANDEDNESS = ["单手", "双手"] as const;

// 拥有优异法器的法器组（供「优异法器训练」选择）
const IMPL_GROUP_KEYS = ["圣徽", "法珠", "权杖", "法杖", "魔典", "图腾", "魔杖", "匕首", "气印"];
const SUPERIOR_IMPL_GROUPS = IMPL_GROUP_KEYS.filter((g) => BASE_IMPLEMENTS.some((im) => im.superior && im.name.includes(g)));

// 从「武器擅长：X」一行的值提取 token 列表（X 形如 "简易近战，军用重刃，绞索" 或 "你获得飞锤和战锤的擅长"）
export function extractProficiencyTokens(value: string): string[] {
  const v = value
    .replace(/^(你)?获得/, "")
    .replace(/的擅长\s*$/, "")
    .replace(/^所有/, "")
    .replace(/武器$/, "")
    .replace(/简易和军用/g, "简易，军用") // "简易和军用近战武器" → "简易，军用近战"
    .replace(/军用和优异/g, "军用，优异")
    .trim();
  return v.split(/[，,、和及与]+/).map((s) => s.trim()).filter(Boolean);
}

// 专长白名单：已知能明确授予武器/组/类别擅长的专长 → token 列表。
// 选择型专长（如「擅长武器」「战斗牧师武装」）无法自动判定，交给面板的手动"视为擅长"覆盖。
const FEAT_PROFICIENCY: Record<string, string[]> = {
  "矮人武器特训": ["斧", "锤"],
  "牛头人武器才能": ["战斧", "手斧", "战锤", "飞锤"],
  "侏儒武器训练": ["简易锤", "军用锤", "简易镐", "军用镐"],
  "索离诺尔标志": ["军用锤", "军用斧", "军用镐"],
  "雅灵士兵": ["矛"],
  "收割者之镰": ["镰刀", "巨镰"],
  "月弓潜行者": ["短弓"],
  "致力月弓": ["短弓"],
  "长鞭训练": ["长鞭"],
  "塔兰塔武器特训": ["塔兰塔回旋镖", "塔兰塔长镰", "塔兰塔弯刀"],
  "图拉斯武器特训": ["寇派斯弯刀", "多头鞭", "镰刀", "巨镰", "弯刀", "弯刃大刀"],
  "瓦伦纳武器特训": ["弯刀", "双头弯刀", "弯刃大刀"],
  "瓦伦纳骑手训练": ["简易矛", "军用矛"],
  "希恩德瑞克武器特训": ["卓尔长刀", "希恩德瑞克回旋镖"],
  "螳螂人武器大师": ["双头尖矛", "三刃镖"],
  "水沫聚合战士": ["捕网"],
  "偷袭之杖": ["木棍"],
  "小刀精通": ["反曲刀", "拳匕"],
  "天国戟兵": ["长柄刀", "长戟"],
};

// 专长名规范化：剥离消歧后缀（如 "长鞭训练 <兼职长鞭>" → "长鞭训练"），用于匹配白名单键。
// 数据中同名专长常带 <…> 来源/职业后缀以消歧，白名单仅存核心名。
const featBaseName = (name: string): string => name.replace(/\s*<[^>]*>\s*$/, "").trim();

// 选择型「擅长」专长：描述为「获得你选择的/其中之一的擅长」或「选择一种法器」，选后需弹面板让玩家挑选具体对象
export interface FeatOption { name: string; main: string; sub: string; }
export interface FeatChoice { cat: "weapon" | "implement"; label: string; options: FeatOption[]; implTier?: "basic" | "superior"; }

function weaponOptions(list: BaseWeapon[]): FeatOption[] {
  return list.map((w) => ({ name: w.name, main: w.dice, sub: w.traits && w.traits !== "—" ? w.traits : w.group }));
}
// 法器选项按「法器组」给出（name=组名），便于在 CharacterSheet 按组过滤法器池（含基础+优异法器）
function implementGroupOptions(groups: string[]): FeatOption[] {
  return groups.map((nm) => {
    const rep = BASE_IMPLEMENTS.find((x) => x.name === nm);
    return { name: nm, main: rep ? String(rep.price) + "gp" : "—", sub: nm + "法器" };
  });
}

export function featChoiceInfo(feat: { name: string }): FeatChoice | null {
  const n = featBaseName(feat.name);
  if (n === "擅长武器") return { cat: "weapon", label: "选择一把武器", options: weaponOptions(BASE_WEAPONS) };
  if (n === "战斗牧师武装") return { cat: "weapon", label: "选择一把军用武器", options: weaponOptions(BASE_WEAPONS.filter((w) => w.category.includes("军用"))) };
  if (n === "白莲决斗专精") return { cat: "implement", label: "选择一种法器", options: implementGroupOptions(["法珠", "权杖", "法杖", "魔杖"]), implTier: "basic" };
  if (n === "奥术法器擅长") return { cat: "implement", label: "选择一种奥术法器", options: implementGroupOptions(["法珠", "权杖", "法杖", "魔杖", "圣徽", "魔典", "图腾", "气印"]), implTier: "basic" };
  if (n === "优异法器训练") return { cat: "implement", label: "选择一种优异法器", options: implementGroupOptions(SUPERIOR_IMPL_GROUPS), implTier: "superior" };
  return null;
}

// 收集全部擅长 token：职业（含混职）/种族 的「武器擅长：」行 + 已选专长白名单 + 选择型专长的手动选择
export function collectProficiencyTokens(input: {
  classText?: string;  // 主职业 sourceText
  classText2?: string; // 混职第二职业 sourceText
  raceText?: string;   // 种族 sourceText
  featNames: string[]; // 已选专长名称
  featChoiceTokens?: string[]; // 选择型专长选定的武器/法器名（中文，含空格全名的中文部分）
}): Set<string> {
  const out = new Set<string>();
  const pushLines = (text?: string) => {
    if (!text) return;
    // 职业「武器擅长：」行 / 种族「XX武器擅长：」行（英文行跳过）
    for (const m of text.matchAll(/^''?[\u4e00-\u9fff]*武器擅长[：:]\s*''?([^\n]+)/gm)) {
      const val = m[1].trim();
      if (!/[\u4e00-\u9fff]/.test(val)) continue;
      for (const t of extractProficiencyTokens(val)) if (t) out.add(t);
    }
  };
  pushLines(input.classText);
  pushLines(input.classText2);
  pushLines(input.raceText);
  for (const name of input.featNames) {
    const tokens = FEAT_PROFICIENCY[featBaseName(name)];
    if (tokens) for (const t of tokens) out.add(t);
  }
  for (const t of input.featChoiceTokens ?? []) if (t) out.add(t);
  return out;
}

// 收集已擅长的法器组：职业（含混职）/种族「法器：」行 + 选择型法器专长选定的法器 → 法器组名列表
export function collectImplementGroups(input: {
  classText?: string;
  classText2?: string;
  raceText?: string;
  featChoices?: { cat: "weapon" | "implement"; item: string }[];
}): string[] {
  const groups = new Set<string>();
  const pushToken = (token: string) => {
    if (!token) return;
    const g = IMPL_GROUP_KEYS.find((k) => token.includes(k));
    if (g) groups.add(g);
  };
  const pushText = (text?: string) => {
    if (!text) return;
    const m = text.match(/^''?法器[：:]\s*''?([^\n]+)/m);
    if (m) m[1].split(/[，,、和及与]+/).forEach((t) => pushToken(t.trim()));
  };
  pushText(input.classText);
  pushText(input.classText2);
  pushText(input.raceText);
  for (const c of input.featChoices ?? []) if (c.cat === "implement") pushToken(c.item);
  return Array.from(groups);
}

// 单个 token 是否命中某武器（具体武器名 > 类别/组表达式）
function matchesToken(weapon: BaseWeapon, token: string): boolean {
  if (!token) return false;
  const cn = weapon.name.split(/\s/)[0]; // 中文名部分
  const diff = DIFFICULTIES.find((d) => token.includes(d));
  const type = WEAPON_TYPES.find((t) => token.includes(t));
  const hand = HANDEDNESS.find((h) => token.includes(h));
  // 组名：类别表达式（含难度/类型/持用）内嵌组名取子串（如"军用镐"→"镐"）；独立组名（如"锤"）要求精确匹配，避免"短弓"误匹配"弓"
  let group: string | undefined;
  if (diff || type || hand) {
    group = [...WEAPON_GROUPS].find((g) => token.includes(g));
  } else if (WEAPON_GROUPS.has(token)) {
    group = token;
  }
  if (diff || type || hand || group) {
    if (diff && !weapon.category.includes(diff)) return false;
    if (type && !weapon.category.includes(type)) return false;
    if (hand && !weapon.category.endsWith("·" + hand)) return false;
    if (group && !weapon.group.split(/[，,]/).includes(group)) return false;
    return true;
  }
  // 具体武器名：精确匹配中文名（如 token「匕首」仅匹配「匕首」，不含「格挡匕首」）
  return cn === token;
}

// 角色是否擅长某武器
export function isProficient(weapon: BaseWeapon, tokens: Set<string>): boolean {
  for (const t of tokens) if (matchesToken(weapon, t)) return true;
  return false;
}

// 角色是否满足「擅长 R」的武器前置（R 形如 "混用剑" / "单手锤" / "重刃" / "任意多用的斧"）
export function satisfiesWeaponProficiency(tokens: Set<string>, req: string): boolean {
  const clean = req.replace(/^(任意|所有)/, "").trim();
  if (!clean) return false;
  return BASE_WEAPONS.some((w) => matchesToken(w, clean) && isProficient(w, tokens));
}

// —— 护甲 / 盾牌擅长（用于专长前置「擅长鳞甲」判定）——
const LIGHT_ARMOR = new Set(["布甲", "皮甲", "革甲"]);
const HEAVY_ARMOR = new Set(["链甲", "鳞甲", "板甲"]);

function splitArmorLine(text: string, key: "防具" | "盾牌"): string[] {
  const re = key === "防具" ? /^''?防具擅长[：:]\s*''?([^\n]+)/gm : /^''?盾牌擅长[：:]\s*''?([^\n]+)/gm;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    for (const t of m[1].split(/[，,、]/)) { const s = t.trim(); if (s) out.push(s); }
  }
  return out;
}

// 由专长名提取其授予的防具/盾牌名（如「盔甲擅长：革甲」→「革甲」、「盾牌擅长：轻盾」→「轻盾」）
const ARMOR_FEAT_RE = /^盔甲擅长：([^\s<]+)/;
const SHIELD_FEAT_RE = /^盾牌擅长：([^\s<]+)/;
function featArmorTokens(name: string): string[] {
  const n = featBaseName(name);
  const m = n.match(ARMOR_FEAT_RE);
  return m ? [m[1]] : [];
}
function featShieldTokens(name: string): string[] {
  const n = featBaseName(name);
  const m = n.match(SHIELD_FEAT_RE);
  return m ? [m[1]] : [];
}

// 从职业（含混职）/种族 sourceText + 已选专长收集防具擅长 token
export function collectArmorTokens(classText?: string, classText2?: string, raceText?: string, featNames: string[] = []): Set<string> {
  const out = new Set<string>();
  for (const text of [classText, classText2, raceText]) { if (text) for (const t of splitArmorLine(text, "防具")) out.add(t); }
  for (const n of featNames) for (const t of featArmorTokens(n)) out.add(t);
  return out;
}
// 从职业（含混职）/种族 sourceText + 已选专长收集盾牌擅长 token
export function collectShieldTokens(classText?: string, classText2?: string, raceText?: string, featNames: string[] = []): Set<string> {
  const out = new Set<string>();
  for (const text of [classText, classText2, raceText]) { if (text) for (const t of splitArmorLine(text, "盾牌")) out.add(t); }
  for (const n of featNames) for (const t of featShieldTokens(n)) out.add(t);
  return out;
}

// 判断是否擅长某护甲/盾牌名（如 "鳞甲"/"轻盾"/"盾牌"）；护甲类别 token（轻甲/重甲/所有护甲）换算到具体护甲
export function armorProficient(armorTokens: Set<string>, shieldTokens: Set<string>, name: string): boolean {
  if (armorTokens.has(name) || shieldTokens.has(name) || armorTokens.has("所有护甲") || armorTokens.has("所有盔甲")) return true;
  if (name === "盾牌") return shieldTokens.has("轻盾") || shieldTokens.has("重盾");
  if (LIGHT_ARMOR.has(name)) return armorTokens.has("轻甲");
  if (HEAVY_ARMOR.has(name)) return armorTokens.has("重甲");
  return false;
}

// ---- 擅长总览（装备面板「擅长」弹窗展示用）----
export type ProfCategory = "武器" | "法器" | "防具";
export interface ProfGroup { cat: ProfCategory; items: string[]; }
export interface SourceProf { source: string; groups: ProfGroup[]; }

function textToItems(value: string): string[] {
  return value.split(/[，,、和及与]+/).map((s) => s.trim()).filter(Boolean);
}

// 从一段 sourceText 提取三种擅长（武器/防具/法器行）
function extractTextGroups(text: string): ProfGroup[] {
  const out: ProfGroup[] = [];
  const armor = text.match(/^''?防具擅长[：:]\s*''?([^\n]+)/m);
  if (armor) out.push({ cat: "防具", items: textToItems(armor[1].trim()) });
  const weapon = text.match(/^''?[\u4e00-\u9fff]*武器擅长[：:]\s*''?([^\n]+)/m);
  if (weapon) out.push({ cat: "武器", items: extractProficiencyTokens(weapon[1].trim()) });
  const impl = text.match(/^''?法器[：:]\s*''?([^\n]+)/m);
  if (impl) out.push({ cat: "法器", items: textToItems(impl[1].trim()) });
  return out;
}

// 收集擅长总览（按来源分组：主职业/混职/种族/专长）；专长含白名单武器擅长与选择型专长的手动选择
export function collectProficiencySources(input: {
  className: string;
  className2?: string;
  classText?: string;
  classText2?: string;
  raceName: string;
  raceText?: string;
  featNames: string[];
  featChoices?: { cat: "weapon" | "implement"; item: string }[];
}): SourceProf[] {
  const out: SourceProf[] = [];
  const pushText = (source: string, text?: string) => {
    if (!text) return;
    const groups = extractTextGroups(text);
    if (groups.length) out.push({ source, groups });
  };
  pushText(input.className || "职业", input.classText);
  pushText(input.className2 || "混职", input.classText2);
  pushText(input.raceName || "种族", input.raceText);
  const featWeaponItems: string[] = [];
  const featImplItems: string[] = [];
  const featArmorItems: string[] = [];
  for (const name of input.featNames) {
    const tokens = FEAT_PROFICIENCY[featBaseName(name)];
    if (tokens) featWeaponItems.push(...tokens);
    featArmorItems.push(...featArmorTokens(name), ...featShieldTokens(name));
  }
  for (const c of input.featChoices ?? []) {
    if (c.cat === "implement") featImplItems.push(c.item);
    else featWeaponItems.push(c.item);
  }
  const featGroups: ProfGroup[] = [];
  if (featWeaponItems.length) featGroups.push({ cat: "武器", items: featWeaponItems });
  if (featArmorItems.length) featGroups.push({ cat: "防具", items: featArmorItems });
  if (featImplItems.length) featGroups.push({ cat: "法器", items: featImplItems });
  if (featGroups.length) out.push({ source: "专长", groups: featGroups });
  return out;
}
