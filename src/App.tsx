// 遭遇战模拟器主应用（DM 工具型，手动/半自动）
// 战斗引擎与交互保留；界面框架改为 六视图(遭遇/怪物/角色卡/万律/设置/导出) + 顶部操作栏 + 左导航。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppView,
  AttackKind,
  AttackOption,
  BattleActionKind,
  Combatant,
  CombatantStats,
  ConditionKey,
  EffectSpec,
  FogLevel,
  LogEntry,
  MovePreview,
  ObjectTarget,
  OngoingDamage,
  Party,
  PartyMember,
  Team,
  TerrainTool,
  UndoUnit,
  Zone,
  ZoneBuild,
} from "./types";
import { buildPath, dealDamage, heal, makeLog, nextCid, syncBloodied, toggleCondition, useSurge, addEffect, clearTurnStartEffects, basicAttackOf, chargeAttackOf, rushAttackOf, chargePathOf, isDead, freqKindOf, freqLimitOf, isSummoned, addOngoingDamage, applyAuraCondition } from "./engine";
import { CONDITION_LABEL, isObjectCid, objectIdOf, OBJECT_DEFAULTS, DAMAGE_TYPE_LABEL } from "./types";
import type { DamageType } from "./types";
import {
  parseRange,
  rangeStatus,
  tokenDistance,
  gridDistance,
  losBlocked,
  burstCells,
  blastSquare,
  cellsInRect,
  affectedIn,
  centerOf,
  fmtMod,
  effectiveMoveLimit,
  cellCostOf,
  parseTargetSpec,
  closeBurstCells,
  auraRadius,
  coverOf,
  wallAdjacent,
  wallValidate,
  wallCellsOwnedBy,
  zoneCellsOf,
  sameTeam,
  teamOf,
} from "./engine";
import type { CoverLevel, Point, TargetSpec } from "./engine";
import { loadLibrary, parseMonsterLibrary } from "./data";
import { buildCharacterCombatant, parseD4eJson, type RawD4e } from "./characterParse";
import AttackDialog from "./AttackDialog";
import type { AttackResolution } from "./AttackDialog";
import OABar from "./battle/OABar";
import type { OAProvoker, OAResult } from "./battle/triggers";
import EffectDialog from "./EffectDialog";
import type { EffectApplyTarget, PhaseTriggerHit, BattlePhase } from "./types";
import { applyEffectToCombatant, effectApplyParts, resolveCombatantHitDamages, objectHitLogText, objectImmuneLogText, hitDamageLogText, attackRollLogText, splitAttackSpecs, collectHitReactions, hasMountableEffect, applyRegenAtTurnStart, applyOngoingAtTurnStart, freshActionBudget, spendAction, actionSlotOf, canSpendAction, rollDeathSave } from "./battle/resolve";
import type { ActionSlot } from "./battle/resolve";
import { battleBus } from "./battle/events";
import { logEvt } from "./diagLog";
import { specsToApplyTarget, detectMoveOA, detectPowerOA, zoneEnterDetect, auraEnterDetect, auraTurnStartTick, phaseTriggerCheck, ownerTriggerCheck, hitReactionDetect, auraEffectTargets, auraCellsOf, applyOaDamage } from "./battle/triggers";
import SurpriseDialog from "./battle/SurpriseDialog";
import EncounterTitle from "./battle/EncounterTitle";
import AppShell from "./main-shell/AppShell";
import BattleView from "./battle/BattleView";
import { CELL } from "./MapGrid";
import { loadLib, saveLib, type EncounterMeta, type EncounterSnapshot, type MapBgAlign } from "./battle/encounterLib";
import { advanceActor, expiredConditionTargets, settleTurnStart, rollEndSaves, forcedStep } from "./battle/turn";
import { readFileAsDataUrl, compressDataUrlToBudget } from "./4ebuild/lib/image";
import { cachePutImage, cacheGetImage, cacheDeleteImage } from "./4ebuild/lib/imageCache";
import MonstersView from "./MonstersView";
import CharactersView from "./characters/CharactersView";
import CarBuildView from "./carbuild/CarBuildView";
import type { Character } from "./4ebuild/sheet/character";
import RulesView from "./RulesView";
import SettingsView from "./SettingsView";
import ExportView from "./ExportView";
import MonsterBuilder from "./MonsterBuilder";
import {
  applySettings,
  loadParties,
  loadSettings,
  loadTeams,
  saveParties,
  saveSettings,
  saveTeams,
  type MonsterTeam,
  type Settings,
} from "./uiPrefs";

function nextPartyId(): string {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 历史涂色的本地持久化键 */
const COLOR_HISTORY_KEY = "es-color-history";

/** 历史涂色容量（最近 16 个） */
const COLOR_HISTORY_LIMIT = 16;

/** 读取历史涂色（最多 16 个，校验 6 位十六进制色值） */
function loadColorHistory(): string[] {
  try {
    const raw = localStorage.getItem(COLOR_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c))
      .slice(0, COLOR_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/** 保存历史涂色 */
function saveColorHistory(h: string[]): void {
  try {
    localStorage.setItem(COLOR_HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* 存储不可用时静默忽略 */
  }
}

/** 地形格双态开关：有则删、无则加 */
function toggleCell(set: Set<string>, k: string): Set<string> {
  const n = new Set(set);
  if (n.has(k)) n.delete(k);
  else n.add(k);
  return n;
}

/** 地形格移除：无则原样返回，有则删（擦除工具用） */
function removeCell(set: Set<string>, k: string): Set<string> {
  if (!set.has(k)) return set;
  const n = new Set(set);
  n.delete(k);
  return n;
}

/** 读取图片 data URL 的原始尺寸（供导入地图背景时计算自适应缩放）。 */
function imageSizeOf(src: string): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

/** 框选校准（导入地图）：用户框出印刷网格的一个方格（es-map 表面坐标 rect），
    据此重新计算 缩放+偏移，使虚线网格贴合该方格（1 个框选格 = 1 个 CELL）。 */
function calibMapBgFromRect(
  align: MapBgAlign,
  rect: { x: number; y: number; width: number; height: number },
  cell: number,
): MapBgAlign {
  const rw = rect.width;
  const rh = rect.height;
  if (!(rw > 2 && rh > 2)) return align;
  // 新缩放：让框选方格的平均边长 = 1 个格（CELL）
  const scale = align.scale * cell / ((rw + rh) / 2);
  if (!(scale > 0)) return align;
  const k = scale / align.scale;
  // 图片内坐标（相对图片左上角）缩放后显示位置 = offsetX + 新图片内坐标
  const dx = (rect.x - align.offsetX) * k;
  const dy = (rect.y - align.offsetY) * k;
  // 让框选方格左上角（= 印刷网格交点）落在最近的网格线交点上
  const mx = Math.round((align.offsetX + dx) / cell);
  const my = Math.round((align.offsetY + dy) / cell);
  return {
    ...align, // 保留 baseW：基准宽度与网格 cols 解耦，列数变化不拉伸背景
    offsetX: Math.round(mx * cell - dx),
    offsetY: Math.round(my * cell - dy),
    scale,
  };
}

// 强制移动的直线合法落点：from→to 必须是直/斜连续线（含对角），返回中间+落点；否则 null。
function straightMovePath(from: Point, to: Point): Point[] | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  const sx = dx < 0 ? -1 : dx > 0 ? 1 : 0;
  const sy = dy < 0 ? -1 : dy > 0 ? 1 : 0;
  if (dx === 0 && dy === 0) return null;
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return null;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const pts: Point[] = [];
  for (let i = 1; i <= steps; i++) pts.push({ x: from.x + sx * i, y: from.y + sy * i });
  return pts;
}
// 依据 万律·强制移动：与源共线且变远→推，变近→拉，其它直线→滑
function forcedVerb(from: Point, to: Point, attPos: Point | null): "推" | "拉" | "滑" {
  if (!attPos) return "滑";
  const cross = (from.x - attPos.x) * (to.y - attPos.y) - (from.y - attPos.y) * (to.x - attPos.x);
  if (cross !== 0) return "滑";
  const df = (from.x - attPos.x) ** 2 + (from.y - attPos.y) ** 2;
  const dt = (to.x - attPos.x) ** 2 + (to.y - attPos.y) ** 2;
  return dt > df ? "推" : "拉";
}

/** 体型条件校验（sizeCond 形如「中型或更小」「大型或更大」）→ 目标占格是否满足 */
function sizeCondOk(cond: string, grid: number): boolean {
  const m = cond.match(/(超巨型|巨型|大型|中型|小型|微型)(?:或(更大|更小))?/);
  if (!m) return true;
  const cellBase = m[1] === "超巨型" ? 9 : m[1] === "巨型" ? 4 : m[1] === "大型" ? 2 : 1;
  const dir = m[2] ?? "";
  if (!dir) return grid === cellBase;
  return dir === "更大" ? grid >= cellBase : grid <= cellBase;
}

/** 目标定义校验（敌/友过滤 + 条件目标 + 体型条件）：返回不满足的提示；null = 通过 */
function targetSpecHint(spec: TargetSpec, attacker: Combatant, target: Combatant): string | null {
  if (spec.faction === "enemy" && sameTeam(target, attacker)) return `${target.name} 是己方，不满足「敌人」目标条件。`;
  if (spec.faction === "ally" && !sameTeam(target, attacker)) return `${target.name} 是敌方，不满足「盟友」目标条件。`;
  if (spec.condTarget) {
    const k = spec.condTarget as ConditionKey;
    if (!target.conditions.includes(k)) return `${target.name} 未处于「${CONDITION_LABEL[k] ?? k}」状态，不满足目标条件。`;
  }
  if (spec.sizeCond && !sizeCondOk(spec.sizeCond, target.size)) return `${target.name} 体型不满足「${spec.sizeCond}」目标条件。`;
  return null;
}

/** 效果语义化中的最大强制移动距离（推/拉/滑）；无 → null（批 1-8：8 方向箭头距离上限） */
function forcedMoveMaxDist(attack: AttackOption): number | null {
  const spec = (attack.effectSpecs ?? []).find((s) => s.kind === "push" || s.kind === "pull" || s.kind === "slide");
  return spec && spec.value && spec.value > 0 ? spec.value : null;
}

/** 物体目标免疫判定（批 4-4a-3）：物体免疫暗蚀/毒素/心灵伤害，且免疫对抗意志的攻击 */
function attackImmuneToObject(a: Pick<AttackOption, "defense" | "damageType">): boolean {
  if (a.defense === "will") return true;
  return a.damageType === "necrotic" || a.damageType === "poison" || a.damageType === "psychic";
}

/** 物体目标 → 结算条伪 Combatant（批 4-4a-3）：仅提供结算条所需字段；will 置极高 → 对抗意志自动未命中 */
function objectAsTarget(o: ObjectTarget): Combatant {
  return {
    cid: o.id,
    name: o.name,
    ac: o.ac,
    fort: o.fort,
    ref: o.ref,
    will: 1e6,
    hp: o.hp,
    maxHp: o.maxHp,
    conditions: [],
    effects: [],
  } as unknown as Combatant;
}

/** 移动结算参数（批 2-3：点击/拖拽/快步共用 finishMove） */
interface MoveOpts {
  dist: number;
  limited: boolean;
  shift?: boolean;
  /** 自动寻路分支显示「(N 点移动力)」 */
  costText?: string;
}

export default function App() {
  const [combatants, setCombatants] = useState<Combatant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const [pendingPlace, setPendingPlace] = useState<string | null>(null);
  // 瞄准模式：右侧面板选中威能后，在地图上点选目标
  const [aim, setAim] = useState<{ attackerId: string; attack: AttackOption } | null>(null);
  // 近程爆发的起始格（大型生物可点自身占用格选择；null=默认左上格）
  const [aimOrigin, setAimOrigin] = useState<Point | null>(null);
  // 多目标威能（如 一个或两个生物）已点选的目标 cid 列表
  const [aimSel, setAimSel] = useState<string[]>([]);
  // 选择性近程/区域威能：已确定的效果区域（供地图高亮 + 继续点选目标）
  const [aimArea, setAimArea] = useState<{ cells: Set<string>; label: string } | null>(null);
  /** 当前展示的灵气（灵气N）：地图高亮环绕持有者的填满区域 */
  const [auraView, setAuraView] = useState<{ attackerId: string; attack: AttackOption; radius: number } | null>(null);
  const [pendingAttack, setPendingAttack] = useState<{
    attackerId: string;
    attack: AttackOption;
    targetIds: string[];
    rangeText: string;
    /** 目标词条是否强制包含全部（弹窗中不可取消勾选） */
    forced: boolean;
    /** 逐目标掩护等级（批 2-4）：AttackDialog 据此自动勾选部分/超级掩护调整值 */
    coverByTarget?: Record<string, CoverLevel>;
  } | null>(null);
  /** 效果型威能：地图「强制移动模式」——8 方向箭头 / 点直线落点，逐个移动目标 */
  const [effectMove, setEffectMove] = useState<{
    attackerId: string;
    attack: AttackOption;
    /** 本次已强制移动的目标 cid */
    moved: string[];
    /** 当前正被选作移动对象的 cid */
    mover: string | null;
    /** 限定可移动目标（攻击+推拉滑命中后才进入）：只允许列出的目标被移动 */
    hitOnly?: string[];
    /** 各被移目标在本轮强制移动开始时的原位置（取消时按此还原） */
    origPts: Record<string, Point>;
  } | null>(null);
  /** 效果型威能：移动结束后的效果结算弹窗（状态/持续伤害/再生） */
  const [pendingEffect, setPendingEffect] = useState<{
    attackerId: string;
    attack: AttackOption;
    defaultTargets: string[];
    /** 本次可挂载的语义化效果子集（按 4e 命中/未命中分段过滤）；缺省 = attack.effectSpecs 全部 */
    specsOverride?: EffectSpec[];
  } | null>(null);
  /** 强制移动直线落点被阻挡（批 3 收尾）：路径第 blockedAt+1 格被 blockedBy 阻挡，DM 选择停在障碍前 / 自定义距离 */
  const [blockedMove, setBlockedMove] = useState<{
    moverCid: string;
    attack: AttackOption;
    pts: Point[];
    /** 第一个被阻挡的路径下标（0=第一格即被挡，无法移动） */
    blockedAt: number;
    blockedBy: string;
  } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  // 可撤回操作单元：快照式事务栈（与 combatants/log 平行，供「撤回动作/整回合回滚」）
  const [undoStack, setUndoStack] = useState<UndoUnit[]>([]);
  const undoSeqRef = useRef(0);
  const undoRef = useRef<UndoUnit | null>(null);
  // 区域效果 zone / 墙（批 2-2b：持久区域效果生命周期；批 2-1 先落数据 + undo 快照）
  const [zones, setZones] = useState<Zone[]>([]);
  /** 区域效果放置中（批 2-2b）：zone=点中心格落地；wall=连续点选塑形格；null=无放置 */
  const [zoneBuild, setZoneBuild] = useState<ZoneBuild | null>(null);
  /** 放置期校验失败的红标格（如非法墙格），批 2b-4 */
  const [invalidZoneCell, setInvalidZoneCell] = useState<string | null>(null);
  // 借机预判（批 2-3）：检测命中弹统一结算条；oaDeferredRef 存「结算后要执行」的闭包（移动落子 / 原攻击结算）
  const [pendingOA, setPendingOA] = useState<{ kind: "move" | "power" | "reaction"; mover: Combatant; provokers: OAProvoker[] } | null>(null);
  const oaDeferredRef = useRef<((results: OAResult[] | null) => void) | null>(null);
  const [turnOrder, setTurnOrder] = useState<string[]>([]);
  const [turnIndex, setTurnIndex] = useState(0);
  const [round, setRound] = useState(1);
  // 批 4-4a-2：召唤兽绑定召出者模式——bindTarget=待绑定的召唤兽 cid；激活时点棋子绑定、点空格取消
  const [bindTarget, setBindTarget] = useState<string | null>(null);
  // 批 6f：守护者绑定主人模式——bindMaster=待绑定的守护者 cid；激活时点棋子设置为主人、点空格取消
  const [bindMaster, setBindMaster] = useState<string | null>(null);
  // 回合阶段：开始 → 动作 → 结束（手动结算，DM 点按钮推进）
  const [phase, setPhase] = useState<"start" | "action" | "end">("start");
  // 突袭轮：弹窗开关 + 突袭状态
  const [surpriseDlgOpen, setSurpriseDlgOpen] = useState(false);
  const [surpriseView, setSurpriseView] = useState<{ attackers: string[]; active: boolean } | null>(null);
  const [mapCols, setMapCols] = useState(20);
  const [mapRows, setMapRows] = useState(20);
  const [monsters, setMonsters] = useState<CombatantStats[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 场景图层：墙(障碍) / 困难 / 遮蔽(轻雾/重雾/暗)，三者语义正交
  const [obstacles, setObstacles] = useState<Set<string>>(new Set());
  const [difficult, setDifficult] = useState<Set<string>>(new Set());
  const [fog, setFog] = useState<Record<string, FogLevel>>({});
  // 新增场景类型：水域 / 坠落地形 / 陷阱
  const [water, setWater] = useState<Set<string>>(new Set());
  const [chasm, setChasm] = useState<Set<string>>(new Set());
  const [traps, setTraps] = useState<Set<string>>(new Set());
  // 涂色图层：格 "x,y" → 用户涂抹的地图底色；mapColor 为涂色工具的当前画笔颜色
  const [cellColors, setCellColors] = useState<Record<string, string>>({});
  const [mapColor, setMapColor] = useState("#9e9e9e");
  // 历史涂色：最近 16 个使用过的颜色（最新在前），本地持久化
  const [colorHistory, setColorHistory] = useState<string[]>(loadColorHistory);
  const applyMapColor = useCallback((c: string) => {
    setMapColor(c);
    setColorHistory((prev) => {
      const n = [c, ...prev.filter((x) => x !== c)].slice(0, COLOR_HISTORY_LIMIT);
      saveColorHistory(n);
      return n;
    });
  }, []);
  // 物体目标（批 4-4a-3）：墙/陷阱格 → 物体数据（AC/强韧/反射/HP，DM 定值）。id 见 objectIdOf
  const [objects, setObjects] = useState<Record<string, ObjectTarget>>({});
  const [sceneTool, setSceneToolState] = useState<TerrainTool>(null);
  const [view, setView] = useState<AppView>("battle");
  // 遭遇视图阶段：manage=管理遭遇(封存后进入，中心显示存档库卡片) / run=进行遭遇(完整地图)
  const [stage, setStage] = useState<"manage" | "run">("manage");
  // 遭遇存档库（提升到 App，供管理阶段卡片与存档库共用）
  const [encLib, setEncLib] = useState<EncounterMeta[]>(loadLib);
  // 当前正在进行的遭遇（从存档库打开时记录其 id/name；新建地图则重置）。用于结束遭遇时更新而非重复新增
  const [currentEnc, setCurrentEnc] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    saveLib(encLib);
  }, [encLib]);
  // 万律页预填搜索词（供「场景棋子栏·万律条目」跳转）
  const [rulesPrefill, setRulesPrefill] = useState<string>("");
  // 遭遇视图左/右栏开关（迁移到顶部操作栏控制）
  const [leftTab, setLeftTab] = useState<"setup" | "turn">("setup");
  const [leftOpen, setLeftOpen] = useState(true);
  const [sideOpen, setSideOpen] = useState(true);
  // 右栏 tab 预留：当前仅 "token"，将来可扩展更多面板
  const [sideTab, setSideTab] = useState<"token">("token");
  // 底部「全员数据」数据栏开关（默认常驻显示）
  const [rosterOpen, setRosterOpen] = useState(true);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [teams, setTeams] = useState<MonsterTeam[]>(loadTeams);
  const [parties, setParties] = useState<Party[]>(loadParties);
  const [charPool, setCharPool] = useState<CombatantStats[]>([]);
  const loadEncRef = useRef<HTMLInputElement>(null);
  // 地图背景图（导入地图功能）：图片字节存 IndexedDB，遭遇快照只存缓存键；对齐参数随快照保存
  const [mapBg, setMapBg] = useState<string | null>(null);
  const [mapBgKey, setMapBgKey] = useState<string | null>(null);
  const [mapBgAlign, setMapBgAlign] = useState<MapBgAlign>({ offsetX: 0, offsetY: 0, scale: 1, baseW: 20 * CELL });
  const [mapBgDlg, setMapBgDlg] = useState(false);
  const [mapBgCalib, setMapBgCalib] = useState(false); // 框选校准模式：在地图上框选印刷网格的一个方格
  // 背景图异步加载竞态守卫：导入/加载/清空时自增，旧请求结果不再生效
  const bgSeq = useRef(0);
  const mapBgRef = useRef<HTMLInputElement>(null);

  // 应用 UI 设置（主题色 / 棋子圆角 / 网格）
  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  const classMap = useRef<Map<string, unknown>>(new Map());
  const raceMap = useRef<Map<string, unknown>>(new Map());

  useEffect(() => {
    loadLibrary().then((lib) => {
      if (!lib.ready) {
        setError(lib.error ?? "数据加载失败");
        return;
      }
      for (const c of lib.classes) classMap.current.set(c.id, c);
      for (const r of lib.races) raceMap.current.set(r.id, r);
      setMonsters(parseMonsterLibrary(lib.creatures, lib.creatureClass));
      setReady(true);
    });
  }, []);

  // 战斗日志（带元数据：轮次/当前行动者/阶段）
  const pushLog = useCallback((text: string, tone: LogEntry["tone"] = "normal") => {
    const undo = undoRef.current?.id;
    logEvt("battle", text);
    setLog((prev) => [...prev.slice(-199), makeLog(text, tone, undo ? { undo } : undefined)]);
  }, []);

  // ---------- 可撤回操作单元（快照式事务） ----------
  // 用法：beginUndo →（未改动的每个棋子）snapBefore(cid) → 渲染改动/写日志 → commitUndo。
  // 未画出 before → 不产生可撤回单元（纯日志/系统提示不计入）。
  const beginUndo = useCallback(
    (round: number, turnCid: string | undefined, label: string) => {
      // 批 2-1：zones/obstacles 全量快照（zone 放置/墙落地/到期并入同一 undo 单元）
      undoRef.current = { id: ++undoSeqRef.current, round, turnCid, label, before: {}, zonesBefore: zones, obstaclesBefore: [...obstacles], phase };
    },
    [zones, obstacles, phase],
  );
  const snapBefore = useCallback((cid: string) => {
    const u = undoRef.current;
    if (!u || u.before[cid]) return;
    const c = combatants.find((x) => x.cid === cid);
    if (c) u.before[cid] = { ...c };
  }, [combatants]);
  const commitUndo = useCallback(
    (label?: string, zonesNow?: Zone[], obstaclesNow?: Set<string>) => {
      const u = undoRef.current;
      undoRef.current = null;
      if (!u) return;
      // 批 2-1：仅棋子快照非空或 zones/obstacles 有变化才产生可撤回单元
      // zonesNow/obstaclesNow：调用方即将写入的新状态（zone 放置/到期时闭包 zones/obstacles 仍为旧值，须显式传入）
      const zc = zonesNow ?? zones;
      const oc = obstaclesNow ?? obstacles;
      const zonesChanged = !u.zonesBefore || u.zonesBefore.length !== zc.length || u.zonesBefore.some((z, i) => z.id !== zc[i]?.id);
      const obstaclesChanged = !u.obstaclesBefore || u.obstaclesBefore.length !== oc.size || u.obstaclesBefore.some((k) => !oc.has(k));
      if (Object.keys(u.before).length === 0 && !zonesChanged && !obstaclesChanged) return; // 状态未变 → 无可撤回
      if (label) u.label = label;
      setUndoStack((prev) => [...prev.slice(-199), u]);
    },
    [zones, obstacles],
  );

  // 撤回：回滚到指定操作单元之前（丢弃该单元及之后所有单元，按反序还原快照并清除其日志）。
  const rewindUndo = useCallback(
    (fromUnitId: number) => {
      const idx = undoStack.findIndex((u) => u.id === fromUnitId);
      if (idx < 0) return;
      const dropped = undoStack.slice(idx); // 含目标单元
      logEvt("op", `用户执行【撤回】，回滚到 "${dropped[0].label}" 操作之前（撤掉了 ${dropped.length} 个单元）`);
      // 反序还原受影响棋子的「操作前」快照（最后应用最先的快照=回到目标单元前）
      const restore = new Map<string, Combatant>();
      for (let i = dropped.length - 1; i >= 0; i--) {
        for (const [cid, snap] of Object.entries(dropped[i].before)) restore.set(cid, snap);
      }
      if (restore.size > 0) setCombatants((prev) => prev.map((c) => restore.get(c.cid) ?? c));
      // 批 2-1：zones/obstacles 恢复为目标单元（dropped[0]）操作前的快照
      const zBefore = dropped[0].zonesBefore;
      if (zBefore) setZones(zBefore);
      const oBefore = dropped[0].obstaclesBefore;
      if (oBefore) setObstacles(new Set(oBefore));
      const ids = new Set(dropped.map((u) => u.id));
      setLog((prev) => prev.filter((e) => !(e.undo !== undefined && ids.has(e.undo))));
      setUndoStack((prev) => prev.filter((u) => !ids.has(u.id)));
    },
    [undoStack],
  );

  /** 回合开始结算唯一性守卫（与回合开始 effect 共用） */
  const settledStartRef = useRef<Set<string>>(new Set());

  /** 撤回后还原回合指针/阶段：从被回滚角色的整回合或「回合开始」单元，退到上一个角色的「回合结束」阶段。
   *  即该回合开始前的状态；再点下一回合可重新结算本回合的开始。 */
  const turnToPrevEnd = useCallback(
    (cid: string | undefined, rd: number) => {
      if (!cid) return;
      const idx = turnOrder.indexOf(cid);
      const len = turnOrder.length;
      if (len === 0) return;
      if (idx > 0) {
        setTurnIndex(idx - 1);
        setPhase("end");
        setRound(rd);
      } else if (rd > 1) {
        // 被回滚者在队首位：前一位是上一轮末位
        setTurnIndex(len - 1);
        setPhase("end");
        setRound(rd - 1);
      }
    },
    [turnOrder],
  );

  // 撤回入口：指定操作单元 / 整回合回滚（均复用 rewindUndo）
  const undoUnit = useCallback(
    (id: number) => {
      const u = undoStack.find((x) => x.id === id);
      rewindUndo(id);
      // 「撤回」的是回合开始单元 → 回到回合开始前的阶段（上一个角色的回合结束），并重置开始结算守卫
      if (u && u.phase === "start") {
        if (u.turnCid) settledStartRef.current.delete(`${u.round}:${u.turnCid}`);
        turnToPrevEnd(u.turnCid, u.round);
      }
    },
    [undoStack, rewindUndo, turnToPrevEnd],
  );
  const undoTurn = useCallback(
    (cid: string, rd: number) => {
      const idx = undoStack.findIndex((u) => u.turnCid === cid && u.round === rd);
      if (idx < 0) return;
      rewindUndo(undoStack[idx].id);
      // 回滚整回合 → 回到上一个角色的「回合结束」阶段，并重置开始结算守卫以便重来
      settledStartRef.current.delete(`${rd}:${cid}`);
      turnToPrevEnd(cid, rd);
    },
    [undoStack, rewindUndo, turnToPrevEnd],
  );

  const pushTurnLog = useCallback(
    (
      text: string,
      tone: LogEntry["tone"],
      phase: NonNullable<LogEntry["phase"]>,
      cidOverride?: string,
      opts?: { act?: AttackKind; power?: string },
    ) => {
      const cid = cidOverride ?? turnOrder[turnIndex];
      const who = combatants.find((x) => x.cid === cid);
      const undo = undoRef.current?.id;
      logEvt("battle", `${who ? who.name + "：" : ""}${text}`);
      setLog((prev) => [
        ...prev.slice(-199),
        makeLog(text, tone, {
          round,
          turnCid: cid,
          phase,
          ...(who ? { hp: `${who.hp}/${who.maxHp}` } : {}),
          ...(opts?.act ? { act: opts.act } : {}),
          ...(opts?.power ? { power: opts.power } : {}),
          ...(undo ? { undo } : {}),
        }),
      ]);
    },
    [combatants, round, turnIndex, turnOrder],
  );

  const selected = combatants.find((c) => c.cid === selectedId) ?? null;

  /** 文字画面快照：把当前所有棋子的关键数值压成一段文字，写入统一日志，供导出还原画面 */
  const snapshotCombatants = useCallback(
    (reason: string) => {
      const lines = combatants.map((c) => {
        const pos = c.pos ? `@(${c.pos.x},${c.pos.y})` : "";
        const thp = c.tempHp > 0 ? `临时+${c.tempHp}` : "";
        const tag = c.kind === "pc" ? "PC" : isSummoned(c) ? "召唤" : isObjectCid(c.cid) ? "物体" : "怪";
        const conds = (c.conditions ?? []).map((k) => CONDITION_LABEL[k] ?? k).join("/");
        const od = (c.ongoingDamage ?? []).map((d) => `持续${DAMAGE_TYPE_LABEL[d.type as DamageType] ?? d.type ?? ""}${d.value}`).join("+");
        return `${c.name}[${tag}] HP${c.hp}/${c.maxHp}${thp}${pos}${conds ? `状态[${conds}]` : ""}${od ? `|${od}` : ""}`;
      });
      logEvt("snapshot", `${reason}｜${lines.join("；")}`);
    },
    [combatants],
  );

  // ---------- 更新 combatant 的通用辅助 ----------
  const patchCombatant = useCallback((cid: string, fn: (c: Combatant) => Combatant) => {
    setCombatants((prev) => prev.map((c) => (c.cid === cid ? fn(c) : c)));
  }, []);

  // ---------- 批 4-4a-2：召唤兽生命周期 ----------
  /** 从遭遇移除指定棋子（召唤兽死亡/解除/召出者死亡联动）：清理 combatants / turnOrder / 选择 / 放置 */
  const removeCombatantNow = useCallback((cid: string) => {
    // 批 4-4a-2/6f：移除棋子（召唤兽/召出者级联、手动按钮移除）时，turnOrder 收缩但回合指针
    // 不会自动回退——若被移除者位次在指针之前/等于指针，回合指针会越界或错位，
    // 使 nextTurn/runTurnStart 读取到 undefined 或错误棋子，造成「回合结算未执行」。
    // 这里在校正后把指针夹在合法区间，并对「指针之前被移除」回退一位，守住对齐。
    const removed = turnOrder.indexOf(cid);
    setCombatants((prev) => prev.filter((x) => x.cid !== cid));
    setTurnOrder((prev) => prev.filter((x) => x !== cid));
    setSelectedId((prev) => (prev === cid ? null : prev));
    setPendingPlace((prev) => (prev === cid ? null : prev));
    if (removed >= 0 && removed <= turnIndex) {
      setTurnIndex((ti) => {
        const base = removed < ti ? ti - 1 : Math.min(ti, turnOrder.length - 2);
        return Math.max(0, base);
      });
    }
  }, [turnIndex, turnOrder]);

  /** 棋子死亡联动（批 4-4a-2）：死者是召出者 → 级联移除其召唤兽；死者自身是召唤兽 → 保留死亡棋子（仅解除召唤才离场）。由各伤害路径在 isDead 后调用。 */
  const onCombatantDied = useCallback(
    (c: Combatant, phase: "action" | "interrupt" | "start" | "end" = "action") => {
      // 死者自身是召唤兽（无论是否绑定）→ 与普通棋子一致，保留死亡棋子（仅「解除召唤」才离场）
      if (isSummoned(c)) {
        pushTurnLog(`☠ ${c.name}（召唤兽）死亡。`, "crit", phase);
        return;
      }
      // 死者是召出者：其召唤兽一同消失
      const summons = combatants.filter((x) => isSummoned(x) && x.summonerCid === c.cid);
      for (const s of summons) {
        pushTurnLog(`☠ ${c.name} 死亡，召唤兽 ${s.name} 一同消失。`, "crit", phase);
        removeCombatantNow(s.cid);
      }
    },
    [combatants, pushTurnLog, removeCombatantNow],
  );

  // ---------- 加入参战者 ----------
  /** 加入参战者。team：所属队伍标识（批 8）；未传时按 kind 兜底（pc→"pc" 玩家队，monster→"monster" 怪物队）。
   * 布置分组时传入：怪物编队传 `mt:${teamId}`、角色队伍成员传 `pt:${partyId}`。 */
  const addCombatant = useCallback(
    (stats: CombatantStats, color?: string, team?: string) => {
      const c: Combatant = {
        ...stats,
        cid: nextCid(),
        pos: null,
        conditions: [],
        initResult: null,
        actionBudget: freshActionBudget(),
        ...(stats.kind === "pc" ? { actionPoints: 1 } : {}),
        ...(color ? { color } : {}),
        ...(team ? { team } : {}),
      };
      setCombatants((prev) => [...prev, c]);
      setSceneToolState(null); // 进入放置模式时退出场景画笔，避免画墙拦截点击
      setPendingPlace(c.cid);
      setMovePreview(null);
      pushLog(`${c.name} 已加入，在地图上点击放置。`, "warn");
      // 批 4-4a-2：召唤兽放置后可右键 → 绑定召出者（先攻随召出者；召出者死亡/解除召唤自动移除，自身死亡保留死亡棋子）
      if (isSummoned(c)) {
        pushLog(`${c.name} 是召唤兽：放置后可右键棋子 →「绑定召出者」。`, "normal");
      }
    },
    [pushLog],
  );

  // ---------- 角色池：批量导入 .d4e.json ----------
  const importD4eToPool = useCallback(
    (files: File[]) => {
      for (const f of files) {
        const reader = new FileReader();
        reader.onload = () => {
          const parsed = parseD4eJson(String(reader.result));
          if (!parsed.ok || !parsed.char) {
            pushLog(parsed.error ?? "导入失败", "warn");
            return;
          }
          const stats = buildCharacterCombatant(parsed.char, classMap.current, raceMap.current);
          setCharPool((prev) => [...prev, { ...stats, rawChar: parsed.char as Record<string, unknown> }]);
          pushLog(`已导入角色卡「${stats.name}」→ 角色池。`);
        };
        reader.readAsText(f);
      }
    },
    [pushLog],
  );

  // ---------- 车卡视图：加入角色池 / 改卡种子 ----------
  const [carSeed, setCarSeed] = useState<Record<string, unknown> | null>(null);

  // 车卡器「加入角色池」：与 .d4e.json 导入相同的解析管道；同名角色替换（改卡回写），异名追加
  const addCharToPool = useCallback(
    (char: Character) => {
      // Character（interface 无索引签名）与 RawD4e 运行时同构，显式收窄类型
      const raw = char as unknown as RawD4e;
      const stats = buildCharacterCombatant(raw, classMap.current, raceMap.current);
      setCharPool((prev) => {
        const idx = prev.findIndex((p) => p.name === stats.name);
        const entry: CombatantStats = { ...stats, rawChar: raw as Record<string, unknown> };
        return idx >= 0 ? prev.map((p, i) => (i === idx ? entry : p)) : [...prev, entry];
      });
      pushLog(`车卡「${stats.name}」已加入角色池。`);
    },
    [pushLog],
  );

  // 角色池「改卡」：带入车卡视图编辑（车卡视图内同名卡更新为池内最新版并激活）
  const editCharInCarBuild = useCallback((rawChar: Record<string, unknown>) => {
    setCarSeed(rawChar);
    setView("carbuild");
  }, []);

  // 角色卡速览写回：速览面板（OverviewView）编辑后的完整角色数据落回角色池同名条目，
  // 与 addCharToPool 同一解析管道重算派生数值（hpNow 覆盖随之生效）；静默、去重（不打日志）
  const updateCharRaw = useCallback((raw: Record<string, unknown>) => {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return;
    setCharPool((prev) => {
      const idx = prev.findIndex((p) => p.name === name);
      if (idx < 0) return prev;
      const old = prev[idx];
      if (old.rawChar && JSON.stringify(old.rawChar) === JSON.stringify(raw)) return prev;
      const stats = buildCharacterCombatant(raw as RawD4e, classMap.current, raceMap.current);
      return prev.map((p, i) => (i === idx ? { ...stats, rawChar: raw } : p));
    });
  }, []);

  // ---------- 角色队伍管理 ----------
  const mutateParties = useCallback((fn: (prev: Party[]) => Party[]) => {
    setParties((prev) => {
      const next = fn(prev);
      saveParties(next);
      return next;
    });
  }, []);

  const createParty = useCallback(() => {
    const id = nextPartyId();
    mutateParties((prev) => [...prev, { id, name: "新队伍", members: [] }]);
    pushLog("已创建队伍「新队伍」。", "normal");
  }, [mutateParties, pushLog]);

  const renameParty = useCallback(
    (id: string, name: string) => {
      mutateParties((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    },
    [mutateParties],
  );

  const deleteParty = useCallback(
    (id: string) => {
      mutateParties((prev) => prev.filter((p) => p.id !== id));
      pushLog("已删除队伍。", "warn");
    },
    [mutateParties, pushLog],
  );

  const addPartyMember = useCallback(
    (partyId: string, member: PartyMember) => {
      mutateParties((prev) => prev.map((p) => (p.id === partyId ? { ...p, members: [...p.members, member] } : p)));
    },
    [mutateParties],
  );

  const removePartyMember = useCallback(
    (partyId: string, memberId: string) => {
      mutateParties((prev) =>
        prev.map((p) => (p.id === partyId ? { ...p, members: p.members.filter((m) => m.id !== memberId) } : p)),
      );
    },
    [mutateParties],
  );

  const memberColor = useCallback((partyId: string, memberId: string, color: string | undefined) => {
    let sync: { name: string; kind: Team; color: string | undefined } | null = null;
    mutateParties((prev) => {
      const next = prev.map((p) => (p.id !== partyId ? p : { ...p, members: p.members.map((m) => (m.id !== memberId ? m : { ...m, color })) }));
      const m = next.find((p) => p.id === partyId)?.members.find((x) => x.id === memberId);
      if (m) sync = { name: m.name, kind: m.source === "pc" ? "pc" : "monster", color };
      return next;
    });
    // 同步已放置的同名同阵营棋子描边
    if (sync) {
      setCombatants((prev) => prev.map((c) => (c.name === sync!.name && c.kind === sync!.kind ? { ...c, color: sync!.color } : c)));
    }
  }, [mutateParties]);

  // 放置队伍成员：以快照构建 combatant 并入遭遇（带描边色）；队伍=所在角色队伍 id（批 8：同队=盟友、异队=敌人）
  const placePartyMember = useCallback(
    (partyId: string, stats: CombatantStats, color?: string) => addCombatant(stats, color, `pt:${partyId}`),
    [addCombatant],
  );

  const openCharacter = useCallback(
    (c: Combatant) => {
      const base = (settings.charcraftUrl || "http://localhost:5173").replace(/\/+$/, "");
      if (!c.rawChar) {
        window.open(base, "_blank");
        pushLog(`【${c.name}】无车卡原始数据，已打开车卡器首页。`, "normal");
        return;
      }
      // Unicode 安全 → base64 → URL 编码后放于 hash，供车卡器 #import= 读取（单向带入）
      const json = JSON.stringify(c.rawChar);
      const b64 = btoa(unescape(encodeURIComponent(json)));
      window.open(base + "#import=" + encodeURIComponent(b64), "_blank");
      pushLog(`【${c.name}】已打开车卡器并在新标签页载入该角色数据。`, "normal");
    },
    [settings.charcraftUrl, pushLog],
  );

  // ---------- 地图点击 ----------
  const occupantAt = useCallback(
    (x: number, y: number): Combatant | null => {
      for (const c of combatants) {
        if (!c.pos) continue;
        if (x >= c.pos.x && x < c.pos.x + c.size && y >= c.pos.y && y < c.pos.y + c.size) return c;
      }
      return null;
    },
    [combatants],
  );

  // ---------- 瞄准：在地图上点选目标 / 区域中心 ----------
  // 规则要点（万律书）：近战/远程多目标各目标独立掷攻击骰与伤害骰；
  // 近程/区域各目标独立掷攻击骰、共享一次伤害骰；近程爆发/冲击以使用者整个空间为起始格、不影响创造者；
  // 区域威能：使用者须对起始格（区域中心）与 起始格→目标 有效果线；目标↔使用者不要求。
  /** 批 2-4：逐目标掩护等级（障碍版）。近战/远程=攻击者中心→目标四角；近程=起始格→目标四角；区域=区域中心→目标四角。 */
  const coverForTargets = useCallback(
    (attacker: Combatant, attack: AttackOption, targetIds: string[], anchorOverride?: Point): Record<string, CoverLevel> => {
      const pr = parseRange(attack.range);
      let anchor: Point | null = null;
      if (pr.type === "melee" || pr.type === "ranged") anchor = attacker.pos ?? null;
      else if (pr.type === "close") anchor = anchorOverride ?? attacker.pos ?? null;
      else if (pr.type === "area") anchor = anchorOverride ?? null;
      if (!anchor) return {};
      const blocked = new Set(obstacles);
      const out: Record<string, CoverLevel> = {};
      for (const tid of targetIds) {
        const t = combatants.find((c) => c.cid === tid);
        if (t?.pos) out[tid] = coverOf(anchor, 1, t.pos, t.size, blocked).cover;
      }
      return out;
    },
    [combatants, obstacles],
  );
  /** 支付动作槽（开关关闭 = 免检）：返回扣除后的新预算；不足返回 null */
  const paySlot = useCallback(
    (c: Combatant, slot: ActionSlot): { standard: boolean; move: boolean; minor: boolean } | null => {
      if (!settings.auto.turn.actionBudget) return c.actionBudget ?? freshActionBudget();
      return spendAction(c.actionBudget ?? freshActionBudget(), slot);
    },
    [settings.auto.turn.actionBudget],
  );
  const settleAttack = useCallback(
    (attacker: Combatant, attack: AttackOption, targetIds: string[], rangeText: string, anchorOverride?: Point) => {
      const forced = parseTargetSpec(attack.target).forced;
      // 批 2-4：掩护自动计算（近战/远程用攻击者中心；近程用起始格；区域用区域中心）
      const coverByTarget = coverForTargets(attacker, attack, targetIds, anchorOverride);
      setPendingAttack({ attackerId: attacker.cid, attack, targetIds, rangeText, forced, coverByTarget });
      setAim(null);
      setAimSel([]);
      setAimArea(null);
    },
    [coverForTargets],
  );

  // 多目标（近战/远程 / 选择性近程区域）确认：在 min≤已选<max 时由确认按钮触发
  const onConfirmAim = useCallback(() => {
    if (!aim || aimSel.length === 0) return;
    const attacker = combatants.find((c) => c.cid === aim.attackerId);
    if (!attacker || !attacker.pos) return;
    const spec = parseTargetSpec(aim.attack.target);
    if (aimSel.length < spec.min) {
      pushLog(`【${aim.attack.name}】至少需要 ${spec.min} 个目标，继续点击。`, "warn");
      return;
    }
    const pr = parseRange(aim.attack.range);
    const sharedDmg = pr.type === "close" || pr.type === "area";
    const rangeText = `已选 ${aimSel.length} 个目标（各目标独立掷攻击骰${sharedDmg ? "，共享伤害骰" : "与伤害骰"}）`;
    settleAttack(attacker, aim.attack, aimSel, rangeText);
  }, [aim, aimSel, combatants, pushLog, settleAttack]);

  // 目标清单条：移除一个已选目标（点已选目标=取消选中的快捷入口）
  const onRemoveAimSel = useCallback(
    (cid: string) => {
      setAimSel((prev) => prev.filter((id) => id !== cid));
      const c = combatants.find((x) => x.cid === cid);
      if (c) {
        pushLog(`${c.name} 已从目标列表移除。`, "normal");
      } else {
        // 批 4-4a-3：物体目标移除提示
        const o = objects[cid];
        if (o) pushLog(`${o.name} 已从目标列表移除。`, "normal");
      }
    },
    [combatants, objects, pushLog],
  );

  const handleAimPick = useCallback(
    (x: number, y: number) => {
      if (!aim) return;
      const attacker = combatants.find((c) => c.cid === aim.attackerId);
      if (!attacker || !attacker.pos) {
        setAim(null);
        return;
      }
      const pr = parseRange(aim.attack.range);
      const blocked = new Set(obstacles);
      const spec = parseTargetSpec(aim.attack.target);

      if (pr.type === "none") {
        pushLog(`无法解析射程【${aim.attack.range}】，请检查威能射程描述。`, "warn");
        return;
      }

      // 1) 近战 / 远程：个体目标（可多目标）
      if (pr.type === "melee" || pr.type === "ranged") {
        const target = occupantAt(x, y);
        if (!target) {
          // 批 4-4a-3：无生物但该格是墙/陷阱 → 物体目标（点墙/陷阱即可攻击）
          const k = x + "," + y;
          const isWall = obstacles.has(k);
          const isTrap = traps.has(k);
          if (isWall || isTrap) {
            const kind = isWall ? "wall" : "trap";
            const oid = objectIdOf(kind, x, y);
            if (!objects[oid]) {
              // 首次点选：按物体属性表定值创建（DM 可后续在数据栏调整）
              const d = OBJECT_DEFAULTS[kind];
              setObjects((prev) => ({
                ...prev,
                [oid]: { id: oid, kind, x, y, name: kind === "wall" ? "墙" : "陷阱", ...d },
              }));
            }
            const obj = objects[oid] ?? { id: oid, kind, x, y, name: kind === "wall" ? "墙" : "陷阱", ...OBJECT_DEFAULTS[kind] };
            if (obj.hp <= 0) {
              pushLog(`${obj.name} (${x + 1},${y + 1}) 已被破坏。`, "warn");
              return;
            }
            if (aimSel.includes(oid)) {
              setAimSel((prev) => prev.filter((id) => id !== oid));
              pushLog(`${obj.name} (${x + 1},${y + 1}) 已从目标列表移除。`, "normal");
              return;
            }
            const next = [...aimSel, oid];
            setAimSel(next);
            if (next.length >= spec.max) {
              settleAttack(attacker, aim.attack, next, `已选 ${next.length}/${spec.max} 个目标（含物体，各目标独立掷攻击骰与伤害骰）`);
            } else {
              pushLog(
                next.length >= spec.min
                  ? `已选 ${next.length}/${spec.max} 个目标（含物体），可点「确认」结算或继续选择。`
                  : `已选 ${next.length}/${spec.max} 个目标，继续点击下一个目标（可点墙/陷阱攻击物体）。`,
                "normal",
              );
            }
            return;
          }
          pushLog("请点击一个生物或物体（墙/陷阱）作为目标（点空白处不发起攻击）。", "warn");
          return;
        }
        if (target.cid === attacker.cid) {
          pushLog("不能攻击自己；继续点击其他目标（点空白处可取消瞄准）。", "warn");
          return;
        }
        // 冲锋（批 3-3b）：自动移动至目标邻接格（≥2 格、每格更近、不超移动力）+ 挂「冲锋 AC -2」+ 发起基本近战攻击
        if (aim.attack.key === "es-act-charge") {
          if (!target.pos) return;
          const blockedC = new Set(obstacles);
          for (const c of combatants) {
            if (c.pos && c.cid !== attacker.cid) {
              for (let ox = c.pos.x; ox < c.pos.x + c.size; ox++)
                for (let oy = c.pos.y; oy < c.pos.y + c.size; oy++) blockedC.add(ox + "," + oy);
            }
          }
          const ml = effectiveMoveLimit(attacker);
          const cp = ml > 0
            ? chargePathOf(attacker.pos, target.pos, target.size, ml, mapCols, mapRows, blockedC, new Set(obstacles), cellCostOf(difficult), attacker.size)
            : null;
          if (!cp) {
            pushLog(`无法冲锋 ${target.name}：需与目标至少相距 2 格、每格更近、且不超当前移动力（${ml} 点）。`, "warn");
            return;
          }
          const end = cp.path[cp.path.length - 1];
          beginUndo(round, attacker.cid, `${attacker.name} 冲锋 ${target.name}`);
          snapBefore(attacker.cid);
          const pay = paySlot(attacker, "standard");
          patchCombatant(attacker.cid, (x) => addEffect({ ...x, ...(pay ? { actionBudget: pay } : {}), pos: end }, {
            kind: "buff",
            label: "冲锋",
            source: "冲锋",
            duration: "直到下回合开始",
            untilNextTurn: true,
            defMods: { ac: -2 },
          }));
          pushTurnLog(`${attacker.name} 冲锋：移动 ${cp.path.length} 格至目标邻接格 (${end.x + 1},${end.y + 1})，冲锋中 AC -2 直到下回合开始。`, "normal", "action", attacker.cid, { act: "move" });
          commitUndo();
          settleAttack({ ...attacker, pos: end }, chargeAttackOf(attacker), [target.cid], "冲锋攻击（移动后已邻接）");
          return;
        }
        const range = rangeStatus(aim.attack.range, attacker.pos, target.pos, obstacles, attacker.size, target.size);
        if (!range) {
          pushLog("无法判定射程（一方未放置）。", "warn");
          return;
        }
        if (!range.ok) {
          pushLog(`${range.label}，无法攻击 ${target.name}。`, "warn");
          return;
        }
        if (range.losBlocked) {
          pushLog(`对 ${target.name} 的效果线被障碍遮挡，无法攻击。`, "warn");
          return;
        }
        // 批 2-4：全掩护（目标四角效果线全部被遮挡）同样无法攻击
        if (coverOf(attacker.pos, attacker.size, target.pos!, target.size, blocked).cover === "total") {
          pushLog(`对 ${target.name} 处于全掩护（无效果线），无法攻击。`, "warn");
          return;
        }
        const specHint = targetSpecHint(spec, attacker, target);
        if (specHint) {
          pushLog(specHint, "warn");
          return;
        }
        if (spec.max >= 2) {
          if (aimSel.includes(target.cid)) {
            // 点击已选目标 = 取消选中（toggle，误点可直接恢复）
            const next = aimSel.filter((id) => id !== target.cid);
            setAimSel(next);
            pushLog(`${target.name} 已从目标列表移除。`, "normal");
            return;
          }
          const next = [...aimSel, target.cid];
          setAimSel(next);
          if (next.length >= spec.max) {
            settleAttack(attacker, aim.attack, next, `已选 ${next.length}/${spec.max} 个目标（各目标独立掷攻击骰与伤害骰）`);
          } else {
            pushLog(
              next.length >= spec.min
                ? `已选 ${next.length}/${spec.max} 个目标，可点「确认」结算或继续选择。`
                : `已选 ${next.length}/${spec.max} 个目标，继续点击下一个目标。`,
              "normal",
            );
          }
          return;
        }
        settleAttack(attacker, aim.attack, [target.cid], range.label + " ✓ 在射程内");
        return;
      }

      // 2) 近程（爆发 / 冲击）
      if (pr.type === "close") {
        const inOwn =
          x >= attacker.pos.x && x < attacker.pos.x + attacker.size && y >= attacker.pos.y && y < attacker.pos.y + attacker.size;
        if (inOwn) {
          setAimOrigin({ x, y });
          pushLog(`已将起始格设为自身 (${x + 1},${y + 1})，再点击目标格结算。`, "normal");
          return;
        }
        const origin = aimOrigin ?? attacker.pos;
        let cells: Set<string>;
        if (pr.areaKind === "blast") {
          const sq = blastSquare(attacker.pos, attacker.size, pr.dist, { x, y }, mapCols, mapRows);
          if (!sq) {
            pushLog("冲击区域超出地图边界，请靠近攻击者点击。", "warn");
            return;
          }
          cells = cellsInRect(sq);
        } else {
          cells = closeBurstCells(attacker.pos, attacker.size, pr.dist, mapCols, mapRows);
        }
        const affected = affectedIn(combatants, cells, attacker.cid).filter(
          (c) => c.pos && !losBlocked(origin, centerOf(c.pos, c.size), blocked) && coverOf(origin, 1, c.pos, c.size, blocked).cover !== "total",
        );
        if (affected.length === 0) {
          pushLog(`${pr.areaKind === "blast" ? "冲击" : "爆发"}范围内没有可攻击的目标（需有效果线）。`, "warn");
          return;
        }
        if (spec.forced) {
          const rangeText = `${pr.areaKind === "blast" ? `近程冲击 ${pr.dist}` : `近程爆发 ${pr.dist}`}，影响 ${affected.length} 个目标`;
          settleAttack(attacker, aim.attack, affected.map((c) => c.cid), rangeText, origin);
          return;
        }
        const clicked = occupantAt(x, y);
        if (clicked && clicked.cid !== attacker.cid && affected.some((c) => c.cid === clicked.cid)) {
          const specHint = targetSpecHint(spec, attacker, clicked);
          if (specHint) {
            pushLog(specHint, "warn");
            return;
          }
          if (aimSel.includes(clicked.cid)) {
            // 点击已选目标 = 取消选中（toggle）
            const next = aimSel.filter((id) => id !== clicked.cid);
            setAimSel(next);
            pushLog(`${clicked.name} 已从目标列表移除。`, "normal");
            return;
          }
          const next = [...aimSel, clicked.cid];
          setAimSel(next);
          if (next.length >= spec.max) {
            settleAttack(attacker, aim.attack, next, `已选 ${next.length} 个目标（各目标独立掷攻击骰，共享伤害骰）`, origin);
          } else {
            pushLog(`已选 ${next.length}/${spec.max} 个目标，继续点击范围内的目标。`, "normal");
          }
          return;
        }
        setAimArea({ cells, label: `${pr.areaKind === "blast" ? "近程冲击" : "近程爆发"} ${pr.dist}` });
        pushLog(`已确定${pr.areaKind === "blast" ? "冲击" : "爆发"}区域，点击区域内的目标生物（目标词条：${aim.attack.target}）。`, "normal");
        return;
      }

      // 3) 区域（区域N爆发M）
      const center = { x, y };
      const aCenter = centerOf(attacker.pos, attacker.size);
      const centerDist = tokenDistance(attacker.pos, attacker.size, center, 1);
      if (centerDist > pr.dist) {
        pushLog(`区域中心距攻击者 ${centerDist} 格，超出施法距离 ${pr.dist} 格。`, "warn");
        return;
      }
      if (losBlocked(aCenter, center, blocked)) {
        pushLog("攻击者到区域中心的效果线被障碍遮挡，无法施放。", "warn");
        return;
      }
      const acells = burstCells(center, pr.areaSize ?? pr.dist, mapCols, mapRows);
      const affected = affectedIn(combatants, acells).filter(
        (c) => c.pos && !losBlocked(center, centerOf(c.pos, c.size), blocked) && coverOf(center, 1, c.pos, c.size, blocked).cover !== "total",
      );
      if (affected.length === 0) {
        pushLog("该区域内没有可攻击的目标。", "warn");
        return;
      }
      if (spec.forced) {
        const rangeText = `区域爆发 ${pr.areaSize ?? pr.dist}，中心距攻击者 ${centerDist} 格，影响 ${affected.length} 个目标`;
        settleAttack(attacker, aim.attack, affected.map((c) => c.cid), rangeText, center);
        return;
      }
      const clicked = occupantAt(x, y);
      if (clicked && affected.some((c) => c.cid === clicked.cid)) {
        if (clicked.cid === attacker.cid) {
          pushLog("不能攻击自己；继续点击区域内的其他目标。", "warn");
          return;
        }
        const specHint = targetSpecHint(spec, attacker, clicked);
        if (specHint) {
          pushLog(specHint, "warn");
          return;
        }
        if (aimSel.includes(clicked.cid)) {
          // 点击已选目标 = 取消选中（toggle）
          const next = aimSel.filter((id) => id !== clicked.cid);
          setAimSel(next);
          pushLog(`${clicked.name} 已从目标列表移除。`, "normal");
          return;
        }
        const next = [...aimSel, clicked.cid];
        setAimSel(next);
        if (next.length >= spec.max) {
          settleAttack(attacker, aim.attack, next, `已选 ${next.length} 个目标（各目标独立掷攻击骰，共享伤害骰）`, center);
        } else {
          pushLog(`已选 ${next.length}/${spec.max} 个目标，继续点击区域内的目标。`, "normal");
        }
        return;
      }
      setAimArea({ cells: acells, label: `区域爆发 ${pr.areaSize ?? pr.dist}` });
      pushLog(`已确定区域，点击区域内的目标生物（目标词条：${aim.attack.target}）。`, "normal");
    },
    [aim, aimOrigin, aimSel, combatants, obstacles, mapCols, mapRows, occupantAt, pushLog, settleAttack, difficult, paySlot, beginUndo, snapBefore, patchCombatant, pushTurnLog, commitUndo, round, objects],
  );

  const paintTerrain = useCallback(
    (x: number, y: number, apply?: boolean) => {
      const k = x + "," + y;
      if (sceneTool === "wall") {
        setObstacles((prev) => {
          const n = new Set(prev);
          if (apply) {
            n.add(k);
          } else if (n.has(k)) {
            n.delete(k);
            // 批 4-4a-3：墙体被擦除 → 该格的物体目标数据一并清理
            setObjects((prev2) => {
              const oid = objectIdOf("wall", x, y);
              if (!prev2[oid]) return prev2;
              const n2 = { ...prev2 };
              delete n2[oid];
              return n2;
            });
          } else {
            n.add(k);
          }
          return n;
        });
      } else if (sceneTool === "difficult") {
        setDifficult((prev) => {
          const n = new Set(prev);
          if (apply) n.add(k);
          else if (n.has(k)) n.delete(k);
          else n.add(k);
          return n;
        });
      } else if (sceneTool === "lightFog") {
        setFog((prev) => {
          const n = { ...prev };
          if (apply) n[k] = "light";
          else if (n[k] === "light") delete n[k];
          else n[k] = "light";
          return n;
        });
      } else if (sceneTool === "heavyFog") {
        setFog((prev) => {
          const n = { ...prev };
          if (apply) n[k] = "heavy";
          else if (n[k] === "heavy") delete n[k];
          else n[k] = "heavy";
          return n;
        });
      } else if (sceneTool === "dark") {
        setFog((prev) => {
          const n = { ...prev };
          if (apply) n[k] = "dark";
          else if (n[k] === "dark") delete n[k];
          else n[k] = "dark";
          return n;
        });
      } else if (sceneTool === "dim") {
        setFog((prev) => {
          const n = { ...prev };
          if (apply) n[k] = "dim";
          else if (n[k] === "dim") delete n[k];
          else n[k] = "dim";
          return n;
        });
      } else if (sceneTool === "water") {
        setWater((prev) => (apply ? new Set(prev).add(k) : toggleCell(prev, k)));
      } else if (sceneTool === "chasm") {
        setChasm((prev) => (apply ? new Set(prev).add(k) : toggleCell(prev, k)));
      } else if (sceneTool === "color") {
        // 涂色工具：涂抹所选颜色（拖动=强制上色；单击同色格=清除，其他=上色）
        setCellColors((prev) => {
          const n = { ...prev };
          if (apply) n[k] = mapColor;
          else if (n[k] === mapColor) delete n[k];
          else n[k] = mapColor;
          return n;
        });
      } else if (sceneTool === "erase") {
        // 擦除工具：一键清除该格全部地形与涂色（墙/困难/水域/坠落/迷雾）；墙体被擦除 → 物体目标数据一并清理
        setObstacles((prev) => {
          if (!prev.has(k)) return prev;
          const n = new Set(prev);
          n.delete(k);
          setObjects((prev2) => {
            const oid = objectIdOf("wall", x, y);
            if (!prev2[oid]) return prev2;
            const n2 = { ...prev2 };
            delete n2[oid];
            return n2;
          });
          return n;
        });
        setDifficult((prev) => removeCell(prev, k));
        setWater((prev) => removeCell(prev, k));
        setChasm((prev) => removeCell(prev, k));
        setFog((prev) => {
          if (!(k in prev)) return prev;
          const n = { ...prev };
          delete n[k];
          return n;
        });
        setCellColors((prev) => {
          if (!(k in prev)) return prev;
          const n = { ...prev };
          delete n[k];
          return n;
        });
      }
      setMovePreview(null);
    },
    [sceneTool, mapColor],
  );

  /** 批 2b-4：区域效果落地（zone=覆盖格集；wall=塑形格序列）。同一 undo 单元（zones+obstacles 恢复）。
   * 效果型威能语义化解析：无 manual → auto 挂载；否则 manual（DM 裁决）。默认触发=进入、时长=到持有者回合结束。 */
  const placeZone = useCallback(
    (zb: ZoneBuild, cells: string[]) => {
      if (cells.length === 0) return;
      const specs = zb.attack.effectSpecs ?? [];
      const hasManual = specs.some((s) => s.kind === "manual");
      let effect: Zone["effect"];
      if (specs.length > 0 && !hasManual) {
        const t = specsToApplyTarget({ cid: zb.attackerId } as Combatant, specs);
        effect = t ? { kind: "auto", target: t } : { kind: "manual", raw: zb.attack.effectText };
      } else {
        effect = { kind: "manual", raw: zb.attack.effectText };
      }
      const z: Zone = {
        id: "z" + nextCid(),
        kind: zb.kind,
        cells,
        source: { name: zb.attack.name, powerKey: zb.attack.key },
        effect,
        trigger: "enter",
        ownerCid: zb.attackerId,
        createdRound: round,
        createdTurnIndex: turnIndex,
        duration: "untilOwnerTurnEnd",
      };
      beginUndo(round, zb.attackerId, `放置区域效果【${zb.attack.name}】`);
      // 批 3-3a：效果型威能（区域/墙）落地时消耗动作槽（仅当前行动者）
      if (zb.attackerId === turnOrder[turnIndex]) {
        const s = actionSlotOf(zb.attack.kind);
        if (s) {
          const spent = spendAction(combatants.find((c) => c.cid === zb.attackerId)?.actionBudget ?? freshActionBudget(), s);
          if (spent) {
            snapBefore(zb.attackerId);
            patchCombatant(zb.attackerId, (x) => ({ ...x, actionBudget: spent }));
          }
        }
      }
      // 批 3-3c：威能频率计数（区域/墙放置同样计入遭遇/每日/充能）
      {
        const fk3 = freqKindOf(zb.attack.freq);
        if (fk3 === "encounter" || fk3 === "daily" || fk3 === "recharge") {
          snapBefore(zb.attackerId);
          patchCombatant(zb.attackerId, (x) => ({
            ...x,
            powerUses: { ...(x.powerUses ?? {}), [zb.attack.key]: ((x.powerUses ?? {})[zb.attack.key] ?? 0) + 1 },
          }));
        }
      }
      const nextZones = [...zones, z];
      const nextObs = new Set(obstacles);
      if (zb.kind === "wall") for (const k of cells) nextObs.add(k);
      setZones(nextZones);
      if (zb.kind === "wall") setObstacles(nextObs);
      pushTurnLog(`【${zb.attack.name}】${zb.kind === "wall" ? "墙" : "区域效果"}已放置（${cells.length} 格），进入触发、至持有者回合结束。`, "normal", "action", zb.attackerId);
      commitUndo(`放置区域效果【${zb.attack.name}】`, nextZones, nextObs);
      setZoneBuild(null);
      setInvalidZoneCell(null);
    },
    [zones, obstacles, round, turnIndex, beginUndo, commitUndo, pushTurnLog, combatants, turnOrder, snapBefore, patchCombatant],
  );

  /** 批 2b-4：放置期点击格。zone=点中心（距离+效果线校验）后选格集；wall=连续塑形（起始格校验 + 正交相邻 + 不占生物格 + 三定律 + 最大长度）。 */
  const handleZoneBuildClick = useCallback(
    (x: number, y: number) => {
      if (!zoneBuild) return;
      const zb = zoneBuild;
      const attacker = combatants.find((c) => c.cid === zb.attackerId && c.pos);
      if (!attacker || !attacker.pos) {
        setZoneBuild(null);
        return;
      }
      const key = x + "," + y;
      const pr = parseRange(zb.attack.range);
      const wallM = zb.attack.range.match(/区域(\d+)墙(\d+)/);

      // zone（非墙）：点中心 → 距离 + 效果线校验 → burstCells 选格集
      if (zb.kind === "zone") {
        if (pr.type !== "area") {
          pushLog(`无法解析射程【${zb.attack.range}】，无法放置区域。`, "warn");
          setZoneBuild(null);
          return;
        }
        const aCenter = centerOf(attacker.pos, attacker.size);
        const centerDist = tokenDistance(attacker.pos, attacker.size, { x, y }, 1);
        if (centerDist > pr.dist) {
          pushLog(`区域中心距攻击者 ${centerDist} 格，超出施法距离 ${pr.dist} 格。`, "warn");
          return;
        }
        if (losBlocked(aCenter, { x, y }, new Set(obstacles))) {
          pushLog("攻击者到区域中心的效果线被障碍遮挡，无法放置。", "warn");
          return;
        }
        const cells = burstCells({ x, y }, pr.areaSize ?? pr.dist, mapCols, mapRows);
        setZoneBuild({ ...zb, seq: [...cells] });
        setInvalidZoneCell(null);
        pushLog(`已选区域中心 (${x + 1},${y + 1})，覆盖 ${cells.size} 格，点「完成」放置。`, "normal");
        return;
      }

      // wall：连续塑形
      const dist = wallM ? parseInt(wallM[1], 10) : pr.dist ?? 0;
      const maxLen = wallM ? parseInt(wallM[2], 10) : Infinity;
      if (zb.seq.length === 0) {
        // 起始格：距离 + 效果线 + 不占生物格
        const aCenter = centerOf(attacker.pos, attacker.size);
        const centerDist = tokenDistance(attacker.pos, attacker.size, { x, y }, 1);
        if (centerDist > dist) {
          pushLog(`墙起始格距攻击者 ${centerDist} 格，超出施法距离 ${dist} 格。`, "warn");
          return;
        }
        if (losBlocked(aCenter, { x, y }, new Set(obstacles))) {
          pushLog("攻击者到墙起始格的效果线被障碍遮挡，无法放置。", "warn");
          return;
        }
        if (occupantAt(x, y)) {
          pushLog("墙不能建在生物占据的格子上。", "warn");
          return;
        }
        setZoneBuild({ ...zb, seq: [key] });
        setInvalidZoneCell(null);
        pushLog(`墙起始格 (${x + 1},${y + 1})，继续点击下一格（沿边线直连）或点「完成」落地。`, "normal");
        return;
      }
      const last = zb.seq[zb.seq.length - 1];
      const [lx, ly] = last.split(",").map(Number);
      if (!wallAdjacent({ x: lx, y: ly }, { x, y })) {
        setInvalidZoneCell(key);
        pushLog("墙必须沿边线连续直连（与上一格正交相邻），非法格红标。", "warn");
        return;
      }
      if (zb.seq.includes(key)) {
        // 点最后一格 = 撤销上一格；点更早的格 = 拒绝（防成环）
        if (key === last) {
          setZoneBuild({ ...zb, seq: zb.seq.slice(0, -1) });
          pushLog("已撤销墙的上一格。", "normal");
        } else {
          pushLog("该格已在墙序列中（墙不能成环）。", "warn");
        }
        return;
      }
      if (occupantAt(x, y)) {
        setInvalidZoneCell(key);
        pushLog("墙不能建在生物占据的格子上。", "warn");
        return;
      }
      if (zb.seq.length >= maxLen) {
        pushLog(`墙最长 ${maxLen} 格，已达上限，点「完成」落地。`, "warn");
        return;
      }
      const pts = [...zb.seq, key].map((k) => {
        const [a, b] = k.split(",").map(Number);
        return { x: a, y: b };
      });
      const wv = wallValidate(pts);
      if (!wv.ok) {
        setInvalidZoneCell(key);
        pushLog(wv.reason ?? "墙形状不合法。", "warn");
        return;
      }
      setZoneBuild({ ...zb, seq: [...zb.seq, key] });
      setInvalidZoneCell(null);
      pushLog(`墙已塑形 ${zb.seq.length + 1} 格，继续点击或点「完成」落地。`, "normal");
    },
    [zoneBuild, combatants, obstacles, mapCols, mapRows, occupantAt, pushLog],
  );

  /** 批 2b-4：放置确认 → placeZone（zone 需已选格；wall 需通过三定律）。 */
  const confirmZoneBuild = useCallback(() => {
    if (!zoneBuild) return;
    if (zoneBuild.seq.length === 0) {
      pushLog(zoneBuild.kind === "wall" ? "墙至少需要 2 格，请继续塑形。" : "请先点击地图选择区域中心。", "warn");
      return;
    }
    if (zoneBuild.kind === "wall") {
      const pts = zoneBuild.seq.map((k) => {
        const [a, b] = k.split(",").map(Number);
        return { x: a, y: b };
      });
      const wv = wallValidate(pts);
      if (!wv.ok) {
        pushLog(wv.reason ?? "墙形状不合法。", "warn");
        return;
      }
    }
    placeZone(zoneBuild, zoneBuild.seq);
  }, [zoneBuild, placeZone, pushLog]);

  /** 批 2b-4：取消放置（右键地图 / 取消按钮 / 已放置后自动清）。 */
  const cancelZoneBuild = useCallback(() => {
    setZoneBuild(null);
    setInvalidZoneCell(null);
    pushLog("已取消放置区域效果。", "normal");
  }, [pushLog]);

  /** 批 2b-2/2b-5：落子后进入 zone / 灵气的副作用结算（同一 undo 单元内增量应用，不破坏前序修改）。
   * 由 finishMove / 强制移动落子点调用：zone 进入（trigger=enter）+ 进入触发型灵气（emit enterAura）。 */
  const applyEnterSideEffects = useCallback(
    (mover: Combatant, from: Point, to: Point, moverNext: Combatant) => {
      if (settings.auto.trigger.zone) {
        const enteredZones = zoneEnterDetect(from, to, mover.size ?? 1, zones);
        for (const z of enteredZones) {
          // 顶层收窄提取 target，避免闭包内类型收窄丢失
          const zt = z.effect.kind === "auto" ? z.effect.target : null;
          if (zt) {
            const label = effectApplyParts(zt).join("、") || "效果";
            snapBefore(moverNext.cid);
            patchCombatant(moverNext.cid, (curc) => applyEffectToCombatant(curc, { ...zt, cid: moverNext.cid }));
            pushTurnLog(`${mover.name} 进入区域【${z.source.name}】：${label}。`, "warn", "action", mover.cid, { act: "move" });
          } else {
            pushTurnLog(`${mover.name} 进入区域【${z.source.name}】（含 DM 裁决项，请手动结算）。`, "warn", "action", mover.cid, { act: "move" });
          }
        }
      }
      if (settings.auto.trigger.aura) {
        const enteredAuras = auraEnterDetect(moverNext, from, to, combatants, mapCols, mapRows);
        for (const ea of enteredAuras) {
          battleBus.emit({ type: "enterAura", cid: moverNext.cid, auraOwner: ea.owner.cid, power: ea.power });
          const eff = auraEffectTargets(ea.owner, ea.power);
          if (eff) {
            snapBefore(moverNext.cid);
            patchCombatant(moverNext.cid, (curc) => applyEffectToCombatant(curc, { ...eff, cid: moverNext.cid }));
            pushTurnLog(`${mover.name} 进入 ${ea.owner.name} 的灵气【${ea.power.name}】：${effectApplyParts({ ...eff, cid: moverNext.cid }).join("、")}。`, "warn", "action", mover.cid, { act: "move" });
          } else {
            pushTurnLog(`${mover.name} 进入 ${ea.owner.name} 的灵气【${ea.power.name}】（含 DM 裁决项，请手动结算）。`, "warn", "action", mover.cid, { act: "move" });
          }
        }
      }
    },
    [zones, combatants, mapCols, mapRows, settings, snapBefore, patchCombatant, pushTurnLog],
  );

  /** 强制移动直线落点落子（正常 / 停在障碍前 / DM 裁决距离共用，批 3 收尾）：
   * dist 为实际移动格数（含落点）；to 为落点坐标。移动完成清空当前移动对象。 */
  const applyForcedMoveStraight = useCallback(
    (mover: Combatant, to: Point, dist: number) => {
      if (!effectMove) return;
      const from = mover.pos!;
      const attacker = combatants.find((c) => c.cid === effectMove.attackerId);
      const verb = forcedVerb(from, to, attacker?.pos ?? null);
      beginUndo(round, mover.cid, `${mover.name} 被【${effectMove.attack.name}】强制移动`);
      snapBefore(mover.cid);
      patchCombatant(mover.cid, (c) => ({ ...c, pos: to }));
      // 批 2b-2/2b-5：强制移动同样进入 zone / 灵气（推入毒云应触发）
      applyEnterSideEffects(mover, from, to, { ...mover, pos: to });
      pushTurnLog(
        `${mover.name} 被【${effectMove.attack.name}】${verb}${dist} 格，至 (${to.x + 1},${to.y + 1})（强制移动不引发借机攻击）。`,
        "normal",
        "action",
        mover.cid,
        { act: "move" },
      );
      commitUndo();
      setEffectMove((m) =>
        m ? { ...m, moved: m.moved.includes(mover.cid) ? m.moved : [...m.moved, mover.cid], mover: null } : m,
      );
    },
    [effectMove, combatants, round, beginUndo, snapBefore, patchCombatant, applyEnterSideEffects, pushTurnLog, commitUndo],
  );

  const onCellClick = useCallback(
    (x: number, y: number, apply?: boolean) => {
      // 0) 场景绘制模式（墙体/困难/遮蔽）：apply=true 为画笔拖动涂抹（只上色），否则单击切换
      if (sceneTool) {
        paintTerrain(x, y, apply);
        return;
      }

      // 0.1) 召唤兽绑定召出者模式（批 4-4a-2）：点召出者棋子绑定 / 点空格取消
      if (bindTarget) {
        const occ = occupantAt(x, y);
        const summon = combatants.find((c) => c.cid === bindTarget);
        if (occ && occ.cid === bindTarget) {
          pushLog("不能以自己为召出者。", "warn");
        } else if (occ) {
          if (summon) {
            // 批 8：召唤兽跟随召出者队伍（绑定瞬间同步 team，保证无 combatants 上下文的判断也正确）
            patchCombatant(bindTarget, (c) => ({ ...c, summonerCid: occ.cid, team: teamOf(occ) }));
            pushLog(`${summon.name} 已绑定召出者 ${occ.name}：先攻随召出者，召出者死亡/解除召唤时自动移除，自身死亡保留死亡棋子。`, "normal");
          }
        } else {
          pushLog("已取消绑定召出者。", "normal");
        }
        setBindTarget(null);
        return;
      }

      // 0.2) 守护者绑定主人模式（批 6f）：点一棋子设置为主人 / 点空格取消（与 summoner 绑定同 UX）
      if (bindMaster) {
        const occ = occupantAt(x, y);
        const guard = combatants.find((c) => c.cid === bindMaster);
        if (occ && occ.cid === bindMaster) {
          pushLog("不能以自己为主人。", "warn");
        } else if (occ) {
          if (guard) {
            patchCombatant(bindMaster, (c) => ({ ...c, masterCid: occ.cid }));
            pushLog(
              `${guard.name} 已绑定主人 ${occ.name}：其灵气/特性将围绕主人结算（主人位于灵气内受保护、瞬移至主人邻接等）。`,
              "normal",
            );
          }
        } else {
          pushLog("已取消设置主人。", "normal");
        }
        setBindMaster(null);
        return;
      }

      // 0.3) 区域效果放置模式（zone=点中心选格集；wall=连续塑形墙）
      if (zoneBuild) {
        handleZoneBuildClick(x, y);
        return;
      }

      // 0.4) 效果「强制移动」模式：点目标选中（出现 8 方向箭头）→ 点箭头或直线合法落点移动
      if (effectMove) {
        const occ = occupantAt(x, y);
        if (occ) {
          // 点棋子 → 选为待移动目标（hitOnly 时仅命中目标可选）
          if (effectMove.hitOnly && !effectMove.hitOnly.includes(occ.cid)) {
            pushLog(`${occ.name} 不在本次受影响目标内，无法移动。`, "warn");
            return;
          }
          setEffectMove((m) => (m ? { ...m, mover: occ.cid } : m));
          setSelectedId(occ.cid);
          return;
        }
        // 点空格 → 若已选目标，尝试直线强制移动
        const moverCid = effectMove.mover;
        if (!moverCid) {
          pushLog("请先点击要移动的目标棋子（或点其 8 方向箭头移动 1 格）。", "warn");
          return;
        }
        const mover = combatants.find((c) => c.cid === moverCid);
        if (!mover?.pos) return;
        if (mover.size > 1) {
          pushLog("强制移动的直线落点模式暂时只支持 1×1 棋子；大型棋子请用 8 方向箭头移动。", "warn");
          return;
        }
        const pts = straightMovePath(mover.pos, { x, y });
        if (!pts) {
          pushLog("强制移动必须是 直线（直/斜）路径，请另选落点（或点 8 方向箭头）。", "warn");
          return;
        }
        // 校验路径（含落点）无遮挡：不可越界、不可穿墙、不可穿过其它棋子。
        // 被阻挡时按规则停在障碍前（首个非法格的前一格），弹出 DM 裁决（批 3 收尾）。
        let blockedAt = -1;
        let blockedBy = "";
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (p.x < 0 || p.y < 0 || p.x >= mapCols || p.y >= mapRows) { blockedAt = i; blockedBy = "地图边界"; break; }
          if (obstacles.has(p.x + "," + p.y)) { blockedAt = i; blockedBy = "障碍"; break; }
          const occ2 = occupantAt(p.x, p.y);
          if (occ2 && occ2.cid !== moverCid) { blockedAt = i; blockedBy = `${occ2.name}（棋子）`; break; }
        }
        if (blockedAt >= 0) {
          setBlockedMove({ moverCid, attack: effectMove.attack, pts, blockedAt, blockedBy });
          return;
        }
        applyForcedMoveStraight(mover, { x, y }, pts.length);
        return;
      }

      // 0.5) 瞄准模式：点选目标 / 区域中心
      if (aim) {
        handleAimPick(x, y);
        return;
      }

      // 1) 待放置令牌（校验整块占地）
      if (pendingPlace) {
        const target = combatants.find((c) => c.cid === pendingPlace);
        if (target) {
          const size = Math.max(1, target.size);
          let reason = "";
          outer: for (let dy = 0; dy < size; dy++) {
            for (let dx = 0; dx < size; dx++) {
              const gx = x + dx;
              const gy = y + dy;
              if (gx >= mapCols || gy >= mapRows) {
                reason = "棋子超出地图边界，请选择更靠内的格子。";
                break outer;
              }
              if (obstacles.has(gx + "," + gy)) {
                reason = "该区域包含障碍，无法放置。";
                break outer;
              }
              if (occupantAt(gx, gy)) {
                reason = "该区域已被其它棋子占据，请选择空格放置。";
                break outer;
              }
            }
          }
          if (reason) {
            // 点击的是被其它棋子占据的格：退出放置模式，并选中该棋子（方便直接查看/操作）
            const other = occupantAt(x, y);
            if (other) {
              setPendingPlace(null);
              setMovePreview(null);
              setSelectedId(other.cid);
              return;
            }
            pushLog(reason, "warn");
            return;
          }
          patchCombatant(target.cid, (c) => ({ ...c, pos: { x, y } }));
          const next = combatants.find((c) => c.pos == null && c.cid !== target.cid);
          setPendingPlace(next ? next.cid : null);
          pushLog(`${target.name} 已放置于 (${x + 1}, ${y + 1})。`);
          return;
        }
        setPendingPlace(null);
      }

      // 2) 有参战者占据该格 → 选中
      const occupant = occupantAt(x, y);
      if (occupant) {
        setMovePreview(null);
        setSelectedId(occupant.cid);
        return;
      }

      // 3) 空格：取消选择
      if (selected && selected.pos) {
        setMovePreview(null);
        setSelectedId(null);
      } else {
        setMovePreview(null);
      }
    },
    [combatants, occupantAt, patchCombatant, pendingPlace, pushLog, selected, sceneTool, paintTerrain, obstacles, mapCols, mapRows, aim, handleAimPick, effectMove, applyForcedMoveStraight, beginUndo, snapBefore, commitUndo, round, pushTurnLog, applyEnterSideEffects, zoneBuild, handleZoneBuildClick, bindTarget, bindMaster],
  );

  /** 批 2-3：统一落子（点击/拖拽/快步共用）。results=null → 无借机直接移动；
   * results 非空 → 借机伤害打到 mover + 命中即停（final=最早命中者的离开格），同一 undo 单元一步撤回。 */
  const finishMove = useCallback(
    (mover: Combatant, path: Point[], results: OAResult[] | null, opts: MoveOpts) => {
      const end = path[path.length - 1];
      const applied = results?.filter((r) => r.applied) ?? [];
      beginUndo(round, mover.cid, `${mover.name} 移动${applied.length > 0 ? "（被借机拦截）" : ""}`);
      snapBefore(mover.cid);
      let finalPos = end;
      let next = { ...mover };
      // 批 3-3a：自愿移动消耗「移动」动作（快步同为移动动作；强制移动不经本函数）。预算不足 → 拦截。
      if (mover.cid === turnOrder[turnIndex]) {
        const spent = spendAction(mover.actionBudget ?? freshActionBudget(), "move");
        if (spent) {
          next = { ...next, actionBudget: spent };
        } else if (settings.auto.turn.actionBudget) {
          setMovePreview(null);
          setPendingOA(null);
          pushLog(`${mover.name} 已无可用移动动作（动作预算用尽；可先结束回合或关闭「回合动作预算」）。`, "warn");
          return;
        }
      }
      if (applied.length > 0) {
        finalPos = applied[0].provoker.fromCell; // 命中即停：停在被离开的威胁格
        for (const r of applied) {
          if (r.damage <= 0) continue;
          dealDamage(next, r.damage);
          battleBus.emit({ type: "takeDamage", cid: mover.cid, amount: r.damage, source: r.provoker.enemyCid });
          if (next.hp <= 0) battleBus.emit({ type: "hpZero", cid: mover.cid, hp: next.hp });
        }
      }
      next = { ...next, pos: finalPos };
      setCombatants((prev) => prev.map((c) => (c.cid === mover.cid ? next : c)));
      battleBus.emit({ type: "move", cid: mover.cid, from: mover.pos!, to: finalPos, forced: false, path, shift: opts.shift ?? false });
      // 批 2b-2/2b-5：落子后进入 zone / 灵气副作用（同一 undo 单元）
      applyEnterSideEffects(mover, mover.pos!, finalPos, next);
      for (const r of applied) {
        pushTurnLog(
          `${r.enemyName} 对 ${mover.name} 借机攻击：d20 ${r.d20} ${fmtMod(r.attackBonus)} = ${r.total} vs ${r.defenseLabel} ${r.defense}，命中 ${r.damage} 点伤害。`,
          "warn",
          "interrupt",
          mover.cid,
        );
      }
      pushTurnLog(
        `${mover.name} 移动 ${opts.dist} 格${opts.costText !== undefined ? `（${opts.costText} 点移动力）` : ""}至 (${finalPos.x + 1}, ${finalPos.y + 1})${applied.length > 0 ? "，被借机拦截" : opts.limited ? "（超出速度，停在最远可达点）" : ""}。`,
        "normal",
        "action",
        mover.cid,
        { act: "move" },
      );
      commitUndo();
      setMovePreview(null);
    },
    [round, beginUndo, snapBefore, commitUndo, pushTurnLog, applyEnterSideEffects, turnOrder, turnIndex, settings, pushLog],
  );

  const confirmMove = useCallback(() => {
    if (pendingOA) return; // 借机结算中，屏蔽重复移动入口
    if (!movePreview || !selected) return;
    const mover = combatants.find((c) => c.cid === movePreview.cid);
    if (!mover || !mover.pos) return;
    const path = movePreview.path;
    const opts: MoveOpts = { dist: movePreview.dist, limited: movePreview.limited, shift: movePreview.shift };
    // 批 3-3a：动作预算预检（移动动作；快步同）——不足直接拦截，不进入借机预判
    if (
      mover.cid === turnOrder[turnIndex] &&
      settings.auto.turn.actionBudget &&
      !canSpendAction(mover.actionBudget ?? freshActionBudget(), "move")
    ) {
      setMovePreview(null);
      pushLog(`${mover.name} 已无可用移动动作（动作预算用尽）。`, "warn");
      return;
    }
    // 批 2-3：移动借机预判（快步不引发；oppDetect 关闭则直接移动）
    if (settings.auto.trigger.oppDetect && !movePreview.shift) {
      const oaPlan = detectMoveOA(mover, path, { combatants, cols: mapCols, rows: mapRows, obstacles });
      if (oaPlan.length > 0) {
        oaDeferredRef.current = (results) => finishMove(mover, path, results, opts);
        setPendingOA({ kind: "move", mover, provokers: oaPlan });
        return;
      }
    }
    finishMove(mover, path, null, opts);
  }, [movePreview, selected, combatants, settings, mapCols, mapRows, obstacles, finishMove, pendingOA, turnOrder, turnIndex, pushLog]);

  const cancelMove = useCallback(() => setMovePreview(null), []);

  // ---------- 拖拽移动 ----------
  const moveTokenTo = useCallback(
    (cid: string, end: { x: number; y: number }, path?: Point[], shift?: boolean) => {
      if (pendingOA) return; // 借机结算中，屏蔽重复移动入口
      const mover = combatants.find((c) => c.cid === cid);
      if (!mover || !mover.pos) return;
      const ctx = { combatants, cols: mapCols, rows: mapRows, obstacles };
      if (path && path.length > 0) {
        const opts: MoveOpts = { dist: path.length, limited: false, shift };
        // 批 2-3：移动借机预判（快步/强制不引发；oppDetect 关闭则直接移动）
        if (settings.auto.trigger.oppDetect && !shift) {
          const oaPlan = detectMoveOA(mover, path, ctx);
          if (oaPlan.length > 0) {
            oaDeferredRef.current = (results) => finishMove(mover, path, results, opts);
            setPendingOA({ kind: "move", mover, provokers: oaPlan });
            setSelectedId(cid);
            return;
          }
        }
        finishMove(mover, path, null, opts);
        setSelectedId(cid);
        return;
      }
      const blocked = new Set(obstacles);
      for (const c of combatants) {
        if (c.pos && c.cid !== cid) {
          for (let ox = c.pos.x; ox < c.pos.x + c.size; ox++) {
            for (let oy = c.pos.y; oy < c.pos.y + c.size; oy++) blocked.add(ox + "," + oy);
          }
        }
      }
      const ml = effectiveMoveLimit(mover);
      const bp =
        ml > 0
          ? buildPath(mover.pos, end, ml, mapCols, mapRows, blocked, new Set(obstacles), cellCostOf(difficult), mover.size)
          : { path: [], cost: 0, dist: 0, limited: true };
      if (!bp.limited && bp.path.length > 0) {
        const opts: MoveOpts = { dist: bp.dist, limited: false, shift, costText: String(bp.cost) };
        // 批 2-3：自动寻路同样预判移动借机
        if (settings.auto.trigger.oppDetect && !shift) {
          const oaPlan = detectMoveOA(mover, bp.path, ctx);
          if (oaPlan.length > 0) {
            oaDeferredRef.current = (results) => finishMove(mover, bp.path, results, opts);
            setPendingOA({ kind: "move", mover, provokers: oaPlan });
            setMovePreview(null);
            setSelectedId(cid);
            return;
          }
        }
        finishMove(mover, bp.path, null, opts);
      } else if (ml <= 0) {
        pushTurnLog(`${mover.name} 处于定身或束缚状态，无法移动。`, "warn", "action", cid, { act: "move" });
      } else {
        pushLog("目标格被障碍或占位阻挡，或移动力不足，无法到达。", "warn");
      }
      setMovePreview(null);
      setSelectedId(cid);
    },
    [combatants, obstacles, difficult, mapCols, mapRows, pushTurnLog, pushLog, settings, finishMove, pendingOA],
  );

  // ---------- 先攻 / 回合 ----------
  const rollInitiative = useCallback(() => {
    // 同类怪物（同名同阵营）共享一次 d20 掷骰；分组后再各加先攻修正排序
    const d20Cache = new Map<string, number>();
    const rolled = combatants.map((c) => {
      const key = c.kind + "|" + c.name;
      let d20 = d20Cache.get(key);
      if (d20 === undefined) {
        d20 = 1 + Math.floor(Math.random() * 20);
        d20Cache.set(key, d20);
      }
      return { c, total: d20 + c.init, d20 };
    });
    const byId = new Map(rolled.map((r) => [r.c.cid, r]));
    // 批 4-4a-2：召唤兽先攻与召出者相同（「先攻 和召出者一样」）——已绑定召出者时沿用其先攻总值
    for (const r of rolled) {
      if (isSummoned(r.c) && r.c.summonerCid && byId.has(r.c.summonerCid)) {
        r.total = byId.get(r.c.summonerCid)!.total;
      }
    }
    const order = [...rolled].sort((a, b) => b.total - a.total || b.c.init - a.c.init).map((r) => r.c.cid);
    setTurnOrder(order);
    setTurnIndex(0);
    setRound(1);
    // 把掷出的先攻结果写回棋子，供「全员数据」栏展示真实先攻值；并重置全员动作预算
    setCombatants((prev) =>
      prev.map((c) => (byId.has(c.cid) ? { ...c, initResult: byId.get(c.cid)!.total, actionBudget: freshActionBudget() } : { ...c, actionBudget: freshActionBudget() })),
    );
    for (const cid of order) {
      const r = byId.get(cid)!;
      pushLog(`${r.c.name}：先攻 ${r.d20} + ${r.c.init} = ${r.total}`, "normal");
    }
    logEvt("op", "用户点击【投掷先攻】完成，先攻顺序已按从高到低排定");
    snapshotCombatants("投掷先攻完成后的当前画面");
  }, [combatants, pushLog, snapshotCombatants]);

  /** 批 2b-3：zone 到期移除（墙按引用计数清 obstacles；并入 undo 单元，一步撤回 zones+obstacles 恢复） */
  const expireZones = useCallback((ids: string[], label: string, phase: "end" | "system", cidOverride?: string) => {
    if (ids.length === 0) return;
    const remaining = zones.filter((z) => !ids.includes(z.id));
    beginUndo(round, cidOverride ?? turnOrder[turnIndex], label);
    const before = wallCellsOwnedBy(zones);
    const after = wallCellsOwnedBy(remaining);
    const nextObs = new Set(obstacles);
    for (const [k] of before) {
      if ((after.get(k) ?? 0) === 0) nextObs.delete(k); // 引用计数归零 → 从 obstacles 清除
    }
    setZones(remaining);
    setObstacles(nextObs);
    for (const z of zones) {
      if (ids.includes(z.id)) {
        pushTurnLog(`区域效果【${z.source.name}】到期，已移除。`, "normal", phase, cidOverride ?? turnOrder[turnIndex]);
      }
    }
    commitUndo(label, remaining, nextObs);
  }, [zones, obstacles, beginUndo, commitUndo, pushTurnLog, round, turnIndex, turnOrder]);

  const nextTurn = useCallback(() => {
    if (turnOrder.length === 0) return;
    // 阶段 0 重构：下一个行动者下标/轮数由纯函数算出（跳死/跨轮逻辑抽到 battle/turn.advanceActor）
    const { nextIndex: next, cid, wrapped, newRound } = advanceActor(combatants, turnOrder, turnIndex, round);
    // 突袭轮结束：突袭者已全部行动，轮到非突袭者时清除突袭标记并进入正常回合
    if (surpriseView?.active && !surpriseView.attackers.includes(cid)) {
      setCombatants((prev) => prev.map((c) =>
        c.conditions.includes("surprised") ? { ...c, conditions: c.conditions.filter((k) => k !== "surprised") } : c,
      ));
      setSurpriseView(null);
      pushLog("突袭轮结束：被突袭者恢复正常。", "normal");
    }
    // 批 3-3a：新行动者回合开始重置动作预算（突袭轮内突袭者仅 1 个标准动作）；
    // 批 3-3b：同时清除该行动者「直到下回合开始」的效果（奔跑/全防御/回气/冲锋）
    const surpriseBudget = surpriseView?.active && surpriseView.attackers.includes(cid);
    setCombatants((prev) =>
      prev.map((c) =>
        c.cid === cid
          ? { ...clearTurnStartEffects(c), actionBudget: surpriseBudget ? { standard: true, move: false, minor: false } : freshActionBudget(), apUsedThisRound: false }
          : c,
      ),
    );
    setTurnIndex(next);
    // 回合切到该角色时，右栏跟随展示其数据/状态
    setSelectedId(cid);
    if (wrapped) setRound(newRound);
    // 批 2b-3：untilOwnerTurnStart 的区域效果在轮到持有者（新回合开始）前到期
    expireZones(
      zones.filter((z) => z.duration === "untilOwnerTurnStart" && z.ownerCid === cid).map((z) => z.id),
      "区域效果到期",
      "system",
      cid,
    );
    setPhase("start");
    const c = combatants.find((x) => x.cid === cid);
    if (c) {
      setLog((prev) => [...prev.slice(-199), makeLog(`→ 轮到 ${c.name} 行动`, "normal", { round: newRound, turnCid: cid, phase: "system", hp: `${c.hp}/${c.maxHp}` })]);
    }
  }, [combatants, pushLog, round, surpriseView, turnIndex, turnOrder, zones, expireZones]);

  // ---------- 死亡豁免（批 3-3c） ----------

  /** 对指定濒死棋子执行一次死亡豁免（不管理 undo，调用方负责）：天然20 花回复力求生 / 3 次失败死亡 */
  const doDeathSave = useCallback(
    (c: Combatant) => {
      if (c.kind !== "pc" || isDead(c) || c.hp > 0) return false;
      const ds = rollDeathSave(c, () => 1 + Math.floor(Math.random() * 20));
      if (ds.outcome === "revive") {
        snapBefore(c.cid);
        patchCombatant(c.cid, (x) => {
          const n = { ...x };
          if (ds.surgeUsed) {
            n.surgesLeft = (n.surgesLeft ?? 0) - 1;
            heal(n, x.surgeValue);
          } else {
            n.deathSaveFails = 0;
          }
          return n;
        });
        pushTurnLog(`${c.name} 死亡豁免：天然 20！${ds.surgeUsed ? `花费 1 次回复力，恢复 ${c.surgeValue} 点生命脱离濒死。` : "无回复力，稳定在 0（不再作死亡豁免）。"}`, "normal", "start", c.cid);
      } else if (ds.dead) {
        snapBefore(c.cid);
        patchCombatant(c.cid, (x) => ({ ...x, deathSaveFails: 0, hp: -x.bloodied - 1 }));
        pushTurnLog(`☠ ${c.name} 死亡豁免第三次失败，死亡。`, "crit", "start", c.cid);
        battleBus.emit({ type: "hpZero", cid: c.cid, hp: -c.bloodied - 1 });
      } else {
        const label = ds.outcome === "fail2" ? "天然 1！记 2 次失败" : ds.outcome === "fail" ? `d20 ${ds.d20}（≤9）记 1 次失败` : `d20 ${ds.d20}（10–19）无变化`;
        if (ds.outcome !== "none") {
          snapBefore(c.cid);
          patchCombatant(c.cid, (x) => ({ ...x, deathSaveFails: ds.fails }));
        }
        pushTurnLog(`${c.name} 死亡豁免：${label}（失败 ${ds.fails}/3）${ds.fails >= 2 ? "，濒临死亡！" : ""}`, ds.outcome === "none" ? "normal" : "warn", "start", c.cid);
      }
      return true;
    },
    [patchCombatant, pushTurnLog, snapBefore],
  );

  /** 手动死亡豁免（顶栏按钮，自动开关关闭时由 DM 点掷） */
  const onDeathSave = useCallback(() => {
    const cur = combatants.find((x) => x.cid === turnOrder[turnIndex]);
    if (!cur) return;
    if (cur.kind !== "pc" || cur.hp > 0 || isDead(cur)) {
      pushLog(`${cur.name} 未濒死，无需死亡豁免。`, "warn");
      return;
    }
    beginUndo(round, cur.cid, `${cur.name} 死亡豁免`);
    doDeathSave(cur);
    commitUndo();
  }, [combatants, turnOrder, turnIndex, round, beginUndo, commitUndo, doDeathSave, pushLog]);

  // ---------- 批 7：阶段检查命中结算（灵气回合触发 + 回合边界类反应威能） ----------
  /** 结算一次阶段检查的命中结果（auraDamage/auraHeal/auraOngoing/auraCondition/immediate）。
   * phase：当前检查的战斗阶段（turnStart/turnEnd）；hit.target 为受影响棋子。
   * 返回是否发生任何结算（供「无效果待结算」日志判断）。不自行 commitUndo。 */
  const applyPhaseHits = useCallback(
    (phase: BattlePhase, hits: PhaseTriggerHit[]): boolean => {
      const logPhase = phase === "turnStart" ? ("start" as const) : ("end" as const);
      let any = false;
      for (const hit of hits) {
        const t = hit.target;
        const tname = t.name;
        switch (hit.kind) {
          case "auraDamage": {
            if (!settings.auto.trigger.aura) break;
            any = true;
            snapBefore(t.cid);
            patchCombatant(t.cid, (x) => {
              dealDamage(x, hit.dmg!, hit.type ? { type: hit.type } : undefined);
              return x;
            });
            const after = { ...t };
            const applied = dealDamage(after, hit.dmg!, hit.type ? { type: hit.type } : undefined);
            const dmgLabel = (hit.type ? DAMAGE_TYPE_LABEL[hit.type as DamageType] ?? hit.type : "") || "";
            pushTurnLog(
              `${tname} 在 ${hit.owner.name} 的灵气【${hit.power.name}】内${phase === "turnStart" ? "开始" : "结束"}回合，受到 ${applied}${dmgLabel}伤害${hit.bloodied ? "（持有者重伤）" : ""}，HP ${after.hp}/${after.maxHp}。`,
              "warn",
              logPhase,
              t.cid,
            );
            if (isDead(after)) {
              pushTurnLog(`☠ ${tname} 生命降至 ${after.hp}（重伤线 -${after.bloodied}），死亡。`, "crit", logPhase, t.cid);
              onCombatantDied(after, logPhase);
            }
            break;
          }
          case "auraHeal": {
            any = true;
            snapBefore(t.cid);
            patchCombatant(t.cid, (x) => {
              heal(x, hit.heal!);
              return x;
            });
            const after = { ...t };
            heal(after, hit.heal!);
            pushTurnLog(
              `${tname} 在 ${hit.owner.name} 的灵气【${hit.power.name}】内${phase === "turnStart" ? "开始" : "结束"}回合，恢复 ${hit.heal} 点生命${hit.targetBloodied ? "（目标重伤）" : ""}，HP ${after.hp}/${after.maxHp}。`,
              "normal",
              logPhase,
              t.cid,
            );
            break;
          }
          case "auraOngoing": {
            any = true;
            snapBefore(t.cid);
            patchCombatant(t.cid, (x) => {
              addOngoingDamage(x, { value: hit.value!, saveOn: hit.saveOn ?? "end", ...(hit.type ? { type: hit.type } : {}) });
              return x;
            });
            const typeLabel = hit.type ? (DAMAGE_TYPE_LABEL[hit.type as DamageType] ?? hit.type) : "";
            pushTurnLog(
              `${tname} 在 ${hit.owner.name} 的灵气【${hit.power.name}】内${phase === "turnStart" ? "开始" : "结束"}回合，挂载 ${hit.value} 点${typeLabel}持续伤害（豁免终止）${hit.bloodied ? "（持有者重伤）" : ""}。`,
              "warn",
              logPhase,
              t.cid,
            );
            break;
          }
          case "auraCondition": {
            any = true;
            snapBefore(t.cid);
            // phase：当前边界施加 → 下一次同型边界即下轮（phase=1）；「直到其下回合结束」在回合开始施加时
            // 当前回合结束不算「下回合」，须 phase=2 跳过本次边界；持有者锚定依回合顺序（本轮其后=phase1，已过=下轮 phase2）
            let p: 1 | 2 = 1;
            if (hit.expiryOwner) {
              const oi = turnOrder.indexOf(hit.owner.cid);
              p = oi > turnIndex ? 1 : 2;
            } else if (hit.expires === "end" && phase === "turnStart") {
              p = 2;
            }
            patchCombatant(t.cid, (x) => applyAuraCondition(x, hit.condition!, hit.expires ?? "start", { source: hit.expiryOwner ? hit.owner.cid : undefined, phase: p }));
            const condLabel = CONDITION_LABEL[hit.condition as ConditionKey] ?? hit.condition;
            const suffix = `直到${hit.expiryOwner ? `${hit.owner.name}的` : "其"}下回合${hit.expires === "start" ? "开始" : "结束"}${hit.note ? `（且不能${hit.note}）` : ""}`;
            if (hit.spec?.ownerTrigger) {
              pushTurnLog(`${hit.owner.name} 的灵气【${hit.power.name}】标记 ${tname}：${condLabel}${suffix}。`, "warn", logPhase, t.cid);
            } else {
              pushTurnLog(`${tname} 在 ${hit.owner.name} 的灵气【${hit.power.name}】内${phase === "turnStart" ? "开始" : "结束"}回合，${condLabel}${suffix}。`, "warn", logPhase, t.cid);
            }
            break;
          }
          case "immediate": {
            // 回合边界类反应威能：触发条件满足，提示 DM 裁决（受 trigger.provoke 控制；命中类由借机结算条自动承接）
            if (!settings.auto.trigger.provoke) break;
            pushTurnLog(
              `${tname} 的回合${phase === "turnStart" ? "开始" : "结束"}，${hit.owner.name} 的反应威能【${hit.power.name}】触发条件满足（DM 裁决）。`,
              "warn",
              logPhase,
              t.cid,
            );
            break;
          }
        }
      }
      return any;
    },
    [snapBefore, patchCombatant, pushTurnLog, onCombatantDied, turnIndex, turnOrder, settings],
  );

  // ---------- 回合开始结算（持续伤害 + 再生 + 灵气 + 区域效果 + 死亡豁免，手动） ----------
  const runTurnStart = useCallback(() => {
    const cur = turnOrder[turnIndex];
    const c = combatants.find((x) => x.cid === cur);
    if (!cur || !c) return;
    const name = c.name;
    beginUndo(round, cur, `${name} 回合开始结算`);
    // 批 6d：状态/标记到期清理（at=start）：轮到目标自身回合开始 → 清除「直到其下回合开始」；
    // 轮到持有者回合开始 → 清除锚定持有者「直到该X下回合开始」的状态（phase=2 跳过本次边界）。
    // 由 turn.stateExpire 独立门控，避免关闭灵气结算时「被标记」等状态滞留（不再依赖 trigger.aura）。
    // 阶段 0 重构：待清理棋子由纯函数算出（battle/turn.expiredConditionTargets）
    if (settings.auto.turn.stateExpire) {
      const cleared = expiredConditionTargets(combatants, cur, "start");
      if (cleared.length > 0) {
        for (const nc of cleared) {
          snapBefore(nc.cid);
          patchCombatant(nc.cid, () => nc);
        }
        pushTurnLog(`${name} 的回合开始：${cleared.length} 个灵气状态到期移除。`, "normal", "start", cur);
      }
    }
    // 阶段 0 重构：再生 + 持续伤害一次算全（battle/turn.settleTurnStart），复用其 final 状态做死亡/死亡豁免判定，消除重复 applyOngoingAtTurnStart 调用
    const settle = settleTurnStart(c);
    if (settle.regenHealed !== 0) {
      snapBefore(cur);
      patchCombatant(cur, (x) => applyRegenAtTurnStart(x).next);
      pushTurnLog(`${name} 再生 ${settle.regenHealed > 0 ? "+" + settle.regenHealed : settle.regenHealed} 生命。`, settle.regenHealed > 0 ? "normal" : "warn", "start", cur);
    }
    // 持续伤害：不同类型各自生效各自结算；同类型取最高已在 addOngoingDamage 保证
    if (settle.ongoingTotal > 0) {
      snapBefore(cur);
      patchCombatant(cur, (x) => applyOngoingAtTurnStart(x).next);
      pushTurnLog(`${name} 受到${settle.ongoingParts.join("、")}。`, "warn", "start", cur);
      // 批 4-4a-2：持续伤害致死——怪物/召唤兽直接死亡离场（PC 走死亡豁免）；ongoingOnly=仅持续伤害 on 原态，语义与改前一致
      if (isDead(settle.ongoingOnly)) {
        pushTurnLog(`☠ ${name} 生命降至 ${settle.ongoingOnly.hp}（重伤线 -${settle.ongoingOnly.bloodied}），死亡。`, "crit", "start", cur);
        onCombatantDied(settle.ongoingOnly, "start");
      }
    }
    // 死亡豁免（批 3-3c）：再生+持续伤害结算后仍濒死的 PC 在回合开始掷死亡豁免（自动开关；关闭则手动按钮）
    if (settings.auto.turn.deathSave && c.kind === "pc" && !isDead(c) && settle.curState.hp <= 0) doDeathSave(settle.curState);
    // 灵气自动结算（批 2b-2）：持有者灵气对覆盖范围内目标应用效果（auto.trigger.aura；增量应用避免覆盖前序）
    let tickAny = false;
    if (settings.auto.trigger.aura) {
      const at = auraTurnStartTick(c, combatants, mapCols, mapRows);
      if (at && at.inside.length > 0) {
        tickAny = true;
        if (at.eff) {
          for (const t of at.inside) {
            snapBefore(t.cid);
            patchCombatant(t.cid, (curc) => applyEffectToCombatant(curc, { ...at.eff!, cid: t.cid }));
            pushTurnLog(`${name} 的灵气【${at.aura.name}】影响 ${t.name}：${effectApplyParts({ ...at.eff, cid: t.cid }).join("、")}。`, "warn", "start", cur);
          }
        } else {
          for (const t of at.inside) pushTurnLog(`${name} 的灵气【${at.aura.name}】影响 ${t.name}（含 DM 裁决项，请手动结算）。`, "warn", "start", cur);
        }
      }
    }
    // 阶段检查（批 7）：目标回合开始，收集影响它的全部灵气触发（伤害/治疗/持续/状态）+ 回合边界类反应威能
    // 由灵气持有者视角改为目标视角统一检查：任何在该灵气内开始回合的敌人由目标自己的回合开始触发，不再挂持有者回合
    if (settings.auto.trigger.aura) {
      if (applyPhaseHits("turnStart", phaseTriggerCheck("turnStart", c, combatants, mapCols, mapRows))) tickAny = true;
      // 持有者侧检查（批 7/17b-6）：c 的灵气中 ownerTrigger 的 auraCondition 对灵气内目标触发
      if (applyPhaseHits("turnStart", ownerTriggerCheck(c, combatants, mapCols, mapRows))) tickAny = true;
    }
    // 区域效果轮开始触发（批 2b-5）：trigger=start 的 zone 对覆盖范围内棋子结算（auto.trigger.zone）
    if (settings.auto.trigger.zone) {
      for (const z of zones) {
        if (z.trigger !== "start") continue;
        const cells = zoneCellsOf(z);
        const inside = affectedIn(combatants, cells).filter((x) => x.hp > 0);
        if (inside.length === 0) continue;
        tickAny = true;
        // 顶层收窄提取 target，避免闭包内类型收窄丢失
        const eff = z.effect.kind === "auto" ? z.effect.target : null;
        if (eff) {
          const label = effectApplyParts(eff).join("、") || "效果";
          for (const t of inside) {
            snapBefore(t.cid);
            patchCombatant(t.cid, (curc) => applyEffectToCombatant(curc, { ...eff, cid: t.cid }));
            pushTurnLog(`区域【${z.source.name}】影响 ${t.name}：${label}。`, "warn", "start", cur);
          }
        } else {
          for (const t of inside) pushTurnLog(`区域【${z.source.name}】影响 ${t.name}（含 DM 裁决项，请手动结算）。`, "warn", "start", cur);
        }
      }
    }
    if (settle.regenHealed === 0 && settle.ongoingTotal === 0 && !tickAny) pushTurnLog(`${name} 无再生 / 持续伤害待结算。`, "normal", "start", cur);
    commitUndo();
    setPhase("start");
  }, [combatants, patchCombatant, pushTurnLog, round, beginUndo, snapBefore, commitUndo, turnIndex, turnOrder, settings, mapCols, mapRows, zones, doDeathSave, onCombatantDied]);

  // ---------- 回合结束结算（豁免终止，手动掷豁免） ----------
  const runTurnEnd = useCallback(() => {
    const cur = turnOrder[turnIndex];
    const c = combatants.find((x) => x.cid === cur);
    if (!cur || !c) return;
    const name = c.name;
    beginUndo(round, cur, `${name} 回合结束豁免`);
    // 批 6d：状态/标记到期清理（at=end）：轮到目标/持有者回合结束 → 清除「直到其下回合结束」的状态（独立于灵气开关）
    // 阶段 0 重构：待清理棋子由纯函数算出（battle/turn.expiredConditionTargets）
    if (settings.auto.turn.stateExpire) {
      const cleared = expiredConditionTargets(combatants, cur, "end");
      if (cleared.length > 0) {
        for (const nc of cleared) {
          snapBefore(nc.cid);
          patchCombatant(nc.cid, () => nc);
        }
        pushTurnLog(`${name} 的回合结束：${cleared.length} 个灵气状态到期移除。`, "normal", "end", cur);
      }
    }
    // 阶段检查（批 7）：目标回合结束，收集影响它的全部灵气触发（伤害/治疗/持续/状态）+ 回合边界类反应威能
    let auraTickApplied = false;
    if (applyPhaseHits("turnEnd", phaseTriggerCheck("turnEnd", c, combatants, mapCols, mapRows))) auraTickApplied = true;
    // 阶段 0 重构：豁免判断+掷骰由纯函数封装（battle/turn.rollEndSaves），hasOngoing 短路无持续伤害
    const sr = rollEndSaves(c, () => 1 + Math.floor(Math.random() * 20));
    if (!sr.hasOngoing) {
      if (!auraTickApplied) pushTurnLog(`${name} 无可豁免的持续效果。`, "normal", "end", cur);
      commitUndo();
      setPhase("end");
      return;
    }
    for (const roll of sr.rolls) {
      pushTurnLog(`${name} 危急豁免：d20 = ${roll.d20} ${roll.ok ? "≥10 成功" : "<10 失败"}（${roll.label}）`, roll.ok ? "normal" : "warn", "end", cur);
    }
    if (sr.success > 0) {
      pushTurnLog(`${name} ${sr.success} 项持续伤害豁免成功，已移除。`, "normal", "end", cur);
      snapBefore(cur);
      patchCombatant(cur, (x) => ({ ...x, ongoingDamage: sr.next.ongoingDamage }));
    }
    commitUndo();
    setPhase("end");
  }, [combatants, patchCombatant, pushTurnLog, round, beginUndo, snapBefore, commitUndo, turnIndex, turnOrder, settings, mapCols, mapRows, applyPhaseHits]);

  /** 结束当前行动者的回合：先做回合结束豁免结算，再推进到下一位。 */
  const endTurn = useCallback(() => {
    logEvt("op", `用户点击【下一回合】，结束 ${combatants.find((x) => x.cid === turnOrder[turnIndex])?.name ?? turnOrder[turnIndex]} 的回合`);
    runTurnEnd(); // 回合结束结算（当前行动者豁免终止）
    battleBus.emit({ type: "turnEnd", cid: turnOrder[turnIndex], round });
    // 批 2b-3：untilOwnerTurnEnd 的区域效果在当前回合结束时到期
    expireZones(
      zones.filter((z) => z.duration === "untilOwnerTurnEnd" && z.ownerCid === turnOrder[turnIndex]).map((z) => z.id),
      "区域效果到期",
      "end",
    );
    nextTurn();
  }, [runTurnEnd, expireZones, nextTurn, turnOrder, turnIndex, round, zones, combatants]);

  /** P1 修正：每个行动者进入「回合开始」阶段时，自动完成回合开始结算（再生/持续伤害/死亡豁免）；
   *  投掷先攻进入第一位、或结束回合进入下一位（nextTurn 均置 phase="start"）都会走到这里。
   *  此前 runTurnStart 无任何调用点，导致第一位行动者只有「回合中」而没有「回合开始」。 */
  useEffect(() => {
    if (phase !== "start") return;
    const cid = turnOrder[turnIndex];
    if (!cid) return;
    const key = `${round}:${cid}`;
    if (settledStartRef.current.has(key)) return;
    settledStartRef.current.add(key);
    runTurnStart(); // 结算回合开始（内部 commitUndo 为一个 undo 单元）；结算完成即进入行动阶段
    logEvt("op", `第 ${round} 轮轮到 ${combatants.find((x) => x.cid === cid)?.name ?? cid} 行动，进入其回合`);
    snapshotCombatants(`${combatants.find((x) => x.cid === cid)?.name ?? cid} 回合开始时画面`);
    setPhase("action");
  }, [phase, turnOrder, turnIndex, round, runTurnStart, snapshotCombatants]);

  const startSurprise = useCallback((attackers: string[]) => {
    const atks = new Set(attackers);
    const rest = combatants.filter((c) => !atks.has(c.cid));
    const order = [...attackers, ...rest.map((c) => c.cid)];
    setTurnOrder(order);
    setTurnIndex(0);
    setRound(1);
    setPhase("start");
    // 被突袭者在突袭轮提供战斗优势；批 3-3a：突袭者仅 1 个标准动作、被突袭者不能行动（预算强制）
    setCombatants((prev) =>
      prev.map((c) =>
        atks.has(c.cid)
          ? { ...c, actionBudget: { standard: true, move: false, minor: false } }
          : { ...c, conditions: [...new Set([...c.conditions, "surprised"] as ConditionKey[])], actionBudget: { standard: false, move: false, minor: false } },
      ),
    );
    setSurpriseView({ attackers: [...attackers], active: true });
    pushLog(`突袭轮开始：${attackers.map((id) => combatants.find((x) => x.cid === id)?.name ?? id).join("、")} 先动，每个突袭者仅做一个动作。`, "normal");
    setSurpriseDlgOpen(false);
  }, [combatants, pushLog]);

  const surprise = useCallback(() => {
    setSurpriseDlgOpen(true);
  }, []);

  // ---------- 攻击结算 ----------
  // 效果型威能：移动结束后的效果结算——手动/语义化自动施加「状态 / 持续伤害 / 再生 / 临时生命 / 治疗」（一个撤回单元）
  // pe 由调用方传入：弹窗兜底（pendingEffect）或 语义化自动应用（finishEffectMove / afterResolveApplyEffects）共用
  const applyEffect = useCallback(
    (pe: { attackerId: string; attack: AttackOption; defaultTargets: string[] } | null, targets: EffectApplyTarget[]) => {
      if (!pe) return;
      const actCid = turnOrder[turnIndex];
      const named = targets
        .map((t) => ({ t, c: combatants.find((x) => x.cid === t.cid) }))
        .filter((x): x is { t: EffectApplyTarget; c: Combatant } => !!x.c);
      if (named.length === 0) {
        setPendingEffect(null);
        return;
      }
      beginUndo(round, actCid, `【${pe.attack.name}】结算效果`);
      for (const { t, c } of named) {
        snapBefore(t.cid);
        patchCombatant(t.cid, (x) => applyEffectToCombatant(x, t));
        const parts = effectApplyParts(t);
        if (parts.length) pushTurnLog(`${c.name} 受【${pe.attack.name}】影响：${parts.join("；")}。`, "normal", "action");
      }
      commitUndo();
      setPendingEffect(null);
    },
    [combatants, round, turnIndex, turnOrder, beginUndo, snapBefore, patchCombatant, pushTurnLog, commitUndo],
  );

  // 强制移动方向模式（批 1-8）：点 8 方向箭头移动 1 格（逐格步进，箭头实时校验）
  const handleForcedMoveDir = useCallback(
    (cid: string, dx: number, dy: number) => {
      if (!effectMove) return;
      const mover = combatants.find((c) => c.cid === cid);
      if (!mover?.pos) return;
      const from = mover.pos;
      const spec = effectMove.attack.effectSpecs?.find((s) => s.kind === "push" || s.kind === "pull" || s.kind === "slide");
      const maxDist = spec?.value && spec.value > 0 ? spec.value : 1;
      // 阶段 0 重构：单步可达判定 + 目标格由纯函数算出（battle/turn.forcedStep）
      const { reach, to } = forcedStep(mover, { dx, dy }, maxDist, mapCols, mapRows, obstacles, combatants);
      if (reach < 1) {
        pushLog("该方向无法移动（界外 / 障碍 / 被其它棋子占据）。", "warn");
        return;
      }
      beginUndo(round, cid, `${mover.name} 被【${effectMove.attack.name}】强制移动`);
      snapBefore(cid);
      // 记录该目标本轮原位置（首次移动时才记，供取消还原）
      setEffectMove((m) =>
        m && !m.origPts[cid] ? { ...m, origPts: { ...m.origPts, [cid]: from } } : m,
      );
      patchCombatant(cid, (c) => ({ ...c, pos: to }));
      // 批 2b-2/2b-5：强制移动同样进入 zone / 灵气（推入毒云应触发）
      applyEnterSideEffects(mover, mover.pos, to, { ...mover, pos: to });
      const attacker = combatants.find((c) => c.cid === effectMove.attackerId);
      const verb = forcedVerb(mover.pos, to, attacker?.pos ?? null);
      pushTurnLog(
        `${mover.name} 被【${effectMove.attack.name}】${verb}1 格，至 (${to.x + 1},${to.y + 1})（强制移动不引发借机攻击）。`,
        "normal",
        "action",
        cid,
        { act: "move" },
      );
      commitUndo();
      setEffectMove((m) => (m ? { ...m, moved: m.moved.includes(cid) ? m.moved : [...m.moved, cid], mover: cid } : m));
    },
    [effectMove, combatants, obstacles, mapCols, mapRows, beginUndo, snapBefore, patchCombatant, pushTurnLog, pushLog, commitUndo, round, applyEnterSideEffects],
  );

  // 取消强制移动：把已移动的目标全部还原到本轮开始前的原位置，再退出模式
  const cancelForcedMove = useCallback(() => {
    if (!effectMove) return;
    for (const [cid, p] of Object.entries(effectMove.origPts)) {
      const c = combatants.find((x) => x.cid === cid);
      if (!c || !c.pos || (c.pos.x === p.x && c.pos.y === p.y)) continue;
      beginUndo(round, cid, `${c.name} 强制移动撤销`);
      snapBefore(cid);
      patchCombatant(cid, (x) => ({ ...x, pos: p }));
      pushTurnLog(`${c.name} 强制移动已取消，回到原位 (${p.x + 1},${p.y + 1})。`, "normal", "action", cid, { act: "move" });
      commitUndo();
    }
    setEffectMove(null);
  }, [effectMove, combatants, round, beginUndo, snapBefore, patchCombatant, pushTurnLog, commitUndo]);

  // 效果型威能「完成移动并结算效果」：推拉滑已在地图完成；
  // 效果型威能移动完成后：存在可挂载效果（非仅推拉滑/纯伤害）→ 一律弹精简确认窗
  const finishEffectMove = useCallback(() => {
    if (!effectMove) return;
    // 批 3-3a：效果型威能（强制移动+效果）结算时消耗动作槽（仅当前行动者）
    const attacker = combatants.find((c) => c.cid === effectMove.attackerId);
    if (attacker && attacker.cid === turnOrder[turnIndex]) {
      const s = actionSlotOf(effectMove.attack.kind);
      if (s) {
        const spent = spendAction(attacker.actionBudget ?? freshActionBudget(), s);
        if (spent) {
          snapBefore(attacker.cid);
          patchCombatant(attacker.cid, (x) => ({ ...x, actionBudget: spent! }));
        }
      }
    }
    const specs = effectMove.attack.effectSpecs ?? [];
    const movedTargets = effectMove.moved
      .map((cid) => combatants.find((c) => c.cid === cid))
      .filter((c): c is Combatant => !!c);
    const pe = { attackerId: effectMove.attackerId, attack: effectMove.attack, defaultTargets: effectMove.moved };
    // 存在可挂载效果 → 弹精简确认窗；仅推拉滑（无可挂载效果）→ 直接结束，不进弹窗
    const mountable = movedTargets.length > 0 && specs.length > 0 && movedTargets.some((c) => specsToApplyTarget(c, specs) !== null);
    if (mountable) setPendingEffect(pe);
    setEffectMove(null);
  }, [effectMove, combatants, turnOrder, turnIndex, snapBefore, patchCombatant]);

  // 攻击结算提交后的效果应用：无推拉滑（或移动已完成）时语义化效果统一走精简确认窗
  const afterResolveApplyEffects = useCallback(
    (attacker: Combatant, attack: AttackOption, targetIds: string[], specOverride?: EffectSpec[]) => {
      const specs = specOverride ?? attack.effectSpecs ?? [];
      const targetCids = targetIds
        .map((cid) => combatants.find((c) => c.cid === cid))
        .filter((c): c is Combatant => !!c);
      const pe = { attackerId: attacker.cid, attack, defaultTargets: targetIds, specsOverride: specOverride };
      // 存在可挂载效果（非仅推拉滑/纯伤害）→ 一律弹精简确认窗，每类效果结算给一次确认
      // 阶段 0 重构：可挂载判定由纯函数算出（battle/resolve.hasMountableEffect）
      const mountable = hasMountableEffect(targetCids, specs, (c) => specsToApplyTarget(c, specs));
      if (mountable) setPendingEffect(pe);
    },
    [combatants],
  );

  /** 批 6f：恐怖守护者类"不死之盾"主人保护——目标若是某守护者的主人，且该守护者
   * 拥有「主人…只受到一半伤害」灵气，且主人当前位于该灵气内 → 本次伤害减半。
   * 返回 null=无保护；否则返回减半后的整数伤害。 */
  const masterHalfDamage = useCallback(
    (target: Combatant, raw: number): number | null => {
      if (!target.masterCid || !target.pos) return null;
      const guard = combatants.find((g) => g.cid === target.masterCid);
      if (!guard || !guard.pos) return null;
      const aura = (guard.attacks ?? []).find(
        (a) => a.kind === "aura" && /主人/.test(a.effectText ?? "") && /一半伤害|只受到一半/.test(a.effectText ?? ""),
      );
      if (!aura) return null;
      // 守卫整个空间的近程爆发灵气覆盖格（批 6f）；主人空间任一格落入即视为「位于灵气内」
      // 复用 triggers.auraCellsOf（内部即 auraRadius + closeBurstCells），避免重复实现
      const auraCells = auraCellsOf(guard, aura, mapCols, mapRows);
      if (auraCells.size === 0) return null;
      let inside = false;
      for (let dx = 0; dx < (target.size ?? 1) && !inside; dx++)
        for (let dy = 0; dy < (target.size ?? 1); dy++)
          if (auraCells.has(`${target.pos.x + dx},${target.pos.y + dy}`)) { inside = true; break; }
      if (!inside) return null;
      return Math.max(1, Math.floor(raw / 2));
    },
    [combatants, mapCols, mapRows],
  );

  /** 批 2-3：威能借机的借机伤害；批 7：被命中反应威能伤害（独立 undo 单元；DM 应用后由 deferred 回调原攻击结算）。
   * label="reaction" 时日志/撤销单元文案按「被命中反应」区分。 */
  const applyOaTo = useCallback(
    (victim: Combatant, results: OAResult[], label: "oa" | "reaction" = "oa") => {
      // 阶段 0 重构：伤害累积 + 死亡判定 + 命中文案由纯函数算出（battle/triggers.applyOaDamage），App 只做副作用（undo/日志/事件/combatants）
      const { next, hits, died } = applyOaDamage(victim, results, label);
      if (hits.length === 0) return;
      beginUndo(round, victim.cid, `${victim.name} 被${label === "reaction" ? "反应" : "借机"}攻击`);
      snapBefore(victim.cid);
      for (const h of hits) {
        battleBus.emit({ type: "takeDamage", cid: victim.cid, amount: h.amount, source: h.provoker.enemyCid });
        if (next.hp <= 0) battleBus.emit({ type: "hpZero", cid: victim.cid, hp: next.hp });
        pushTurnLog(h.rollText, "warn", "interrupt", victim.cid);
      }
      if (died) {
        pushTurnLog(`☠ ${victim.name} 生命降至 ${next.hp}（重伤线 -${victim.bloodied}），死亡。`, "crit", "interrupt", victim.cid);
        onCombatantDied(next, "interrupt"); // 批 4-4a-2：召唤兽死亡/召出者死亡级联移除
      }
      setCombatants((prev) => prev.map((c) => (c.cid === victim.cid ? next : c)));
      commitUndo();
    },
    [round, beginUndo, snapBefore, commitUndo, pushTurnLog, onCombatantDied],
  );

  /** 攻击结算主体（批 2-3：handleResolve 的 defer 目标；威能借机先独立结算后再进入此函数） */
  const resolveAttackBody = useCallback(
    (r: AttackResolution) => {
      if (!pendingAttack) return;
      const attacker = combatants.find((c) => c.cid === pendingAttack.attackerId);
      if (!attacker) {
        setPendingAttack(null);
        return;
      }
      beginUndo(round, attacker.cid, `${attacker.name} 使用【${r.attack.name}】`);
      battleBus.emit({ type: "usePower", cid: attacker.cid, power: r.attack, targetIds: r.targets.map((t) => t.cid) });
      // 批 3-3a：动作型威能结算 → 消耗对应动作槽（仅当前行动者；自由/触发/灵气/特性不消耗）
      const slot = actionSlotOf(r.attack.kind);
      if (slot && attacker.cid === turnOrder[turnIndex]) {
        const spent = spendAction(attacker.actionBudget ?? freshActionBudget(), slot);
        if (spent) {
          snapBefore(attacker.cid);
          patchCombatant(attacker.cid, (x) => ({ ...x, actionBudget: spent! }));
        } else {
          pushTurnLog(`${attacker.name} 已无可用${slot === "standard" ? "标准" : slot === "move" ? "移动" : "次要"}动作（本次动作未扣槽）。`, "warn", "action", attacker.cid);
        }
      }
      const atkName = r.attack.name;
      const atkKind = r.attack.kind;
      // 批 3-3c：威能频率计数——遭遇/每日/充能威能使用后计入（同 undo 单元，可一并撤回）
      const fk2 = freqKindOf(r.attack.freq);
      if (fk2 === "encounter" || fk2 === "daily" || fk2 === "recharge") {
        snapBefore(attacker.cid);
        patchCombatant(attacker.cid, (x) => ({
          ...x,
          powerUses: { ...(x.powerUses ?? {}), [r.attack.key]: ((x.powerUses ?? {})[r.attack.key] ?? 0) + 1 },
        }));
      }

      if (r.isEffect) {
        for (const t of r.targets) {
          const c = combatants.find((x) => x.cid === t.cid);
          if (!c) continue;
          pushTurnLog(`${attacker.name} 对 ${c.name} 使用【${atkName}】：${r.attack.effectText}`, "normal", "action", attacker.cid, { act: atkKind, power: atkName });
        }
        commitUndo();
        setPendingAttack(null);
        // 批 2b-4：区域效果 zone / 墙（效果型威能射程为 区域N… 或 区域N墙M → 进入放置模式）
        const wallMatch = r.attack.range.match(/区域(\d+)墙(\d+)/);
        const zonePr = parseRange(r.attack.range);
        if (zonePr.type === "area" || wallMatch) {
          setZoneBuild({ kind: wallMatch ? "wall" : "zone", attackerId: attacker.cid, attack: r.attack, seq: [] });
          setInvalidZoneCell(null);
          pushLog(
            `【${atkName}】进入放置模式：${wallMatch ? "连续点击地图塑形墙体（≥2 格），点结算条「完成」落地，右键取消" : "点击地图选择区域中心，右键取消"}。`,
            "normal",
          );
          return;
        }
        // 效果型：含推拉滑 → 进入强制移动方向模式（批 1-8）；完全解析 → 自动挂载；否则弹窗兜底
        const affected = r.targets.map((t) => t.cid);
        const fmSpecs = (r.attack.effectSpecs ?? []).filter((s) => s.kind === "push" || s.kind === "pull" || s.kind === "slide");
        if (fmSpecs.length > 0 && affected.length > 0) {
          setEffectMove({ attackerId: attacker.cid, attack: r.attack, moved: [], mover: null, hitOnly: affected, origPts: {} });
        } else if (affected.length > 0) {
          afterResolveApplyEffects(attacker, r.attack, affected);
        }
        return;
      }

      for (const t of r.targets) {
        const c = combatants.find((x) => x.cid === t.cid);
        if (!c) continue;
        // 多重攻击：逐段独立日志（命中段合计伤害由后续统一结算）
        if (t.segments) {
          for (const sg of t.segments) {
            // 阶段 0 重构：命中/重击/失手文案由纯函数算出（battle/resolve.attackRollLogText）
            pushTurnLog(
              attackRollLogText({
                attackerName: attacker.name,
                targetName: t.name,
                power: atkName,
                seg: { n: sg.n, name: sg.label ?? `${sg.n} 段` },
                crit: sg.crit,
                fumble: sg.fumble,
                roll: sg.roll,
                attackBonus: sg.attackBonus,
                modTotal: sg.modTotal ?? 0,
                total: sg.total,
                defenseLabel: sg.defenseLabel,
                defense: sg.defense,
                hit: sg.hit,
              }),
              sg.hit ? "hit" : "miss",
              "action",
              attacker.cid,
              { act: atkKind, power: atkName },
            );
          }
          if (t.hit && t.damageTotal <= 0) {
            pushTurnLog(`${attacker.name} 对 ${t.name}【${atkName}】多段均未造成伤害。`, "normal", "action", attacker.cid, { act: atkKind, power: atkName });
          }
          continue;
        }
        // 阶段 0 重构：命中/重击/失手文案由纯函数算出（battle/resolve.attackRollLogText）
        if (t.crit || t.fumble) {
          const lvl = t.crit ? "crit" : "miss";
          pushTurnLog(
            attackRollLogText({
              attackerName: attacker.name,
              targetName: t.name,
              power: atkName,
              crit: t.crit,
              fumble: t.fumble,
              roll: t.roll,
              attackBonus: t.attackBonus,
              modTotal: t.modTotal ?? 0,
              total: t.total,
              defenseLabel: t.defenseLabel,
              defense: t.defense,
              hit: t.hit,
            }),
            lvl,
            "action",
            attacker.cid,
            { act: atkKind, power: atkName },
          );
        } else {
          pushTurnLog(
            attackRollLogText({
              attackerName: attacker.name,
              targetName: t.name,
              power: atkName,
              crit: false,
              fumble: false,
              roll: t.roll,
              attackBonus: t.attackBonus,
              modTotal: t.modTotal ?? 0,
              total: t.total,
              defenseLabel: t.defenseLabel,
              defense: t.defense,
              hit: t.hit,
            }),
            t.hit ? "hit" : "miss",
            "action",
            attacker.cid,
            { act: atkKind, power: atkName },
          );
        }
      }
      if (r.rangeText) pushLog(r.rangeText, "normal");

      // 先克隆结算伤害（纯函数，不突变 state），再一次性提交 + 逐目标日志
      // 批 4-4a-3：物体目标 → 直接扣物体 HP（免疫意志攻击/暗蚀毒素心灵伤害；HP≤0 破坏移除，不参与战斗条/死亡联动）
      for (const t of r.targets) {
        if (!t.hit || t.damageTotal <= 0 || !isObjectCid(t.cid)) continue;
        const o = objects[t.cid];
        if (!o) continue;
        if (attackImmuneToObject(r.attack)) {
          // 阶段 0 重构：免疫文案由纯函数算出（battle/resolve.objectImmuneLogText）
          pushTurnLog(objectImmuneLogText(t.name, r.attack.defense, r.attack.damageType), "normal", "action", attacker.cid, { act: atkKind, power: atkName });
          continue;
        }
        // 阶段 0 重构：物体伤害文案+HP 由纯函数算出（battle/resolve.objectHitLogText）
        const ob = objectHitLogText(t.name, t.damageTotal, o.hp, o.maxHp);
        pushTurnLog(ob.text, ob.level, "action", attacker.cid, { act: atkKind, power: atkName });
        setObjects((prev) => {
          const next = { ...prev };
          if (ob.hp <= 0) delete next[o.id];
          else next[o.id] = { ...o, hp: ob.hp };
          return next;
        });
      }
      // 阶段 0 重构：多重命中伤害合计+吸收由纯编排器算出（battle/resolve.resolveCombatantHitDamages），App 只做 undo/事件/日志/级联/写回
      const hurt = resolveCombatantHitDamages(
        r.targets.filter((t) => !isObjectCid(t.cid)),
        (cid) => combatants.find((x) => x.cid === cid),
        masterHalfDamage,
      );
      for (const h of hurt) {
        snapBefore(h.t.cid);
        battleBus.emit({ type: "takeDamage", cid: h.t.cid, amount: h.dealt, source: attacker.cid });
        if (h.c.hp <= 0) battleBus.emit({ type: "hpZero", cid: h.t.cid, hp: h.c.hp }); // hpZero 在 hp≤0（含濒死 PC）
        if (h.died) {
          pushTurnLog(`☠ ${h.t.name} 生命降至 ${h.c.hp}（重伤线 -${h.c.bloodied}），死亡。`, "crit", "action", attacker.cid);
          onCombatantDied(h.c, "action"); // 批 4-4a-2：召唤兽死亡/召出者死亡级联移除
        }
      }
      if (hurt.length > 0) {
        const nextById = new Map(hurt.map((h) => [h.c.cid, h.c]));
        setCombatants((prev) => prev.map((c) => nextById.get(c.cid) ?? c));
      }
      for (const h of hurt) {
        // 阶段 0 重构：命中伤害文案（含吸收/掷骰注记、伤势推导）由纯函数算出（battle/resolve.hitDamageLogText）
        pushTurnLog(
          hitDamageLogText(h.t.name, h.t.damageTotal, h.absorbed, h.c.hp, h.c.maxHp, h.c.bloodied, r.damageParts),
          "warn",
          "action",
          attacker.cid,
          { act: atkKind, power: atkName },
        );
      }
      // 批 7：被命中反应检测——伤害结算后，对每个命中且存活的 victim 检测其 immediate「被命中」威能；
      // 有则挂 reaction 结算条（复用借机结算条机制），DM 应用/跳过后再继续尾部（commitUndo / 效果挂载）
      const tail = () => {
        commitUndo();
        setPendingAttack(null);
        // 攻击命中 + 含推拉滑 → 进入强制移动方向模式（仅命中目标，批 1-8）；无推拉滑 → 直接语义化挂载效果
        // 批 4-4a-3：物体不参与强制移动/状态挂载（墙/陷阱不可被推拉、不受状态影响）
        const hitCids = r.targets.filter((t) => t.hit && !isObjectCid(t.cid)).map((t) => t.cid);
        const missCids = r.targets.filter((t) => !t.hit && !isObjectCid(t.cid)).map((t) => t.cid);
        // 4e 分段语义：命中/失手段按命中与否生效，效果段恒生效（when 缺省 = 命中&未命中都挂载）
        // 阶段 0 重构：效果段拆分由纯函数算出（battle/resolve.splitAttackSpecs）
        const { hitSpecs, missSpecs, fmSpecs } = splitAttackSpecs(r.attack.effectSpecs ?? []);
        if (fmSpecs.length > 0 && hitCids.length > 0) {
          setEffectMove({ attackerId: attacker.cid, attack: r.attack, moved: [], mover: null, hitOnly: hitCids, origPts: {} });
        } else if (hitCids.length > 0 && hitSpecs.length > 0) {
          afterResolveApplyEffects(attacker, r.attack, hitCids, hitSpecs);
        }
        // 未命中但含恒生效/失手段效果 → 仍挂载（如 效果：标记，未命中也生效）
        if (missCids.length > 0 && missSpecs.length > 0) {
          afterResolveApplyEffects(attacker, r.attack, missCids, missSpecs);
        }
      };
      if (settings.auto.trigger.oppDetect) {
        // 阶段 0 重构：被命中反应收集由纯函数算出（battle/resolve.collectHitReactions），仅统计存活命中者
        const reactions = collectHitReactions(hurt, (c) => hitReactionDetect(c, attacker, { combatants, cols: mapCols, rows: mapRows, obstacles }));
        if (reactions.length > 0) {
          oaDeferredRef.current = (results) => {
            if (results && results.some((x) => x.applied)) applyOaTo(attacker, results, "reaction");
            tail();
          };
          setPendingOA({ kind: "reaction", mover: attacker, provokers: reactions });
          return;
        }
      }
      tail();
    },
    [combatants, objects, pendingAttack, pushTurnLog, pushLog, round, beginUndo, snapBefore, commitUndo, afterResolveApplyEffects, turnOrder, turnIndex, onCombatantDied, masterHalfDamage, settings, mapCols, mapRows, obstacles, applyOaTo, hitReactionDetect],
  );

  /** 攻击结算入口（批 2-3）：远程/区域/近程威能在使用瞬间被邻接敌人借机（先独立结算，再继续原攻击） */
  const handleResolve = useCallback(
    (r: AttackResolution) => {
      if (!pendingAttack) return;
      const attacker = combatants.find((c) => c.cid === pendingAttack.attackerId);
      if (!attacker) {
        setPendingAttack(null);
        return;
      }
      if (settings.auto.trigger.oppDetect) {
        const oaPlan = detectPowerOA(attacker, r.attack, { combatants, cols: mapCols, rows: mapRows, obstacles });
        if (oaPlan.length > 0) {
          oaDeferredRef.current = (results) => {
            if (results && results.some((x) => x.applied)) applyOaTo(attacker, results);
            resolveAttackBody(r);
          };
          setPendingOA({ kind: "power", mover: attacker, provokers: oaPlan });
          return;
        }
      }
      resolveAttackBody(r);
    },
    [pendingAttack, combatants, settings, mapCols, mapRows, obstacles, applyOaTo, resolveAttackBody],
  );

  /** 批 2-3：借机结算条回调——应用（结算伤害 + 继续原动作）/ 跳过（DM 裁决，继续原动作）/ 取消（放弃原动作） */
  const onOaApply = useCallback((results: OAResult[]) => {
    const d = oaDeferredRef.current;
    oaDeferredRef.current = null;
    setPendingOA(null);
    d?.(results);
  }, []);
  const onOaSkip = useCallback(() => {
    const d = oaDeferredRef.current;
    oaDeferredRef.current = null;
    setPendingOA(null);
    d?.(null);
  }, []);
  const onOaCancel = useCallback(() => {
    const d = oaDeferredRef.current;
    const kind = pendingOA?.kind;
    oaDeferredRef.current = null;
    setPendingOA(null);
    setMovePreview(null);
    if (kind === "reaction") {
      // 被命中反应：原攻击伤害已结算提交，取消=跳过反应并继续原攻击尾部（commitUndo / 效果挂载）
      d?.(null);
    } else {
      // 移动/威能借机：放弃原动作
      setPendingAttack(null);
    }
  }, [pendingOA]);

  // ---------- 棋子栏回调 ----------
  const onPatch = useCallback(
    (patch: Partial<Combatant>) => {
      if (!selectedId) return;
      patchCombatant(selectedId, (c) => {
        const next = { ...c, ...patch };
        syncBloodied(next);
        return next;
      });
    },
    [patchCombatant, selectedId],
  );
  /** 按 cid 打补丁（棋子栏速览面板写回：切换棋子时也要能把旧棋子的改动落盘，不能走 selectedId） */
  const onPatchCid = useCallback(
    (cid: string, patch: Partial<Combatant>) => {
      patchCombatant(cid, (c) => {
        const next = { ...c, ...patch };
        syncBloodied(next);
        return next;
      });
    },
    [patchCombatant],
  );
  /** 按 cid 扣血（批 1-9：数据栏 HP 微调共用；日志归属当前行动者） */
  const applyDamageTo = useCallback(
    (cid: string, n: number) => {
      const c = combatants.find((x) => x.cid === cid);
      const actCid = turnOrder[turnIndex];
      if (!c) return;
      beginUndo(round, actCid, c.name + " 受到伤害");
      snapBefore(cid);
      const next = { ...c };
      dealDamage(next, n);
      if (next.hp <= 0) battleBus.emit({ type: "hpZero", cid, hp: next.hp });
      battleBus.emit({ type: "takeDamage", cid, amount: n, source: actCid });
      setCombatants((prev) => prev.map((x) => (x.cid === cid ? next : x)));
      pushTurnLog(`${c.name} 受到 ${n} 点伤害`, "warn", "action", actCid);
      if (isDead(next)) {
        pushTurnLog(`☠ ${c.name} 死亡。`, "crit", "action", actCid);
        onCombatantDied(next, "action"); // 批 4-4a-2：召唤兽死亡/召出者死亡级联移除
      }
      commitUndo();
    },
    [combatants, patchCombatant, pushTurnLog, round, beginUndo, snapBefore, commitUndo, turnIndex, turnOrder, onCombatantDied],
  );
  const onApplyDamage = useCallback(
    (n: number) => {
      if (!selectedId) return;
      applyDamageTo(selectedId, n);
    },
    [applyDamageTo, selectedId],
  );
  /** 按 cid 治疗（批 1-9：数据栏 HP 微调共用） */
  const applyHealTo = useCallback(
    (cid: string, n: number) => {
      const c = combatants.find((x) => x.cid === cid);
      const actCid = turnOrder[turnIndex];
      if (!c) return;
      beginUndo(round, actCid, c.name + " 回复生命");
      snapBefore(cid);
      patchCombatant(cid, (x) => {
        const next = { ...x };
        heal(next, n);
        return next;
      });
      pushTurnLog(`${c.name} 回复 ${n} 点生命`, "normal", "action", actCid);
      commitUndo();
    },
    [combatants, patchCombatant, pushTurnLog, round, beginUndo, snapBefore, commitUndo, turnIndex, turnOrder],
  );
  const onApplyHeal = useCallback(
    (n: number) => {
      if (!selectedId) return;
      applyHealTo(selectedId, n);
    },
    [applyHealTo, selectedId],
  );
  const onUseSurge = useCallback(() => {
    if (!selectedId) return;
    const c = combatants.find((x) => x.cid === selectedId);
    const actCid = turnOrder[turnIndex];
    if (!c) return;
    beginUndo(round, actCid, c.name + " 使用回复力");
    snapBefore(selectedId);
    patchCombatant(selectedId, (x) => {
      const next = { ...x };
      useSurge(next);
      return next;
    });
    pushTurnLog(`${c.name} 花费 1 次回复力，回复 ${c.surgeValue} 点生命`, "normal", "action", actCid);
    commitUndo();
  }, [combatants, patchCombatant, pushTurnLog, selectedId, round, beginUndo, snapBefore, commitUndo, turnIndex, turnOrder]);
  const onTokenToggleCondition = useCallback(
    (cid: string, k: ConditionKey) => {
      const c = combatants.find((x) => x.cid === cid);
      const actCid = turnOrder[turnIndex];
      if (!c) return;
      beginUndo(round, actCid, c.name + " 切换状态");
      snapBefore(cid);
      patchCombatant(cid, (c0) => {
        const next = { ...c0 };
        toggleCondition(next, k);
        return next;
      });
      const active = !(c.conditions ?? []).includes(k);
      pushTurnLog(`${c.name} ${active ? "获得" : "移除"}状态「${k}」。`, "normal", "action", actCid);
      commitUndo();
    },
    [combatants, patchCombatant, round, beginUndo, snapBefore, commitUndo, pushTurnLog, turnIndex, turnOrder],
  );
  const onRemove = useCallback(
    (cidArg?: string) => {
      const cid = cidArg ?? selectedId;
      if (!cid) return;
      const c = combatants.find((x) => x.cid === cid);
      if (c) pushLog(`${c.name} 被移出遭遇`, "warn");
      setCombatants((prev) => prev.filter((x) => x.cid !== cid));
      if (cid === selectedId) {
        setSelectedId(null);
        setMovePreview(null);
      }
      setTurnOrder((prev) => prev.filter((x) => x !== cid));
    },
    [combatants, pushLog, selectedId],
  );
  const onSetAttacks = useCallback(
    (attacks: AttackOption[]) => {
      if (!selectedId) return;
      patchCombatant(selectedId, (c) => ({ ...c, attacks }));
    },
    [patchCombatant, selectedId],
  );

  /** 右键菜单：进入「绑定召出者」模式（点召出者棋子绑定 / 点空格取消） */
  const onBindSummoner = useCallback(
    (cid: string) => {
      const c = combatants.find((x) => x.cid === cid);
      if (!c) return;
      setBindTarget(cid);
      setSelectedId(cid);
      pushLog(`请点击要绑定的召出者棋子（${c.name} 的先攻将随召出者；召出者死亡/解除召唤时自动移除）；点空格取消。`, "normal");
    },
    [combatants, pushLog],
  );

  /** 右键菜单：解除绑定（不再随召出者先攻/移除） */
  const onUnbindSummoner = useCallback(
    (cid: string) => {
      const c = combatants.find((x) => x.cid === cid);
      patchCombatant(cid, (x) => ({ ...x, summonerCid: undefined }));
      pushLog(`${c?.name ?? "该召唤兽"} 已解除绑定（不再随召出者先攻/移除）。`, "normal");
    },
    [combatants, patchCombatant, pushLog],
  );

  /** 右键菜单：解除召唤（手动移除召唤兽） */
  const onDismissSummon = useCallback(
    (cid: string) => {
      const c = combatants.find((x) => x.cid === cid);
      if (!c) return;
      pushLog(`${c.name} 被解除召唤，离开战场。`, "warn");
      removeCombatantNow(cid);
    },
    [combatants, pushLog, removeCombatantNow],
  );

  /** 批 6f：进入「设定主人」模式（守护者 → 点主人棋子）；如守护者所述依赖外部主人，需先绑定才能自动结算。 */
  const onSetMaster = useCallback(
    (cid: string) => {
      const g = combatants.find((x) => x.cid === cid);
      if (!g) return;
      setBindMaster(cid);
      setSelectedId(cid);
      pushLog(`请点击要设为主人的棋子（${g.name} 的灵气/特性将围绕该主人结算）；点空格取消。`, "normal");
    },
    [combatants, pushLog],
  );

  /** 批 6f：清除主从绑定（改回由 DM 裁决或由他切换主人） */
  const onClearMaster = useCallback(
    (cid: string) => {
      const g = combatants.find((x) => x.cid === cid);
      patchCombatant(cid, (x) => ({ ...x, masterCid: undefined }));
      pushLog(`${g?.name ?? "该棋子"} 已解除主人绑定。`, "normal");
    },
    [combatants, patchCombatant, pushLog],
  );

  /** 批 6f：守护者的呼唤（瞬移）自动结算——守护者已绑定主人，且该威能为「瞬移/传送…邻接其主人」的移动型
   * 效果威能时，自动把守护者瞬移到其主人空间外围的第一个空邻接格；无主人 / 无可落位则返回 false（回退手动强制移动）。 */
  const autoMasterTeleport = useCallback(
    (guard: Combatant, attack: AttackOption): boolean => {
      if (guard.size !== 1 || !guard.masterCid || !guard.pos) return false;
      const master = combatants.find((c) => c.cid === guard.masterCid);
      if (!master?.pos) return false;
      const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < mapCols && y < mapRows;
      const free: Point[] = [];
      for (let dx = -1; dx <= master.size; dx++) {
        for (let dy = -1; dy <= master.size; dy++) {
          const insideMaster = dx >= 0 && dx < master.size && dy >= 0 && dy < master.size;
          if (insideMaster) continue;
          const x = master.pos.x + dx;
          const y = master.pos.y + dy;
          if (!inBounds(x, y)) continue;
          if (obstacles.has(`${x},${y}`)) continue;
          if (occupantAt(x, y)) continue;
          free.push({ x, y });
        }
      }
      if (free.length === 0) return false;
      // 选距守护者当前位置最近的空邻接格
      free.sort((a, b) => gridDistance(guard.pos!, a) - gridDistance(guard.pos!, b));
      const dest = free[0];
      const from = guard.pos;
      beginUndo(round, guard.cid, `${guard.name} 使用【${attack.name}】`);
      snapBefore(guard.cid);
      const pay = paySlot(guard, "move");
      patchCombatant(guard.cid, (x) => ({ ...x, pos: dest, ...(pay ? { actionBudget: pay } : {}) }));
      applyEnterSideEffects(guard, from, dest, { ...guard, pos: dest });
      pushTurnLog(
        `${guard.name} 使用【${attack.name}】，瞬移至主人 ${master.name} 的邻接格 (${dest.x + 1},${dest.y + 1})。`,
        "normal",
        "action",
        guard.cid,
        { act: "move" },
      );
      commitUndo();
      return true;
    },
    [combatants, occupantAt, obstacles, mapCols, mapRows, round, paySlot, beginUndo, snapBefore, patchCombatant, applyEnterSideEffects, pushTurnLog, commitUndo],
  );

  // ---------- 攻击瞄准 ----------
  const onPickAttack = useCallback(
    (attackerId: string, attack: AttackOption) => {
      const attacker = combatants.find((c) => c.cid === attackerId);
      if (!attacker) return;
      if (!attacker.pos) {
        pushLog(`${attacker.name} 尚未放置，请先在地图上放置。`, "warn");
        return;
      }
      const isEffectLike = attack.attack === null && !attack.attackVar;
      // 批 3-3c：威能频率计数——遭遇/每日/充能威能已用尽则禁止再次使用（随意/灵气不限）
      const fk = freqKindOf(attack.freq);
      const usedN = attacker.powerUses?.[attack.key] ?? 0;
      const limit = fk === "encounter" ? freqLimitOf(attack.freq) : 1;
      if ((fk === "encounter" || fk === "daily" || fk === "recharge") && usedN >= limit) {
        pushLog(`【${attack.name}】已用尽（${fk === "encounter" ? "遭遇" : fk === "daily" ? "每日" : "充能"}威能，本回合已用 ${usedN}/${limit} 次）。短休/长休或充能后恢复。`, "warn");
        return;
      }
      // 批 3-3a：动作预算预检——动作型威能（标准/移动/次要）在当前行动者且开关开启时校验；灵气高亮是查看不消耗
      const slot = actionSlotOf(attack.kind);
      if (
        slot &&
        !(isEffectLike && auraRadius(attack.range) !== null) &&
        attacker.cid === turnOrder[turnIndex] &&
        settings.auto.turn.actionBudget &&
        !canSpendAction(attacker.actionBudget ?? freshActionBudget(), slot)
      ) {
        pushLog(`${attacker.name} 已无可用${slot === "standard" ? "标准" : slot === "move" ? "移动" : "次要"}动作（动作预算用尽）。`, "warn");
        return;
      }
      // 效果型（特性/灵气等无攻击动作，attack=null 且非召唤兽加成）：
      // 不进入「地图点目标」瞄准流；灵气带上半径并在地图高亮，其余仅展示描述。
      if (isEffectLike) {
        setAim(null);
        setAimOrigin(null);
        setAimSel([]);
        setAimArea(null);
        setMovePreview(null);
        setPendingPlace(null);
        setSceneToolState(null);
        setSelectedId(attackerId);
        const r = auraRadius(attack.range);
        if (r !== null) {
          // 再次点击同一灵气 → 关闭高亮
          setAuraView((prev) =>
            prev && prev.attackerId === attackerId && prev.attack.key === attack.key
              ? null
              : { attackerId, attack, radius: r },
          );
          pushLog(`【${attack.name}】灵气半径 ${r} 格。${attack.effectText ? " " + attack.effectText : ""}`, "normal");
        } else {
          // 批 2b-4：效果型威能射程为「区域N…」或「区域N墙M」→ 直接进入放置模式（无攻击骰，无需瞄准目标）
          const wallMatch = attack.range.match(/区域(\d+)墙(\d+)/);
          const zonePr = parseRange(attack.range);
          if (wallMatch || zonePr.type === "area") {
            setZoneBuild({ kind: wallMatch ? "wall" : "zone", attackerId, attack, seq: [] });
            setInvalidZoneCell(null);
            pushLog(
              `【${attack.name}】进入放置模式：${wallMatch ? "连续点击地图塑形墙体（≥2 格），点「完成」落地" : "点击地图选择区域中心（距离+效果线校验），点「完成」落地"}。`,
              "normal",
            );
            return;
          }
          setAuraView(null);
          // 批 6f：守护者的呼唤（瞬移）——守卫已绑定主人且该威能为「瞬移/传送…邻接其主人」→ 自动落位
          const isMasterTeleport = attack.kind === "move" && /主人/.test(`${attack.effectText ?? ""}${attack.name ?? ""}`) && /瞬移|传送/.test(attack.effectText ?? "");
          if (isMasterTeleport) {
            if (attacker.masterCid && autoMasterTeleport(attacker, attack)) {
              setPendingEffect(null);
              return;
            }
            if (!attacker.masterCid) {
              pushLog(`【${attack.name}】需先为该守护者指定主人（右键 → 设定主人）才能自动结算；将回退手动移动。`, "warn");
            } else {
              pushLog(`【${attack.name}】主人周围暂无空邻接格，请手动裁决。`, "warn");
            }
          }
          // 普通效果型威能（无灵气半径）→ 进入地图「强制移动模式」，移动结束后再结算效果
          setEffectMove({ attackerId, attack, moved: [], mover: null, origPts: {} });
          setPendingEffect(null);
          pushLog(`【${attack.name}】进入强制移动：点要移动的目标棋子，再点其直线合法落点（可逐个移多个）；完成后点「结算效果」。`, "normal");
        }
        return;
      }
      setAim({ attackerId, attack });
      setPendingEffect(null);
      setEffectMove(null);
      setAimOrigin(null);
      setAimSel([]);
      setAimArea(null);
      setSelectedId(attackerId);
      setMovePreview(null);
      setPendingPlace(null);
      setSceneToolState(null);
      pushLog(`选中威能【${attack.name}】：在地图上点击目标（点击攻击者自身可取消瞄准）。`, "normal");
    },
    [combatants, pushLog, turnOrder, turnIndex, settings, autoMasterTeleport],
  );

  // ---------- 批 3-3b：基础动作（移动动作/标准动作快捷入口，顶栏动作槽旁按钮组触发） ----------

  /** 起身（移动动作）：移除倒地 */
  const onActionStand = useCallback(() => {
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (!cur) return;
    if (!cur.conditions.includes("prone")) { pushLog(`${cur.name} 并未倒地，无需起身。`, "warn"); return; }
    if (settings.auto.turn.actionBudget && !canSpendAction(cur.actionBudget ?? freshActionBudget(), "move")) {
      pushLog(`${cur.name} 已无可用移动动作（起身）。`, "warn"); return;
    }
    beginUndo(round, cur.cid, `${cur.name} 起身`);
    snapBefore(cur.cid);
    const pay = paySlot(cur, "move");
    patchCombatant(cur.cid, (x) => ({
      ...x,
      ...(pay ? { actionBudget: pay } : {}),
      conditions: x.conditions.filter((k) => k !== "prone"),
    }));
    pushTurnLog(`${cur.name} 起身站立。`, "normal", "action", cur.cid, { act: "move" });
    commitUndo();
  }, [combatants, turnOrder, turnIndex, settings.auto.turn.actionBudget, paySlot, pushLog, pushTurnLog, round, beginUndo, snapBefore, patchCombatant, commitUndo]);

  /** 卧倒（次要动作）：主动倒地 */
  const onActionProne = useCallback(() => {
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (!cur) return;
    if (cur.conditions.includes("prone")) { pushLog(`${cur.name} 已倒地。`, "warn"); return; }
    if (settings.auto.turn.actionBudget && !canSpendAction(cur.actionBudget ?? freshActionBudget(), "minor")) {
      pushLog(`${cur.name} 已无可用次要动作（卧倒）。`, "warn"); return;
    }
    beginUndo(round, cur.cid, `${cur.name} 卧倒`);
    snapBefore(cur.cid);
    const pay = paySlot(cur, "minor");
    patchCombatant(cur.cid, (x) => ({
      ...x,
      ...(pay ? { actionBudget: pay } : {}),
      conditions: [...x.conditions, "prone"],
    }));
    pushTurnLog(`${cur.name} 卧倒。`, "normal", "action", cur.cid, { act: "minor" });
    commitUndo();
  }, [combatants, turnOrder, turnIndex, settings.auto.turn.actionBudget, paySlot, pushLog, pushTurnLog, round, beginUndo, snapBefore, patchCombatant, commitUndo]);

  /** 全防御（标准动作）：所有防御 +2 直到下回合开始 */
  const onActionDefend = useCallback(() => {
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (!cur) return;
    if (settings.auto.turn.actionBudget && !canSpendAction(cur.actionBudget ?? freshActionBudget(), "standard")) {
      pushLog(`${cur.name} 已无可用标准动作（全防御）。`, "warn"); return;
    }
    beginUndo(round, cur.cid, `${cur.name} 全防御`);
    snapBefore(cur.cid);
    const pay = paySlot(cur, "standard");
    patchCombatant(cur.cid, (x) => addEffect({ ...x, ...(pay ? { actionBudget: pay } : {}) }, {
      kind: "buff",
      label: "全防御",
      source: "全防御",
      duration: "直到下回合开始",
      untilNextTurn: true,
      defMods: { ac: 2, fort: 2, ref: 2, will: 2 },
    }));
    pushTurnLog(`${cur.name} 全防御：AC/强韧/反射/意志 +2 直到下回合开始。`, "normal", "action", cur.cid, { act: "standard" });
    commitUndo();
  }, [combatants, turnOrder, turnIndex, settings.auto.turn.actionBudget, paySlot, pushLog, pushTurnLog, round, beginUndo, snapBefore, patchCombatant, commitUndo]);

  /** 回气（标准动作，每遭遇一次）：花费 1 回复力回血 + 所有防御 +2 直到下回合开始 */
  const onActionWind = useCallback(() => {
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (!cur) return;
    if (cur.secondWindUsed) { pushLog(`${cur.name} 本遭遇已用过回气（短休息或长休息后恢复）。`, "warn"); return; }
    if ((cur.surgesLeft ?? 0) <= 0) { pushLog(`${cur.name} 没有可用的回复力。`, "warn"); return; }
    if (settings.auto.turn.actionBudget && !canSpendAction(cur.actionBudget ?? freshActionBudget(), "standard")) {
      pushLog(`${cur.name} 已无可用标准动作（回气）。`, "warn"); return;
    }
    beginUndo(round, cur.cid, `${cur.name} 回气`);
    snapBefore(cur.cid);
    const pay = paySlot(cur, "standard");
    patchCombatant(cur.cid, (x) => {
      const base = { ...x, ...(pay ? { actionBudget: pay } : {}), secondWindUsed: true };
      useSurge(base);
      return addEffect(base, {
        kind: "buff",
        label: "回气",
        source: "回气",
        duration: "直到下回合开始",
        untilNextTurn: true,
        defMods: { ac: 2, fort: 2, ref: 2, will: 2 },
      });
    });
    pushTurnLog(`${cur.name} 回气：花费 1 次回复力，回复 ${cur.surgeValue} 点生命；AC/强韧/反射/意志 +2 直到下回合开始。`, "normal", "action", cur.cid, { act: "standard" });
    commitUndo();
  }, [combatants, turnOrder, turnIndex, settings.auto.turn.actionBudget, paySlot, pushLog, pushTurnLog, round, beginUndo, snapBefore, patchCombatant, commitUndo]);

  /** 奔跑（移动动作）：挂「奔跑」效果（速度 +2、攻击骰 -5、提供战斗优势，直到下回合开始），随后拖拽移动落子时扣移动动作 */
  const onActionRun = useCallback(() => {
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (!cur) return;
    if (settings.auto.turn.actionBudget && !canSpendAction(cur.actionBudget ?? freshActionBudget(), "move")) {
      pushLog(`${cur.name} 已无可用移动动作（奔跑）。`, "warn"); return;
    }
    beginUndo(round, cur.cid, `${cur.name} 奔跑`);
    snapBefore(cur.cid);
    patchCombatant(cur.cid, (x) => addEffect(x, {
      kind: "buff",
      label: "奔跑",
      source: "奔跑",
      duration: "直到下回合开始",
      untilNextTurn: true,
      runSpeed: true,
      grantCA: true,
    }));
    pushTurnLog(`${cur.name} 开始奔跑：速度 +2、攻击骰 -5、对敌提供战斗优势（直到下回合开始）。长按拖拽移动棋子完成奔跑移动。`, "normal", "action", cur.cid, { act: "move" });
    commitUndo();
    setSelectedId(cur.cid);
  }, [combatants, turnOrder, turnIndex, settings.auto.turn.actionBudget, pushLog, pushTurnLog, round, beginUndo, snapBefore, patchCombatant, commitUndo, setSelectedId]);

  /** 基本攻击（标准动作）：直接进入瞄准（预算由 onPickAttack 检查并扣除） */
  const onActionBasic = useCallback(() => {
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (!cur || !cur.pos) { pushLog("当前行动者未放置。", "warn"); return; }
    onPickAttack(cur.cid, basicAttackOf(cur));
  }, [combatants, turnOrder, turnIndex, onPickAttack, pushLog]);

  /** 冲撞（标准动作）：进入瞄准，选邻接目标后力量 vs 强韧，命中推离 1 格（预算由 onPickAttack 检查） */
  const onActionRush = useCallback(() => {
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (!cur || !cur.pos) { pushLog("当前行动者未放置。", "warn"); return; }
    onPickAttack(cur.cid, rushAttackOf(cur));
  }, [combatants, turnOrder, turnIndex, onPickAttack, pushLog]);

  /** 冲锋（标准动作）：进入瞄准，选目标后由 handleAimPick 自动移动至邻接格（≥2 格、每格更近）+ 基本近战攻击 + 冲锋中 AC -2 */
  const onActionCharge = useCallback(() => {
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (!cur || !cur.pos) { pushLog("当前行动者未放置。", "warn"); return; }
    if (settings.auto.turn.actionBudget && !canSpendAction(cur.actionBudget ?? freshActionBudget(), "standard")) {
      pushLog(`${cur.name} 已无可用标准动作（冲锋）。`, "warn"); return;
    }
    setAim({ attackerId: cur.cid, attack: chargeAttackOf(cur) });
    setAimOrigin(null);
    setAimSel([]);
    setAimArea(null);
    setPendingEffect(null);
    setEffectMove(null);
    setMovePreview(null);
    setSelectedId(cur.cid);
    pushLog(`【冲锋】点击目标生物：将自动移动到目标邻接格并做基本近战攻击（需离目标至少 2 格、每格更近、不超速度 ${cur.speed}；冲锋中 AC -2 直到下回合开始）。`, "normal");
  }, [combatants, turnOrder, turnIndex, settings.auto.turn.actionBudget, pushLog, setSelectedId]);

  /** 行动点（批 3-3c）：每回合一次，花费 1 点获得一个额外标准动作（动作槽刷新为可用） */
  const onSpendActionPoint = useCallback(() => {
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (!cur) return;
    if (cur.apUsedThisRound) { pushLog(`${cur.name} 本回合已使用过行动点（每回合最多一次）。`, "warn"); return; }
    if ((cur.actionPoints ?? 0) <= 0) { pushLog(`${cur.name} 没有可用的行动点。`, "warn"); return; }
    beginUndo(round, cur.cid, `${cur.name} 花费行动点`);
    snapBefore(cur.cid);
    patchCombatant(cur.cid, (x) => ({
      ...x,
      actionPoints: (x.actionPoints ?? 0) - 1,
      apUsedThisRound: true,
      ...(settings.auto.turn.actionBudget ? { actionBudget: { standard: true, move: x.actionBudget?.move ?? true, minor: x.actionBudget?.minor ?? true } } : {}),
    }));
    pushTurnLog(`${cur.name} 花费 1 点行动点，获得一个额外标准动作。`, "normal", "action", cur.cid);
    commitUndo();
  }, [combatants, turnOrder, turnIndex, round, beginUndo, snapBefore, patchCombatant, commitUndo, pushTurnLog, settings.auto.turn.actionBudget, pushLog]);

  /** 基础动作按钮组调度器（右键菜单/顶栏用，批 3-3b）：按动作类型分派到具体处理器 */
  const onAction = useCallback(
    (kind: BattleActionKind) => {
      switch (kind) {
        case "basic":
          return onActionBasic();
        case "run":
          return onActionRun();
        case "stand":
          return onActionStand();
        case "prone":
          return onActionProne();
        case "defend":
          return onActionDefend();
        case "wind":
          return onActionWind();
        case "charge":
          return onActionCharge();
        case "rush":
          return onActionRush();
      }
    },
    [onActionBasic, onActionRun, onActionStand, onActionProne, onActionDefend, onActionWind, onActionCharge, onActionRush],
  );

  // ---------- 批 4b-1：右键菜单「效果」——持续伤害/挂载效果的增删 ----------
  const onRemoveOngoing = useCallback(
    (cid: string, index: number) => {
      const c = combatants.find((x) => x.cid === cid);
      if (!c || !c.ongoingDamage?.[index]) return;
      beginUndo(round, turnOrder[turnIndex], `${c.name} 移除持续伤害`);
      snapBefore(cid);
      const od = c.ongoingDamage[index];
      patchCombatant(cid, (x) => ({ ...x, ongoingDamage: (x.ongoingDamage ?? []).filter((_, i) => i !== index) }));
      pushTurnLog(`${c.name} 移除了持续伤害：${od.type ?? "无类型"} ${od.value}。`, "normal", "action", cid);
      commitUndo();
    },
    [combatants, round, turnOrder, turnIndex, beginUndo, snapBefore, patchCombatant, pushTurnLog, commitUndo],
  );

  const onAddOngoing = useCallback(
    (cid: string, od: OngoingDamage) => {
      const c = combatants.find((x) => x.cid === cid);
      if (!c) return;
      beginUndo(round, turnOrder[turnIndex], `${c.name} 附加持续伤害`);
      snapBefore(cid);
      patchCombatant(cid, (x) => {
        const next = { ...x };
        addOngoingDamage(next, od);
        return next;
      });
      pushTurnLog(
        `${c.name} 附加持续伤害：${od.type ?? "无类型"} ${od.value}（${od.saveOn === "start" ? "回合开始" : "回合结束"}豁免终止）。`,
        "warn",
        "action",
        cid,
      );
      commitUndo();
    },
    [combatants, round, turnOrder, turnIndex, beginUndo, snapBefore, patchCombatant, pushTurnLog, commitUndo],
  );

  const onRemoveEffect = useCallback(
    (cid: string, index: number) => {
      const c = combatants.find((x) => x.cid === cid);
      if (!c || !c.effects?.[index]) return;
      beginUndo(round, turnOrder[turnIndex], `${c.name} 移除效果`);
      snapBefore(cid);
      const eff = c.effects[index];
      patchCombatant(cid, (x) => ({ ...x, effects: (x.effects ?? []).filter((_, i) => i !== index) }));
      pushTurnLog(`${c.name} 移除了效果：${eff.label}${eff.source ? `（${eff.source}）` : ""}。`, "normal", "action", cid);
      commitUndo();
    },
    [combatants, round, turnOrder, turnIndex, beginUndo, snapBefore, patchCombatant, pushTurnLog, commitUndo],
  );

  const cancelAim = useCallback(() => {
    setAim(null);
    setAimOrigin(null);
    setAimSel([]);
    setAimArea(null);
    setMovePreview(null);
    setAuraView(null);
  }, []);

  const clearEncounter = useCallback(() => {
    setCombatants([]);
    setSelectedId(null);
    setMovePreview(null);
    setPendingPlace(null);
    setPendingAttack(null);
    setAim(null);
    setAimOrigin(null);
    setAimSel([]);
    setAimArea(null);
    setAuraView(null);
    setPendingEffect(null);
    setEffectMove(null);
    setTurnOrder([]);
    setTurnIndex(0);
    setRound(1);
    setObstacles(new Set());
    setDifficult(new Set());
    setFog({});
    setWater(new Set());
    setChasm(new Set());
    setTraps(new Set());
    setCellColors({}); // 涂色图层随遭遇清空
    setObjects({}); // 批 4-4a-3：物体目标随遭遇清空
    setZones([]); // 批 2-2b：区域效果/墙随遭遇清空
    setSceneToolState(null);
    bgSeq.current++; // 使进行中的背景图异步加载失效
    setMapBg(null);
    setMapBgKey((prev) => {
      if (prev) cacheDeleteImage(prev); // 清缓存，防 IndexedDB 孤儿键膨胀
      return null;
    });
    setMapBgAlign({ offsetX: 0, offsetY: 0, scale: 1, baseW: 20 * CELL });
    setMapBgDlg(false);
    setLog([]);
    setCurrentEnc(null);
    pushLog("遭遇已清空。", "warn");
  }, [pushLog]);

  // ---------- 场景画笔切换 ----------
  const setSceneTool = useCallback(
    (tool: TerrainTool) => {
      setSceneToolState(tool);
      setMovePreview(null);
      setPendingPlace(null);
      setSelectedId(null);
    },
    [],
  );

  const setMapSize = useCallback((cols: number, rows: number) => {
    setMapCols(cols);
    setMapRows(rows);
  }, []);

  // ---------- 遭遇阶段切换（管理 ⇄ 进行） ----------
  // 管理阶段：封存后进入，中心显示遭遇地图缩略图；点击缩略图 / 创建地图 进入进行阶段
  const createMap = useCallback(() => {
    clearEncounter();
    setStage("run");
    pushLog("已创建新地图，进入进行阶段。", "normal");
  }, [clearEncounter, pushLog]);

  // ---------- 地图背景图导入（导入地图） ----------
  /** 从 IndexedDB 恢复背景图（按缓存键），带竞态守卫：导入/加载/清空都会自增 bgSeq，旧请求结果丢弃 */
  const loadMapBg = useCallback((key: string) => {
    const seq = ++bgSeq.current;
    cacheGetImage(key).then((d) => {
      if (seq === bgSeq.current) setMapBg(d ?? null);
    });
  }, []);

  /** 读取图片文件并导入为地图背景：压缩 → 缓存 IndexedDB → 清空遭遇 → 进入进行阶段并打开对齐面板 */
  const importMapBg = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        pushLog("导入失败：请选择图片文件。", "warn");
        return;
      }
      let dataUrl: string;
      try {
        dataUrl = await readFileAsDataUrl(file);
      } catch {
        pushLog("导入失败：无法读取该图片。", "warn");
        return;
      }
      // 压缩到预算内（JPEG 重编码会把 PNG 透明压成黑底，地图图片通常可接受）；失败回退原图
      try {
        dataUrl = await compressDataUrlToBudget(dataUrl, 2 * 1024 * 1024, { maxDim: 2400 });
      } catch {
        /* 压缩失败：尝试用原图 */
      }
      // 自适应初始缩放：图片宽度对齐当前网格宽度
      let scale = 1;
      try {
        const { naturalWidth } = await imageSizeOf(dataUrl);
        scale = naturalWidth > 0 ? naturalWidth / (mapCols * CELL) : 1;
      } catch {
        /* 读不到尺寸则保持 1 */
      }
      const key = "mapbg-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      try {
        await cachePutImage(key, dataUrl);
      } catch {
        pushLog("图片缓存失败：背景仅在本次会话有效。", "warn");
      }
      bgSeq.current++;
      clearEncounter();
      setMapBg(dataUrl);
      setMapBgKey(key);
      setMapBgAlign({ offsetX: 0, offsetY: 0, scale, baseW: mapCols * CELL }); // baseW = 当前网格宽度：正常导入下 渲染宽度=网格宽
      setStage("run");
      setMapBgDlg(true);
      setMapBgCalib(true); // 导入后直接进入框选校准：框选印刷网格的一个方格即自动贴合
      pushLog("已导入地图背景图：请框选印刷网格的一个方格校准，再用滑块微调。", "normal");
    },
    [clearEncounter, mapCols, pushLog],
  );

  /** 移除地图背景图（删除 IndexedDB 缓存并清空状态） */
  const removeMapBg = useCallback(() => {
    bgSeq.current++;
    setMapBgKey((prev) => {
      if (prev) cacheDeleteImage(prev);
      return null;
    });
    setMapBg(null);
    setMapBgAlign({ offsetX: 0, offsetY: 0, scale: 1, baseW: 20 * CELL });
    setMapBgDlg(false);
    pushLog("已移除地图背景图。", "normal");
  }, [pushLog]);

  // ---------- 遭遇保存 / 读取 ----------
  const clampMap = useCallback((n: number) => {
    if (Number.isNaN(n)) return 20;
    return Math.max(4, Math.min(30, n));
  }, []);

  const buildSnapshot = useCallback((): EncounterSnapshot => ({
    version: 1,
    map: {
      cols: mapCols,
      rows: mapRows,
      // 背景图仅本地缓存：快照只存缓存键与对齐参数；图片字节存 IndexedDB，不随 .enc.json 导出
      ...(mapBgKey ? { bgKey: mapBgKey, bgAlign: mapBgAlign } : {}),
    },
    obstacles: [...obstacles],
    difficult: [...difficult],
    fog,
    water: [...water],
    chasm: [...chasm],
    trap: [...traps],
    cellColors,
    objects,
    parties,
    combatants: combatants.map((c) => ({ ...c, conditions: [...c.conditions] })),
    turnOrder,
    turnIndex,
    round,
  }), [combatants, mapCols, mapRows, obstacles, difficult, fog, water, chasm, traps, cellColors, objects, parties, turnIndex, turnOrder, round, mapBgKey, mapBgAlign]);

  const saveEncounter = useCallback(() => {
    const data = buildSnapshot();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "遭遇-" + new Date().toISOString().slice(0, 10) + ".enc.json";
    a.click();
    URL.revokeObjectURL(url);
    pushLog(`遭遇已保存（${combatants.length} 名参战者）。`, "normal");
  }, [buildSnapshot, combatants.length, pushLog]);

  /** 遭遇数据（.enc.json / 存档库快照）的结构 */
  interface ParsedEncounter {
    version?: number;
    map?: { cols?: number; rows?: number; bgKey?: string; bgAlign?: { offsetX?: number; offsetY?: number; scale?: number; baseW?: number; gridOpacity?: number } };
    obstacles?: unknown;
    combatants?: unknown;
    turnOrder?: unknown;
    turnIndex?: number;
    round?: number;
    difficult?: unknown;
    fog?: unknown;
    water?: unknown;
    chasm?: unknown;
    trap?: unknown;
    cellColors?: unknown;
    objects?: unknown;
    parties?: unknown;
  }

  /** 校验并应用遭遇数据到当前状态；成功返回 true */
  const applyEncounterData = useCallback(
    (data: ParsedEncounter): boolean => {
      if (data.version !== 1 || !Array.isArray(data.combatants)) {
        pushLog("文件格式无效：缺少 version / combatants 字段。", "warn");
        return false;
      }
      const obs = new Set<string>();
      if (Array.isArray(data.obstacles)) {
        for (const k of data.obstacles) {
          if (typeof k === "string" && /^\d+,\d+$/.test(k)) obs.add(k);
        }
      }
      const diff = new Set<string>();
      if (Array.isArray(data.difficult)) {
        for (const k of data.difficult) {
          if (typeof k === "string" && /^\d+,\d+$/.test(k)) diff.add(k);
        }
      }
      const fogNext: Record<string, FogLevel> = {};
      if (data.fog && typeof data.fog === "object") {
        for (const [k, v] of Object.entries(data.fog as Record<string, unknown>)) {
          if (/^\d+,\d+$/.test(k) && (v === "light" || v === "heavy" || v === "dark" || v === "dim")) fogNext[k] = v;
        }
      }
      const parseCells = (raw: unknown): Set<string> => {
        const s = new Set<string>();
        if (Array.isArray(raw)) {
          for (const k of raw) if (typeof k === "string" && /^\d+,\d+$/.test(k)) s.add(k);
        }
        return s;
      };
      const waterNext = parseCells(data.water);
      const chasmNext = parseCells(data.chasm);
      const trapNext = parseCells(data.trap);
      const colorNext: Record<string, string> = {};
      if (data.cellColors && typeof data.cellColors === "object") {
        for (const [k, v] of Object.entries(data.cellColors as Record<string, unknown>)) {
          if (/^\d+,\d+$/.test(k) && typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) colorNext[k] = v;
        }
      }
      const restored: Combatant[] = [];
      for (const c of data.combatants as Combatant[]) {
        if (!c || typeof c.cid !== "string" || typeof c.name !== "string") continue;
        restored.push({
          ...c,
          pos: c.pos && typeof c.pos.x === "number" ? { x: c.pos.x, y: c.pos.y } : null,
          conditions: Array.isArray(c.conditions) ? (c.conditions.filter((k) => typeof k === "string") as Combatant["conditions"]) : [],
          initResult: typeof c.initResult === "number" ? c.initResult : null,
        });
      }
      if (restored.length === 0 && data.combatants.length > 0) {
        pushLog("文件中的参战者数据无效。", "warn");
        return false;
      }
      setCombatants(restored);
      setObstacles(obs);
      setDifficult(diff);
      setFog(fogNext);
      setWater(waterNext);
      setChasm(chasmNext);
      setTraps(trapNext);
      setCellColors(colorNext);
      if (data.objects && typeof data.objects === "object") setObjects(data.objects as Record<string, ObjectTarget>);
      else setObjects({});
      if (Array.isArray(data.parties)) {
        const pNext = (data.parties as Party[]).filter((p) => p && typeof p.id === "string");
        setParties(pNext);
        saveParties(pNext);
      }
      if (data.map && typeof data.map.cols === "number") setMapCols(clampMap(data.map.cols));
      if (data.map && typeof data.map.rows === "number") setMapRows(clampMap(data.map.rows));
      // 地图背景图恢复：有缓存键则异步从 IndexedDB 取；无键（旧档）显式清空，防残留上一场背景
      const bgKey = data.map?.bgKey;
      const bgAlignRaw = data.map?.bgAlign;
      setMapBgKey(bgKey && typeof bgKey === "string" ? bgKey : null);
      setMapBgAlign({
        offsetX: typeof bgAlignRaw?.offsetX === "number" ? bgAlignRaw.offsetX : 0,
        offsetY: typeof bgAlignRaw?.offsetY === "number" ? bgAlignRaw.offsetY : 0,
        scale: typeof bgAlignRaw?.scale === "number" ? bgAlignRaw.scale : 1,
        // 旧档无 baseW：回退为当前网格宽度，保证既往背景仍按原逻辑铺满
        baseW: typeof bgAlignRaw?.baseW === "number" ? bgAlignRaw.baseW : mapCols * CELL,
        gridOpacity: typeof bgAlignRaw?.gridOpacity === "number" ? bgAlignRaw.gridOpacity : 1,
      });
      setMapBgDlg(false);
      if (bgKey && typeof bgKey === "string") loadMapBg(bgKey);
      else {
        bgSeq.current++; // 使进行中的旧背景图请求失效
        setMapBg(null);
      }
      setTurnOrder(Array.isArray(data.turnOrder) ? data.turnOrder.filter((x) => typeof x === "string") : []);
      setTurnIndex(typeof data.turnIndex === "number" ? data.turnIndex : 0);
      setRound(typeof data.round === "number" ? data.round : 1);
      setSelectedId(null);
      setMovePreview(null);
      setPendingPlace(null);
      setPendingAttack(null);
      setSceneToolState(null);
      return true;
    },
    [clampMap, loadMapBg, pushLog],
  );

  const loadEncounter = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result)) as ParsedEncounter;
          const ok = applyEncounterData(data);
          if (ok) {
            const n = Array.isArray(data.combatants) ? data.combatants.length : 0;
            setStage("run");
            pushLog(`遭遇已读取：${n} 名参战者，已进入进行阶段。`, "normal");
          }
        } catch {
          pushLog("读取失败：不是有效的 JSON 文件。", "warn");
        }
      };
      reader.readAsText(file);
    },
    [applyEncounterData, setStage, pushLog],
  );

  /** 从存档库卡片加载遭遇并进入进行阶段 */
  const openEncounter = useCallback(
    (meta: EncounterMeta) => {
      const ok = applyEncounterData(meta.snapshot as unknown as ParsedEncounter);
      if (!ok) return;
      setCurrentEnc({ id: meta.id, name: meta.name });
      setStage("run");
      pushLog(`已载入遭遇「${meta.name}」，进入进行阶段。`, "normal");
    },
    [applyEncounterData, pushLog],
  );

  /** 把当前遭遇存入存档库：自存档库打开则更新原条目（保留 id/name，不重复新增），新建遭遇则新增 */
  const addToLib = useCallback(() => {
    const snap = buildSnapshot();
    if (currentEnc) {
      setEncLib((prev) => {
        const exist = prev.find((e) => e.id === currentEnc.id);
        if (!exist) {
          const entry: EncounterMeta = {
            id: currentEnc.id,
            savedAt: new Date().toISOString(),
            name: currentEnc.name,
            snapshot: snap,
          };
          return [entry, ...prev].slice(0, 50);
        }
        const updated: EncounterMeta = { ...exist, savedAt: new Date().toISOString(), name: currentEnc.name, snapshot: snap };
        return [updated, ...prev.filter((e) => e.id !== exist.id)].slice(0, 50);
      });
      return;
    }
    const entry: EncounterMeta = {
      id: "e" + Date.now().toString(36),
      savedAt: new Date().toISOString(),
      name: "遭遇-" + new Date().toISOString().slice(0, 10),
      snapshot: snap,
    };
    setEncLib((prev) => [entry, ...prev].slice(0, 50));
    // 记录已建条目：之后的保存/封存更新同一条目，避免重复新增
    setCurrentEnc({ id: entry.id, name: entry.name });
  }, [buildSnapshot, currentEnc]);

  /** 保存：把当前遭遇状态存入存档库（可反复保存，更新同一条目） */
  const saveToLib = useCallback(() => {
    addToLib();
    pushLog("当前遭遇已保存到存档库。", "normal");
  }, [addToLib, pushLog]);

  /** 封存：清空瞬时状态、当前遭遇存入存档库、返回管理阶段 */
  const endEncounter = useCallback(() => {
    setMovePreview(null);
    setPendingPlace(null);
    setPendingAttack(null);
    setAim(null);
    setAimOrigin(null);
    setAimSel([]);
    setAimArea(null);
    setSceneToolState(null);
    addToLib();
    setCurrentEnc(null);
    setStage("manage");
    pushLog("遭遇已封存，存入存档库，返回管理阶段。", "normal");
  }, [addToLib, pushLog]);

  // ---------- 视图导航 ----------
  const handleNav = useCallback((v: AppView) => {
    setView(v);
    if (v !== "battle") {
      setMovePreview(null);
      setPendingPlace(null);
      setSceneToolState(null);
      setAim(null);
      setAimOrigin(null);
      setAimSel([]);
      setAimArea(null);
      setPendingAttack(null);
    }
  }, []);

  const pendingPlaceName = pendingPlace ? combatants.find((c) => c.cid === pendingPlace)?.name ?? null : null;
  const pendingCombatant = pendingPlace ? (combatants.find((c) => c.cid === pendingPlace) ?? null) : null;
  const cancelPendingPlace = useCallback(() => setPendingPlace(null), []);

  const goLeftTab = useCallback((t: "setup" | "turn") => {
    if (leftTab === t && leftOpen) {
      // 点击当前已激活的 tab → 关闭左栏（与右栏 toggle 一致）
      setLeftOpen(false);
    } else {
      setLeftTab(t);
      setLeftOpen(true);
    }
  }, [leftTab, leftOpen]);

  // 右栏 toggle：与左栏同构；当前仅 "token" 一个 tab，将来可扩展
  const goSideTab = useCallback((t: "token") => {
    if (sideTab === t && sideOpen) {
      setSideOpen(false);
    } else {
      setSideTab(t);
      setSideOpen(true);
    }
  }, [sideTab, sideOpen]);

  // 底部「全员数据」数据栏开关
  const toggleRoster = useCallback(() => setRosterOpen((v) => !v), []);

  // 修改当前遭遇名称：自存档库打开则沿用其 id；新建遭遇首次改名时生成 id（封存时入库）
  const renameEncounter = useCallback(
    (name: string) => {
      setCurrentEnc((prev) => {
        const next = prev ?? { id: "e" + Date.now().toString(36), name };
        if (next.name === name) return prev;
        return { ...next, name };
      });
      pushLog(`遭遇已更名为「${name}」。`, "normal");
    },
    [pushLog],
  );

  const openRules = useCallback(
    (keyword: string) => {
      setRulesPrefill(keyword);
      setView("rules");
      setMovePreview(null);
      setPendingPlace(null);
      setSceneToolState(null);
      setAim(null);
      setAimOrigin(null);
      setAimSel([]);
      setAimArea(null);
      setPendingAttack(null);
    },
    [],
  );

  // 顶部操作栏（battle 视图·进行阶段）：左侧三栏开关（布置桌面/回合栏/棋子栏）；地图尺寸已迁入场景面板；管理阶段不显示
  const topActions =
    view === "battle" && stage === "run" ? (
      <>
        <div className="es-battle-tools">
          <div className="es-top-tools">
            <button className={"es-top-tool" + (leftOpen && leftTab === "setup" ? " on" : "")} onClick={() => goLeftTab("setup")}>布置桌面</button>
            <button className={"es-top-tool" + (leftOpen && leftTab === "turn" ? " on" : "")} onClick={() => goLeftTab("turn")}>回合栏</button>
          </div>
          <EncounterTitle name={currentEnc?.name ?? "未命名遭遇"} onRename={renameEncounter} />
          <button className={"es-top-tool es-top-tool--right" + (rosterOpen ? " on" : "")} onClick={toggleRoster} title={rosterOpen ? "隐藏底部战斗数据栏" : "显示底部战斗数据栏"}>战斗数据</button>
          <button className={"es-top-tool" + (sideOpen && sideTab === "token" ? " on" : "")} onClick={() => goSideTab("token")}>棋子栏</button>
        </div>
      </>
    ) : null;

  // 顶栏最右端：保存 + 结束遭遇按钮（置于右栏列内右对齐，始终在视口最右）
  const topEnd =
    view === "battle" && stage === "run" ? (
      <>
        <button className="md-btn" onClick={saveToLib} title="保存当前遭遇到存档库">
          <span className="material-symbols-outlined">save</span> 保存
        </button>
        <button className="md-btn" onClick={endEncounter} title="保存当前遭遇并返回管理阶段">
          <span className="material-symbols-outlined">check</span> 结束遭遇
        </button>
      </>
    ) : undefined;

  // 强制移动方向模式（批 1-8）：当前选中移动对象 + 可移距离上限 + 已移动目标（地图渲染 8 方向箭头用）
  const forcedMoveView = useMemo(() => {
    if (!effectMove || !effectMove.mover) return null;
    const maxDist = forcedMoveMaxDist(effectMove.attack);
    if (maxDist === null) return null;
    return { moverCid: effectMove.mover, maxDist, moved: effectMove.moved };
  }, [effectMove]);

  return (
    <>
      <AppShell
          view={view}
          onView={handleNav}
          topActions={topActions}
          // 进行遭遇阶段：顶栏与下方三栏对齐（76 导航 + 左栏 260 + 中栏 + 右栏 336）。leftW 恒定不随左栏开合变化，保证顶栏布局（含标题）始终不动
  topAlign={view === "battle" && stage === "run" ? { leftW: 260, rightW: 336 } : undefined}
          topEnd={topEnd}
        >
        <div className="es-content">
          {view === "battle" ? (
            ready ? (
              <BattleView
                combatants={combatants}
                selectedId={selectedId}
                movePreview={movePreview}
                pendingPlaceName={pendingPlaceName}
                pendingCombatant={pendingCombatant}
                onCancelPendingPlace={cancelPendingPlace}
                obstacles={obstacles}
                difficult={difficult}
                fog={fog}
                water={water}
                chasm={chasm}
                traps={traps}
                cellColors={cellColors}
                mapColor={mapColor}
                onSetMapColor={applyMapColor}
                colorHistory={colorHistory}
                objects={objects}
                sceneTool={sceneTool}
                mapCols={mapCols}
                mapRows={mapRows}
                onSetMapSize={setMapSize}
                turnOrder={turnOrder}
                turnIndex={turnIndex}
                round={round}
                log={log}
                monsters={monsters}
                teams={teams}
                parties={parties}
                charPool={charPool}
                aim={aim}
                aimOrigin={aimOrigin}
                aimSel={aimSel}
                aimArea={aimArea}
                auraView={auraView}
                forcedMove={forcedMoveView}
                zones={zones}
                zoneBuild={zoneBuild}
                invalidZoneCell={invalidZoneCell}
                onConfirmZoneBuild={confirmZoneBuild}
                onCancelZoneBuild={cancelZoneBuild}
                onCellClick={onCellClick}
                onConfirmMove={confirmMove}
                onCancelMove={cancelMove}
                onMoveTokenTo={moveTokenTo}
                onToggleCondition={onTokenToggleCondition}
                bindTarget={bindTarget}
                onBindSummoner={onBindSummoner}
                onUnbindSummoner={onUnbindSummoner}
                onDismissSummon={onDismissSummon}
                bindMaster={bindMaster}
                onSetMaster={onSetMaster}
                onClearMaster={onClearMaster}
                onConfirmAim={onConfirmAim}
                onCancelAim={cancelAim}
                onRemoveAimSel={onRemoveAimSel}
                onForcedMoveDir={handleForcedMoveDir}
                onSelectCombatant={setSelectedId}
                onPickAttack={onPickAttack}
                onPatch={onPatch}
                onPatchCid={onPatchCid}
                onApplyDamage={onApplyDamage}
                onApplyHeal={onApplyHeal}
                onApplyDamageTo={applyDamageTo}
                onApplyHealTo={applyHealTo}
                onUseSurge={onUseSurge}
                onRemove={onRemove}
                onSetAttacks={onSetAttacks}
                onSetSceneTool={setSceneTool}
                onRollInitiative={rollInitiative}
                onEndTurn={endTurn}
                autoActionBudget={settings.auto.turn.actionBudget}
                onAction={onAction}
                onRemoveOngoing={onRemoveOngoing}
                onAddOngoing={onAddOngoing}
                onRemoveEffect={onRemoveEffect}
                onDeathSave={onDeathSave}
                onSpendActionPoint={onSpendActionPoint}
                onUndoUnit={undoUnit}
                onUndoTurn={undoTurn}
                onSurprise={surprise}
                stage={stage}
                onCreateMap={createMap}
                onExportEncounter={saveEncounter}
                onImportEncounter={() => loadEncRef.current?.click()}
                onImportMapBg={() => mapBgRef.current?.click()}
                mapBg={mapBg}
                mapBgAlign={mapBgAlign}
                mapBgDlg={mapBgDlg}
                mapBgCalib={mapBgCalib}
                onOpenMapBg={() => setMapBgDlg(true)}
                onCloseMapBg={() => {
                  setMapBgDlg(false);
                  setMapBgCalib(false);
                }}
                onRemoveMapBg={removeMapBg}
                onMapBgAlign={setMapBgAlign}
                onStartCalib={() => setMapBgCalib(true)}
                onCancelCalib={() => setMapBgCalib(false)}
                onCalibRect={(rect) => {
                  setMapBgAlign((prev) => calibMapBgFromRect(prev, rect, CELL));
                  setMapBgCalib(false);
                }}
                encLib={encLib}
                onSetEncLib={setEncLib}
                onOpenEncounter={openEncounter}
                onAddCombatant={addCombatant}
                onPlacePartyMember={placePartyMember}
                onImportD4e={importD4eToPool}
                onCreateParty={createParty}
                onRenameParty={renameParty}
                onDeleteParty={deleteParty}
                onAddPartyMember={addPartyMember}
                onRemovePartyMember={removePartyMember}
                onMemberColor={memberColor}
                onOpenCharacter={openCharacter}
                leftTab={leftTab}
                leftOpen={leftOpen}
                sideOpen={sideOpen}
                rosterOpen={rosterOpen}
                showHpBar={settings.showHpBar}
                onOpenRules={openRules}
                notify={pushLog}
              />
            ) : (
              <div className="es-loading">
                {error ? `数据加载失败：${error}` : "加载怪物数据…"}
              </div>
            )
          ) : view === "monsters" ? (
            <MonstersView
              monsters={monsters}
              teams={teams}
              onSaveTeams={(t) => {
                setTeams(t);
                saveTeams(t);
              }}
            />
          ) : view === "characters" ? (
            <CharactersView
              parties={parties}
              monsters={monsters}
              charPool={charPool}
              onImportD4e={importD4eToPool}
              onCreateParty={createParty}
              onRenameParty={renameParty}
              onDeleteParty={deleteParty}
              onAddPartyMember={addPartyMember}
              onRemovePartyMember={removePartyMember}
              onMemberColor={memberColor}
              onPlacePartyMember={placePartyMember}
              onEditChar={editCharInCarBuild}
              onUpdateCharRaw={updateCharRaw}
              notify={pushLog}
            />
          ) : view === "carbuild" ? (
            <CarBuildView
              seed={carSeed}
              onSeedConsumed={() => setCarSeed(null)}
              onAddToPool={addCharToPool}
            />
          ) : view === "builder" ? (
            <MonsterBuilder onDeploy={addCombatant} />
          ) : view === "settings" ? (
            <SettingsView
              settings={settings}
              onChange={(s) => {
                setSettings(s);
                saveSettings(s);
              }}
            />
          ) : view === "export" ? (
            <ExportView
              combatants={combatants}
              obstacles={obstacles}
              difficult={difficult}
              fog={fog}
              water={water}
              chasm={chasm}
              traps={traps}
              parties={parties}
              cols={mapCols}
              rows={mapRows}
              turnOrder={turnOrder}
              turnIndex={turnIndex}
              teams={teams}
              settings={settings}
              notify={pushLog}
            />
          ) : (
            <RulesView prefill={rulesPrefill} />
          )}
        </div>
      </AppShell>

      {/* 攻击结算条（底部固定、非模态；瞄准点选目标后出现）。借机结算条弹出时隐藏，避免双条重叠 */}
      {pendingAttack && !pendingOA && (
        <AttackDialog
          attacker={combatants.find((c) => c.cid === pendingAttack.attackerId)!}
          attack={pendingAttack.attack}
          targets={pendingAttack.targetIds
            .map((cid) => {
              const c = combatants.find((x) => x.cid === cid);
              if (c) return c;
              // 批 4-4a-3：物体目标 → 伪 Combatant（防御/HP 取物体数据；will 极高=免疫意志攻击）
              const o = objects[cid];
              return o ? objectAsTarget(o) : null;
            })
            .filter((c): c is Combatant => !!c)}
          rangeText={pendingAttack.rangeText}
          locked={pendingAttack.forced}
          auto={settings.auto}
          rosterOpen={rosterOpen}
          cover={pendingAttack.coverByTarget}
          onResolve={handleResolve}
          onClose={() => setPendingAttack(null)}
        />
      )}

      {/* 借机结算条（批 2-3）：移动/威能借机检测命中后弹出，DM 应用/跳过/取消后再继续原动作 */}
      {pendingOA && (
        <OABar
          kind={pendingOA.kind}
          mover={pendingOA.mover}
          provokers={pendingOA.provokers}
          ctx={{ combatants, cols: mapCols, rows: mapRows, obstacles }}
          autoResolve={settings.auto.trigger.oppResolve}
          rosterOpen={rosterOpen}
          onApply={onOaApply}
          onSkip={onOaSkip}
          onCancel={onOaCancel}
        />
      )}

      {/* 突袭轮：选择突袭者 */}
      {surpriseDlgOpen && (
        <SurpriseDialog
          combatants={combatants}
          onCancel={() => setSurpriseDlgOpen(false)}
          onConfirm={startSurprise}
        />
      )}

      {/* 效果「强制移动」模式浮层栏 */}
      {stage === "run" && effectMove && (
        <div className="es-fmovebar">
          <div className="es-fmovebar-info">
            <b>强制移动模式</b>
            <span>
              点击要移动的目标棋子 → 周围出现 <b>8 方向箭头</b>（灰=不可达，数字=可移格数），点箭头逐格移动；
              也可直接点其 <b>直线</b>（直/斜）合法落点移动；可逐个移动多个目标。
            </span>
            <span className="es-fmovebar-hint">
              {effectMove.mover
                ? `当前选中移动对象：${combatants.find((c) => c.cid === effectMove.mover)?.name ?? ""}`
                : `${effectMove.moved.length} 个目标已移动`}
            </span>
          </div>
          <div className="es-fmovebar-actions">
            <button className="es-btn-inline" onClick={cancelForcedMove}>取消</button>
            <button className="es-btn-apply" onClick={finishEffectMove}>完成移动并结算效果</button>
          </div>
        </div>
      )}

      {/* 效果型威能：移动结束后的效果结算弹窗（仅 DM 裁决兜底时出现；语义化已自动挂载） */}
      {pendingEffect && (
        <EffectDialog
          attack={pendingEffect.attack}
          combatants={combatants}
          attackerId={pendingEffect.attackerId}
          defaultTargets={pendingEffect.defaultTargets}
          specsOverride={pendingEffect.specsOverride}
          onApply={(targets) => applyEffect(pendingEffect, targets)}
          onClose={() => setPendingEffect(null)}
        />
      )}

      {/* 强制移动直线落点被阻挡（批 3 收尾）：停在障碍前（规则默认）或 DM 自定义距离 */}
      {blockedMove && (
        <BlockedMoveDialog
          info={blockedMove}
          onMove={(dist) => {
            const mover = combatants.find((c) => c.cid === blockedMove.moverCid);
            if (mover?.pos) applyForcedMoveStraight(mover, dist > 0 ? blockedMove.pts[dist - 1] : { ...mover.pos }, dist);
            setBlockedMove(null);
          }}
          onClose={() => setBlockedMove(null)}
        />
      )}

      {/* 管理阶段「导入遭遇」隐藏文件框（触发按钮位于遭遇视图二层顶栏） */}
      <input
        ref={loadEncRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadEncounter(f);
          e.target.value = "";
        }}
      />

      {/* 地图背景图隐藏文件框（「导入地图」按钮触发；导入后进入进行阶段并打开对齐面板） */}
      <input
        ref={mapBgRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importMapBg(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** 强制移动直线落点被阻挡的 DM 裁决对话框（批 3 收尾）：
 * 4E 规则默认停在障碍前一格；DM 可自定义距离（0=原地不动，或任意 ≤ 落点距离）。 */
function BlockedMoveDialog({
  info,
  onMove,
  onClose,
}: {
  info: { moverCid: string; attack: AttackOption; pts: Point[]; blockedAt: number; blockedBy: string };
  onMove: (dist: number) => void;
  onClose: () => void;
}) {
  const max = info.pts.length;
  const [distText, setDistText] = useState(String(Math.max(0, info.blockedAt)));
  const distVal = Math.max(0, Math.min(max, parseInt(distText, 10) || 0));
  const isRuleDefault = info.blockedAt > 0 && distVal === info.blockedAt;
  return (
    <div className="es-overlay" onClick={onClose}>
      <div className="es-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="es-dialog-head">
          <span className="es-dialog-title">强制移动被阻挡</span>
          <span className="es-dialog-sub">【{info.attack.name}】</span>
          <button className="es-dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="es-effect-text">
          {info.blockedAt === 0
            ? <>路径第一格即被「<b>{info.blockedBy}</b>」阻挡，无法移动。</>
            : <>路径第 <b>{info.blockedAt + 1}</b> 格被「<b>{info.blockedBy}</b>」阻挡。</>}
          <br />
          4E 规则默认停在障碍前一格；特殊情况由 DM 裁决（可输入任意距离）。
        </div>

        <div className="es-dmg-section">
          <div className="es-dmg-row">
            <label>移动距离（格；0 = 原地不动，最多 {max} 格）</label>
            <input
              type="number"
              min={0}
              max={max}
              value={distText}
              onChange={(e) => setDistText(e.target.value)}
            />
          </div>
        </div>

        <div className="es-dialog-actions">
          <button className="es-btn-cancel" onClick={onClose}>取消</button>
          <button className="es-btn-apply" onClick={() => onMove(distVal)}>
            {distVal === 0 ? "不移动（原地）" : `移动 ${distVal} 格${isRuleDefault ? "（停在障碍前）" : "（DM 裁决）"}`}
          </button>
        </div>
      </div>
    </div>
  );
}