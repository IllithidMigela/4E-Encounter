// —— 混职天赋 Hybrid Talent 解析与效果解析 ——
// 混职类条目（hybrid:"是"）sourceText 内含「! 混职天赋选项」小节，其下为「!! 选项名」子节，
// 每个子节标题即一个可由「混职天赋」专长选取的职业特性（如「原力守护者 Primal Guardian」）。
import type { Entry } from "../data/types";
import { cleanDisplayName } from "../sheet/character";
import { classFeaturesHtml, classTraitHtml, parseFeatureSections, type FeatureSection } from "./wikirender";

export interface HybridTalentRef { before: string; label: string; after: string; popup: string }
export interface HybridTalentOption { title: string; body: string; ref?: HybridTalentRef }
export interface HybridTalentGroup { source: string; intro?: string; options: HybridTalentOption[]; }

// —— 混职天赋选项正文中的「职业特性」引用 → 悬浮超链接 ref ——
// 覆盖两类句式：
//   1. 「取得『名』职业特性…」/「获得X的『名』职业特性…」（显式特性名）
//   2. 「这职业特性跟X的职业特性（完全）一样，…」（含「不过…」等后续的修改版；目标为 X 的同名职业特性，
//      特性名带「（混职）」等变体后缀时与选项同名特性归一匹配）
// 命中且能在全量职业中解析到对应职业特性正文时，保留原文，并将该特性名片段渲染为悬浮超链接，
// 浮窗内容为对应职业特性的规则正文。

const stripParens = (s: string) => s.replace(/（[^（）]*）/g, "").replace(/\([^()]*\)/g, "").trim();
const cnOf = (s: string) => { const m = stripParens(s).match(/^[^A-Za-z]+/); return (m ? m[0] : stripParens(s)).trim(); };
const clsCn = (n: string) => cleanDisplayName(n).replace(/\s+[A-Za-z].*$/, "").trim();

// 在指定职业（或全量职业）的「职业特性」小节中，查找特性名与 `featName` 归一匹配的特性规则正文
function findFeatureBody(allClasses: Entry[], className: string | undefined, featName: string): string | undefined {
  const want = cnOf(featName);
  if (!want) return undefined;
  const pool = className
    ? allClasses.filter((c) => c.name === className || clsCn(c.name) === className || cleanDisplayName(c.name) === className)
    : allClasses;
  for (const entry of pool) {
    const featsHtml = classFeaturesHtml(entry.sourceText);
    if (!featsHtml) continue;
    const sec = parseFeatureSections(featsHtml).sections.find((s) => cnOf(s.title) === want);
    if (sec && sec.body?.trim()) return sec.body;
  }
  return undefined;
}

export function hybridFeatureRef(body: string, title: string, allClasses: Entry[]): HybridTalentRef | undefined {
  // 形式一：正文中的「名」职业特性引用（显式特性名）——首个能解析到特性正文的命中即视作引用
  for (const mq of body.matchAll(/「([^」]+)」/g)) {
    const popup = findFeatureBody(allClasses, undefined, mq[1].trim());
    if (popup) {
      const start = mq.index;
      const end = start + mq[0].length;
      return { before: body.slice(0, start), label: mq[0], after: body.slice(end), popup };
    }
  }
  // 形式二：「这职业特性跟X的职业特性一样，…」——来源职业为 X，目标特性为选项同名（变体后缀归一）
  const mc = body.match(/(?:跟|和|与)(.+?)的(?:职业)?特性/);
  if (mc) {
    const cls = mc[1].trim();
    const popup = findFeatureBody(allClasses, cls, title);
    if (popup) {
      const segStart = mc.index!; // 「跟X的职业特性」片段起点（保留连词「跟/和/与」）
      const segEnd = mc.index! + mc[0].length;
      return { before: body.slice(0, segStart), label: body.slice(segStart, segEnd), after: body.slice(segEnd), popup };
    }
  }
  return undefined;
}

// 解析混职类条目正文中的混职天赋选项：定位「! 混职天赋选项」到下一个「! 」顶级标题之间的区域，
// 提取区域引言与所有「!! 选项」子节标题/正文。
export function parseHybridTalentOptions(sourceText: string): { intro?: string; options: HybridTalentOption[] } {
  const m = sourceText.match(/^!\s*混职天赋选项\s*$/m);
  if (!m) return { options: [] };
  const rest = sourceText.slice(m.index! + m[0].length);
  const next = rest.search(/^!\s(?!!\s)/m); // 下一个顶级「! 」标题（如「! 建议配搭」）
  const section = next >= 0 ? rest.slice(0, next) : rest;
  const firstOpt = section.search(/^!! /m);
  const head = firstOpt >= 0 ? section.slice(0, firstOpt) : section;
  const introM = head.match(/@@\.\w+\s*([\s\S]*?)^@@/m);
  const intro = introM ? introM[1].replace(/^\s*$/gm, "").trim() : undefined;
  const options: HybridTalentOption[] = [];
  const optPart = firstOpt >= 0 ? section.slice(firstOpt) : "";
  for (const p of optPart.split(/^(?=!! )/m)) {
    const om = p.match(/^!! (.+?)\n([\s\S]*)$/);
    if (!om) continue;
    // 剥离 @@ 宏行与尾部水平分隔线（「---」）及多余空白，使等价句「…完全一样。」能被结尾判定准确命中
    const body = om[2]
      .replace(/^@@\.\w+\s*/gm, "")
      .replace(/^@@\s*$/gm, "")
      .replace(/^\s*$/gm, "")
      .replace(/\s*-{3,}\s*$/, "")
      .replace(/\s*$/, "")
      .trim();
    options.push({ title: om[1].trim(), body });
  }
  return { intro, options };
}

// 专长名规范化用于匹配「混职天赋」（去掉消歧后缀，如「混职天赋 <典范>」）
const hybridBaseName = (n: string) => n.replace(/\s*<[^>]*>\s*$/, "").trim();
export const isHybridTalentFeat = (f?: { name?: string }) => !!f && hybridBaseName(f.name ?? "") === "混职天赋";

// 从一组职业条目（主职+混职）构建混职天赋选项组，保留来源职业名（供弹窗分组展示与效果溯源）。
// allClasses：全量职业条目，用于为「与XX完全一样」的选项构建悬浮超链接 ref（指向源职业同名特性正文；非等价句则无 ref）。
export function hybridTalentGroups(entries: (Entry | undefined)[], allClasses: Entry[] = []): HybridTalentGroup[] {
  const groups: HybridTalentGroup[] = [];
  for (const e of entries) {
    if (!e) continue;
    const p = parseHybridTalentOptions(e.sourceText);
    if (p.options.length) {
      const options = p.options.map((o) => ({ ...o, ...(allClasses.length ? { ref: hybridFeatureRef(o.body, o.title, allClasses) } : {}) }));
      groups.push({ source: cleanDisplayName(e.name), intro: p.intro, options });
    }
  }
  return groups;
}

// 在选项组中按选项完整标题定位，返回 (来源职业名, 选项正文)；跨组标题撞车时取首个命中（罕见）
export function resolveHybridOption(groups: HybridTalentGroup[], title: string): { source: string; body: string } | undefined {
  for (const g of groups) {
    const o = g.options.find((x) => x.title === title);
    if (o) return { source: g.source, body: o.body };
  }
  return undefined;
}

// 从选项正文提取「获得X的擅长」的擅长 token，并按 防具/盾牌/武器 分类
// （护甲类选项如「你获得皮甲，革甲和链甲的擅长」；无法归类的类别项归入武器 token 由 existing 匹配处理）。
const HYBRID_ARMOR_SET = new Set(["布甲", "皮甲", "革甲", "链甲", "鳞甲", "板甲"]);
export function hybridTalentProfTokens(body: string): { armor: string[]; shield: string[]; weapon: string[] } {
  const armor: string[] = [];
  const shield: string[] = [];
  const weapon: string[] = [];
  const push = (arr: string[], t: string) => { if (t && !arr.includes(t)) arr.push(t); };
  const re = /获得((?:[^，。！？\n])+?)的擅长/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    for (const it of m[1].split(/[，,、和及与]+/)) {
      const t = it.trim();
      if (!t) continue;
      if (t.includes("盾")) { push(armor, t); push(shield, t); }
      else if (HYBRID_ARMOR_SET.has(t)) push(armor, t);
      else push(weapon, t);
    }
  }
  return { armor, shield, weapon };
}

// —— 混职职业能力：合并两个混职职业的 trait，生成一段「''标签：''值」文本 ——
// 依混职规则：护甲/盾牌取交集、武器/法器/职业技能/关键属性/威能来源/职位取并集、
// 防御加值累加、起始HP/每级HP/每日回复力求和向下取整、受训技能=并集列表选3（叠加各职额外受训）。

interface ClassTraitData {
  role: string;
  source: string;
  attrs: string[];
  armor: string[];
  shield: string[];
  weapon: string[];
  implement: string[];
  defBonus: string[];
  hp: number;
  php: number;
  surge: number;
  skills: string[];
  extra: number;
}

function splitList(v: string): string[] {
  return v.split(/[，,、和及与]+/).map((s) => s.trim()).filter(Boolean);
}

function parseOneClassTrait(entry: Entry): ClassTraitData {
  const trait = classTraitHtml(entry.sourceText) ?? "";
  const f = entry.fields ?? {};
  const cur = (re: RegExp) => { const m = trait.match(re); return m ? m[1].trim() : ""; };
  const armorRaw = cur(/^''?防具擅长[：:]\s*''?([^\n]*)/m);
  const armorParts = armorRaw.split(/[；;]/);
  const armor = splitList(armorParts[0]);
  const shield: string[] = [];
  for (let i = 1; i < armorParts.length; i++) if (/盾/.test(armorParts[i])) shield.push(...splitList(armorParts[i]));
  const defTxt = cur(/^''?防御加值[：:]\s*''?([^\n]*)/m);
  const hp = parseFloat(cur(/^''?起始HP[：:]\s*''?([^\n]*)/m)) || 0;
  const php = parseFloat(cur(/^''?每级增加HP[：:]\s*''?([^\n]*)/m)) || 0;
  const surge = parseFloat(cur(/^''?每日回复力[：:]\s*''?([^\n]*)/m)) || 0;
  const extraTxt = cur(/^''?额外受训技能[：:]\s*''?([^\n]*)/m);
  let extra = 0;
  const em = extraTxt.match(/选择(\d+)\s*个/);
  if (em) extra = parseInt(em[1], 10);
  return {
    role: f["role"] || "",
    source: f["power source"] || "",
    attrs: splitList(cur(/^''?关键属性[：:]\s*''?([^\n]*)/m)),
    armor,
    shield,
    weapon: splitList(cur(/^''?[\u4e00-\u9fff]*武器擅长[：:]\s*''?([^\n]*)/m)),
    implement: splitList(cur(/^''?法器[：:]\s*''?([^\n]*)/m)),
    defBonus: defTxt ? [defTxt] : [],
    hp,
    php,
    surge,
    skills: splitList(cur(/^''?职业技能[：:]\s*''?([^\n]*)/m)),
    extra,
  };
}

const concatAll = (...arrs: string[][]) => [...new Set(arrs.flat().map((s) => s.trim()).filter(Boolean))];

// 合并两个混职职业的 trait 为「''标签：''值」文本（无风味段落，供职业能力面板按普通 trait 样式渲染）
export function mergedClassTraitText(entries: (Entry | undefined)[]): string | undefined {
  const cs = entries.map((e) => (e ? parseOneClassTrait(e) : undefined)).filter(Boolean) as ClassTraitData[];
  if (cs.length < 2) return undefined;
  const [a, b] = cs;
  const role = concatAll([a.role], [b.role]).join(" / ");
  const source = concatAll([a.source], [b.source]).join(" / ");
  const attrs = concatAll(a.attrs, b.attrs).join("，");
  const armor = a.armor.filter((x) => b.armor.includes(x)).join("，");
  const shield = a.shield.filter((x) => b.shield.includes(x)).join("，");
  const weapon = concatAll(a.weapon, b.weapon).join("，");
  const implement = concatAll(a.implement, b.implement).join("，");
  const defBonus = concatAll(a.defBonus, b.defBonus).join("；");
  const sum = (x: number, y: number) => Math.floor(x + y);
  const hp = sum(a.hp, b.hp);
  const php = sum(a.php, b.php);
  const surge = sum(a.surge, b.surge);
  const skills = concatAll(a.skills, b.skills).join("、");
  const trained = 3 + a.extra + b.extra;

  const lines: string[] = [];
  if (role) lines.push(`''职位：''${role}`);
  if (source) lines.push(`''威能来源：''${source}`);
  if (attrs) lines.push(`''关键属性：''${attrs}`);
  lines.push(`''防具擅长：''${armor}${shield ? "；" + shield : ""}`);
  if (weapon) lines.push(`''武器擅长：''${weapon}`);
  if (implement) lines.push(`''法器：''${implement}`);
  if (defBonus) lines.push(`''防御加值：''${defBonus}`);
  lines.push(`''起始HP：''${hp} + 体质值`);
  lines.push(`''每级增加HP：''${php}`);
  lines.push(`''每日回复力：''${surge} + 体质调整值`);
  lines.push(`''受训技能：''1级时，从下列职业技能列表中，选择${trained}个受训技能。`);
  if (skills) lines.push(`''职业技能：''${skills}`);
  return lines.join("\n");
}

// 解析「这职业特性跟X的职业特性（完全）一样」句：定位 X 的同名职业特性「条目」（含正文），
// 供混职卡下折叠使用基础职业的样式/字号/选项/算法完整渲染原版。命中失败返回 undefined。
export interface OriginalFeatureInfo { entry: Entry; section: FeatureSection }
export function originalFeatureInfo(body: string, title: string, classes: Entry[]): OriginalFeatureInfo | undefined {
  const mc = body.match(/(?:跟|和|与)(.+?)的(?:职业)?特性/);
  if (!mc) return undefined;
  const cls = mc[1].trim().replace(/^混职/, "");
  const want = cnOf(title);
  for (const entry of classes) {
    if (!(entry.name === cls || clsCn(entry.name) === cls || cleanDisplayName(entry.name) === cls)) continue;
    const featsHtml = classFeaturesHtml(entry.sourceText);
    if (!featsHtml) continue;
    const sec = parseFeatureSections(featsHtml).sections.find((s) => cnOf(s.title) === want);
    if (sec && sec.body?.trim()) return { entry, section: sec };
  }
  return undefined;
}