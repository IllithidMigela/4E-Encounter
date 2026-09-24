// 设置（UI 偏好）与怪物队伍：读取/写入 localStorage
import type { CombatantStats, Party } from "./types";

export interface Settings {
  accent: string; // 主色 key
  tokenCorner: number; // 棋子圆角像素
  showGrid: boolean; // 是否显示网格线
  /** 棋子底部 2px 血条（批 1-10：地图增强，可开关） */
  showHpBar: boolean;
  charcraftUrl: string; // 车卡器（4E-NEXT）地址，供「打开角色卡」
  auto: AutoSettings; // 自动化开关（默认全开；关闭后对应环节退回 DM 手动填写）
}

/** 自动化设置：分组见方案文档「三、自动化设置面板」。默认全部开启。 */
export interface AutoSettings {
  /** A 攻击判定 */
  attack: {
    /** 自动掷攻击骰 */
    roll: boolean;
    /** 自动计算调整值（战优/夹击/目盲/倒地/束缚/被标记/掩护/隐蔽/奔跑） */
    mods: boolean;
    /** 自动命中判定 */
    hit: boolean;
    /** 自然 1 失手（自然 20 重击另由 dealDamage 处理） */
    critFail: boolean;
    /** 自动掷伤害 */
    damage: boolean;
    /** 自动应用命中效果 */
    effects: boolean;
  };
  /** B 回合结算 */
  turn: {
    /** 回合开始持续伤害 */
    ongoing: boolean;
    /** 回合开始再生 */
    regen: boolean;
    /** 回合结束豁免 */
    saveEnd: boolean;
    /** 死亡豁免 */
    deathSave: boolean;
    /** 回合动作预算（批 3-3a）：标准/移动/次要 记账与拦截（含替代规则） */
    actionBudget: boolean;
    /** 状态/标记到期自动清除（回合边界清理 condUntil，含被标记等；独立于灵气结算开关，避免关灵气时标记滞留） */
    stateExpire: boolean;
  };
  /** C 状态与生命 */
  life: {
    /** 重伤/濒死自动标记 */
    bloodied: boolean;
    /** 状态修正自动生效（倒地/目盲/束缚/震慑…对防御/速度的修正） */
    condMods: boolean;
    /** 伤害修正自动应用（抗力/易伤/免疫/虚体/虚弱减半） */
    damageMods: boolean;
  };
  /** D 触发与光环 */
  trigger: {
    /** 灵气自动结算 */
    aura: boolean;
    /** 借机自动检测 */
    oppDetect: boolean;
    /** 借机自动结算 */
    oppResolve: boolean;
    /** 触发动作提示 */
    provoke: boolean;
    /** 区域效果 zone 自动结算（批 2-2b） */
    zone: boolean;
  };
  /** E 资源 */
  resource: {
    /** 行动点自动管理 */
    actionPoint: boolean;
  };
}

/** 全自动默认值 */
export function defaultAuto(): AutoSettings {
  return {
    attack: { roll: true, mods: true, hit: true, critFail: true, damage: true, effects: true },
    turn: { ongoing: true, regen: true, saveEnd: true, deathSave: true, actionBudget: true, stateExpire: true },
    life: { bloodied: true, condMods: true, damageMods: true },
    trigger: { aura: true, oppDetect: true, oppResolve: true, provoke: true, zone: true },
    resource: { actionPoint: true },
  };
}

/** 深合并旧存档中的 auto（缺字段补默认，保证升级兼容） */
function mergeAuto(raw: Partial<AutoSettings> | undefined): AutoSettings {
  const d = defaultAuto();
  if (!raw || typeof raw !== "object") return d;
  const merge = <T extends Record<string, boolean>>(src: T | undefined, def: T): T => {
    const out = { ...def };
    if (src && typeof src === "object") for (const k of Object.keys(def)) out[k as keyof T] = (src[k as keyof T] ?? def[k as keyof T]) as T[keyof T];
    return out;
  };
  return {
    attack: merge(raw.attack, d.attack),
    turn: merge(raw.turn, d.turn),
    life: merge(raw.life, d.life),
    trigger: merge(raw.trigger, d.trigger),
    resource: merge(raw.resource, d.resource),
  };
}

export interface MonsterTeam {
  id: string;
  name: string;
  stats: CombatantStats[];
  /** 队伍级棋子描边颜色（整个队伍放图默认用此色；成员优先级更高） */
  color?: string;
  /** 成员级棋子描边颜色：怪物名 → 描边色（同名怪物共享，覆盖队伍级） */
  memberColors?: Record<string, string>;
}

const SETTINGS_KEY = "es.settings";
const TEAMS_KEY = "es.teams";
const PARTIES_KEY = "es.parties";

export const ACCENT_PRESETS: { key: string; label: string; color: string; onSurface: string; container: string }[] = [
  { key: "blue", label: "玄青", color: "#3f5b91", onSurface: "#ffffff", container: "#d9e2ff" },
  { key: "wine", label: "绛紫", color: "#7d3a5c", onSurface: "#ffffff", container: "#f2dbe6" },
  { key: "teal", label: "黛青", color: "#2f6e6a", onSurface: "#ffffff", container: "#d3e8e6" },
  { key: "umber", label: "赭石", color: "#8a5a2b", onSurface: "#ffffff", container: "#f0e0cd" },
  { key: "slate", label: "青灰", color: "#5b6478", onSurface: "#ffffff", container: "#dde2ee" },
];

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Settings>;
      return {
        accent: typeof p.accent === "string" ? p.accent : "blue",
        tokenCorner: typeof p.tokenCorner === "number" ? p.tokenCorner : 12,
        showGrid: typeof p.showGrid === "boolean" ? p.showGrid : true,
        showHpBar: typeof p.showHpBar === "boolean" ? p.showHpBar : true,
        charcraftUrl: typeof p.charcraftUrl === "string" && p.charcraftUrl ? p.charcraftUrl : "http://localhost:5173",
        auto: mergeAuto(p.auto),
      };
    }
  } catch {
    /* ignore */
  }
  return { accent: "blue", tokenCorner: 12, showGrid: true, showHpBar: true, charcraftUrl: "http://localhost:5173", auto: defaultAuto() };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadTeams(): MonsterTeam[] {
  try {
    const raw = localStorage.getItem(TEAMS_KEY);
    if (raw) return JSON.parse(raw) as MonsterTeam[];
  } catch {
    /* ignore */
  }
  return [];
}

export function saveTeams(teams: MonsterTeam[]): void {
  try {
    localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
  } catch {
    /* ignore */
  }
}

export function loadParties(): Party[] {
  try {
    const raw = localStorage.getItem(PARTIES_KEY);
    if (raw) return JSON.parse(raw) as Party[];
  } catch {
    /* ignore */
  }
  return [];
}

export function saveParties(parties: Party[]): void {
  try {
    localStorage.setItem(PARTIES_KEY, JSON.stringify(parties));
  } catch {
    /* ignore */
  }
}

export function applySettings(s: Settings): void {
  const pres = ACCENT_PRESETS.find((p) => p.key === s.accent) ?? ACCENT_PRESETS[0];
  const root = document.documentElement;
  root.style.setProperty("--md-sys-color-primary", pres.color);
  root.style.setProperty("--md-sys-color-on-primary", pres.onSurface);
  root.style.setProperty("--md-sys-color-primary-container", pres.container);
  root.style.setProperty("--es-token-radius", s.tokenCorner + "px");
  document.body.classList.toggle("es-no-grid", !s.showGrid);
}