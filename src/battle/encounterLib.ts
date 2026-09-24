// 遭遇存档库：类型定义 + localStorage 读写 + 快照解析（供管理阶段卡片 / 存档库共用）
import type { Combatant, FogLevel, ObjectTarget, Party } from "../types";

/** 地图背景图对齐参数（仅本地缓存图片的引用键随遭遇保存，图片字节存 IndexedDB） */
export interface MapBgAlign {
  offsetX: number;
  offsetY: number;
  scale: number;
  /** 图片基准宽度（px）：渲染宽度 = baseW * scale。与网格 cols 解耦——调整列数不再拉伸背景图；
      缺省时回退为当前网格宽度（兼容旧存档） */
  baseW?: number;
  /** 图层最上方虚线对齐网格的透明度（0~1），缺省 1 */
  gridOpacity?: number;
}

/** 遭遇快照（与 buildSnapshot 一致的结构） */
export interface EncounterSnapshot {
  version: number;
  map: { cols: number; rows: number; bgKey?: string; bgAlign?: MapBgAlign };
  obstacles: string[];
  difficult: string[];
  fog: Record<string, FogLevel>;
  water: string[];
  chasm: string[];
  trap: string[];
  /** 涂色图层（批 5）：格 "x,y" → 用户涂抹的地图底色；旧档可能缺失 */
  cellColors?: Record<string, string>;
  /** 物体目标（批 4-4a-3）：墙/陷阱格 → 物体数据；旧档可能缺失 */
  objects?: Record<string, ObjectTarget>;
  parties: Party[];
  combatants: Combatant[];
  turnOrder: string[];
  turnIndex: number;
  round: number;
}

/** 遭遇存档元信息 */
export interface EncounterMeta {
  id: string;
  savedAt: string;
  name: string;
  snapshot: EncounterSnapshot;
}

export const LIB_KEY = "es-encounter-lib";

export function loadLib(): EncounterMeta[] {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e.id === "string" && e.snapshot && typeof e.snapshot === "object");
  } catch {
    return [];
  }
}

export function saveLib(lib: EncounterMeta[]) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(lib));
  } catch {
    /* 忽略存储失败 */
  }
}

const toSet = (raw: unknown): Set<string> => {
  const s = new Set<string>();
  if (Array.isArray(raw)) {
    for (const k of raw) if (typeof k === "string" && /^\d+,\d+$/.test(k)) s.add(k);
  }
  return s;
};

/** 从遭遇快照解析出缩略图渲染所需数据（防御性解析，非法字段忽略） */
export function parseSnapshotForThumb(snap: EncounterSnapshot) {
  const fog: Record<string, FogLevel> = {};
  if (snap.fog && typeof snap.fog === "object") {
    for (const [k, v] of Object.entries(snap.fog as Record<string, unknown>)) {
      if (/^\d+,\d+$/.test(k) && (v === "light" || v === "heavy" || v === "dark" || v === "dim")) fog[k] = v as FogLevel;
    }
  }
  const combatants = Array.isArray(snap.combatants)
    ? snap.combatants.filter((c): c is Combatant => !!c && typeof c.cid === "string" && typeof c.name === "string")
    : [];
  return {
    cols: snap.map && typeof snap.map.cols === "number" ? snap.map.cols : 8,
    rows: snap.map && typeof snap.map.rows === "number" ? snap.map.rows : 8,
    combatants,
    obstacles: toSet(snap.obstacles),
    difficult: toSet(snap.difficult),
    fog,
    water: toSet(snap.water),
    chasm: toSet(snap.chasm),
    traps: toSet(snap.trap),
  };
}
