// 怪物属性块解析（纯函数，无 DOM / import.meta 依赖）
// 供运行时（src/data.ts re-export）与构建脚本（scripts/build-creatures.mjs）共用，
// 保证「构建时预解析」与「运行时解析」逻辑完全一致。
// 注意：本文件相对导入必须带 .ts 扩展名（Node 原生 TS 执行要求）。
import type { AttackKind, AttackOption, CombatantStats, ConditionKey, DefenseKey, EffectSpec } from "./types.ts";
import { DAMAGE_TYPE_ZH } from "./types.ts";

export interface Entry {
  id: string;
  name: string;
  nameEn?: string;
  category: string;
  tags: string[];
  sourceText: string;
  size?: string;
  speed?: string;
  role?: string;
  [k: string]: unknown;
}

// ---------- HTML 文本工具 ----------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&nbsp;": " ",
  "&#39;": "'",
  "&apos;": "'",
};

export function stripTags(html: string): string {
  let s = html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ");
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  s = s.replace(/''/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * 把怪物的整段威能描述拆成结构化段落（命中/次命中/未命中/失手/效果/维持）。
 * 依赖 wiki 卡片经典格式：不同段落以「命中：」「如果可以：(…)则」「未命中：」「失手：」「效果：」「维持：」等起始标记分隔。
 * 批 4c-1：新增「失手：」分段（4e 常见「Miss: Half damage」→「失手：一半伤害」），独立归入 miss 段供失手伤害管线识别。
 */
export function parseSegments(desc: string): {
  hit?: string;
  second?: string;
  miss?: string;
  effect?: string;
  sustain?: string;
} {
  const seg: Record<string, string> = {};
  // 分段标记：需位于段首（前邻行首/句点/分号/括号后/空白），避免误伤「持续效果」这类正文中的词。
  // 注意使用捕获组顺序：长词在前，避免「第二次命中」被「命中」短路。
  // 「攻击：」为截断标记（攻击行已由攻击解析器单独处理，不并入任何效果段，防止「效果…攻击：…命中：」串段）。
  const marker = /(?:^|[。；\n)）\s])(命中|第二次命中|次命中|未命中|失手|效果|维持|第二攻击|攻击)([^：:]*)[：:]/g;
  const cuts: { at: number; start: number; key: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(desc)) !== null) {
    // key 可能附带了可选项（如「维持次要」），这里取主标记
    const raw = m[1];
    const key =
      raw === "命中" ? "hit"
      : raw === "第二次命中" || raw === "次命中" ? "second"
      : raw === "未命中" || raw === "失手" ? "miss"
      : raw === "效果" ? "effect"
      : raw === "攻击" || raw === "第二攻击" ? "attack"
      : "sustain";
    // 切片起点 = 整匹配结束（含前缀分隔符与冒号），保证各段不带前导冒号/分隔符
    // 切片终点 = 下一标记的匹配起点（m.index），保证上一段不吞入下一标记文本（如「…三格。 攻击：…」的「 攻击：」）
    cuts.push({ at: m.index + m[0].length, start: m.index, key });
  }
  if (cuts.length === 0) return seg;

  const push = (key: string, text: string) => {
    const t = text.trim();
    if (!t) return;
    seg[key] = (seg[key] ? seg[key] + " " : "") + t;
  };

  for (let i = 0; i < cuts.length; i++) {
    const cur = cuts[i];
    const end = i + 1 < cuts.length ? cuts[i + 1].start : desc.length;
    // attack 段仅作截断边界，本身不落入任何分段（攻击行单独解析）
    if (cur.key !== "attack") push(cur.key, desc.slice(cur.at, end));
  }
  return seg;
}

// ---------- 威能效果语义化（第 2 层：短语模式 → 可执行效果） ----------

/** 中文状态词 → ConditionKey */
const CONDITION_ZH: Record<string, ConditionKey> = {
  定身: "immobilized",
  目盲: "blinded",
  晕眩: "dazed",
  眩晕: "dazed",
  震慑: "stunned",
  迟缓: "slowed",
  束缚: "restrained",
  受缚: "restrained", // 批 4c-1：常见同义译名
  支配: "dominated",
  受控: "dominated", // 批 4c-1：受控 = 被支配
  石化: "petrified",
  虚弱: "weakened",
  耳聋: "deafened",
  无助: "helpless",
  失去意识: "unconscious",
  昏迷: "unconscious", // 批 4c-1：同义译名
  被标记: "marked",
  倒地: "prone",
  惊惧: "dazed", // 罕见译名归并
};

/** 强制移动动词 → EffectSpec.kind */
const FORCED_VERB: Record<string, "push" | "pull" | "slide"> = {
  推离: "push",
  击退: "push",
  推动: "push", // 批 4c-1：同义译名
  拉近: "pull",
  拖近: "pull",
  拉动: "pull", // 批 4c-1：同义译名
  滑动: "slide",
  滑移: "slide", // 批 4c-1：同义译名
  拖拽: "slide",
  牵引: "slide",
};

/** 伤害类型词序列（长词在前，避免「寒冰伤害」被「寒冰」短路后剩余无类型） */
const DAMAGE_WORDS = Object.keys(DAMAGE_TYPE_ZH).sort((a, b) => b.length - a.length);

/** 中文数字 → 阿拉伯数字（「五」→5、「十五」→15；无法识别返回 null），批 4c-1：瞬移等距离用中文数字 */
function zhNum(s: string): number | null {
  const d: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!/^[一二两三四五六七八九十]+$/.test(s)) return null;
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === "十") {
      total += (cur === 0 ? 1 : cur) * 10;
      cur = 0;
    } else {
      cur = d[ch] ?? 0;
    }
  }
  return total + cur;
}

/** 带符号数值（+5 / -2），供 buff 标签展示 */
function fmtSign(v: number): string {
  return v > 0 ? `+${v}` : String(v);
}

/**
 * 效果语义化：把一段威能正文（命中/效果/未命中等）按句拆解，逐句匹配可执行效果短语模式。
 * 规则：
 * - 每个词都要知道怎么在模拟器里结算；匹配不出任何模式 → 标 manual（DM 裁决），绝不静默丢失。
 * - 豁免终止识别：（豁免终止）/（豁免终止所有）→ saveOn "end"。
 * 返回 EffectSpec 列表 + 是否全部解析。
 */
export function parsePowerEffects(text: string): { specs: EffectSpec[]; allParsed: boolean } {
  const specs: EffectSpec[] = [];
  // 按 。；； 切句，保留「（豁免终止）」不拆开；纯伤害描述句返回空数组（伤害由 damageExpr 结算）
  // 批 5：括号内容整体保护（「目标被支配（豁免终止；目标在此豁免骰上受到-4减值）」内分号不切句），切句后还原。
  const guards: string[] = [];
  const masked = (text ?? "").replace(/（[^）]*）/g, (m) => {
    guards.push(m);
    return `\u0000${guards.length - 1}\u0000`;
  });
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => guards[+i] ?? "");
  const sentences = masked.split(/[。；;]/).map((s) => s.trim()).filter(Boolean).map(restore);
  for (const raw of sentences) {
    const found = matchEffectSentence(raw);
    for (const spec of found) specs.push(spec);
  }
  const allParsed = specs.every((s) => s.kind !== "manual");
  return { specs, allParsed };
}

/** 灵气回合触发句的句首前缀（用于排除通用治疗/持续伤害/标记等模式，由 17b 系灵气时点模式承接）。 */
const AURA_TURN_PREFIX = /^(?:(?:此外|另外)[，,]?\s*)?(?:在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时)[,，]?\s*)?任何(?:进入(?:或(?:在)?(?:该|此)灵气内|该灵气或在其内)?|(?:在该灵气内|在此灵气内|在灵气内))(?:开始和结束回合|开始回合|开始其回合|结束其回合|结束回合)/;

/** 为灵气 attack 应用效果语义化（领先块合并后重算 effectSpecs/coverage/unparsed）。 */
function setAuraSpecs(opt: AttackOption, text: string): void {
  opt.effectText = text;
  const r = parsePowerEffects(text);
  opt.effectSpecs = r.specs;
  const manuals = r.specs.filter((s) => s.kind === "manual");
  if (r.specs.length === 0) {
    opt.coverage = "fully";
    opt.unparsed = undefined;
  } else if (manuals.length === 0) {
    opt.coverage = "fully";
    opt.unparsed = undefined;
  } else if (manuals.length === r.specs.length) {
    opt.coverage = "manual";
    opt.unparsed = manuals.map((s) => s.raw);
  } else {
    opt.coverage = "partial";
    opt.unparsed = manuals.map((s) => s.raw);
  }
}

/** 单句 → EffectSpec 列表（一句可含多效果：推离并倒地 / 推离且晕眩等）；
 * 未匹配任何模式 → [manual]（DM 裁决）；纯伤害描述句 → []（伤害已由 damageExpr 结算） */
export function matchEffectSentence(sentence: string): EffectSpec[] {
  const s = sentence.replace(/^命中：|^效果：|^未命中：|^失手：|^后续效果：|^维持(?:次要)?：|^次要维持[^：:]*：/, "").trim();
  if (!s) return [];
  // 引导/限定句（无可执行效果）：无攻击骰 = 自动命中/纯效果引导，无独立可执行效果
  if (/^无攻击骰/.test(s)) return [];
  // 编号子攻击表头（眼魔射线类）：「1-魅惑射线（魅惑）：射程 10」——子攻击列表条目头，非独立效果
  if (/^\d+\s*[-—－]\s*[^；;：:]+[：:]\s*(?:射程|射线|近程爆发|远程|区域|触及)\s*\d+\s*(?:（[^）]*）)?$/.test(s)) return [];
  // 子攻击攻加行（独立成句的「+14 vs. 意志」）：攻击行由攻击解析器单独处理，此处跳过不标 manual
  if (/^[+-]\s*\d+\s*vs\.?\s*(?:AC|强韧|反射|意志)$/.test(s)) return [];
  // 豁免失败递进（死亡为豁免结算结果，不独立成效果）：「第二次豁免失败时：目标死亡」
  if (/^(?:首次|第二次|第三次|第四次)豁免失败时：目标死亡/.test(s)) return [];
  const saveOn = /豁免终止/.test(s) ? ("end" as const) : undefined;
  const specs: EffectSpec[] = [];
  let m: RegExpMatchArray | null;

  // 1) 持续伤害：N点持续[类型]伤害（豁免终止）
  // 批 6c：排除灵气回合触发型（「任何在该灵气内…回合的敌人受到 N点持续伤害（豁免终止）」由 17b-3 auraOngoing 承接，避免错时点挂载）
  if (!AURA_TURN_PREFIX.test(s)) {
    m = s.match(/(\d+)\s*点?\s*持续\s*([^（，。；]*?)伤害\s*（豁免终止(?:所有)?）/);
    if (m) {
      const typeText = m[2].replace(/^(?:目标(?:获得)?|受到)?/, "").trim();
      const type = typeText ? DAMAGE_TYPE_ZH[typeText] ?? typeText : undefined;
      specs.push({
        kind: "ongoing",
        raw: s,
        value: parseInt(m[1], 10),
        ...(type ? { type } : {}),
        saveOn,
        ...(/豁免终止所有/.test(s) ? { note: "豁免终止所有" } : {}),
      });
    } else {
      // 持续伤害（无豁免终止但带伤害词）
      m = s.match(/(\d+)\s*点?\s*持续\s*([^（，。；]*?)伤害/);
      if (m) {
        const typeText = m[2].replace(/^(?:目标(?:获得)?|受到)?/, "").trim();
        const type = typeText ? DAMAGE_TYPE_ZH[typeText] ?? typeText : undefined;
        specs.push({ kind: "ongoing", raw: s, value: parseInt(m[1], 10), ...(type ? { type } : {}), ...(saveOn ? { saveOn } : {}) });
      }
    }
  }

  // 2) 强制移动：推离/拉近/滑动… 目标至多 N 格（一句可多个，逐个捕获；批 4c-1：支持中文数字「两格」）
  const forcedRe = /(推离|击退|推动|拉近|拖近|拉动|滑动|滑移|拖拽|牵引)(?:或拖拽|并拖拽)?\s*(?:目标)?(?:至多|最多|至少|共)?\s*(\d+|[一二两三四五六七八九十]+)\s*格/g;
  let fm: RegExpExecArray | null;
  while ((fm = forcedRe.exec(s)) !== null) {
    const n = parseInt(fm[2], 10);
    specs.push({ kind: FORCED_VERB[fm[1]], raw: s, value: /^\d+$/.test(fm[2]) ? n : (zhNum(fm[2]) ?? n) });
  }

  // 3) 击倒 / 目标倒地（含「并倒地」「且目标倒地」等组合）
  if (/击倒|倒地/.test(s)) {
    specs.push({ kind: "prone", raw: s, condition: "prone" });
  }

  // 4) 临时生命：N点临时生命值
  m = s.match(/(\d+)\s*点\s*临时生命(?:值)?/);
  if (m) specs.push({ kind: "tempHp", raw: s, value: parseInt(m[1], 10) });

  // 5) 再生：N点再生
  m = s.match(/(\d+)\s*点\s*再生/);
  if (m) specs.push({ kind: "regeneration", raw: s, value: parseInt(m[1], 10) });

  // 6) 恢复生命：恢复N点（额外）生命值（治疗；批 4c-1：兼容「恢复3点额外生命值」）
  // 批 6b：排除灵气回合触发型治疗（「任何在该灵气内…回合的…盟友恢复 N点生命值」由 17b-2 auraHeal 承接，避免错时点/错目标挂载）
  if (!/^任何(?:进入(?:或(?:在)?(?:该|此)灵气内|该灵气或在其内)?|(?:在该灵气内|在此灵气内))(?:开始和结束回合|开始回合|结束其回合|结束回合)/.test(s)) {
    m = s.match(/(?:恢复|回复)\s*(\d+)\s*点\s*(?:额外)?\s*生命(?:值)?/);
    if (m) specs.push({ kind: "heal", raw: s, value: parseInt(m[1], 10) });
  }

  // 7) 被标记
  if (/被标记|标记目标/.test(s)) {
    specs.push({
      kind: "mark",
      raw: s,
      condition: "marked",
      ...(saveOn ? { saveOn } : {}),
      // 批 4e：效果段标记带「直到…下回合结束」等时长 → 保留，供 condUntil 到期清理（未命中同样生效）
      ...(/直到[^，。；]*(?:回合|遭遇|敏锐)?结束/.test(s) ? { duration: s.match(/直到[^，。；]*(?:回合|遭遇|敏锐)?结束/)?.[0] } : {}),
    });
  }

  // 8) 传送（批 4c-1：支持中文数字与「瞬移」同义译名）
  m = s.match(/(?:传送|瞬移)\s*(?:目标)?(?:至多|最多)?\s*(\d+|[一二两三四五六七八九十]+)\s*格/);
  if (m) {
    const n = parseInt(m[1], 10);
    specs.push({ kind: "teleport", raw: s, value: /^\d+$/.test(m[1]) ? n : (zhNum(m[1]) ?? n) });
  } else {
    // 批 5：传送到邻近目标的一格（不指定格数）：等价 1 格、落点=目标邻近任意格
    m = s.match(/(?:传送|瞬移)到邻近(?:目标|它|其)的一格/);
    if (m) {
      specs.push({ kind: "teleport", raw: s, value: 1, teleportRelative: { dx: 0, dy: 0 }, note: "邻近目标" });
    }
  }

  // 9) 状态（可豁免终止 / 带时长）：目标[获得]状态[直到…]；批 5：支持「被支配」（目标被支配，中间有「被」）
  for (const [zh, key] of Object.entries(CONDITION_ZH)) {
    // 目标获得状态 / 目标被状态 / 目标状态直到… / 目标状态（豁免终止）
    const re = new RegExp(`(?:目标|一个[^，。；]{0,6}?|其)(?:获得|被)?${zh}(?:直到[^，。；]*)?`);
    if (re.test(s)) {
      specs.push({ kind: "condition", raw: s, condition: key, ...(saveOn ? { saveOn } : {}) });
    }
  }

  // 10) 擒拿/擒抱 → 束缚（grabbed≈restrained；附原文备注供 DM 核实挣脱条件）批 4c-1
  if (/被擒拿|被擒抱|遭到擒抱|受擒抱/.test(s)) {
    specs.push({ kind: "condition", raw: s, condition: "restrained", note: s, saveOn });
  }

  // 11) 提供战斗优势（kind=grantCA）：「提供战斗优势直到…」「向X提供战斗优势（豁免终止）」批 4c-1
  if (/提供战斗优势/.test(s)) {
    specs.push({
      kind: "grantCA",
      raw: s,
      grantCA: true,
      label: "提供战斗优势",
      ...(saveOn ? { saveOn, duration: "豁免终止" } : /直到[^，。；]*(回合|遭遇)结束/.test(s) ? { duration: s.match(/直到[^，。；]*(回合|遭遇)结束/)?.[0] } : {}),
    });
  }

  // 12) 防御加值/减值（kind=buff·defMods）：「在所有防御上获得+5加值」「目标在所有防御上受到-2减值（豁免终止）」批 4c-1
  // 12-pre) buff 时长归一：豁免终止 > 「至（你的）下回合结束 / 你（的）下回合结束前」> 无
  const buffDuration = (): string | undefined =>
    saveOn ? "豁免终止" : s.match(/(?:直到|至|直至)(?:你(?:的)?)?下(?:一)?回合结束|你(?:的)?下(?:一)?回合结束前/)?.[0] || undefined;
  m = s.match(/在(所有)?(防御|AC|强韧|反射|意志)上(获得|受到|承受)([+-]?\d+)\s*点?(加值|减值)/);
  if (m) {
    let v = parseInt(m[4].replace(/\s+/g, ""), 10);
    if (m[5] === "减值") v = -Math.abs(v);
    else v = Math.abs(v);
    const isAll = m[1] === "所有" || m[2] === "防御";
    const defMods: Partial<Record<DefenseKey, number>> = isAll
      ? { ac: v, fort: v, ref: v, will: v }
      : { [m[2] as DefenseKey]: v };
    specs.push({
      kind: "buff",
      raw: s,
      label: isAll ? `所有防御${fmtSign(v)}` : `${m[2]}${fmtSign(v)}`,
      defMods,
      ...(buffDuration() ? { duration: buffDuration() } : {}),
    });
  } else {
    // 攻击骰加减值（kind=buff·atkMods）：「目标的攻击骰受到-2 减值（豁免终止）」「后续效果：目标的攻击骰受到-2 减值」
    // 批 5：兼容条件短语「在水中战斗时，其攻击骰对非水生生物获得+2加值」（攻击骰与获得之间夹「对…」条件）
    // 批 6e：兼容「攻击骰获得+2威能加值」（加值/减值前带「威能」定语）
    m = s.match(/攻击骰(?:上)?(?:对[^，。；]{1,14}?)?(受到|获得|承受)([+-]?\d+)\s*点?(?:威能)?(减值|加值)/);
    if (m) {
      let v = parseInt(m[2].replace(/\s+/g, ""), 10);
      if (m[3] === "减值") v = -Math.abs(v);
      else v = Math.abs(v);
      const condM = s.match(/攻击骰(?:上)?(对[^，。；]{1,14}?)(?:受到|获得|承受)/);
      specs.push({
        kind: "buff",
        raw: s,
        label: `攻击骰${fmtSign(v)}${condM ? `（${condM[1].replace(/^对/, "对")}）` : ""}`,
        atkMods: v,
        ...(buffDuration() ? { duration: buffDuration() } : {}),
        ...(condM ? { note: s } : {}),
      });
    }
  }

  // 12b) 豁免骰加值/减值（kind=buff·saveMods）：「目标在此豁免骰上受到-4减值」批 5
  m = s.match(/豁免骰上(?:受到|获得|承受)([+-]?\d+)\s*点?(减值|加值)/);
  if (m) {
    let v = parseInt(m[1].replace(/\s+/g, ""), 10);
    if (m[2] === "减值") v = -Math.abs(v);
    else v = Math.abs(v);
    specs.push({
      kind: "buff",
      raw: s,
      label: `豁免骰${fmtSign(v)}`,
      saveMods: v,
      ...(buffDuration() ? { duration: buffDuration() } : {}),
    });
  }

  // 12c) 伤害骰加值/减值（kind=buff·dmgMods）：「在伤害骰上获得+5加值」批 5（鲜血之地灵气：命中后伤害骰加值，挂载为效果条目供 DM 手动计）
  m = s.match(/在伤害骰上(?:获得|受到|承受)([+-]?\d+)\s*点?(加值|减值)/);
  if (m) {
    let v = parseInt(m[1].replace(/\s+/g, ""), 10);
    if (m[2] === "减值") v = -Math.abs(v);
    else v = Math.abs(v);
    specs.push({
      kind: "buff",
      raw: s,
      label: `伤害骰${fmtSign(v)}`,
      dmgMods: v,
      ...(buffDuration() ? { duration: buffDuration() } : {}),
    });
  }

  // 12d) 额外伤害（kind=buff·描述性效果条目）：「该目标受到25点额外伤害」批 5（战斗优势/邪恶扭曲等条件性额外伤害，挂载供 DM 命中后手动计）
  m = s.match(/(?:受到|造成|承受)(\d+)\s*点额外伤害/);
  if (m) {
    specs.push({
      kind: "buff",
      raw: s,
      label: `额外伤害 ${m[1]}`,
      note: s,
    });
  }

  // 12e) 重伤条件强化（kind=buff·描述性条目）：「且若该生物重伤，则为+10加值」批 5（鲜血之地：重伤时伤害骰加值提升，依附前句加值，挂载供 DM 参考）
  m = s.match(/且若(?:该生物|目标)?重伤，则为([+-]?\d+)\s*点?(加值|减值)/);
  if (m) {
    specs.push({
      kind: "buff",
      raw: s,
      label: `重伤时伤害骰${m[1]}${m[2]}`,
      note: s,
    });
  }

  // 12f) 攻击骰+伤害骰复合（kind=buff·atkMods+dmgMods）：「盟友在灵气内时攻击骰和伤害骰都获得+2加值」批 6e
  m = s.match(/(攻击骰)和(伤害骰)都?(?:上)?(?:获得|受到|承受)([+-]?\d+)\s*点?(加值|减值)/);
  if (m) {
    let v = parseInt(m[3].replace(/\s+/g, ""), 10);
    if (m[4] === "减值") v = -Math.abs(v);
    else v = Math.abs(v);
    specs.push({ kind: "buff", raw: s, label: `攻击骰和伤害骰${fmtSign(v)}`, atkMods: v, dmgMods: v });
  }

  // 12g) 临时抗力增益（kind=buff·描述性）：「获得N点全伤害抗力，直到你下一回合结束」「获得5点火焰抗力（豁免终止）」
  // 批（战斗祝福）：正面的临时抗性与伤害骰 buff 同构，挂载为效果条目展示给 DM，时长取 buffDuration。
  // 增益受体判定：文本中的「你/盟友 获得」决定受体为 施法者/盟友/两者之一（beneficiary）。
  m = s.match(/获得(\d+)\s*点(?:的)?(?:(全伤害)|([^，。；]{0,4}?))(?:抗性|抗力)/);
  if (m) {
    let beneficiary: EffectSpec["beneficiary"];
    if (/你或[^，。；]*盟友获得|你(?:的)?[^，。；]*一个盟友获得/.test(s)) beneficiary = "selfAlly";
    else if (/盟友获得|一个盟友获得/.test(s)) beneficiary = "ally";
    else if (/你获得/.test(s)) beneficiary = "self";
    specs.push({
      kind: "buff",
      raw: s,
      label: `${m[2] ? "全伤害" : `${m[3] ?? ""}`}抗力 ${Math.abs(parseInt(m[1], 10))}`,
      note: s,
      ...(beneficiary ? { beneficiary } : {}),
      ...(buffDuration() ? { duration: buffDuration() } : {}),
    });
  }

  // 13) 区域/结界生成（kind=zone）：「此爆发创造一个持续到…的区域」「生成为一个结界持续到…」批 4c-1
  // 批 5：定语上限 6→20（「创造一个持续到此龙下一回合结束的区域」定语 12 字，此前被截断漏配）
  m = s.match(/创造(?:一个|出一个)?[^，。；]{0,20}?区域|生成(?:一个|出一个)?[^，。；]{0,20}?结界/);
  if (m) {
    const dur = s.match(/持续(?:到|至)?[^，。；]*结束|持续[^，。；]{0,10}$/)?.[0];
    specs.push({
      kind: "zone",
      raw: s,
      label: `区域：${s.slice(0, 24)}${s.length > 24 ? "…" : ""}`,
      note: s,
      ...(dur ? { duration: dur } : {}),
    });
  }

  // 13b) 墙生成（kind=zone·wall）：「区域10墙4」批 5（全库仅巴菲门特/迪斯帕特，均效果型；几何三定律由放置交互校验）
  m = s.match(/^区域\s*(\d+)\s*墙\s*(\d+)/);
  if (m) {
    specs.push({ kind: "zone", raw: s, label: `墙：区域${m[1]}墙${m[2]}（${m[2]} 格连续）`, note: s });
  }

  // 13c) 墙/结界/区域的行为规则描述句（承接 13b/13a 生成的区域；主语为墙/结界/区域本身或其创造者的规则文本，非独立可执行效果）批 5
  // 「这面墙无法被摧毁和攀爬」「若巴菲门特创建了超过一面墙，则这些墙都不可以邻近」「巴菲门特和它的盟友可以不受减值地透过这面墙移动」
  // 归为 zone 描述条目（raw 保留原文），不标 manual；含强效果词（伤害/强制移动/状态）的仍走原判定。
  if (
    /这面(?:幻术)?墙|这些墙|该墙|此区域|该结界|这个区域/.test(s) &&
    !/持续伤害|推离|击退|拉近|拖近|滑动|拖拽|牵引|击倒|晕眩|定身|束缚|支配|标记|临时生命|传送|隐形|获得|受到\d+点伤害/.test(s)
  ) {
    specs.push({ kind: "zone", raw: s, label: "墙/区域规则", note: s });
  }

  // 14) 灵气范围调整（kind=zone·灵气）：「风暴之缚灵气增加2格」「岩石之雨重置为灵气1」「毒烟扩大为灵气3」批 4c-1
  // 批 4c-1：灵气也可位于算子之后（「重置为灵气1」「扩大为灵气3」），如不命中则回退旧形式（灵气在算子前）
  m = s.match(/(.+?)灵气(增加|重置为|减为|扩大为)(\d+|[一二两三四五六七八九十]+)\s*格?/)
    ?? s.match(/(.+?)(增加|重置为|减为|扩大为)灵气\s*(\d+|[一二两三四五六七八九十]+)\s*格?/);
  if (m && !/的敌人/.test(s)) {
    const n = /^\d+$/.test(m[3]) ? parseInt(m[3], 10) : (zhNum(m[3]) ?? 0);
    const label = m[2] === "增加" ? `灵气范围 +${n}` : `灵气范围 → ${n}`;
    specs.push({ kind: "zone", raw: s, label: `${m[1].replace(/^该|^此|^的/, "")}${label}`, note: s });
  }

  // 15) 移动效果（kind=move）：「快步N格」「跳跃8格」「飞行N格」「以最多它的速度快步」「以其速度移动」批 4c-1（落点由 DM 指定）
  // 批 4c-1：跳跃/飞行/冲锋 同样归入移动效果；「不引发借机攻击」作为备注
  // 批 5：「作为冲锋的一部分」是攻击描述（冲锋时附带效果），不当作移动效果
  m = s.match(/(快步|跳跃|飞行|冲锋)\s*(\d+|[一二两三四五六七八九十]+)?\s*格?/);
  if (/快步|跳跃|飞行|冲锋/.test(s) && !/作为(?:一次)?冲锋的一部分/.test(s) && m) {
    const n = m[2] ? (/^\d+$/.test(m[2]) ? parseInt(m[2], 10) : (zhNum(m[2]) ?? undefined)) : undefined;
    const verb = m[1] === "冲锋" ? "冲锋" : m[1] === "快步" ? "快步" : "移动";
    specs.push({ kind: "move", raw: s, value: n, label: n ? `移动：${verb} ${n} 格` : `移动：${verb}`, note: /不引发借机攻击/.test(s) ? "该移动不引发借机攻击" : undefined });
  } else if (/以最多.{0,6}?(他的|她的|它的)?速度(?:移动|快步|行走)|以其速度移动/.test(s)) {
    specs.push({ kind: "move", raw: s, label: "移动：以最多速度移动", note: /不引发借机攻击/.test(s) ? "该移动不引发借机攻击" : undefined });
  }

  // 16) 临时抗力（kind=resist）：「获得对触发的伤害类型的N点抗力，直到…」批 4c-1
  m = s.match(/获得对触发的伤害类型(?:的)?(\d+)\s*点抗力/);
  if (m) {
    const dur = s.match(/直到[^，。；]*(回合|遭遇)结束/)?.[0];
    specs.push({
      kind: "resist",
      raw: s,
      value: parseInt(m[1], 10),
      label: `抗力（触发类型）${parseInt(m[1], 10)}`,
      type: "触发类型",
      ...(dur ? { duration: dur } : {}),
    });
  }

  // 17) 区域/结界附加描述（kind=zone）：「该结界是困难地形」「此区域是重度障目」「任何进入该结界的生物受到N点伤害」批 4c-1
  m = s.match(/^(?:该|此)(?:结界|区域)是([^，。；]{1,12})$/);
  if (m) {
    specs.push({ kind: "zone", raw: s, label: `区域地形：${m[1]}`, note: s });
  }
  // 批 5：定语上限 12→20（「任何进入该结界或在其内开始回合的生物受到N点伤害」中间隔 12 字，此前漏配）
  m = s.match(/任何(?:进入(?:该|此)(?:结界|区域)|在(?:该|此)?灵气内结束其回合的敌人)[^，。；]{0,20}受到(\d+)\s*点([^，。；]{0,6})伤害/);
  if (m) {
    const isAura = /灵气内结束其回合/.test(s);
    specs.push({ kind: "zone", raw: s, label: `${isAura ? "灵气伤害" : "区域伤害"}：${m[2]}${parseInt(m[1], 10)}`, note: s });
  }

  // 17b) 灵气回合触发伤害（kind=auraDamage）：「任何在该灵气内开始回合的敌人受到 10火焰伤害，在该X重伤时则为 20火焰伤害」
  // 变体：开始回合/开始和结束回合/结束其回合/结束回合；进入或…（由 auraTriggersOnEnter 承接进入时点）；前置「在该X重伤期间，」/「此外，」；后置「，在该X重伤时则为 M伤害」
  // 不锚定结尾：允许「，且该X滑移…」等后续分句由其他模式继续解析；(?!点?持续) 排除「持续伤害」（走 ongoing）
  m = s.match(
    /^(?:(?:此外|另外)[，,]?\s*)?(?:在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时)[,，]?\s*)?任何(?:进入(?:或(?:在)?(?:该|此)灵气内|该灵气或在其内)?|(?:在该灵气内|在此灵气内))(?:开始和结束回合|开始回合|结束其回合|结束回合)(?:且[^，。；]{1,16}?)?的(?:[^，。；]{0,6}?)(敌人|生物)(?:受到|将受到)\s*(\d+)\s*点?(?![点\s]*持续)([^，。；0-9]{0,8})伤害(?:，在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时)则为\s*(\d+)\s*点?([^，。；0-9]{0,8})伤害)?/,
  );
  if (m) {
    const typeText = (m[3] ?? "").trim();
    const type = typeText ? DAMAGE_TYPE_ZH[typeText] ?? typeText : undefined;
    const isStartAndEnd = /开始和结束回合/.test(s);
    const base: EffectSpec = {
      kind: "auraDamage",
      raw: s,
      value: parseInt(m[2], 10),
      ...(type ? { type } : {}),
      trigger: /结束(?:其)?回合/.test(s) || isStartAndEnd ? ("end" as const) : ("start" as const),
      faction: m[1] === "敌人" ? ("enemy" as const) : undefined,
      ...(/在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时(?!则为))/.test(s) ? { bloodiedOnly: true } : {}),
      ...(m[4] !== undefined ? { bloodiedValue: parseInt(m[4], 10) } : {}),
    };
    specs.push(base);
    // 「开始和结束回合」= 开始与结束两个时点各触发一次
    if (isStartAndEnd) specs.push({ ...base, trigger: "start" });
  }

  // 17b-2) 灵气回合触发治疗（kind=auraHeal）：「任何在该灵气内开始回合的该X的（重伤的）盟友恢复 10点生命值」
  // 与 17b 同构：时点（开始/结束/开始和结束回合）、目标（盟友/生物）、前置「在该X重伤期间」=持有者重伤、
  // 定语「重伤的X盟友」=目标重伤（targetBloodied）。受 6) 的治疗正则排除句首同构句承接。
  m = s.match(
    /^(?:(?:此外|另外)[，,]?\s*)?(?:在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时)[,，]?\s*)?任何(?:进入(?:或(?:在)?(?:该|此)灵气内|该灵气或在其内)?|(?:在该灵气内|在此灵气内))(?:开始和结束回合|开始回合|结束其回合|结束回合)(?:且[^，。；]{1,16}?)?的([^，。；]{0,24}?)(盟友|生物)(?:恢复|回复)\s*(\d+)\s*点?\s*生命(?:值)?/,
  );
  if (m) {
    const isStartAndEnd = /开始和结束回合/.test(s);
    const base: EffectSpec = {
      kind: "auraHeal",
      raw: s,
      value: parseInt(m[3], 10),
      trigger: /结束(?:其)?回合/.test(s) || isStartAndEnd ? ("end" as const) : ("start" as const),
      faction: m[2] === "盟友" ? ("ally" as const) : undefined,
      ...(/重伤/.test(m[1] ?? "") ? { targetBloodied: true } : {}),
      ...(/在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时(?!则为))/.test(s) ? { bloodiedOnly: true } : {}),
    };
    specs.push(base);
    // 「开始和结束回合」= 开始与结束两个时点各触发一次
    if (isStartAndEnd) specs.push({ ...base, trigger: "start" });
  }

  // 17b-3) 灵气回合触发持续伤害（kind=auraOngoing）：「任何在该灵气内开始回合的敌人受到 5 点持续伤害（豁免终止）」
  // 由 1) 的 AURA_TURN_PREFIX 排除与 17b 的 (?![点\s]*持续) 排除承接，避免错时点/错挂载。
  m = s.match(
    /^(?:(?:此外|另外)[，,]?\s*)?(?:在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时)[,，]?\s*)?任何(?:进入(?:或(?:在)?(?:该|此)灵气内|该灵气或在其内)?|(?:在该灵气内|在此灵气内))(?:开始和结束回合|开始回合|结束其回合|结束回合)(?:且[^，。；]{1,16}?)?的(?:[^，。；]{0,6}?)(敌人|生物)(?:受到|将受到)\s*(\d+)\s*点?\s*持续\s*([^，。；0-9]{0,8})伤害（豁免终止(?:所有)?）/,
  );
  if (m) {
    const typeText = (m[3] ?? "").trim();
    const type = typeText ? DAMAGE_TYPE_ZH[typeText] ?? typeText : undefined;
    specs.push({
      kind: "auraOngoing",
      raw: s,
      value: parseInt(m[2], 10),
      ...(type ? { type } : {}),
      saveOn,
      trigger: /结束(?:其)?回合/.test(s) || /开始和结束回合/.test(s) ? ("end" as const) : ("start" as const),
      faction: m[1] === "敌人" ? ("enemy" as const) : undefined,
      ...(/在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时(?!则为))/.test(s) ? { bloodiedOnly: true } : {}),
    });
  }

  // 17b-4) 灵气回合触发状态（kind=auraCondition）：「任何在该灵气内开始回合的敌人迟缓直到其下回合开始」
  // 变体：时点（开始回合/开始其回合/结束回合）、目标（敌人/生物/活体生物）、状态（迟缓/被标记/定身…由 CONDITION_ZH 兜底）、
  // 时长锚定（其/它/该敌人/该生物/该盟友 = 目标自身 → expires；该X（X=持有者名）→ expires+expiryOwner）、
  // 附加（「且不能传送/瞬移」记入 note 供 DM 沿用）。(?:任何)? 使「任何」整组可选（注意不能用 任何?，后者会要求「任」）。
  m = s.match(
    /^(?:(?:此外|另外)[，,]?\s*)?(?:在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时)[,，]?\s*)?(?:任何)?(?:进入(?:或(?:在)?(?:该|此)灵气内|该灵气或在其内)?|在(?:该|此)?灵气内)(?:开始和结束回合|开始其回合|开始回合|结束其回合|结束回合)(?:且[^，。；]{1,16}?)?的(?:[^，。；]{0,6}?)(敌人|生物)([^；。]{1,24}?)(?:直到|至|，直到|，至)(其|它|该敌人|该生物|该盟友|该[^，。；]{1,12}?)(?:的)?(?:下回合|下一回合)(开始|结束|终止)/,
  );
  if (m) {
    const condClause = m[2];
    const cond =
      Object.entries(CONDITION_ZH).find(([zh]) => condClause.includes(zh))?.[1] ??
      (/标记/.test(condClause) ? ("marked" as const) : undefined);
    if (cond) {
      const anchor = m[3];
      const expires = m[4] === "开始" ? ("start" as const) : ("end" as const);
      const ownerAnchored = anchor !== "其" && anchor !== "它" && !/^(?:该敌人|该生物|该盟友)$/.test(anchor);
      const noteM = condClause.match(/且不能([^，。；]{1,8})/);
      specs.push({
        kind: "auraCondition",
        raw: s,
        condition: cond,
        trigger: /结束(?:其)?回合/.test(s) ? ("end" as const) : ("start" as const),
        faction: m[1] === "敌人" ? ("enemy" as const) : undefined,
        expires,
        ...(ownerAnchored ? { expiryOwner: true } : {}),
        ...(noteM ? { note: noteM[1] } : {}),
        ...(/在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时(?!则为))/.test(s) ? { bloodiedOnly: true } : {}),
      });
    } else if (/诅咒/.test(condClause)) {
      // 批 6e：命名诅咒类（如巴尔泽布的诅咒：所有防御-2 且全伤害易伤5）非标准状态，挂载为描述条目供 DM 沿规则应用
      specs.push({
        kind: "buff",
        raw: s,
        label: `诅咒（${m[3]}下回合${m[4] === "开始" ? "开始" : "结束"}前有效）`,
        note: s,
      });
    }
  }
  // 17b-5) 灵气回合触发伤害变体（kind=auraDamage）：「在灵气内开始其回合的生物受到10点火焰伤害」
  // 「没有魔鬼关键字的生物在灵气内开始其回合时受到2点伤害」「所有在该灵气内结束回合的敌人受到 5 点火焰伤害」
  // 17b 要求「任何」前缀且目标后置；本模式承接 所有/无前缀/「没有X关键字」定语/「…时」等变体（互相排斥不重复）。
  m = s.match(
    /^(?:(?:此外|另外)[，,]?\s*)?(?:在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时)[,，]?\s*)?(?:所有在(?:该|此)?灵气内|没有[^，。；]{1,12}?关键字的(?:生物|敌人|盟友)?在(?:该|此)?灵气内|在(?:该|此)?灵气内|在灵气内)(?:开始和结束回合|开始其回合|开始回合|结束其回合|结束回合)(?:的|时)(?:[^，。；]{0,8}?)?(生物|敌人|盟友)?(?:受到|将受到)\s*(\d+)\s*点?(?![点\s]*持续)([^，。；0-9]{0,8})伤害/,
  );
  if (m) {
    const typeText = (m[3] ?? "").trim();
    const type = typeText ? DAMAGE_TYPE_ZH[typeText] ?? typeText : undefined;
    specs.push({
      kind: "auraDamage",
      raw: s,
      value: parseInt(m[2], 10),
      ...(type ? { type } : {}),
      trigger: /结束(?:其)?回合/.test(s) || /开始和结束回合/.test(s) ? ("end" as const) : ("start" as const),
      faction: m[1] === "敌人" ? ("enemy" as const) : undefined,
      ...(/在该[^，。；]{0,12}?(?:处于)?重伤(?:期间|时(?!则为))/.test(s) ? { bloodiedOnly: true } : {}),
    });
  }

  // 17b-6) 持有者回合开始时施加状态（kind=auraCondition·ownerTrigger）：「任何在该深狱炼魔回合开始时位于该灵气内的敌人被该深狱炼魔标记直到该深狱炼魔下回合结束」
  // 与 17b-4 的区别：时点为持有者回合开始（而非目标回合），目标为当时位于灵气内的所有敌人；由 auraOwnerConditionTick 结算。
  m = s.match(/^任何在该[^，。；]{1,14}?回合开始时位于该灵气内(?:的)?(?:[^，。；]{0,6}?)(敌人|生物|盟友)([^；。]{1,24}?)(?:直到|至)(该[^，。；]{1,14}?|其|它)(?:的)?(?:下回合|下一回合)(开始|结束|终止)/);
  if (m) {
    const condClause = m[2];
    const cond =
      Object.entries(CONDITION_ZH).find(([zh]) => condClause.includes(zh))?.[1] ??
      (/标记/.test(condClause) ? ("marked" as const) : undefined);
    if (cond) {
      const anchor = m[3];
      specs.push({
        kind: "auraCondition",
        raw: s,
        condition: cond,
        trigger: "start",
        ownerTrigger: true,
        faction: m[1] === "敌人" ? ("enemy" as const) : undefined,
        expires: m[4] === "开始" ? ("start" as const) : ("end" as const),
        ...(anchor !== "其" && anchor !== "它" && !/^(?:该敌人|该生物|该盟友)$/.test(anchor) ? { expiryOwner: true } : {}),
      });
    }
  }

  // 17c-1) 灵气内困难地形（kind=zone）：「该灵气内的格子对敌人来说是困难地形」「敌人视该灵气内的格子为困难地形」
  // 「灵气内的格子是困难地形」「在该天使非重伤且在其守护对象 5 格内的情况下，灵气内的格子对敌人来说是困难地形」
  m =
    s.match(/^(?:在该[^，。；]{0,24}?的情况下，)?(?:该|此)?灵气(?:内)?的?格子?(?:对[^，。；]{1,10}?)?(?:来说|说)?是困难地形/) ??
    s.match(/^(?:敌人|生物|盟友)视(?:该|此)?灵气内的格子为困难地形/);
  if (m) {
    specs.push({ kind: "zone", raw: s, label: "灵气困难地形", note: s });
  }

  // 17c-2) 灵气内常驻修正（kind=buff）：「敌人在该灵气内时所有防御受到-2减值」「该灵气内的盟友 AC 获得+2加值」
  // 「在该灵气内的敌人对魅惑效果的豁免受到-2减值」「该灵气内的敌人的豁免掷骰受到-2减值」「该灵气内的敌人的技能检定受到-5减值」
  // 批 6e：灵气常驻加减值不依赖命中/豁免终止；主语限定灵气语境（两句型：灵气前置 / 目标前置「X在该灵气内时」），
  // 与 12/12b/12c 的「在…上」结构互补不冲突（攻击骰/伤害骰已由 12-else/12c/12f 承接，不在本模式主语内）。
  if (specs.length === 0 && /灵气/.test(s)) {
    const auraModSubj =
      "(所有防御|防御|AC\\s*和\\s*(?:强韧|反射)|AC|强韧|反射|意志|对[^，。；]{1,14}?(?:效果)?的?豁免(?:掷骰)?|豁免掷骰|豁免|技能检定)";
    // 17c-2b：目标前缀可带「在」（「在该灵气内的盟友的 AC 获得+2加值」）；修饰语前容忍空格（「盟友 AC」）；
    // 「对抗…攻击的」定语（「对抗恐惧攻击的所有防御受到-2减值」）。
    // 捕获组约定：m[1]=修饰子句(auraModSubj)、m[2]=数值、m[3]=加值/减值；目标生物词用非捕获避免占位。
    const auraModTail = `\\s*${auraModSubj}\\s*(?:上)?(?:受到|获得|承受)([+-]?\\d+)\\s*点?(?:威能)?(加值|减值)`;
    m =
      s.match(new RegExp(`(?:在)?(?:该|此)?灵气(?:内)?的?(?:敌人|生物|盟友|植物盟友)?(?:在(?:该|此)?灵气内时)?(?:的)?(?:对抗[^，。；]{1,14}?攻击的)?${auraModTail}`)) ??
      s.match(new RegExp(`(?:敌人|生物|盟友|植物盟友)(?:在(?:该|此)?灵气内时)?(?:的)?(?:对抗[^，。；]{1,14}?攻击的)?${auraModTail}`));
    if (m) {
      const subj = m[1].replace(/\s+/g, "");
      let v = parseInt(m[2].replace(/\s+/g, ""), 10);
      if (m[3] === "减值") v = -Math.abs(v);
      else v = Math.abs(v);
      const b: EffectSpec = { kind: "buff", raw: s, label: `${subj}${fmtSign(v)}` };
      if (/^对/.test(subj)) {
        b.saveMods = v;
        b.label = `豁免${fmtSign(v)}（${subj}）`;
      } else if (/^豁免/.test(subj)) {
        b.saveMods = v;
      } else if (subj === "技能检定") {
        // 技能检定无战斗修正管线，仅描述
      } else if (subj === "所有防御" || subj === "防御") {
        b.defMods = { ac: v, fort: v, ref: v, will: v };
      } else if (subj === "AC和强韧") {
        b.defMods = { ac: v, fort: v };
      } else if (subj === "AC和反射") {
        b.defMods = { ac: v, ref: v };
      } else if (subj === "AC") {
        b.defMods = { ac: v };
      } else if (subj === "强韧") {
        b.defMods = { fort: v };
      } else if (subj === "反射") {
        b.defMods = { ref: v };
      } else if (subj === "意志") {
        b.defMods = { will: v };
      }
      specs.push(b);
    }
  }

  // 17c-3) 灵气内抗性/易伤（kind=resist/buff）：「在该灵气内的盟友获得 5 点火焰抗性」「在该灵气内的敌人获得 5 点心灵易伤」
  m = s.match(/(?:在)?(?:该|此)?灵气(?:内)?的?(?:敌人|生物|盟友)(?:获得|拥有)\s*(\d+)\s*点([^，。；0-9]{1,6}?)(抗性|易伤)/);
  if (m) {
    const t = m[2].trim();
    if (m[3] === "抗性") {
      specs.push({ kind: "resist", raw: s, value: parseInt(m[1], 10), type: t, label: `${t}抗性 ${m[1]}` });
    } else {
      specs.push({ kind: "buff", raw: s, label: `${t}易伤 ${m[1]}`, note: s });
    }
  }

  // 18) 隐形/隐蔽/相位移动（kind=hidden）：「目标隐形直到…」「获得隐蔽和相位移动，直到…」批 4c-1
  // 4e 语义：隐形=全隐蔽（攻击 -5）、获得隐蔽=部分隐蔽（攻击 -2）、相位移动=可穿越障碍；挂载为效果条目供 DM 沿用。
  for (const h of [
    { re: /隐形/, label: "隐形" },
    { re: /获得(?:部分)?隐蔽/, label: "获得隐蔽" },
    { re: /相位移动/, label: "相位移动" },
  ]) {
    if (h.re.test(s)) {
      const dur = s.match(/直到[^，。；]{0,18}/)?.[0];
      specs.push({ kind: "hidden", raw: s, label: h.label, ...(dur ? { duration: dur } : {}), ...(saveOn ? { saveOn, duration: "豁免终止" } : {}) });
    }
  }

  // 19) 状态升级（豁免终止时形态变化）：「目标改迟缓为定身（豁免终止）」「目标改为石化（豁免终止）」批 4c-1
  let sm = s.match(/(?:目标)?改([^，。；]{1,6})为([^，。；]{1,6})（豁免终止）/);
  if (sm) {
    const cond = Object.entries(CONDITION_ZH).find(([zh]) => sm![2].includes(zh))?.[1];
    if (cond) specs.push({ kind: "condition", raw: s, condition: cond, saveOn, note: `由${sm[1]}升级` });
  } else {
    sm = s.match(/(?:目标)?改为?([^，。；]{1,8})（豁免终止）/);
    if (sm) {
      const cond = Object.entries(CONDITION_ZH).find(([zh]) => sm![1].includes(zh))?.[1];
      if (cond) specs.push({ kind: "condition", raw: s, condition: cond, saveOn });
    }
  }

  // 20) 变形/改变形态（kind=transform）：「改变他的物理形态，变为…」批 5（纯效果条目，挂载供 DM 记录）
  m = s.match(/改变(?:他的|她的|它的)?物理形态/);
  if (m) {
    specs.push({ kind: "transform", raw: s, label: "改变形态" });
  }

  // 21) 支配盟友规则（kind=buff·描述性条目）：「被格拉兹特支配的生物在考虑夹击时，算作他的盟友」批 5（规则文本，挂载供 DM 参考）
  m = s.match(/被[^。；]{0,10}支配的生物[^。；]{0,20}算作[^。；]{0,8}盟友/);
  if (m) {
    specs.push({ kind: "buff", raw: s, label: "支配盟友（夹击规则）", note: s });
  }

  // 22) 行动恢复类（kind=removeCondition）：「每当该龙回合结束时，其身上任何晕眩、震慑或受控效果终止」
  // 特性：回合结束时自动移除自身指定状态（挂载为效果条目，回合结算时读取移除）
  m = s.match(/每当(?:该)?([^，。；]{1,8}?)回合结束时，其身上任何([^。；]+?)效果终止/);
  if (m) {
    specs.push({
      kind: "removeCondition",
      raw: s,
      label: "行动恢复：回合结束移除自身状态",
      note: m[2].trim(),
      saveOn: "end",
    });
  }

  if (specs.length > 0) return specs;

  // 17c-4) 条件/规则承接句（kind=buff·描述性）：主效果已由前句自动结算，条件修饰句挂载为描述条目供 DM 沿条件应用。
  // 「若该敌人已经在承受无类型持续伤害，则该伤害增加 5点」「每当敌人在该灵气内结束回合时，该死亡骑士滑移该敌人最多三格」
  // 「重伤时此灵气激活」「多个恶心瘴气灵气叠加， 最多能造成 10点伤害」「此外，任何邻接被诅咒的生物开始回合的盟友也受诅咒…」
  if (
    /^(?:若|如果)该[^，。；]{0,22}(?:则|，则)/.test(s) ||
    (/^每当[^，。；]{0,24}时，/.test(s) && !/其身上[^。；]{0,10}效果终止/.test(s)) ||
    /^重伤时(?:此|该)?(?:灵气)?(?:激活|生效)/.test(s) ||
    /^多个[^，。；]{0,16}(?:灵气|诅咒)不?会?叠加/.test(s) ||
    /^此外，任何邻接[^，。；]{0,12}?开始回合的[^，。；]{0,8}?(?:敌人|生物|盟友)也受到[^，。；]{0,16}?的影响直到其下回合结束/.test(s)
  ) {
    const valM = s.match(/(?:该伤害)?(?:增加|为|造成)\s*(\d+)\s*点/);
    specs.push({
      kind: "buff",
      raw: s,
      label: valM ? `条件修正：${valM[1]} 点` : /^每当/.test(s) ? "条件触发（每当…时）" : /^多个/.test(s) ? "叠加规则" : /^此外，任何邻接/.test(s) ? "诅咒蔓延" : "条件规则",
      note: s,
    });
    return specs;
  }

  // 17c-5) 特定动作/事件触发型伤害（kind=buff·描述性）：「在该灵气内瞬移的敌人受到 10点伤害」
  // 「任何在该灵气内进行攻击的敌人受到 10 点毒素伤害」「任何在该灵气内以近战攻击命中该巴布魔的敌人受到 5 点强酸伤害」
  // 「任何在该灵气内受到持续火焰伤害的敌人受到 5 点额外火焰伤害」
  // 非回合时点（进入时已由 auraEnter 承接），由 DM 在事件发生时手动结算；挂载为描述条目。
  m = s.match(/^(?:任何|所有)?(?:在(?:该|此)?灵气内|灵气内)(?:[^，。；]{0,24}?)的?(?:敌人|生物|盟友)(?:受到|将受到)\s*(\d+)\s*点([^，。；0-9]{0,6})伤害/);
  if (m) {
    const t = m[2].trim();
    specs.push({ kind: "buff", raw: s, label: `动作触发伤害：${m[1]} 点${t ? `（${t}）` : ""}`, note: s });
    return specs;
  }

  // 17c-6) 灵气持有者滑移（kind=move）：「该成年雪暴龙滑移任何在该灵气内结束回合的敌人 1格」批 6e
  // 回合结束触发、落点由 DM 指定（move 条目语义），挂载供回合结算时手动执行。
  m = s.match(/^该[^，。；]{1,12}?滑移任何在(?:该|此)?灵气内结束回合的(?:敌人|生物|盟友)\s*(\d+)\s*格/);
  if (m) {
    specs.push({ kind: "move", raw: s, value: parseInt(m[1], 10), label: `移动：回合结束滑移 ${m[1]} 格`, note: s });
    return specs;
  }

  // 17c-6b) 灵气内被拉动（kind=move）：「任何在该灵气内开始回合的敌人被拉动取决于阿拉巴当前生命值的格数」批 6e
  // 距离随持有者 HP 分档（见 17c-6c 分支表），无法自动取值；挂载为移动条目供 DM 按持有者 HP 落点。
  m = s.match(/^任何在(?:该|此)?灵气内开始回合的(?:敌人|生物|盟友)被拉动/);
  if (m) {
    specs.push({ kind: "move", raw: s, label: "移动：被拉动（距离随持有者HP分档）", note: s });
    return specs;
  }

  // 17c-6c) 条件值分支表（kind=buff·描述性）：「776 至 1100,1格」「551 至 775,2格」… 配合 17c-6b 的分档值。批 6e
  m = s.match(/^\d{1,4}\s*至\s*\d{1,4}\s*,\s*\d+\s*格/);
  if (m) {
    specs.push({ kind: "buff", raw: s, label: "拉动分支（按持有者HP）", note: s });
    return specs;
  }

  // 17c-7) 灵气内规则描述句（kind=buff·描述性）：不可自动结算的禁令/修饰/事件规则，挂载为描述条目供 DM 沿规则应用。批 6e
  for (const r of [
    { re: /不能恢复生命值|不能从火焰抗性获得增益|无法获得火焰抗性的增益/, label: "恢复/抗力禁令" },
    { re: /只能恢复正常值一半|只能获得一半增益|从医疗效果只能获得一半/, label: "治疗减半" },
    { re: /明亮视为昏暗|昏暗视为黑暗|是明亮光照/, label: "光照" },
    { re: /投出\s*19-20\s*可以造成重击/, label: "重击加宽" },
    { re: /死亡豁免失败/, label: "死亡豁免触发" },
    { re: /重投一次失败的威能充能骰/, label: "充能重投" },
    { re: /视为虚体/, label: "虚体" },
    { re: /只受到一半伤害/, label: "伤害减半" },
    { re: /无视该灵气的效果/, label: "免疫灵气" },
    { re: /花费的行动点/, label: "行动点奖励" },
    { re: /DC\d+\s*的[^，。；]{0,10}检定/, label: "技能检定" },
    { re: /不能使用带有传送关键字/, label: "传送禁令" },
    { re: /以一个次要动作激活或取消/, label: "手动开关" },
    { re: /^范围内任何攻击[^，。；]{1,12}?的?(?:敌人|生物|盟友)迟缓/, label: "反击迟缓" },
    { re: /(?:如果在其回合中没有移动(?:的话)?便会|若[^，。；]{0,8}没有移动[^，。；]{0,4}便(?:会)?)迟缓/, label: "条件迟缓（回合中未移动）" },
  ]) {
    if (r.re.test(s)) {
      specs.push({ kind: "buff", raw: s, label: r.label, note: s });
      return specs;
    }
  }

  // 17) 引用攻击句（双重攻击/引用其他威能）：由 parseCreature 的 multiRefs 识别同名威能引用，本句无独立目标效果 → 跳过，不算 manual 批 4c-1
  // 「此龙使用啮咬和爪抓，或使用爪抓两次」「目标以一个自由动作进行一次基本攻击」「使用一次闪电剑和一次火焰鞭」
  // 批 5：「对每个目标使用悲伤之浪」（区域爆发式引用，每个目标各结算一次引用威能）、
  // 「对一个目标做一次X攻击，且对另一个目标做一次Y攻击」（狂暴乱击：分目标多重攻击）同样由 multiRefs 承接。
  if (
    !/不能使用|无法使用|若|如果|则|获得|受到|造成|击倒|束缚|晕眩|持续|隐形|重伤/.test(s) &&
    (
      /使用(?:两次|三次|两次或三次|一次|\d+次|[一二两三四]次)?[^，。；若如果或然后]{1,14}和(?:一次|两次|三次|\d+次|[一二两三四]次)?[^，。；若如果或然后]{1,14}(?:攻击)?/.test(s) ||
      /使用(?:两次|三次|两次或三次|\d+次|[一二两三四]次)[^，。；若如果或然后]{1,14}(?:攻击)?/.test(s) ||
      /进行(?:两次|三次|\d+次|[一二两三四]次)[^，。；若如果或然后]{0,8}(?:攻击|威能)/.test(s) ||
      /进行一次[^，。；]{0,10}攻击/.test(s) ||
      /做(?:一次|两次|三次)[^，。；若如果或然后]{0,10}(?:攻击|威能)/.test(s) || // 批 5：凶猛「它做一次血腥狂怒攻击」（触发特性引用）
      /(?:自由动作|移动动作|标准动作)[^，。；]{0,8}(?:进行一次)?[^，。；]{0,8}(?:基本|近战|近程|远程)攻击/.test(s) ||
      /对每个目标使用[^，。；]{1,14}/.test(s) ||
      /对一个目标做一次[^，。；]{1,14}攻击，且对另一个目标做一次[^，。；]{1,14}攻击/.test(s)
    )
  ) {
    return [];
  }

  // 18) 纯限定语（无可执行效果）：「该移动不会引发借机攻击」「该攻击不会引发借机攻击」批 4c-1
  if (
    /^[^，。；]{0,24}不会(?:因[^，。；]{0,12})?引发借机攻击[^，。；]*$/.test(s) &&
    !/造成|获得|受到|击倒|束缚|晕眩|持续|隐形|伤害|击退|拉近|滑动/.test(s)
  ) {
    return [];
  }

  // 19) 充能并再次使用：「龙息充能，且该龙使用它」批 4c-1（充能由频率机制管理，无独立目标效果）
  if (/充能，且[^，。；]{1,14}使用它/.test(s)) {
    return [];
  }

  // 19b) 水生/水下呼吸限定（纯环境规则，无战斗模拟效果）：「该暗王蛙可以在水下呼吸」「你可以在水下呼吸」批 5
  if (/^(?:该|此|你|它|其)[^，。；]{0,14}可以在水下呼吸$/.test(s)) {
    return [];
  }

  // 20) 区域/结界持续维持（zone 已生成，无新效果）：「次要维持：该结界持续」「该结界持续」批 4c-1
  if (/^(?:该|此)(?:结界|区域)持续/.test(s)) {
    return [];
  }

  // 纯伤害描述句（XdY + N的伤害 / N点伤害）：伤害已由 damageExpr 结算，无需语义化 → 跳过
  // 含任何效果关键词（持续/强制移动/状态/标记/临时生命/时长…）则不属于纯伤害句，继续走 DM 裁决
  if (
    /(\d+d\d+\s*[+-]\s*\d+|\d+d\d+|\d+\s*点[^，。；]*伤害)/.test(s) &&
    !/持续|推离|击退|拉近|拖近|滑动|拖拽|牵引|击倒|倒地|临时生命|再生|标记|传送|豁免终止|直到|定身|目盲|晕眩|眩晕|震慑|迟缓|束缚|支配|石化|虚弱|耳聋|无助|失去意识|战斗优势|攻击骰|擒拿|擒抱|区域|结界|灵气|快步|移动|抗力/.test(s)
  ) {
    return [];
  }

  // 21) 裸范围/目标描述符（效果型威能范围提取后残留；无独立效果）：「近程爆发2」「近程爆发 5（范围内所有盟友）」「射程 视线（一个敌人）」批 5
  if (/^(?:近程爆发|近程冲击|远程|射程|区域|触及)\s*[\d 视线]{1,8}(?:（[^）]*）)?$/.test(s)) {
    return [];
  }

  // 未匹配 → DM 裁决
  return [{ kind: "manual", raw: s }];
}

// ---------- 目标词条解析（UI 与覆盖率报告共用） ----------

/** 目标词条解析结果 */
export interface TargetSpec {
  /** 最少目标数（如「两个生物」= 2，不可只选 1 个） */
  min: number;
  /** 最多目标数 */
  max: number;
  /** 是否强制包含区域内全部目标（如「每个生物」，不可取消） */
  forced: boolean;
  /** 敌/友过滤：enemy=仅敌人、ally=仅盟友、undefined=不限 */
  faction?: "enemy" | "ally";
  /** 条件目标（如「被标记的生物」→ marked）：点选不满足时提示 */
  condTarget?: string;
  /** 体型条件（如「中型或更小」）：点选不满足时提示 */
  sizeCond?: string;
}

/** 状态中文词（目标词条条件目标识别，如「被标记的」「晕眩的」） */
const TARGET_COND_WORDS: Record<string, string> = {
  被标记: "marked",
  受标记: "marked",
  晕眩: "dazed",
  眩晕: "dazed",
  震慑: "stunned",
  定身: "immobilized",
  束缚: "restrained",
  虚弱: "weakened",
  目盲: "blinded",
  倒地: "prone",
  濒死: "dying",
};

/** 解析目标词条 → 最少/最多目标数与是否强制包含全部。
 * 「每个/所有」→ 强制全选；区域词条（范围内/效果区域）无数量词 → 强制全选；
 * 「两个生物」→ 恰好 2 个（不得少于 2）；「一个或两个生物」→ 可选 1~2；其余默认单目标。
 * 附带敌/友过滤、条件目标、体型条件（供清单条过滤与可达性着色）。 */
export function parseTargetSpec(target: string): TargetSpec {
  const t = target ?? "";
  const inArea = /范围内|区域内/.test(t); // 「区域内」覆盖「效果区域内」
  const hasQuantity = /一个|两个|二个/.test(t);
  const forced = /每个|所有|全部/.test(t) || (inArea && !hasQuantity);
  const spec: TargetSpec =
    /(一个|一)或(两|二)个/.test(t) ? { min: 1, max: 2, forced } :
    /(两个|二个)(生物|敌人)/.test(t) ? { min: 2, max: 2, forced } :
    { min: 1, max: 1, forced };

  // 敌/友过滤：词条显式含「敌人/敌方的」→ enemy；「盟友/友方」→ ally
  if (/敌人|敌方的|敌对/.test(t)) spec.faction = "enemy";
  else if (/盟友|友方/.test(t)) spec.faction = "ally";

  // 条件目标（「被标记的生物」等）
  for (const [zh, key] of Object.entries(TARGET_COND_WORDS)) {
    if (t.includes(zh)) {
      spec.condTarget = key;
      break;
    }
  }

  // 体型条件（「大型或更大」「中型或更小」）
  const sm = t.match(/(超巨型|巨型|大型|中型|小型|微型)(?:或(更大|更小))?/);
  if (sm) {
    const size = sm[1];
    const dir = sm[2] ?? "";
    spec.sizeCond = size + (dir ? `或${dir}` : "");
  }
  return spec;
}

// ---------- 抗性 / 易伤 / 免疫 / 虚体 解析 ----------

/** 解析一条「抗力/易伤」值串（如 "10火焰" / "15暗蚀，虚体" / "火焰5"）：
 * 返回 { map: 类型→数值, insubstantial: 是否虚体 } */
export function parseResistList(valueText: string): { map: Record<string, number>; insubstantial: boolean } {
  const map: Record<string, number> = {};
  let insubstantial = false;
  const parts = (valueText ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  for (const p of parts) {
    if (/虚体/.test(p)) {
      insubstantial = true;
      continue;
    }
    if (/^全(?:部)?$/.test(p)) {
      map["all"] = Infinity;
      continue;
    }
    // N[点]类型 或 类型N
    let m = p.match(/^(\d+)\s*点?\s*(.+)$/);
    if (m) {
      const v = parseInt(m[1], 10);
      const t = DAMAGE_TYPE_ZH[m[2]] ?? m[2];
      map[t] = v;
      continue;
    }
    m = p.match(/^(.+?)\s*(\d+)$/);
    if (m) {
      const t = DAMAGE_TYPE_ZH[m[1]] ?? m[1];
      map[t] = parseInt(m[2], 10);
    }
    // 无法匹配的（如 "对近程和区域攻击的5点易伤"）→ 忽略（保留原文展示，不静默丢语义：由行内原始文本兜底）
  }
  return { map, insubstantial };
}

// ---------- 怪物解析 ----------

/** 体型 → 占格数（4e：中型=1，大型=2，巨型=4，超巨型=9；小型/微型=1） */
export function sizeToSquares(sizeText: string): number {
  if (/超巨型/.test(sizeText)) return 9;
  if (/巨型/.test(sizeText)) return 4;
  if (/大型/.test(sizeText)) return 2;
  return 1;
}

const DEFENSE_MAP: Record<string, DefenseKey> = {
  AC: "ac",
  强韧: "fort",
  反射: "ref",
  意志: "will",
};

const KIND_BY_CATEGORY: Record<string, AttackKind> = {
  特性: "trait",
  标准动作: "standard",
  次要动作: "minor",
  移动动作: "move",
  触发动作: "immediate",
  免费动作: "free",
  自由动作: "free",
  // 魔宠/伙伴的增益区（固有/被动/主动 增益、怪癖）——均非攻击，归为特性展示
  固有增益: "trait",
  被动增益: "trait",
  主动增益: "trait",
  怪癖: "trait",
};

/** 动作类型简称 → AttackKind（批 4-4a-2：无 bg-category 的召唤兽/召唤型怪物块头「名称（标准；随意）」或「标准动作✦随意」） */
const KIND_ALIAS: Record<string, AttackKind> = {
  标准: "standard",
  标准动作: "standard",
  移动: "move",
  移动动作: "move",
  次要: "minor",
  次要动作: "minor",
  借机: "immediate",
  借机动作: "immediate",
  触发: "immediate",
  触发动作: "immediate",
  自由: "free",
  自由动作: "free",
  免费: "free",
  免费动作: "free",
  特性: "trait",
  灵气: "aura",
};

/** 伤害表达式：NdM+偏 / NdM / N点伤害（批 4-4a-2：攻击线与紧凑格式共用） */
const DAMAGE_EXPR_RE = /(\d+d\d+\s*[+-]\s*\d+|\d+d\d+|\d+\s*点伤害)/;

/** 从单条怪物正文解析出 CombatantStats；返回 null 表示非属性块怪物（召唤生物/模板） */
export function parseCreature(entry: Entry): CombatantStats | null {
  const html = entry.sourceText;
  if (!html || !/生命值/.test(html) && !/先攻/.test(html)) return null;

  const stats: CombatantStats = {
    kind: "monster",
    name: entry.name,
    size: 1,
    maxHp: 0,
    bloodied: 0,
    hp: 0,
    tempHp: 0,
    surgeValue: 0,
    ac: 10,
    fort: 10,
    ref: 10,
    will: 10,
    init: 0,
    speed: 6,
    attacks: [],
    rawText: html,
  };

  // 召唤兽标记（批 4-4a-2）：先攻行「先攻 和召出者一样」或标题带「召唤生物」→ 可绑定召出者、解除/死亡自动移除
  if (/先攻[\s\S]{0,3}和召出者一样/.test(html) || /召唤生物/.test(html.slice(0, 600))) {
    stats.summoned = true;
  }

  // 1) 标题行：等级与角色
  const titleMatch = html.match(/<div class="bold font-size-h4 bg-title">([\s\S]*?)<\/div>/);
  if (titleMatch) {
    const spans = [...titleMatch[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => stripTags(m[1]));
    const lvlRole = spans[1] ?? "";
    // 等级前缀兼容两种写法：「3级  护卫」与「等级10 杂兵 游击」
    const lm = lvlRole.match(/(\d+)\s*级|等级\s*(\d+)/);
    if (lm) stats.level = parseInt(lm[1] ?? lm[2], 10);
    // 角色：去掉「N级/等级N」前缀与 {{!!tier}} 等模板占位符
    let role = lvlRole.replace(/(?:\d+\s*级|等级\s*\d+)\s*/, "").replace(/\{\{[^}]+\}\}/g, "").trim();
    // 召唤生物/魔宠/元素伙伴不是职位：标记召唤类型，职位取括号内（如「召唤生物（杂兵）」→ 杂兵）
    if (/召唤生物|魔宠|元素伙伴/.test(role)) {
      stats.summoned = true;
      const paren = role.match(/[（(]([^）)]+)[）)]/);
      role = paren ? paren[1].trim() : "";
    }
    // 类型/职能拆分：先剥「杂兵/精英/强者/头目」类型词（含括号后缀「（头目）」），剩余为职能
    // 优先级：杂兵/精英/强者 优先（头目=领导者标记，不改变经验倍率，仅在无其它类型词时兜底）
    // 例：「杂兵 远程」→ tier=杂兵, role=远程；「精英 护卫（头目）」→ tier=精英, role=护卫；「游击（头目）」→ tier=头目, role=游击
    const markers = [...role.matchAll(/[（(]([^）)]*)[）)]/g)].map((x) => x[1].trim()).filter(Boolean);
    const TIER_WORDS = ["杂兵", "精英", "强者", "头目"];
    const tierWord = TIER_WORDS.find((w) => role.includes(w));
    if (tierWord) {
      stats.tier = tierWord;
      for (const w of TIER_WORDS) role = role.split(w).join("");
    }
    if (markers.length) stats.tierTags = markers;
    role = role.replace(/[（()）]/g, "").replace(/\s+/g, "").trim();
    stats.role = role || undefined;
  }

  // 2) 体型/界域/类别行 + XP：`中型 自然界 类人生物（鳞爪类），战蜥人` + `XP 300`
  // 体型→占格数；界域/类别/种群→筛选维度；XP→经验值
  const sizeMatch = html.match(/<div class=bg-title>([\s\S]*?)<\/div>/);
  if (sizeMatch) {
    const spans = [...sizeMatch[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => stripTags(m[1]));
    const text = spans[0] ?? "";
    stats.size = sizeToSquares(text);

    // 拆「体型 界域 类别」：先剥体型词，再剥界域词，剩余为类别（含括号细分/逗号种群）
    const SIZE_WORDS = ["超巨型", "巨型", "超大型", "大型或巨型", "大型", "中型", "小型", "微型", "超小型", "或巨型"];
    const ORIGIN_WORDS = ["自然界", "精界", "元素界", "星界", "异界", "暗影界", "妖精界", "虚空"];
    let rest = text;
    for (const w of SIZE_WORDS) {
      if (rest.startsWith(w)) {
        stats.sizeClass = w; // 记录具体体型类别，供体型筛选（与占格数 size 互补）
        rest = rest.slice(w.length).trim();
        break;
      }
    }
    let origin = "";
    for (const w of ORIGIN_WORDS) {
      if (rest.startsWith(w)) { origin = w; rest = rest.slice(w.length).trim(); break; }
    }
    // 别名归并：妖精界=精界
    if (origin === "妖精界") origin = "精界";
    if (origin) stats.origin = origin;
    // 清理数据源笔误尾巴（「魔法兽 XP-」「类人生物 X400」）
    rest = rest.replace(/\s+X\s*P?-?\s*[\d,]*$/, "").trim();

    // 类别主体 + 种群：先剥括号（括号内逗号前=细分、逗号后=具体种群），再处理括号外逗号（如「类人生物，人类」）
    // 例：「类人生物（鳞爪类），战蜥人」→ category=类人生物, species=战蜥人
    // 例：「魔法兽（气系，龙）」→ category=魔法兽, species=龙
    // 例：「类人生物（不死生物）」→ category=类人生物, species=不死生物
    let cat = rest;
    let species = "";
    const parenM = rest.match(/[（(]([^）)]*)[）)]/);
    if (parenM) {
      cat = rest.replace(/[（(][^）)]*[）)]/, "").trim();
      const inner = parenM[1].split(/[，,]/).map((s) => s.trim()).filter(Boolean);
      species = inner.length > 1 ? inner[inner.length - 1] : (inner[0] ?? "");
    }
    const commaOut = cat.match(/[，,]\s*([^，,]+)$/);
    if (commaOut) {
      species = commaOut[1].trim();
      cat = cat.replace(/[，,].*$/, "").trim();
    }
    // 纯限定词兜底：逗号后缀是「雌性/雄性」等非种群词（如「类人生物，雌性」的美杜莎）→ 回退括号内细分；无括号则留空
    if (/^(?:雌性|雄性|母的|公的|双性)$/.test(species)) {
      species = "";
    }
    if (cat) stats.category = cat;
    if (species) stats.species = species;

    // XP：同行的第二个 span 通常是 `XP 300` / `XP 2,000`（注意千位逗号）
    const xpText = spans.slice(1).join(" ") + " " + stripTags(sizeMatch[1]);
    const xpM = xpText.match(/XP\s*([\d,]+)/);
    if (xpM) stats.xp = parseInt(xpM[1].replace(/,/g, ""), 10);
  }

  // 3) 无 class 的统计行（生命值/先攻/防御/速度/抗力/免疫…；同一行可能含多个标签，全部尝试）
  for (const m of html.matchAll(/<div>([\s\S]*?)<\/div>/g)) {
    const text = stripTags(m[1]);
    if (!text) continue;

    let mm = text.match(/生命值\s*([\d,]+)/);
    if (mm) {
      stats.maxHp = parseInt(mm[1].replace(/,/g, ""), 10);
      mm = text.match(/重伤\s*([\d,]+)/);
      // 杂兵：HP 1、无重伤行 → bloodied 兜底为 1（否则 floor(1/2)=0 会被下方判空丢弃）
      stats.bloodied = mm ? parseInt(mm[1].replace(/,/g, ""), 10) : Math.max(1, Math.floor(stats.maxHp / 2));
      stats.hp = stats.maxHp;
    }
    mm = text.match(/先攻\s*([+-]\s*\d+)/);
    if (mm) {
      stats.init = parseInt(mm[1].replace(/\s+/g, ""), 10);
    }
    mm = text.match(/AC\s*([\d,]+)/);
    if (mm) {
      stats.ac = parseInt(mm[1].replace(/,/g, ""), 10);
      mm = text.match(/强韧\s*([\d,]+)/);
      if (mm) stats.fort = parseInt(mm[1].replace(/,/g, ""), 10);
      mm = text.match(/反射\s*([\d,]+)/);
      if (mm) stats.ref = parseInt(mm[1].replace(/,/g, ""), 10);
      mm = text.match(/意志\s*([\d,]+)/);
      if (mm) stats.will = parseInt(mm[1].replace(/,/g, ""), 10);
    }
    mm = text.match(/速度\s*(\d+)/);
    if (mm) {
      stats.speed = parseInt(mm[1], 10);
    }
    // 伤害修正数据行：''抗力'' 10火焰 / ''易伤'' 5闪电 / ''免疫'' 魅惑，睡眠，震慑 / 虚体
    mm = text.match(/抗力\s*([^；]+)/);
    if (mm) {
      const r = parseResistList(mm[1]);
      stats.resistances = { ...(stats.resistances ?? {}), ...r.map };
      if (r.insubstantial) stats.insubstantial = true;
    }
    mm = text.match(/易伤\s*([^；]+)/);
    if (mm) {
      const r = parseResistList(mm[1]);
      stats.vulnerabilities = { ...(stats.vulnerabilities ?? {}), ...r.map };
      if (r.insubstantial) stats.insubstantial = true;
    }
    mm = text.match(/免疫\s*([^；]+)/);
    if (mm) {
      // 伤害类免疫词映射标准键（供伤害管线短路），效果类免疫保留原文
      const list = mm[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((s) => DAMAGE_TYPE_ZH[s] ?? s);
      stats.immunities = [...(stats.immunities ?? []), ...list];
    }
    if (/虚体/.test(text)) stats.insubstantial = true;
  }

  if (stats.maxHp <= 0) return null;

  // 4) 分区解析动作/特性
  const sections = html.split(/<div class="bold font-size-h4 bg-category">/);
  // 无 bg-category 的怪物（召唤兽/召唤型兵种等，批 4-4a-2）：整个 html 作为一个 section，块头自带动作类型标记
  const iterSections = sections.length > 1 ? sections.slice(1) : [html];
  const usedKeys = new Set<string>();
  for (const section of iterSections) {
    const catMatch = section.match(/^([^<]*?)<\/div>/);
    const cat = catMatch ? stripTags(catMatch[1]) : "";
    const kind = KIND_BY_CATEGORY[cat] ?? "standard";

    const blockRe = /<div class="bold bg-power">([\s\S]*?)<\/div>([\s\S]*?)(?=<div class="bold bg-power">|$)/g;
    let bm: RegExpExecArray | null;
    // 批 6e：最近一次推送的灵气 attack（供续行块把拆分的效果句合并回去重算语义化）
    let lastAura: AttackOption | null = null;
    while ((bm = blockRe.exec(section)) !== null) {
      const headerHtml = bm[1];
      const bodyHtml = bm[2];
      const header = stripTags(headerHtml).replace(/^\s*\{\{[^}]*\}\}\s*/, "").trim();
      if (!header) continue;

      // 批 6e：灵气效果续行块（源数据把灵气效果句拆成「图标块句首 + description 句尾」两块，如
      // 「<div class=bg-power>{{$:/dnd/images/aura}}任何在该灵气内…标记直到该X下回</div><div class=description>合结束。</div>」）
      // 续行块 icon 可能是 aura 或 meleebasic 等（复用图标）；判定依据：含 wiki 图标模板、无✦频率、内容非动作名（长度>6）。
      // 该块无✦频率（判定为续行）且不是独立攻击：把「句首(header) + 句尾(description)」合并回上一灵气块并重算语义化，否则跳过。
      if (/\{\{\$:\/dnd\/images\/[a-z]+\}\}/.test(headerHtml) && !header.includes("✦") && header.length > 6) {
        if (lastAura) {
          const tailM = bodyHtml.match(/<div class="?description"?>([\s\S]*?)<\/div>/);
          const tail = tailM ? stripTags(tailM[1]).trim() : "";
          setAuraSpecs(lastAura, header + tail);
        }
        continue;
      }

      // 名称/类型 ✦ 频率；无 bg-category 的块头可能是「名称（标准；随意）」或「标准动作✦随意」
      const parts = header.split("✦");
      let name = parts[0].trim();
      let freq = (parts[1] ?? "").trim();

      // 威能描述块：兼容新旧两种属性写法（旧库 `class=description`，新库 `class="description"`）
      const descMatch = bodyHtml.match(/<div class="?description"?>([\s\S]*?)<\/div>/);
      let desc = descMatch ? stripTags(descMatch[1]) : "";
      // 批 6e：把同块内紧随的灵气图标续行句首拼到 desc 之前（句首 + 句尾 = 完整效果句）
      const auraContM = bodyHtml.match(/<div class="bold bg-power">\{\{\$:\/dnd\/images\/aura\}\}([\s\S]*?)<\/div>/);
      if (auraContM) desc = stripTags(auraContM[1]).trim() + desc;

      // 灵气
      let attackKind: AttackKind = kind;
      let rangeStr = "";
      if (/^灵气/.test(freq)) {
        attackKind = "aura";
        rangeStr = freq;
      }
      // 无 bg-category 怪物块头补充：名称（类型；频率）→ 拆出动作类型；纯类型名块（标准动作✦随意）→ 类型即名称
      const parenM = name.match(/^(.+?)（([^）]+)）$/);
      if (parenM) {
        const inner = parenM[2].split(/[；;]/).map((s) => s.trim());
        if (inner[0] && KIND_ALIAS[inner[0]]) {
          name = parenM[1].trim();
          attackKind = KIND_ALIAS[inner[0]];
          if (inner[1]) freq = inner[1];
          if (/^灵气/.test(freq)) {
            attackKind = "aura";
            rangeStr = freq;
          }
        }
      } else if (KIND_ALIAS[name]) {
        attackKind = KIND_ALIAS[name];
      }

      // 解析攻击行。攻加值可能是固定数字（近战1；+8 vs. AC），
      // 也可能是召唤兽依赖等级（近战1；你的等级 + 5 vs. AC）——后者无固定加值，标记 attackVar 让结算时手填。
      // 兼容两种写法：旧库「攻击：近战2（一个生物）；+19 vs. AC」（分号分隔），
      // 新库「攻击：近战 2（一个生物）+27 vs. AC」（无分号）或「攻击：+28 vs. AC」（无射程）。
      let attack: number | null = null;
      let attackVar = false;
      let defense: DefenseKey = "ac";
      let damageExpr = "";
      let target = "一个生物";
      const atkMatch = desc.match(/攻击：(.*?)\s*(你的等级\s*[+-]\s*\d+|[+-]\s*\d+)\s*vs\.?\s*(AC|强韧|反射|意志)/);
      if (atkMatch) {
        const rangeTarget = atkMatch[1].trim();
        const rm = rangeTarget.match(/^([^\（(]+)/);
        if (rm) rangeStr = rm[1].replace(/[；;。\s]+$/, "").trim();
        const bonusTxt = atkMatch[2].replace(/\s+/g, "");
        if (/^你的等级/.test(bonusTxt)) attackVar = true;
        else attack = parseInt(bonusTxt, 10);
        defense = DEFENSE_MAP[atkMatch[3]] ?? "ac";
        const hitMatch = desc.match(/命中：([^。；\n]+)/);
        if (hitMatch) {
          const dm = hitMatch[1].match(DAMAGE_EXPR_RE);
          if (dm) damageExpr = dm[1].replace(/\s+/g, "");
        }
      } else {
        // 紧凑格式（召唤兽等无「攻击：」前缀，批 4-4a-2）：[目标/触及2]；+14 vs. AC；1d10 + 6的伤害
        const cRe = desc.match(/^([^，。]*?)?(?:；|;)?\s*([+-]\s*\d+)\s*vs\.?\s*(AC|强韧|反射|意志)/);
        if (cRe) {
          const prefix = (cRe[1] ?? "").trim();
          const rm = prefix.match(/(触及|近程爆发|近程冲击|近程|远程|区域|近战)\s*\d+/);
          if (rm) rangeStr = rm[0].replace(/\s+/g, "");
          if (!rangeStr && prefix && /目标|生物|敌人/.test(prefix)) target = prefix;
          attack = parseInt(cRe[2].replace(/\s+/g, ""), 10);
          defense = DEFENSE_MAP[cRe[3]] ?? "ac";
          const dm = desc.match(DAMAGE_EXPR_RE);
          if (dm) damageExpr = dm[1].replace(/\s+/g, "");
        }
      }

      // 显式重击表达式（批 6）：「（重击为9d12 + 46）」「（若重击则6d10 + 67）」→ critExpr，重击时伤害取该表达式最大。
      // 与「重击，则目标昏迷」等附加效果从句区分：只收括号内紧接「重击为/重击则」且内容为骰式/纯数值的从句。
      let critExpr = "";
      {
        const cm = desc.match(/（(?:若\s*)?重击\s*(?:为|则)\s*([^）)]*?)\s*(?:伤害)?）/);
        if (cm) {
          const cand = cm[1].replace(/[，。]/g, "").replace(/\s+/g, "").replace(/＋/g, "+").replace(/−|－/g, "-");
          if (DAMAGE_EXPR_RE.test(cand) || /^[+-]?\d+$/.test(cand)) critExpr = cand;
        }
      }

      // 效果型威能（无攻击骰）射程回退：效果段含「区域N墙M」/「区域N爆发N」/「区域N」/「近程爆发N」/「远程N」→ 提取为射程（供区域/墙放置入口）
      // 批 5：补「近程爆发N」「远程N」（此前只认区域型，致盲烟尘等效果型威能范围漏空）
      if (!rangeStr && attack === null) {
        const wm = desc.match(/区域\s*(\d+)\s*墙\s*(\d+)/);
        const bm = desc.match(/区域\s*(\d+)\s*爆发\s*(\d+)/);
        const am = desc.match(/区域\s*(\d+)(?![墙爆])/);
        const cm = desc.match(/近程爆发\s*(\d+)/);
        const rm2 = desc.match(/远程\s*(\d+)/);
        if (wm) rangeStr = `区域${wm[1]}墙${wm[2]}`;
        else if (bm) rangeStr = `区域${bm[1]}爆发${bm[2]}`;
        else if (am) rangeStr = `区域${am[1]}`;
        else if (cm) rangeStr = `近程爆发${cm[1]}`;
        else if (rm2) rangeStr = `远程${rm2[1]}`;
      }

      const targetMatch = desc.match(/攻击：[^\（(]*（([^）)]*)）/);
      if (targetMatch) target = targetMatch[1];

      // 结构化分段：命中/次命中/未命中/效果/维持，供回合日志精确撰写「威能→命中→伤害→效果」
      const seg = parseSegments(desc);

      // 触发条件（「触发：」段，到「攻击：/效果：」前为止；借机/即时反应/中断威能）
      let trigger: string | undefined;
      const tm = desc.match(/触发：([\s\S]*?)(?=(?:攻击(?:（[^）]*）)?：|效果(?:（[^）]*）)?：|$))/);
      if (tm && tm[1].trim()) trigger = tm[1].trim();

      // 效果语义化（第 2 层）：把命中/次命中/未命中/效果 段合并解析成可执行效果
      // 批 4c-1：失手段为「一半伤害/半额伤害」→ 归入 AttackOption.halfDamageOnMiss（未命中仍受一半伤害），不再走语义化
      const halfDamageOnMiss = !!seg.miss && /一半伤害|半额伤害|半数伤害|受到一半/.test(seg.miss);
      const specTexts = [seg.hit, seg.second, halfDamageOnMiss ? undefined : seg.miss, seg.effect].filter((x): x is string => !!x);
      // 紧凑格式攻击（无「命中：」分段，批 4-4a-2）：伤害之后「，且…」或防御之后「；…」为效果从句，并入语义化
      let compClause: string | undefined;
      if (attack !== null && !seg.hit) {
        const dmgEnd = desc.indexOf("的伤害");
        let clause = "";
        if (dmgEnd !== -1) clause = desc.slice(dmgEnd + 3);
        else {
          const vIdx = desc.search(/vs\.?\s*(AC|强韧|反射|意志)/);
          if (vIdx !== -1) clause = desc.slice(vIdx).replace(/^[^；;]*[；;]/, "");
        }
        const c = clause.replace(/^[，,、和且\s]+/, "").trim();
        if (c) compClause = c;
      }
      if (compClause) specTexts.push(compClause);
      let specSrc = specTexts.join("；");
      // 批 5：无分段的纯效果型威能（灵气/特性，如鲜血之地/凶猛/战斗优势）：整段正文语义化；
      // 剥掉「触发/要求/攻击」前置段（触发已提取到 trigger，攻击段无命中时不应进效果语义化）。
      if (!specSrc.trim() && attack === null) {
        const body = desc.replace(/^(?:触发|要求|攻击)[^：:]*[：:]/, "").trim();
        if (body) specSrc = body;
      }
      let effectSpecs: EffectSpec[] | undefined;
      let coverage: "fully" | "partial" | "manual" | undefined;
      let unparsed: string[] | undefined;
      if (specSrc.trim()) {
        // 批：按 4e 分段语义标注生效时机——命中/次命中/紧凑从句 → hit（仅命中生效）；
        // 未命中 → miss；效果 → 恒生效（缺省 when，命中/未命中都挂载）
        const hitParts = [seg.hit, seg.second, compClause].filter((x): x is string => !!x);
        const missParts = halfDamageOnMiss ? [] : [seg.miss].filter((x): x is string => !!x);
        const bothParts = [seg.effect].filter((x): x is string => !!x);
        const allSpecs: EffectSpec[] = [];
        const consume = (texts: string[], when: "hit" | "miss" | undefined): void => {
          if (texts.length === 0) return;
          const r = parsePowerEffects(texts.join("；"));
          for (const s of r.specs) {
            if (when) s.when = s.when ?? when;
            allSpecs.push(s);
          }
        };
        consume(hitParts, "hit");
        consume(missParts, "miss");
        consume(bothParts, undefined);
        if (allSpecs.length > 0) {
          effectSpecs = allSpecs;
          const manuals = allSpecs.filter((s) => s.kind === "manual");
          if (manuals.length === allSpecs.length) {
            coverage = "manual";
            unparsed = manuals.map((s) => s.raw);
          } else if (manuals.length > 0) {
            coverage = "partial";
            unparsed = manuals.map((s) => s.raw);
          } else {
            coverage = "fully";
          }
        } else {
          // 无效果句（纯伤害威能）：无可解析效果，视为 fully
          coverage = "fully";
        }
      }

      // 伤害类型：在命中/效果段找类型词（长词优先）；紧凑格式攻击无分段 → 直接查原文
      let damageType: string | undefined;
      const typeSearch = (seg.hit ?? "") + " " + (seg.effect ?? "") + (attack !== null && !seg.hit ? " " + desc : "");
      for (const w of DAMAGE_WORDS) {
        if (typeSearch.includes(w)) {
          damageType = DAMAGE_TYPE_ZH[w];
          break;
        }
      }

      // 强制移动距离汇总（推/拉/滑）：供结算条/强制移动模式预知
      let forcedDist: number | undefined;
      const fm = specSrc.match(/(推离|击退|拉近|拖近|滑动|拖拽|牵引)[^。；]{0,12}?(\d+)\s*格/);
      if (fm) forcedDist = parseInt(fm[2], 10);

      // 多重攻击检测（批 4-4a）：
      // - 攻击线型（有攻加值）：爪击「（如果该龙只以一个生物为目标，则它可以对该生物进行两次该攻击）」
      //   「（该骷髅对同一个目标进行两次攻击）」，以及命中/效果段「进行两次基本攻击/两次近战攻击」。
      //   条件多重（multiCond）：仅当威能只以一个生物为目标时触发。
      // - 效果型（无攻加值）：「效果：该枭熊使用两次冬爪」「进行三次爪击攻击」→ 引用攻击者攻击列表中同名威能 → multiRefs。
      let multiHits: number | undefined;
      let multiCond: boolean | undefined;
      let multiRefs: { name: string; count: number }[] | undefined;
      let multiSplit: boolean | undefined;
      if (attack !== null) {
        const mh1 = desc.match(/(?:如果|若)该[^）]*只以一个生物(?:为|作为)目标，则它(?:可以|可)对该生物进行(两次|三次)该攻击/);
        const mh2 = desc.match(/该[^）]*对同一个目标进行(两次|三次)攻击/);
        if (mh1 || mh2) {
          multiHits = (mh1?.[1] ?? mh2?.[1]) === "三次" ? 3 : 2;
          multiCond = true;
        } else {
          const mh3 = specSrc.match(/(?<![\s\S]{0,20}目标)(?:进行)(两次|三次)(?:基本|近战|近程)攻击/);
          if (mh3) {
            multiHits = mh3[1] === "三次" ? 3 : 2;
            multiCond = false;
          }
        }
      } else if (attack === null) {
        // 效果型引用（批 4-4a + 4c-1）：引用攻击者攻击列表中同名威能 → multiRefs。
        // 三种形式：前置次数「使用两次冬爪」「进行3次爪抓攻击」；后置次数「使用爪抓两次」；
        // 并列「使用啮咬和爪抓，或使用爪抓两次」「使用细剑和匕首攻击」。
        const pushRef = (name: string, count: number) => {
          const n = name.replace(/次$/, "").trim();
          if (!n) return;
          multiRefs = multiRefs ?? [];
          const ex = multiRefs.find((x) => x.name === n);
          if (ex) ex.count += count;
          else multiRefs.push({ name: n, count });
        };
        const cntOf = (t: string): number => {
          if (t.includes("三")) return 3;
          if (t.includes("两") || t.includes("二")) return 2;
          const n = parseInt(t, 10);
          return Number.isFinite(n) ? n : 1;
        };
        // 前置次数：使用/进行 N次 X
        const preRe = /(?:使用|进行)(两次|三次|两次或三次|\d+次|[一二两三四]次)([^，。；若如果或然后]{1,14}?)(?:攻击)?(?=$|[，。；]|若|如果|或|然后)/g;
        let pm: RegExpExecArray | null;
        while ((pm = preRe.exec(specSrc)) !== null) pushRef(pm[2], cntOf(pm[1]));
        // 后置次数：使用X两次
        const postRe = /使用([^，。；若如果或然后]{1,12}?)(两次|三次|两次或三次|\d+次|[一二两三四]次)/g;
        let qm: RegExpExecArray | null;
        while ((qm = postRe.exec(specSrc)) !== null) pushRef(qm[1], cntOf(qm[2]));
        // 并列：使用A和B（攻击）
        const andRe = /使用([^，。；若如果或然后]{1,10})和([^，。；若如果或然后]{1,10})(?:攻击)?(?=$|[，。；]|若|如果|或|然后)/g;
        let am: RegExpExecArray | null;
        while ((am = andRe.exec(specSrc)) !== null) {
          pushRef(am[1], 1);
          pushRef(am[2], 1);
        }
        // 对每个目标使用X（批 5）：区域爆发式引用（如格拉兹特「悲伤旋风」对爆发范围内每个目标各用一次悲伤之浪）→ multiRefs [{X,1}]
        const perRe = /对每个目标使用([^，。；若如果或然后]{1,14})(?:攻击)?/g;
        let prm: RegExpExecArray | null;
        while ((prm = perRe.exec(specSrc)) !== null) pushRef(prm[1], 1);
        // 分目标多重攻击（批 5）：「对一个目标做一次X攻击，且对另一个目标做一次Y攻击」→ multiRefs [{X,1},{Y,1}] + multiSplit
        // （如巴菲门特「狂暴乱击」：切心者打目标A、角撞打目标B，两段各指不同目标）
        const splitRe = /对一个目标做一次([^，。；若如果或然后]{1,14}?)攻击，且对另一个目标做一次([^，。；若如果或然后]{1,14}?)攻击/;
        const splitM = splitRe.exec(specSrc);
        if (splitM) {
          pushRef(splitM[1], 1);
          pushRef(splitM[2], 1);
          multiSplit = true;
        }
      }

      // 同属性块内重名能力（如多只同名攻击）追加序号，避免 React key 冲突
      let key = `${entry.id}#${name}`;
      let n = 2;
      while (usedKeys.has(key)) key = `${entry.id}#${name}#${n++}`;
      usedKeys.add(key);

      const opt: AttackOption = {
        key,
        name,
        kind: attackKind,
        range: rangeStr || (attack !== null ? "近战1" : ""),
        target,
        attack,
        attackVar: attackVar || undefined,
        defense,
        damageExpr,
        effectText: desc,
        freq: freq || undefined,
        hit: seg.hit,
        second: seg.second,
        miss: seg.miss,
        effect: seg.effect,
        sustain: seg.sustain,
        aura: attackKind === "aura" || undefined,
        trigger,
        damageType,
        forcedDist,
        effectSpecs,
        coverage,
        unparsed,
        multiHits,
        multiCond: multiCond || undefined,
        multiRefs,
        multiSplit: multiSplit || undefined,
        halfDamageOnMiss: halfDamageOnMiss || undefined,
        critExpr: critExpr || undefined,
      };
      stats.attacks.push(opt);
      if (attackKind === "aura") lastAura = opt;
    }
  }

  fixCreatureXP(stats);
  return stats;
}

// ---------- 经验值清洗（源数据笔误修正，4e 等级×类型表） ----------

/** 4e 标准怪物 XP 表（杂兵=÷4、精英=×2、强者=×5；头目/无类型标记=×1） */
const XP_BY_LEVEL: Record<number, number> = {
  1: 100, 2: 125, 3: 150, 4: 175, 5: 200, 6: 250, 7: 300, 8: 350, 9: 400, 10: 500,
  11: 600, 12: 700, 13: 800, 14: 1000, 15: 1200, 16: 1400, 17: 1600, 18: 2000, 19: 2400, 20: 2800,
  21: 3200, 22: 4150, 23: 5100, 24: 6050, 25: 7000, 26: 9000, 27: 11000, 28: 13000, 29: 15000, 30: 19000,
};

/** 源数据已知笔误白名单：怪物名 → 正确 XP（对照 4e 表人工核对原文确认源数据打错，自动修正） */
const XP_FIX_BY_NAME: Record<string, number> = {
  龙牙战士: 300,        // 源 30,250（L15 杂兵 = 1200÷4）
  豺狼人恶魔之子: 400,  // 源 900（L9 标准 = 400）
  吉斯洋基士兵: 200,    // 源 175（L13 杂兵 = 800÷4）
  怯魔小仆: 175,        // 源 250（L12 杂兵 = 700÷4）
  深渊食尸鬼饿死鬼: 500, // 源 1400（L18 杂兵 = 2000÷4）
  凤羽鸟: 700,          // 源 350（L12 标准 = 700）
  凤羽人斗士: 700,      // 源 350（L12 标准 = 700）
  凤羽人法师: 700,      // 源 350（L12 标准 = 700）
  脓包衍体: 300,        // 源 3000（L15 杂兵 = 1200÷4）
  妖精骑士亡灵: 1400,   // 源 14000（L16 标准 = 1400，多打 0）
  妖精咒术师亡灵: 2000, // 源 20000（L18 标准 = 2000，多打 0）
  豺狼精魂: 75,         // 源 750（L7 杂兵 = 300÷4，多打 0）
  堕落魔王: 30000,      // 源 15000（L29 精英 = 15000×2）
  罗丝的化身: 35000,    // 源 14000（L25 强者 = 7000×5）
};

/**
 * 经验值清洗：10× 多打零自动修正 + 白名单人工核对修正。
 * 仍不匹配的保留原文（属源数据问题，由构建报告列入待复核，不做臆测改动）。
 */
function fixCreatureXP(stats: CombatantStats): void {
  if (stats.xp === undefined || stats.level === undefined) return;
  const base = XP_BY_LEVEL[stats.level];
  if (!base) return; // 等级超表（如 35 级罗丝蜘蛛神后）不做校验
  const mult = stats.tier === "杂兵" ? 0.25 : stats.tier === "精英" ? 2 : stats.tier === "强者" ? 5 : 1;
  const expect = Math.round(base * mult);
  if (stats.xp === expect) return;
  if (stats.xp === expect * 10) { stats.xp = expect; return; }
  const fix = XP_FIX_BY_NAME[stats.name];
  if (fix !== undefined) stats.xp = fix;
}

/** 构建期复核：清洗后 XP 是否仍与「等级×类型」表不一致（无 XP 的召唤物/坐骑不算错） */
export function xpSanity(stats: CombatantStats): { ok: boolean; expected?: number } {
  if (stats.xp === undefined || stats.level === undefined) return { ok: true };
  const base = XP_BY_LEVEL[stats.level];
  if (!base) return { ok: true };
  const mult = stats.tier === "杂兵" ? 0.25 : stats.tier === "精英" ? 2 : stats.tier === "强者" ? 5 : 1;
  const expected = Math.round(base * mult);
  return { ok: stats.xp === expected, expected };
}

/** 不在总表的元素召唤物（火/水/土/冰/气/寒系），其“种群”就是元素关键词被误当成了物种；确定性归并为「元素生物」 */
const ELEMENTAL_SPECIES = new Set(["火系", "水系", "土系", "冰系", "气系", "寒系", "金系"]);

/** 只保留有属性块的怪物，返回可加入遭遇的怪物列表 */
export function parseMonsterLibrary(entries: Entry[], classMap: CreatureClassMap = {}): CombatantStats[] {
  const out: CombatantStats[] = [];
  for (const e of entries) {
    const s = parseCreature(e);
    if (s) {
      s.id = e.id;
      applyCreatureClass(s, classMap[s.name]);
      // 残留清洗：总表白名单未命中的元素召唤物，把误当物种的元素关键词归并为「元素生物」
      if (s.species && ELEMENTAL_SPECIES.has(s.species)) s.species = "元素生物";
      out.push(s);
    }
  }
  return out;
}

/** 总表白名单分类（英雄手册的权威值，用于覆盖启发式解析结果） */
export interface CreatureClass {
  role?: string;
  origin?: string;
  category?: string;
  species?: string;
  tier?: string;
  tierTags?: string[];
}

export type CreatureClassMap = Record<string, CreatureClass>;

/** 以总表白名单为准覆盖单个怪物的分类字段；未命中/无值则保持解析结果 */
export function applyCreatureClass(s: CombatantStats, rec?: CreatureClass): void {
  if (!rec) return;
  if (rec.role) s.role = rec.role;
  if (rec.origin) s.origin = rec.origin;
  if (rec.category) s.category = rec.category;
  if (rec.species) s.species = rec.species;
  if (rec.tier) s.tier = rec.tier;
  if (rec.tierTags) s.tierTags = rec.tierTags;
}
