// 遭遇战模拟器核心数据模型（D&D 4E）

export type Team = "pc" | "monster";

/** 左侧导航视图 */
export type AppView = "battle" | "monsters" | "characters" | "carbuild" | "rules" | "settings" | "export" | "builder";

/** 遮蔽级：一格一种遮蔽（天然互斥），dark 覆盖 heavy 覆盖 light；dim 为昏暗（弱光） */
export type FogLevel = "light" | "heavy" | "dark" | "dim";

/** 场景画笔工具 */
export type TerrainTool =
  | "wall"
  | "difficult"
  | "lightFog"
  | "heavyFog"
  | "dark"
  | "dim"
  | "water"
  | "chasm"
  | "color"
  | "erase"
  | null;

/** 场景画笔工具（布置桌面·场景面板）的定义：key → 标签 / 图标 / 说明 */
export const TERRAIN_TOOLS: { key: Exclude<TerrainTool, null>; label: string; icon: string; desc: string }[] = [
  { key: "wall", label: "墙体", icon: "brick_wall", desc: "不可通行的墙/障碍，阻断移动与效果线。" },
  { key: "difficult", label: "困难地形", icon: "grass", desc: "进入每格额外消耗 1 点移动力。" },
  { key: "water", label: "水域", icon: "water", desc: "水域/浅水：通常按困难地形算，进入需额外移动力；深水可能不可通行。" },
  { key: "chasm", label: "坠落地形", icon: "landslide", desc: "坠落地形/深渊：坠落格不可通行，越过或被迫移动需规避，跌入另有坠落伤害。" },
  { key: "lightFog", label: "轻迷雾", icon: "cloud", desc: "轻度遮蔽：远程命中受到减值（可提供部分隐蔽）。" },
  { key: "heavyFog", label: "重迷雾", icon: "blur_on", desc: "重度遮蔽：大幅阻碍视线，命中承减值。" },
  { key: "dark", label: "黑暗区域", icon: "dark_mode", desc: "黑暗：缺乏光照，命中承减值，部分生物黑暗视觉。" },
  { key: "dim", label: "昏暗区域", icon: "nights_stay", desc: "昏暗/弱光：轻度光照不足，命中轻微承减，部分生物昏暗视觉。" },
  { key: "color", label: "涂色", icon: "format_paint", desc: "涂色工具：给地图格子涂上所选颜色（按住左键拖动连续涂色）。" },
  { key: "erase", label: "擦除", icon: "ink_eraser", desc: "擦除工具：按住左键拖动清除格子上的全部地形与涂色（墙体/困难/水域/坠落/迷雾）。" },
];

/** 怪物/角色队伍（布置桌面·角色面板）成员 */
export interface PartyMember {
  id: string;
  name: string;
  /** NPC（来自怪物数据）或导入的角色 */
  source: "monster" | "pc";
  /** 可直接构建成 combatant 的战斗属性快照 */
  stats: CombatantStats;
  /** 棋子描边颜色；undefined = 默认无描边 */
  color?: string;
}

/** 一支角色/NPC 队伍 */
export interface Party {
  id: string;
  name: string;
  members: PartyMember[];
}

export type DefenseKey = "ac" | "fort" | "ref" | "will";

export const DEFENSE_LABEL: Record<DefenseKey, string> = {
  ac: "AC",
  fort: "强韧",
  ref: "反射",
  will: "意志",
};

/** 攻击类型（对应 wiki 怪物的动作分区） */
export type AttackKind = "standard" | "move" | "minor" | "free" | "immediate" | "aura" | "trait";

export const KIND_LABEL: Record<AttackKind, string> = {
  standard: "标准",
  move: "移动",
  minor: "次要",
  free: "自由",
  immediate: "触发",
  aura: "灵气",
  trait: "特性",
};

/** 伤害类型（4e 主要能量类型 + 物理） */
export type DamageType =
  | "acid"
  | "cold"
  | "fire"
  | "force"
  | "lightning"
  | "thunder"
  | "radiant"
  | "necrotic"
  | "poison"
  | "psychic"
  | "physical";

export const DAMAGE_TYPE_LABEL: Record<DamageType, string> = {
  acid: "强酸",
  cold: "寒冰",
  fire: "火焰",
  force: "力场",
  lightning: "闪电",
  thunder: "雷鸣",
  radiant: "光耀",
  necrotic: "暗蚀",
  poison: "毒素",
  psychic: "心灵",
  physical: "物理",
};

/** 中文伤害类型词 → 标准键（解析用）；"none" 表示无类型 */
export const DAMAGE_TYPE_ZH: Record<string, DamageType> = {
  强酸: "acid",
  酸: "acid",
  寒冰: "cold",
  冰霜: "cold",
  寒冰伤害: "cold",
  火焰: "fire",
  火: "fire",
  闪电: "lightning",
  雷鸣: "thunder",
  光耀: "radiant",
  光明: "radiant",
  暗蚀: "necrotic",
  暗影: "necrotic",
  毒素: "poison",
  心灵: "psychic",
  神经: "psychic",
  精神: "psychic",
  力场: "force",
  物理: "physical",
  钝击: "physical",
  穿刺: "physical",
  挥砍: "physical",
};

/** 持续伤害（结构化）：不同类型各自生效各自豁免，相同类型取最高 */
export interface OngoingDamage {
  /** 伤害类型（标准键或原始中文；缺省/空 = 无类型） */
  type?: string;
  value: number;
  /** 豁免时机：end=回合结束豁免（「豁免终止」标准）、start=回合开始豁免 */
  saveOn: "end" | "start";
  /** 附加说明（如「且不能起身」），保留原文供展示 */
  note?: string;
}

/**
 * 威能效果语义化（第 2 层）：短语模式 → 可执行效果。
 * 每个词映射到模拟器的表现与结算；解析不出的标 kind="manual"（DM 裁决），绝不静默丢失。
 */
export interface EffectSpec {
  kind:
    | "condition" // 施加状态（可豁免终止）
    | "ongoing" // 持续伤害
    | "push"
    | "pull"
    | "slide" // 强制移动
    | "prone" // 击倒（倒地）
    | "tempHp" // 获得临时生命
    | "regeneration" // 再生
    | "mark" // 被标记
    | "teleport" // 传送
    | "heal" // 恢复生命（治疗）
    | "grantCA" // 提供战斗优势（目标被攻击时攻击方 +2）
    | "buff" // 防御加值/减值（defMods 生效）/ 攻击骰加减值（atkMods 生效）
    | "zone" // 区域/结界生成（墙/爆发区域，含时长；挂载为效果条目供 DM 放置）
    | "move" // 移动效果（快步/以速度移动；挂载为效果条目供 DM 指定落点）
    | "resist" // 临时抗力（对某伤害类型，含时长）
    | "hidden" // 隐形/隐蔽/相位移动（批 4c-1：目标隐形=全隐蔽、获得隐蔽=部分隐蔽、相位移动=可穿越障碍；挂载为效果条目供 DM 沿用）
    | "transform" // 变形（改变形态，批 5：纯效果条目，挂载供 DM 记录）
    | "removeCondition" // 行动恢复类：回合结束时移除自身指定状态（如「每当该龙回合结束时，其身上任何晕眩、震慑或受控效果终止」）
    | "auraDamage" // 灵气回合触发伤害（「任何在该灵气内开始/结束回合的敌人受到N点伤害」；由回合开始/结束结算自动扣血）
    | "auraHeal" // 灵气回合触发治疗（「任何在该灵气内开始/结束回合的…盟友恢复 N点生命值」；由回合开始/结束结算自动回血）
    | "auraOngoing" // 灵气回合触发持续伤害（「任何在该灵气内开始/结束回合的敌人受到 N点持续伤害（豁免终止）」；由回合开始/结束结算挂载持续伤害）
    | "auraCondition" // 灵气回合触发状态（「任何在该灵气内开始/结束回合的敌人迟缓直到其下回合开始」；由回合开始/结束结算施加状态并按 condUntil 到期）
    | "manual"; // 无法解析 → DM 裁决
  /** 原始短语（保留原文，兜底展示） */
  raw: string;
  /** 生效时机：hit=仅命中生效、miss=仅未命中生效、缺省=命中&未命中皆生效（4e：命中/失手段按命中与否，效果段恒生效） */
  when?: "hit" | "miss";
  /** 持续伤害 / 临时生命 / 再生 / 强制移动距离 的数值 */
  value?: number;
  /** 持续伤害类型（标准键） */
  type?: string;
  /** 豁免终止标记：豁免时机（end=回合结束；start=回合开始） */
  saveOn?: "end" | "start";
  /** 状态键（kind=condition 时） */
  condition?: ConditionKey;
  /** 附加说明（原文片段） */
  note?: string;
  /** 展示标签（kind=grantCA/buff 时） */
  label?: string;
  /** 时长文本（如「直到其下回合结束」「遭遇结束」） */
  duration?: string;
  /** 持续至下回合开始（轮到时清除） */
  untilNextTurn?: boolean;
  /** 增益受体判定（正面效果）：self=施法者自身、ally=一名盟友、selfAlly=施法者或范围内一名盟友。
   *  效果结算需据此判断受体，而非默认受击目标。 */
  beneficiary?: "self" | "ally" | "selfAlly";
  /** 提供战斗优势（kind=grantCA） */
  grantCA?: boolean;
  /** 防御修正（kind=buff：所有防御统一加/减值） */
  defMods?: Partial<Record<DefenseKey, number>>;
  /** 攻击骰修正（kind=buff：影响持有者攻击骰） */
  atkMods?: number;
  /** 豁免骰修正（kind=buff：目标在做豁免时受到减值，如「目标在此豁免骰上受到-4减值」；读 1 豁免目标侧修正） */
  saveMods?: number;
  /** 伤害骰修正（kind=buff：命中后伤害骰加/减值，如「在伤害骰上获得+5加值」；挂载为效果条目，结算时 DM 手动计） */
  dmgMods?: number;
  /** 传送目标相对位置（kind=teleport：传送到邻近目标的一格等；dx/dy 为相对目标格的偏移） */
  teleportRelative?: { dx: number; dy: number };
  /** 触发时点（kind=auraDamage）：start=目标回合开始 / end=目标回合结束 / enter=进入时 */
  trigger?: "start" | "end" | "enter";
  /** 持有者重伤时替代伤害（kind=auraDamage：「在该X重伤时则为 M伤害」） */
  bloodiedValue?: number;
  /** 仅持有者重伤时生效（kind=auraDamage：前置「在该X重伤期间」） */
  bloodiedOnly?: boolean;
  /** 目标阵营（kind=auraDamage：敌人→enemy；盟友→ally；生物→不设=任意） */
  faction?: "enemy" | "ally";
  /** 目标重伤时才触发（kind=auraHeal：「…的（重伤的）盟友恢复 N点生命值」；目标自身须重伤） */
  targetBloodied?: boolean;
  /** 状态到期边界（kind=auraCondition）：「直到其下回合开始」→start；「直到其下回合结束/终止」→end */
  expires?: "start" | "end";
  /** 状态到期锚定持有者（kind=auraCondition）：「直到该X下回合开始」（X=灵气持有者，如冰魔虚弱寒气）；
   * true=以持有者下回合边界为准（到期时清）；false/缺省=以目标自身下回合边界为准。 */
  expiryOwner?: boolean;
  /** 持有者回合触发（kind=auraCondition·批 6e）：「任何在该X回合开始时位于该灵气内的敌人被标记…」
   * true=由持有者回合开始时触发（对象为当时灵气内的所有目标，auraOwnerConditionTick 结算）；
   * false/缺省=由目标自身回合开始/结束触发。 */
  ownerTrigger?: boolean;
}

/** 战斗阶段（阶段检查的粒度）：回合开始 / 回合结束 / 被命中 */
export type BattlePhase = "turnStart" | "turnEnd" | "hit";

/** 阶段检查命中的一次效应触发（来源 + 触发条件已满足 + 载荷）。
 * 由 triggers.phaseTriggerCheck 在每个阶段对棋子统一检查收集；灵光回合触发与反应类威能共用。 */
export interface PhaseTriggerHit {
  kind: "auraDamage" | "auraHeal" | "auraOngoing" | "auraCondition" | "immediate";
  /** 效应持有者（灵气持有者 / 反应威能拥有者） */
  owner: Combatant;
  /** 来源威能 */
  power: AttackOption;
  /** 触发该效应的效果规格（aura 类；immediate 类为空） */
  spec?: EffectSpec;
  /** 受影响棋子 */
  target: Combatant;
  /** 载荷（auraDamage）：触发伤害值 */
  dmg?: number;
  /** 载荷（auraDamage/auraOngoing）：伤害类型标准键 */
  type?: string;
  /** 载荷（auraDamage/auraOngoing）：持有者重伤时取血伤值 */
  bloodied?: boolean;
  /** 载荷（auraHeal）：治疗量 */
  heal?: number;
  /** 载荷（auraHeal）：目标须重伤 */
  targetBloodied?: boolean;
  /** 载荷（auraOngoing）：持续伤害值 */
  value?: number;
  /** 载荷（auraOngoing）：豁免时机 */
  saveOn?: "end" | "start";
  /** 载荷（auraCondition）：施加的状态键 */
  condition?: ConditionKey;
  /** 载荷（auraCondition）：状态到期边界 */
  expires?: "start" | "end";
  /** 载荷（auraCondition）：到期锚定持有者 */
  expiryOwner?: boolean;
  /** 附加说明（如「且不能传送」） */
  note?: string;
}

/** 已挂载到棋子上的效果（当前效果列表：数据栏/右栏/hover 卡集中显示） */
export interface ActiveEffect {
  kind: "condition" | "ongoing" | "mark" | "tempHp" | "regeneration" | "buff" | "other";
  label: string;
  /** 来源威能名 */
  source?: string;
  /** 时长语义：豁免终止 / 直到X / 维持 / 遭遇 */
  duration?: string;
  /** 原始短语 */
  raw?: string;
  /** 防御修正（批 3-3b 基础动作：全防御/回气 +2、奔跑 -5、冲锋 -2 AC）；读取方 engine.defModOf 汇总 */
  defMods?: Partial<Record<DefenseKey, number>>;
  /** 攻击骰修正（批 4c-1：效果型攻击骰加减值，如「攻击骰 -2」；读取方 AttackDialog 汇总） */
  atkMods?: number;
  /** 伤害骰修正（批 5：命中后伤害骰加/减值，如鲜血之地灵气「伤害骰+5」；结算时 DM 手动计） */
  dmgMods?: number;
  /** 持有者对外提供战斗优势（奔跑）：被攻击时攻击方自动获得 +2 */
  grantCA?: boolean;
  /** 奔跑：持有者移动速度 +2（effectiveMoveLimit 读取） */
  runSpeed?: boolean;
  /** 回合结束标识：true=持续至下回合开始（轮到时清除） */
  untilNextTurn?: boolean;
}

/** 一条攻击/特性选项 */
export interface AttackOption {
  key: string;
  name: string;
  kind: AttackKind;
  /** 原始射程描述，如 近战1 / 远程10 / 近程爆发2 */
  range: string;
  /** 目标描述，如 一个生物 / 爆发范围内的敌人 */
  target: string;
  /** 攻加值；null 表示无攻击（特性/灵气，仅展示效果） */
  attack: number | null;
  /** 攻加值依赖等级（如召唤兽「你的等级 + N」）：需在结算时手填实际加值；此时 attack 为 null */
  attackVar?: boolean;
  defense: DefenseKey;
  /** 伤害表达式 NdM+偏；"" 表示手填 */
  damageExpr: string;
  /** 显式重击表达式（如「重击为9d12 + 46」「若重击则6d10 + 67」）：重击时伤害取该表达式最大；
   * 缺省时按普通规则对 damageExpr 取最大（批 6：显式重击不再被丢弃）。 */
  critExpr?: string;
  /** 命中效果/特性说明（整段原文，用于展示与效果型威能） */
  effectText: string;
  /** 频率（随意/每回合一次/遭遇/灵气；来自威能名后的 ✦ 标注） */
  freq?: string;
  /** 命中效果（内容，不含「命中：」前缀） */
  hit?: string;
  /** 次命中（「如果…则」条件附加命中） */
  second?: string;
  /** 未命中效果 */
  miss?: string;
  /** 效果（「效果：」内容） */
  effect?: string;
  /** 维持（「维持：」内容） */
  sustain?: string;
  /** 是否灵气（kind=aura 或威能名带 ✦灵气N） */
  aura?: boolean;
  /** 触发条件（「触发：」段内容；借机/即时反应/中断威能） */
  trigger?: string;
  /** 命中伤害类型（标准键；如 "fire"） */
  damageType?: string;
  /** 强制移动（推/拉/滑）距离汇总：供结算条/强制移动模式预知 */
  forcedDist?: number;
  /** 威能效果语义化列表（第 2 层）；空 = 未解析出可执行效果 */
  effectSpecs?: EffectSpec[];
  /** 解析覆盖率：fully=全部语义化 / partial=部分语义化 / manual=需 DM 裁决 */
  coverage?: "fully" | "partial" | "manual";
  /** 未解析短语（DM 裁决清单，绝不静默丢失） */
  unparsed?: string[];
  /** 多重攻击（批 4-4a）：本威能对同一目标连掷的攻击段数。
   * 攻击线型（爪击「…只以一个生物为目标，则它可以对该生物进行两次该攻击」）为条件多重；效果型引用（「使用两次冬爪」）见 multiRefs。 */
  multiHits?: number;
  /** 多重攻击条件：true = 仅当威能只以一个生物为目标时触发（如「一或两个生物」的爪击）；false/undefined = 恒对每个目标连掷。 */
  multiCond?: boolean;
  /** 效果型引用多重攻击（「使用两次冬爪」/「进行三次爪击攻击」）：引用攻击者攻击列表中同名威能 N 次。
   * 结算时按引用解析出实际攻击数据（攻加/防御/伤害），逐段独立掷骰；解析失败回退 DM 裁决。 */
  multiRefs?: { name: string; count: number }[];
  /** 分目标多重攻击（批 5）：「对一个目标做一次X攻击，且对另一个目标做一次Y攻击」。
   * 结算时每个引用段分配给不同目标（第 i 段打第 i 个目标），而非对同一目标连掷。 */
  multiSplit?: boolean;
  /** 失手：一半伤害（未命中仍造成一半伤害；伤害掷骰后取半） */
  halfDamageOnMiss?: boolean;
}

/** 多重攻击单段结算结果（批 4-4a）：同一目标第 n 段独立掷攻击骰+伤害骰。 */
export interface AttackSegment {
  /** 段序号（1-based，展示用） */
  n: number;
  /** 该段引用的攻击名（效果型引用不同威能时显示；同威能多次为 undefined） */
  label?: string;
  /** 该段 d20 */
  roll: number;
  attackBonus: number;
  modTotal: number;
  total: number;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
  /** 该段实际伤害（未命中=0；重击=伤害骰取最大） */
  damage: number;
  damageParts: number[];
  defense: number;
  defenseLabel: string;
}

/**
 * 状态（互斥胶囊切换）
 * 依据《万律书》(4e Rules Compendium) 状态表对齐，采用该书的译名。
 * 注：持续伤害(Ongoing Damage)为数值型效果，此处不列入布尔切换；
 * 重伤(Bloodied)由生命值自动推导，保留但非手动条件。
 */
export type ConditionKey =
  | "bloodied"
  | "blinded"
  | "dazed"
  | "deafened"
  | "dominated"
  | "dying"
  | "helpless"
  | "immobilized"
  | "marked"
  | "petrified"
  | "prone"
  | "restrained"
  | "slowed"
  | "stunned"
  | "surprised"
  | "unconscious"
  | "weakened";

export const CONDITION_LABEL: Record<ConditionKey, string> = {
  bloodied: "重伤",
  blinded: "目盲",
  dazed: "晕眩",
  deafened: "耳聋",
  dominated: "支配",
  dying: "濒死",
  helpless: "无助",
  immobilized: "定身",
  marked: "被标记",
  petrified: "石化",
  prone: "倒地",
  restrained: "束缚",
  slowed: "迟缓",
  stunned: "震慑",
  surprised: "被突袭",
  unconscious: "失去意识",
  weakened: "虚弱",
};

export const ALL_CONDITIONS = Object.keys(CONDITION_LABEL) as ConditionKey[];

/** 基础动作（批 3-3b：移动动作/标准动作快捷入口）：基本攻击/奔跑/起身/卧倒/全防御/回气/冲锋/冲撞 */
export type BattleActionKind = "basic" | "run" | "stand" | "prone" | "defend" | "wind" | "charge" | "rush";

/** 与战斗相关的静态属性（怪物/角色通用） */
export interface CombatantStats {
  kind: Team;
  name: string;
  /** 数据唯一标识（来自源条目的 id，用作列表 key，避免同名怪物重复 key） */
  id?: string;
  level?: number;
  /** 怪物类型（杂兵/精英/强者/头目；普通标准怪物无此标记） */
  tier?: string;
  /** 标题行的括号副标签（如 「精英 护卫（头目）」 的 headtag=头目）；用于职能筛选一并命中 */
  tierTags?: string[];
  /** 怪物职能（护卫/游击/蛮战/远程/控制/伏兵…） */
  role?: string;
  /** 经验值（XP N） */
  xp?: number;
  /** 界域（精界/自然界/元素界/星界/异界/暗影界） */
  origin?: string;
  /** 生物类别（类人生物/魔法兽/野兽/活化生物…） */
  category?: string;
  /** 生物种群（括号细分/逗号后，如 鳞爪类/不死生物/人类/巨人…） */
  species?: string;
  /** 占格数 */
  size: number;
  /** 体型类别（微型/小型/中型/大型/巨型/超巨型…），与 size 互补用于体型筛选 */
  sizeClass?: string;
  maxHp: number;
  bloodied: number;
  hp: number;
  tempHp: number;
  /** 回复力次数（仅 pc） */
  surges?: number;
  surgesLeft?: number;
  surgeValue: number;
  ac: number;
  fort: number;
  ref: number;
  will: number;
  /** 先攻加值 */
  init: number;
  speed: number;
  attacks: AttackOption[];
  /** 伤害抗力：类型标准键 → 削减值（如 { fire: 10 }） */
  resistances?: Record<string, number>;
  /** 伤害易伤：类型标准键 → 额外伤害（如 { fire: 5 }） */
  vulnerabilities?: Record<string, number>;
  /** 免疫：类型/效果列表（含非伤害词，如 疾病/毒素/魅惑/睡眠/震慑） */
  immunities?: string[];
  /** 虚体：受到伤害减半（怪物「抗力」行常附带） */
  insubstantial?: boolean;
  /** 怪物数据原文（展示用） */
  rawText?: string;
  /** 导入角色的信息（展示用） */
  char?: CharacterSummary;
  /** 导入时的原始 .d4e.json 角色快照（用于「打开角色卡」带回车卡器） */
  rawChar?: Record<string, unknown>;
  /** 召唤兽标记（批 4-4a-2）：先攻行「和召出者一样」或标题含「召唤生物」；可绑定召出者，解除/死亡自动移除 */
  summoned?: boolean;
}

/** 从 .d4e.json 导入的角色摘要（用于右侧面板展示车卡信息） */
export interface CharacterSummary {
  race?: string;
  className?: string;
  abilities: Record<string, number>;
  trainedSkills: string[];
  powerNames: string[];
  featNames: string[];
  equipmentNames: string[];
  paragon?: string;
  epic?: string;
}

/** 战斗中一个参战者 */
export interface Combatant extends CombatantStats {
  cid: string;
  pos: { x: number; y: number } | null;
  conditions: ConditionKey[];
  initResult: number | null;
  /** 棋子描边颜色；undefined = 默认无描边 */
  color?: string;
  /** 再生：回合开始时回复的 HP（可为负表示额外扣强制生命） */
  regeneration?: number;
  /** 持续伤害列表（结构化：类型+数值+豁免时机；不同类型各自豁免，相同类型取最高） */
  ongoingDamage?: OngoingDamage[];
  /** 行动点（数据模型预留；批 3 接入使用/重置） */
  actionPoints?: number;
  /** 动作预算（批 3-3a 回合节拍）：标准/移动/次要 本回合是否可用；回合开始时重置。自由动作不计数。
   * 替代规则：移动可由标准替、次要可由移动/标准替（spendAction 实现）。undefined = 按满预算处理。 */
  actionBudget?: { standard: boolean; move: boolean; minor: boolean };
  /** 回气是否已在本遭遇使用（每遭遇一次；短/长休息重置） */
  secondWindUsed?: boolean;
  /** 死亡豁免失败计数（濒死时回合开始掷骰/受伤时累计；3 次死亡；脱离濒死或长休归零） */
  deathSaveFails?: number;
  /** 威能使用计数：key=attack.key → 已使用次数（遭遇=本遭遇、每日=本长休；短休清遭遇/充能、长休清全部） */
  powerUses?: Record<string, number>;
  /** 行动点是否已在本回合使用（每回合最多 1 次；回合开始重置） */
  apUsedThisRound?: boolean;
  /** 已挂载效果（当前效果列表：状态/持续伤害/标记/再生…，集中展示） */
  effects?: ActiveEffect[];
  /** 状态到期标记（批 6c）：condition → 到期边界。
   * at=start：下回合开始清除；at=end：下回合结束清除（phase=1 本回合设置的待转，phase=2 下回合结束清除）。
   * source=undefined 以自身回合边界为准；source=cid 以该灵气持有者的下回合边界为准（「直到该X下回合开始」）。 */
  condUntil?: Partial<Record<ConditionKey, { at: "start" | "end"; source?: string; phase?: 1 | 2; dur?: string }>>;
  /** 绑定的召出者 cid（召唤兽专属，批 4-4a-2）：先攻随召出者；召出者死亡/解除召唤时自动移除，自身死亡保留死亡棋子 */
  summonerCid?: string;
  /** 绑定的主人 cid（依赖外部单位的能力锚点，批 6f：恐怖守护者等）：
   * 由导入的用户指定一个在场棋子为主人；其灵气/威能可引用主人位置或状态自动结算。
   * 与 summonerCid 并存但不共用（主人是"被保护/服务对象"，不是召出者）。 */
  masterCid?: string;
  /** 队伍标识（批 8）：同队=盟友、异队=敌人（4E 规则）。undefined=未指定，按 kind 兜底
   * （pc→"pc" 玩家队，monster→"monster" 怪物队）；召唤兽跟随召出者。
   * 布置分组传入：角色队伍成员 `pt:${partyId}`、怪物编队 `mt:${teamId}`。 */
  team?: string;
}

/**
 * 效果施加目标（批 1-11：结算纯函数 resolve.ts 与 EffectDialog 兜底、语义化自动应用共用）。
 * 血量推导状态（重伤/濒死）不在此列——由 HP 自动推导。
 */
export interface EffectApplyTarget {
  cid: string;
  conditions: ConditionKey[];
  /** 持续伤害（结构化：类型+数值+豁免时机） */
  ongoingDamage?: OngoingDamage;
  /** 再生：回合开始时回复的 HP（可为负表示强制扣血） */
  regeneration?: number;
  /** 临时生命（取最高，不累加） */
  tempHp?: number;
  /** 恢复生命（治疗） */
  heal?: number;
  /** 已挂载效果（批 4c-1：提供战斗优势 / 防御加值等 buff 型效果挂载到当前效果列表） */
  effects?: ActiveEffect[];
  /** 直接伤害（auraDamage：灵气回合触发即时扣血） */
  damage?: number;
  /** 直接伤害类型 */
  damageType?: string;
  /** 持有者重伤时替代伤害（auraDamage：持有者重伤时用此值扣血） */
  damageBloodied?: number;
  /** 状态到期标记（auraCondition：灵气回合触发挂状态时一并设置，到期由回合边界自动清除） */
  condUntil?: Partial<Record<ConditionKey, { at: "start" | "end"; source?: string; phase?: 1 | 2; dur?: string }>>;
}

/**
 * 区域效果 zone / 墙（批 2-2b：持久区域效果生命周期状态机 draft → active → 到期移除）。
 * kind=wall 时 cells 为塑形顺序（"x,y"），落地后同步写 obstacles（引用计数归 wallCellsOwnedBy 管理）。
 */
export interface Zone {
  id: string;
  kind: "zone" | "wall";
  /** 有序 "x,y"（墙=塑形顺序，zone=覆盖格集合） */
  cells: string[];
  source: { name: string; powerKey: string };
  effect:
    | { kind: "auto"; target: EffectApplyTarget }
    | { kind: "manual"; raw: string };
  /** 触发时机：enter=进入触发 / start=轮开始 / end=轮结束 / none=仅手动结算 */
  trigger: "enter" | "start" | "end" | "none";
  ownerCid: string;
  createdRound: number;
  createdTurnIndex: number;
  duration: "untilOwnerTurnEnd" | "untilOwnerTurnStart" | "encounter" | "manual";
}

/** 区域效果放置中状态（批 2-2b）：zone=点击中心格即落地；wall=连续点选塑形格，≥2 格可完成 */
export interface ZoneBuild {
  kind: "zone" | "wall";
  attackerId: string;
  attack: AttackOption;
  /** wall 已点选的塑形格序列（"x,y"）；zone 恒为空 */
  seq: string[];
}

/**
 * 物体目标（批 4-4a-3）：地图障碍（墙/陷阱）可选为攻击目标。
 * 万律：物体有 AC/强韧/反射（无意志）、有生命值；免疫暗蚀/毒素/心灵伤害及对抗意志的攻击；
 * 防御与 HP 由 DM 按物体属性表定值或手填。此处存 DM 设定的值，命中扣血，HP≤0 破坏移除。
 */
export interface ObjectTarget {
  /** 唯一 id：`obj:wall:x,y` / `obj:trap:x,y` */
  id: string;
  kind: "wall" | "trap";
  x: number;
  y: number;
  /** 显示名（墙/陷阱） */
  name: string;
  ac: number;
  fort: number;
  ref: number;
  hp: number;
  maxHp: number;
}

/** 物体目标默认属性（批 4-4a-3）：按「物体属性表」精神给保守定值，DM 可在右键菜单/数据栏调整。
 * 墙=更坚固防御稍高；陷阱=防御低。均无意志（攻击对抗意志自动无效）。 */
export const OBJECT_DEFAULTS: Record<ObjectTarget["kind"], Pick<ObjectTarget, "ac" | "fort" | "ref" | "hp" | "maxHp">> = {
  wall: { ac: 5, fort: 5, ref: 3, hp: 40, maxHp: 40 },
  trap: { ac: 3, fort: 3, ref: 3, hp: 20, maxHp: 20 },
};

/** 物体目标 cid 前缀 → 前缀判定（批 4-4a-3）：AttackDialog / 结算按前缀识别物体目标 */
export function isObjectCid(cid: string): boolean {
  return cid.startsWith("obj:");
}

/** 由格子与种类构造物体目标 id（批 4-4a-3） */
export function objectIdOf(kind: ObjectTarget["kind"], x: number, y: number): string {
  return `obj:${kind}:${x},${y}`;
}

/** 一个可撤回的操作单元（快照式）：记录受影响棋子的「操作前」数据，供撤回/整回合回滚还原 */
export interface UndoUnit {
  id: number;
  round: number;
  turnCid?: string;
  label: string;
  /** cid → 操作前快照（仅记录本单元实际改动的棋子） */
  before: Record<string, Combatant>;
  /** 操作前 zone 全量快照（批 2：zone 放置/到期并入同一 undo 单元） */
  zonesBefore?: Zone[];
  /** 操作前 obstacles 全量快照（批 2：墙落地/引用计数清除并入 undo；障碍 ≤400 格可接受全量） */
  obstaclesBefore?: string[];
  /** 建立该操作单元时所在的回合阶段（用于撤回时还原到正确阶段） */
  phase?: "start" | "action" | "end";
}

/** 移动预览：先预览、后确认 */
export interface MovePreview {
  cid: string;
  path: { x: number; y: number }[];
  dist: number;
  limited: boolean;
  /** 快步（批 2-3）：path.length===1 时确认条显示「快步」toggle；快步移动不引发借机 */
  shift?: boolean;
}

/** 战斗日志条目 */
export interface LogEntry {
  id: number;
  time: string;
  text: string;
  tone: "hit" | "miss" | "warn" | "normal" | "crit";
  /** 第几轮（供回合栏分组；旧条目不填则平铺） */
  round?: number;
  /** 当前行动者 cid */
  turnCid?: string;
  /** 回合阶段：开始 / 回合中 / 回合结束 / 插入动作(借机/触发) / 系统 */
  phase?: "start" | "action" | "end" | "interrupt" | "system";
  /** 动作类型（回合中分层展示：标准/移动/次要/…） */
  act?: AttackKind;
  /** 所用威能名 */
  power?: string;
  /** 记录时刻的血量快照 "cur/max"（回合头展示「此时血量」） */
  hp?: string;
  /** 所属可撤回操作单元的 id（供「撤回动作」按单元清除日志） */
  undo?: number;
}

/** 骰子结果 */
export interface DiceResult {
  total: number;
  parts: number[];
  expr: string;
  nat20?: boolean;
  nat1?: boolean;
}

/** 攻击结算中单个目标的命中判定结果（每个目标独立掷攻击骰） */
export interface TargetResolution {
  cid: string;
  name: string;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
  /** 该目标的 d20 掷骰（独立） */
  roll: number;
  attackBonus: number;
  modTotal: number;
  total: number;
  /** 该目标实际受到的伤害（重击=伤害骰取最大，未命中=0） */
  damageTotal: number;
  defense: number;
  defenseLabel: string;
  /** 多重攻击逐段结果（批 4-4a）：多段时按段独立掷骰；
   * 汇总字段（roll/hit/crit/damageTotal）取首段 / 任一段命中 / 各段伤害合计，供结算条展示与伤害应用。 */
  segments?: AttackSegment[];
}
