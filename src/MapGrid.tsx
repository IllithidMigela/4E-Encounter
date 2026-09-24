// 方形网格地图：CSS Grid + 令牌绝对定位 + 移动预览（效果线 + 终点确认）+ 拖拽移动
// 拖拽：按住棋子拖到落点 → 生成可编辑路径（每个格子中心有可拖动锚点）→ 点击确认落地
// 右键棋子：弹出快捷菜单（状态操作等）
import { useCallback, useMemo, useRef, useState, useLayoutEffect, useEffect } from "react";
import type { AttackOption, BattleActionKind, Combatant, ConditionKey, DamageType, FogLevel, MovePreview, ObjectTarget, OngoingDamage, TerrainTool, Zone, ZoneBuild } from "./types";
import { ALL_CONDITIONS, CONDITION_LABEL, DAMAGE_TYPE_LABEL, TERRAIN_TOOLS } from "./types";
import { buildPath, validatePath, parseRange, centerOf, burstCells, blastSquare, reachCells, losBlocked, tokenDistance, effectiveMoveLimit, cellCostOf, pathMoveCost, closeBurstCells, parseTargetSpec, forcedMoveReach, wallValidate, isSummoned, summonerNameOf } from "./engine";
import { toCanvas } from "html-to-image"; // 地图复制为 PNG：捕获 es-map 网格 div（临时去除 transform 后按真实尺寸渲染）
import { RuleTip } from "./rules"; // 批 4b-2：状态名 hover 联动万律
import type { Point } from "./engine";

export const CELL = 46;
export const LONG_PRESS_MS = 300; // 按住该时长达成“长按”，之后才允许拖拽移动

/** 把格子集合的外轮廓合并为一条 SVG 路径（fill-rule: evenodd 时自动挖出孔洞，
 * 例如近战范围环内的大型生物自身占地）。返回 null 表示空集。 */
function cellsOutlinePath(cells: ReadonlySet<string>, scale: number): string | null {
  if (cells.size === 0) return null;
  const has = (x: number, y: number) => cells.has(x + "," + y);
  const byVertex = new Map<string, { a: string; b: string; used: boolean }[]>();
  const seen = new Set<string>();
  const addEdge = (ax: number, ay: number, bx: number, by: number) => {
    const a = ax + "," + ay;
    const b = bx + "," + by;
    const k = a < b ? a + "|" + b : b + "|" + a;
    if (seen.has(k)) return;
    seen.add(k);
    const e = { a, b, used: false };
    for (const v of [a, b]) {
      let arr = byVertex.get(v);
      if (!arr) byVertex.set(v, (arr = []));
      arr.push(e);
    }
  };
  for (const key of cells) {
    const [x, y] = key.split(",").map(Number);
    if (!has(x, y - 1)) addEdge(x, y, x + 1, y); // 上边
    if (!has(x, y + 1)) addEdge(x, y + 1, x + 1, y + 1); // 下边
    if (!has(x - 1, y)) addEdge(x, y, x, y + 1); // 左边
    if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1); // 右边
  }
  const parts: string[] = [];
  for (const [, edges] of byVertex) {
    const first = edges.find((e) => !e.used);
    if (!first) continue;
    first.used = true;
    const start = first.a;
    const pts: string[] = [start.split(",").map((n) => Number(n) * scale).join(",")];
    let at = first.b;
    let guard = 0;
    while (at !== start && guard++ < 1e6) {
      const next = byVertex.get(at)!.find((e) => !e.used);
      if (!next) break;
      next.used = true;
      pts.push(at.split(",").map((n) => Number(n) * scale).join(","));
      at = next.a === at ? next.b : next.a;
    }
    parts.push("M" + pts.join("L") + "Z");
  }
  return parts.length ? parts.join("") : null;
}

interface Props {
  cols: number;
  rows: number;
  combatants: Combatant[];
  selectedId: string | null;
  movePreview: MovePreview | null;
  pendingName: string | null;
  obstacles: Set<string>;
  difficult: Set<string>;
  fog: Record<string, FogLevel>;
  water: Set<string>;
  chasm: Set<string>;
  traps: Set<string>;
  /** 涂色图层：格 "x,y" → 底色（用户涂抹的地图底色，位于地形覆盖层之下） */
  cellColors: Record<string, string>;
  /** 物体目标（批 4-4a-3）：墙/陷阱格 → 物体数据；受损/完好的物体显示 HP 徽标 */
  objects: Record<string, ObjectTarget>;
  /** 场景画笔工具（墙体/困难/轻雾/重雾/暗/清理）；非 null 时进入绘制模式，屏蔽拖拽与瞄准 */
  sceneTool: TerrainTool;
  /** 右键取消场景绘制（退出绘制模式） */
  onCancelSceneTool: () => void;
  /** 放置模式下右键取消放置（清除待放置令牌） */
  onCancelPendingPlace: () => void;
  aim: { attackerId: string; attack: AttackOption } | null;
  aimOrigin: Point | null;
  aimSel: string[];
  aimArea: { cells: Set<string>; label: string } | null;
  /** 当前展示的灵气（灵气N，环绕持有者自身）：在地图上高亮填满区域 */
  auraView: { attackerId: string; attack: AttackOption; radius: number } | null;
  /** 已放置的区域效果 / 墙（批 2b-3：zone=青绿覆盖；wall=青绿描边石纹，与普通障碍区分） */
  zones: Zone[];
  /** 区域效果放置模式（批 2b-4）：zone=点中心选格集；wall=连续塑形墙；null=无放置 */
  zoneBuild: ZoneBuild | null;
  /** 放置期校验失败的红标格（如非法墙格） */
  invalidZoneCell: string | null;
  /** 放置确认（「完成」） */
  onConfirmZoneBuild: () => void;
  /** 放置取消（「取消」按钮 / 右键地图） */
  onCancelZoneBuild: () => void;
  /** 强制移动方向模式：当前被选作移动对象的目标 + 最大可移距离 + 已移动目标（批 1-8：8 方向箭头实时校验） */
  forcedMove: { moverCid: string; maxDist: number; moved: string[] } | null;
  /** 当前行动者 cid（批 1-10：白色呼吸高亮；null=无） */
  currentCid: string | null;
  /** 棋子底部 2px 血条开关（批 1-10） */
  showHpBar: boolean;
  onConfirmAim: () => void;
  /** 格子点击：单击切换地形；apply=true 时强制涂抹（画笔拖动语义，只上色不切换） */
  onCellClick: (x: number, y: number, apply?: boolean) => void;
  onConfirmMove: () => void;
  onCancelMove: () => void;
  onCancelAim: () => void;
  /** 目标清单条：移除一个已选目标 */
  onRemoveAimSel: (cid: string) => void;
  /** 强制移动方向模式：沿 (dx,dy) 方向移动 1 格（App 侧再校验并落子） */
  onForcedMoveDir: (cid: string, dx: number, dy: number) => void;
  onMoveTokenTo: (cid: string, end: Point, path?: Point[], shift?: boolean) => void;
  onToggleCondition: (cid: string, k: ConditionKey) => void;
  /** 召唤兽绑定召出者模式（批 4-4a-2）：bindTarget=待绑定的召唤兽 cid；非 null 时该棋子高亮 */
  bindTarget: string | null;
  /** 右键菜单：进入「绑定召出者」模式 */
  onBindSummoner: (cid: string) => void;
  /** 右键菜单：解除绑定（不再随召出者先攻/移除） */
  onUnbindSummoner: (cid: string) => void;
  /** 右键菜单：解除召唤（手动移除召唤兽） */
  onDismissSummon: (cid: string) => void;
  /** 批 6f：守护者绑定主人模式——bindMaster=待绑定主人 cid；非 null 时该守护者高亮 */
  bindMaster: string | null;
  /** 右键菜单：进入「设定主人」模式（守护者依赖外部主人时） */
  onSetMaster: (cid: string) => void;
  /** 右键菜单：清除主人绑定 */
  onClearMaster: (cid: string) => void;
  /** 批 4b-1：右键菜单「行动」——基础动作快捷（复用顶栏回调；仅当前行动者可用） */
  onAction: (kind: BattleActionKind) => void;
  /** 右键菜单「数据」：选中该棋子（等价点击选中） */
  onSelectCombatant: (cid: string) => void;
  /** 右键菜单「效果」：移除持续伤害 / 添加持续伤害 / 移除挂载效果 */
  onRemoveOngoing: (cid: string, index: number) => void;
  onAddOngoing: (cid: string, od: OngoingDamage) => void;
  onRemoveEffect: (cid: string, index: number) => void;
  /** 批 4b-2：状态名 hover 迷你规则卡「查看全文」跳转万律 */
  onOpenRules: (keyword: string) => void;
  /** 地图背景图（导入地图）：data URL + 对齐参数 + 重开对齐面板（背景存在时缩放控件区显示按钮） */
  mapBg: string | null;
  mapBgAlign: { offsetX: number; offsetY: number; scale: number; baseW?: number; gridOpacity?: number };
  onOpenMapBg: () => void;
  /** 框选校准：在地图上框选印刷网格的一个方格（es-map 表面坐标）自动校准；calib 为 true 时进入框选模式 */
  calib: boolean;
  onCalibRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  onCancelCalib: () => void;
}

/** 拖拽重路由使用的临时路径（含合规性） */
interface EditorPath {
  cid: string;
  path: Point[];
  dist: number;
  limited: boolean;
}

/** 右键快捷菜单 */
interface TokenMenu {
  cid: string;
  x: number;
  y: number;
  sub: "status" | "action" | "effect" | "data" | null; // 当前展开的子菜单（批 4b-1：状态/行动/效果/数据）
}

/** 列坐标字母：0→A、1→B、25→Z、26→AA…（A1 格标注） */
function indexToLabel(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export default function MapGrid({ cols, rows, mapBg, mapBgAlign, onOpenMapBg, calib, onCalibRect, onCancelCalib, combatants, selectedId, movePreview, pendingName, obstacles, difficult, fog, water, chasm, traps, cellColors, objects, sceneTool, onCancelSceneTool, onCancelPendingPlace, aim, aimOrigin, aimSel, aimArea, auraView, zones, zoneBuild, invalidZoneCell, onConfirmZoneBuild, onCancelZoneBuild, forcedMove, currentCid, showHpBar, onConfirmAim, onCellClick, onConfirmMove, onCancelMove, onCancelAim, onRemoveAimSel, onForcedMoveDir, onMoveTokenTo, onToggleCondition, bindTarget, onBindSummoner, onUnbindSummoner, onDismissSummon, bindMaster, onSetMaster, onClearMaster, onAction, onSelectCombatant, onRemoveOngoing, onAddOngoing, onRemoveEffect, onOpenRules }: Props) {
  const mapRef = useRef<HTMLDivElement>(null); // 地图网格（transform: scale 缩放视觉；坐标换算按 CELL*zoom 反解）
  const wrapRef = useRef<HTMLDivElement>(null); // 地图滚动容器：Excel 式原生滚动（滚轮纵向 + Shift 横向），Ctrl+滚轮缩放
  const [zoom, setZoom] = useState(1); // 缩放 0.5~2：网格用 transform: scale 缩放，外层滚动容器按 CELL*zoom 撑开以支持原生滚动
  // 框选校准（导入地图背景对齐）：框选矩形的表面坐标 + 拖拽起点
  const [calibRect, setCalibRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const calibStart = useRef<{ x: number; y: number } | null>(null);
  // 框选校准模式：Esc 取消
  useEffect(() => {
    if (!calib) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelCalib();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calib, onCancelCalib]);
  // 画笔模式：松开左键（任意位置）结束绘制。若本次手势拖动涂过，则吞掉随之而来的 click
  // （click 在 pointerup 之后同步触发，setTimeout(0) 在其后清除标记，防单格被双切换）
  useEffect(() => {
    const stop = () => {
      paintingRef.current = false;
      lastPaintCellRef.current = null;
      if (dragPaintedRef.current) {
        paintGuardRef.current = true;
        setTimeout(() => {
          paintGuardRef.current = false;
        }, 0);
      } else {
        paintGuardRef.current = false;
      }
      dragPaintedRef.current = false;
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);
  // Ctrl+滚轮缩放时阻止浏览器页面缩放：React onWheel 以 passive 挂载、preventDefault 无效，
  // 需在 wrap 容器挂原生非 passive 监听器（目标阶段先于委托处理器执行），仅拦截默认行为，不阻断地图缩放逻辑
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheelGuard = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    wrap.addEventListener("wheel", onWheelGuard, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheelGuard);
  }, []);
  // Excel 式冻结行列标注的固定栏位（html px，不随 zoom 变化）
  const GUTTER_W = 22; // 左侧行标栏宽度（容纳 AA/AB…）
  const GUTTER_H = 16; // 顶部列标栏高度
  const C = CELL * zoom; // 当前缩放下单元格的物理渲染尺寸（CSS 像素）
  const [dragCell, setDragCell] = useState<{ cid: string; cell: Point } | null>(null);
  const [moveMode, setMoveMode] = useState<string | null>(null); // 长按达成、进入移动模式的棋子
  const [editor, setEditor] = useState<EditorPath | null>(null);
  // 批 2-3：快步 toggle（path.length===1 时确认条显示；快步移动不引发借机攻击）
  const [shiftMove, setShiftMove] = useState(false);
  const [tokenMenu, setTokenMenu] = useState<TokenMenu | null>(null);
  const [hoverCell, setHoverCell] = useState<Point | null>(null); // 瞄准时的悬停格
  const [mapCopied, setMapCopied] = useState(false); // 复制地图为 PNG 后的短暂成功反馈
  const [mapCopying, setMapCopying] = useState(false); // 复制地图为 PNG 进行中（遮罩盖住捕获瞬间的布局变化）
  const [hoverCard, setHoverCard] = useState<{ cid: string; x: number; y: number } | null>(null); // hover 浮动卡（批 1-10）
  const dragOn = useRef(false); // 本次拖拽是否真正发生了位移（用于抑制点击）
  const pressRef = useRef<{ cid: string; x: number; y: number } | null>(null); // 按下起点块（长按由各触发）
  const armRef = useRef(false); // 长按达成，允许移动
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // 长按计时器
  const tokenEls = useRef(new Map<string, HTMLDivElement>()); // 棋子 DOM 引用，供移动动画使用
  const animRef = useRef<{ cid: string; from: Point; path: Point[] } | null>(null); // 待播放的移动动画
  const anchorIndex = useRef<number>(-1); // 正在被拖动的锚点下标（-1 表示无）
  // 画笔模式（批 5）：按住左键拖动连续绘制（涂抹语义，划过格全部上色；单格点击仍为切换）。
  // paintingRef=手势绘制中；lastPaintCellRef=本次手势最后涂过的格（同格不重复涂）；
  // dragPaintedRef=本次手势真正拖动涂过（区分「单击切换」与「拖动涂抹」，拖动后吞掉随后的 click）；
  // paintGuardRef=需要吞掉的 click 标记
  const paintingRef = useRef(false);
  const lastPaintCellRef = useRef<string | null>(null);
  const dragPaintedRef = useRef(false);
  const paintGuardRef = useRef(false);

  // 供路径重路由使用：被移动者自身的格子不计入阻挡
  const startOf = (cid: string): Point | null => combatants.find((c) => c.cid === cid)?.pos ?? null;
  const moverOf = (cid: string): Combatant | undefined => combatants.find((c) => c.cid === cid);
  /** 允许进入的判定：障碍 + 他棋占地（被移动者自身除外） */
  const blockedFor = (moverCid: string): Set<string> => {
    const s = new Set(obstacles);
    for (const c of combatants) {
      if (!c.pos || c.cid === moverCid) continue;
      for (let ox = c.pos.x; ox < c.pos.x + c.size; ox++) {
        for (let oy = c.pos.y; oy < c.pos.y + c.size; oy++) s.add(ox + "," + oy);
      }
    }
    return s;
  };
  /** 斜穿拐角判据只用障碍（墙），生物不填满格子 */
  const wallSet = useMemo(() => new Set(obstacles), [obstacles]);
  /** 困难地形 → 每格移动力消耗 */
  const costOf = useMemo(() => cellCostOf(difficult), [difficult]);
  /** 同名同阵营同体型棋子分组内的序号（规格 2.2.2：右上角标 1、2…，仅组内 ≥2 时标注） */
  const seqOf = useMemo(() => {
    const m = new Map<string, number>();
    const group = new Map<string, { count: number; cids: string[] }>();
    for (const c of combatants) {
      if (!c.pos) continue;
      const key = c.kind + "|" + c.name + "|" + c.size;
      const g = group.get(key) ?? { count: 0, cids: [] };
      g.count++;
      g.cids.push(c.cid);
      group.set(key, g);
    }
    for (const g of group.values()) {
      if (g.count < 2) continue;
      g.cids.forEach((cid, i) => m.set(cid, i + 1));
    }
    return m;
  }, [combatants]);
  /** 该棋子的实际可用移动力（含状态修正） */
  const moveLimitOf = (cid: string): number => {
    const c = moverOf(cid);
    return c ? effectiveMoveLimit(c) : 6;
  };

  // ---------- 瞄准模式：范围 / 效果线可视化 ----------
  const aimView = useMemo(() => {
    if (!aim) return null;
    const attacker = combatants.find((c) => c.cid === aim.attackerId && c.pos);
    if (!attacker || !attacker.pos) return null;
    const pr = parseRange(aim.attack.range);
    const aCenter = centerOf(attacker.pos, attacker.size);
    const blocked = new Set(obstacles);

    const out: {
      cells: Set<string>; // 强高亮：近战范围 / 近程爆发 / 区域爆发
      ringCells: Set<string>; // 弱提示：射程环
      lineTo: Point | null; // 效果线终点
      lineOk: boolean;
      from: Point; // 效果线起点（攻击者中心 / 爆发起始格）
      origin: Point | null; // 近程爆发起始格（单独高亮）
      blastRect: { x: number; y: number; w: number; h: number } | null;
      previewPoint: Point | null; // 判定点（悬停格）：近程/区域爆发定位
      label: string;
    } = {
      cells: new Set(),
      ringCells: new Set(),
      lineTo: null,
      lineOk: false,
      from: aCenter,
      origin: null,
      blastRect: null,
      previewPoint: null,
      label: "",
    };

    if (pr.type === "melee") {
      out.cells = reachCells(attacker.pos, attacker.size, pr.dist, cols, rows);
      out.label = `近战范围 ${pr.dist} 格`;
    } else if (pr.type === "ranged") {
      out.ringCells = burstCells(aCenter, pr.dist, cols, rows);
      out.lineTo = hoverCell;
      out.lineOk = !!hoverCell && tokenDistance(attacker.pos, attacker.size, hoverCell, 1) <= pr.dist && !losBlocked(aCenter, hoverCell, blocked);
      out.label = `远程射程 ${pr.dist} 格（悬停查看效果线）`;
    } else if (pr.type === "close") {
      out.previewPoint = hoverCell; // 判定点：悬停格整格高亮
      if (pr.areaKind === "blast") {
        out.blastRect = hoverCell ? blastSquare(attacker.pos, attacker.size, pr.dist, hoverCell, cols, rows) : null;
        out.label = `近程冲击 ${pr.dist}（悬停预览，点击放置）`;
      } else {
        // 近程爆发：以使用者整个空间为起始格（大型生物爆发更大，与结算一致）
        const origin = aimOrigin ?? attacker.pos;
        out.origin = origin;
        out.from = origin;
        out.cells = closeBurstCells(attacker.pos, attacker.size, pr.dist, cols, rows);
        out.label = `近程爆发 ${pr.dist}（以使用者空间为起始格）`;
      }
    } else if (pr.type === "area") {
      out.ringCells = burstCells(aCenter, pr.dist, cols, rows);
      out.lineTo = hoverCell;
      out.lineOk = !!hoverCell && tokenDistance(attacker.pos, attacker.size, hoverCell, 1) <= pr.dist && !losBlocked(aCenter, hoverCell, blocked);
      if (hoverCell && out.lineOk) out.cells = burstCells(hoverCell, pr.areaSize ?? pr.dist, cols, rows);
      out.previewPoint = hoverCell; // 判定点：悬停格整格高亮
      out.label = `区域爆发 ${pr.areaSize ?? pr.dist}（射程 ${pr.dist}，悬停预览）`;
    } else {
      out.label = `无法解析射程：${aim.attack.range}`;
    }
    return out;
  }, [aim, aimOrigin, combatants, hoverCell, obstacles, cols, rows]);

  // 已点选目标（多目标威能）的占用格集合：地图高亮
  const selCells = useMemo(() => {
    const s = new Set<string>();
    for (const c of combatants) {
      if (!c.pos || !aimSel.includes(c.cid)) continue;
      for (let ox = c.pos.x; ox < c.pos.x + c.size; ox++)
        for (let oy = c.pos.y; oy < c.pos.y + c.size; oy++) s.add(ox + "," + oy);
    }
    return s;
  }, [combatants, aimSel]);

  // 瞄准形状：把各格集合并为连续 SVG 外轮廓（fill-rule: evenodd 挖出孔洞，如近战环内的大型生物占地）
  const aimShapes = useMemo(() => {
    if (!aimView) return null;
    return {
      ring: cellsOutlinePath(aimView.ringCells, CELL),
      cells: cellsOutlinePath(aimView.cells, CELL),
      area: aimArea ? cellsOutlinePath(aimArea.cells, CELL) : null,
      sel: cellsOutlinePath(selCells, CELL),
    };
  }, [aimView, aimArea, selCells]);

  // 当前展示的灵气区域：环绕持有者自身填满 N 格（含效果线），复用近程爆发取格逻辑
  const auraCellSet = useMemo(() => {
    if (!auraView) return null;
    const holder = combatants.find((c) => c.cid === auraView.attackerId && c.pos);
    if (!holder || !holder.pos) return null;
    return closeBurstCells(holder.pos, holder.size, auraView.radius, cols, rows);
  }, [auraView, combatants, cols, rows]);
  const auraShape = useMemo(() => (auraCellSet ? cellsOutlinePath(auraCellSet, CELL) : null), [auraCellSet]);

  // ---------- 区域效果放置期（批 2b-4）----------
  // zone：悬停中心 → 爆发格集预览（与瞄准预览同风格，校验在 App 侧点击时做）
  const zoneHoverCells = useMemo(() => {
    if (!zoneBuild || zoneBuild.kind !== "zone" || !hoverCell) return null;
    const pr = parseRange(zoneBuild.attack.range);
    if (pr.type !== "area") return null;
    return burstCells(hoverCell, pr.areaSize ?? pr.dist, cols, rows);
  }, [zoneBuild, hoverCell, cols, rows]);

  // wall：悬停格实时反馈（与上一格正交相邻且不占生物格 → 青绿可落；否则红标）
  const wallHoverState = useMemo(() => {
    if (!zoneBuild || zoneBuild.kind !== "wall" || !hoverCell || zoneBuild.seq.length === 0) return null;
    const last = zoneBuild.seq[zoneBuild.seq.length - 1];
    const [lx, ly] = last.split(",").map(Number);
    const adjacent = Math.abs(lx - hoverCell.x) + Math.abs(ly - hoverCell.y) === 1;
    const dup = zoneBuild.seq.includes(hoverCell.x + "," + hoverCell.y);
    const occupied = combatants.some(
      (c) =>
        c.pos &&
        hoverCell.x >= c.pos.x &&
        hoverCell.x < c.pos.x + c.size &&
        hoverCell.y >= c.pos.y &&
        hoverCell.y < c.pos.y + c.size,
    );
    return { ok: adjacent && !dup && !occupied };
  }, [zoneBuild, hoverCell, combatants]);

  // 「完成」按钮可用性：zone=已选格；wall=≥2 格且通过三定律
  const zoneBuildValid = useMemo(() => {
    if (!zoneBuild) return false;
    if (zoneBuild.kind === "zone") return zoneBuild.seq.length > 0;
    if (zoneBuild.seq.length < 2) return false;
    const pts = zoneBuild.seq.map((k) => {
      const [a, b] = k.split(",").map(Number);
      return { x: a, y: b };
    });
    return wallValidate(pts).ok;
  }, [zoneBuild]);

  // 目标词条解析：瞄准条显示「已选 / 最多目标数」
  const aimSpec = useMemo(() => (aim ? parseTargetSpec(aim.attack.target) : null), [aim]);

  /** 目标棋子是否占用 cells 中的任一格（整个占地判定） */
  const cellsOverlap = useCallback(
    (c: Combatant, cells: Set<string>): boolean => {
      if (!c.pos) return false;
      for (let ox = c.pos.x; ox < c.pos.x + c.size; ox++)
        for (let oy = c.pos.y; oy < c.pos.y + c.size; oy++) if (cells.has(ox + "," + oy)) return true;
      return false;
    },
    [],
  );

  /** 体型条件校验（sizeCond 形如「中型或更小」「大型或更大」）→ 目标占格是否满足 */
  const sizeCondOk = useCallback((cond: string, grid: number): boolean => {
    const m = cond.match(/(超巨型|巨型|大型|中型|小型|微型)(?:或(更大|更小))?/);
    if (!m) return true;
    const cellBase = m[1] === "超巨型" ? 9 : m[1] === "巨型" ? 4 : m[1] === "大型" ? 2 : 1;
    const dir = m[2] ?? "";
    if (!dir) return grid === cellBase;
    return dir === "更大" ? grid >= cellBase : grid <= cellBase;
  }, []);

  // 可达性着色：瞄准时按「射程+效果线+目标定义」预判每个棋子——ok=绿边（可命中）/ no=灰暗（不可达或被过滤）
  const aimMark = useMemo(() => {
    if (!aim || !aimView) return null;
    const attacker = combatants.find((c) => c.cid === aim.attackerId && c.pos);
    if (!attacker || !attacker.pos) return null;
    const spec = parseTargetSpec(aim.attack.target);
    const pr = parseRange(aim.attack.range);
    const blocked = new Set(obstacles);
    const aCenter = centerOf(attacker.pos, attacker.size);
    const origin = aimOrigin ?? attacker.pos;
    const cells = aimView.cells; // 近程爆发/已放置冲击/已放置区域的受击格
    const ok = new Set<string>();
    const no = new Set<string>();
    for (const c of combatants) {
      if (!c.pos || c.cid === attacker.cid) continue;
      const cCenter = centerOf(c.pos, c.size);
      const cDist = tokenDistance(attacker.pos, attacker.size, c.pos, c.size);
      // 空间范围：近战/远程按射程距离；近程/区域按受击格
      let inScope = false;
      if (pr.type === "melee" || pr.type === "ranged") inScope = cDist <= (pr.dist ?? 0);
      else if (pr.type === "close" || pr.type === "area") inScope = cells.size > 0 && cellsOverlap(c, cells);
      if (!inScope) continue; // 范围外：不标注
      // 目标定义过滤：不满足 → 灰暗（可达性着色，点击会提示）
      if (spec.faction === "enemy" && c.kind === attacker.kind) { no.add(c.cid); continue; }
      if (spec.faction === "ally" && c.kind !== attacker.kind) { no.add(c.cid); continue; }
      if (spec.condTarget && !c.conditions.includes(spec.condTarget as never)) { no.add(c.cid); continue; }
      if (spec.sizeCond && !sizeCondOk(spec.sizeCond, c.size)) { no.add(c.cid); continue; }
      // 效果线
      const from = pr.type === "area" ? (aimView.lineTo ?? aCenter) : origin;
      const reach = !losBlocked(from, cCenter, blocked);
      if (reach) ok.add(c.cid);
      else no.add(c.cid);
    }
    return { ok, no };
  }, [aim, aimView, aimOrigin, combatants, obstacles, cellsOverlap, sizeCondOk]);

  // 强制移动方向模式（批 1-8）：当前移动对象周围的 8 方向箭头 + 实时可达距离
  const forcedArrows = useMemo(() => {
    if (!forcedMove) return null;
    const mover = combatants.find((c) => c.cid === forcedMove.moverCid && c.pos);
    if (!mover?.pos) return null;
    // 障碍或其它棋子占据 → 该格不可推入（目标自身起点不参与判定）
    const isBlocked = (x: number, y: number) => {
      if (obstacles.has(x + "," + y)) return true;
      return combatants.some(
        (c) => c.pos && c.cid !== mover.cid && x >= c.pos.x && x < c.pos.x + c.size && y >= c.pos.y && y < c.pos.y + c.size,
      );
    };
    const dirs: { dx: number; dy: number; label: string; title: string }[] = [
      { dx: 0, dy: -1, label: "↑", title: "上" },
      { dx: 1, dy: -1, label: "↗", title: "右上" },
      { dx: 1, dy: 0, label: "→", title: "右" },
      { dx: 1, dy: 1, label: "↘", title: "右下" },
      { dx: 0, dy: 1, label: "↓", title: "下" },
      { dx: -1, dy: 1, label: "↙", title: "左下" },
      { dx: -1, dy: 0, label: "←", title: "左" },
      { dx: -1, dy: -1, label: "↖", title: "左上" },
    ];
    return {
      cid: mover.cid,
      size: mover.size,
      center: { x: mover.pos.x * CELL + (mover.size * CELL) / 2, y: mover.pos.y * CELL + (mover.size * CELL) / 2 },
      arrows: dirs.map((d) => ({
        ...d,
        reach: forcedMoveReach(mover.pos!, mover.size, d, forcedMove.maxDist, cols, rows, isBlocked),
      })),
    };
  }, [forcedMove, combatants, obstacles, cols, rows]);

  // 拖拽中实时预览的移动者（仅拖拽尚无编辑路径时）
  const dragMover =
    dragCell && !editor ? (combatants.find((c) => c.cid === dragCell.cid && c.pos) ?? null) : null;

  // 拖拽中实时的预览路径：从棋子当前位置到鼠标所在格
  const dragPreview: MovePreview | null = useMemo(() => {
    const mover = dragMover;
    if (!mover || !mover.pos || !dragCell?.cell) return null;
    const ml = effectiveMoveLimit(mover);
    if (ml <= 0) return { cid: mover.cid, path: [], dist: 0, limited: true };
    const bp = buildPath(mover.pos, dragCell.cell, ml, cols, rows, blockedFor(mover.cid), wallSet, costOf, mover.size);
    return { cid: mover.cid, path: bp.path, dist: bp.dist, limited: bp.limited };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragMover, dragCell, obstacles, difficult, combatants, cols, rows]);

  // 当前展示的路径：优先已确认待落的编辑路径，其次拖拽实时预览，再次两步式点击路径
  const dragConflict = !!dragCell || !!editor;
  const shownPreview: MovePreview | null = editor ?? dragPreview;
  const activePreview: MovePreview | null = dragConflict ? shownPreview : movePreview;

  // 路径合规性校验（按棋子完整占地逐格检查；布置失败、落点不可达或超过移动力也视为不合法）
  const legal = useMemo(() => {
    if (!activePreview || activePreview.path.length === 0) return { ok: false, index: -1 };
    const mover = moverOf(activePreview.cid);
    if (!mover) return { ok: false, index: -1 };
    const moverSize = mover.size;
    const moverLimit = moveLimitOf(activePreview.cid);
    if (moverLimit <= 0) {
      const why = mover.conditions.includes("restrained") ? "束缚" : "定身";
      return { ok: false, index: -1, reason: `${why}：该棋子无法移动。` };
    }
    if (activePreview.limited) return { ok: false, index: -1, reason: "路径无法连通：落点被障碍/占位封闭，或移动力不足。" };
    const cost = pathMoveCost(activePreview.path, costOf, moverSize);
    if (cost > moverLimit) {
      return { ok: false, index: -1, reason: `路径经过困难地形，总消耗 ${cost} 点，超过移动力 ${moverLimit} 点，移动不成立。` };
    }
    return validatePath(activePreview.path, blockedFor(activePreview.cid), cols, rows, moverSize, wallSet);
  }, [activePreview, costOf, wallSet, cols, rows, combatants]);

  // 鼠标坐标 → 格（批 2-0b：transform: scale 缩放后 getBoundingClientRect 返回缩放后尺寸，
  // 坐标换算须按 CELL*zoom 反解，避免 CSS transform 后 offsetX 失真）
  const cellFromEvent = (clientX: number, clientY: number): Point | null => {
    const el = mapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.floor((clientX - r.left) / (CELL * zoom));
    const y = Math.floor((clientY - r.top) / (CELL * zoom));
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    return { x, y };
  };

  // ---------- 棋子拖拽（长按触发） ----------
  // 简短轻按 = 点击选择；按住不放（超过一定时长）达成“长按”后才允许拖拽移动，
  // 可从棋子任意位置按下，避免“按下即移动”在轻按时误触发。
  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const onTokenDragStart = (cid: string, e: React.PointerEvent<HTMLDivElement>) => {
    // 任何新的按压先清掉拖拽标记：瞄准/场景绘制/区域放置模式下本函数会早退，
    // 若上一次拖动把 dragOn 置为 true 而此处未清零，则随后的点击会被 onClick 的 `if (dragOn.current) return` 吞掉，
    // 导致「瞄准中点击目标毫无反应」。先清零可保证每次点击都真正落到 onCellClick。
    dragOn.current = false;
    if (sceneTool || aim || zoneBuild) return; // 场景绘制、瞄准、区域放置模式下不拖拽
    e.preventDefault();
    e.stopPropagation();
    armRef.current = false;
    pressRef.current = { cid, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      if (!pressRef.current || pressRef.current.cid !== cid) return;
      armRef.current = true; // 长按达成：允许移动
      setMoveMode(cid); // 进入移动模式：棋子半透明悬浮
    }, LONG_PRESS_MS);
  };

  const onTokenDragMove = (cid: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (!pressRef.current || pressRef.current.cid !== cid) return;
    if (!armRef.current) {
      // 未长按就大幅移动：视为快速滑动（不移动棋子），取消长按
      const st = pressRef.current;
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > CELL) clearLongPress();
      return;
    }
    // 已长按：进入移动
    const st = pressRef.current;
    if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > CELL) dragOn.current = true;
    const cell = cellFromEvent(e.clientX, e.clientY);
    if (cell) setDragCell({ cid, cell });
  };

  const onTokenDragEnd = (cid: string, e: React.PointerEvent<HTMLDivElement>) => {
    clearLongPress();
    setMoveMode(null);
    if (!pressRef.current || pressRef.current.cid !== cid) {
      pressRef.current = null;
      armRef.current = false;
      return;
    }
    if (armRef.current) {
      // 长按后拖到新格且与起点不同 → 生成可编辑路径，等待点击确认落地
      const cell = cellFromEvent(e.clientX, e.clientY);
      const start = startOf(cid);
      if (dragOn.current && cell && start && !(cell.x === start.x && cell.y === start.y)) {
        const mover = moverOf(cid);
        const limit = mover ? effectiveMoveLimit(mover) : 6;
        const size = mover?.size ?? 1;
        const bp = limit > 0 ? buildPath(start, cell, limit, cols, rows, blockedFor(cid), wallSet, costOf, size) : { path: [], cost: 0, dist: 0, limited: true };
        setEditor({ cid, path: bp.path, dist: bp.dist, limited: bp.limited });
        setShiftMove(false); // 新路径重置快步 toggle
      }
      setDragCell(null);
    }
    pressRef.current = null;
    armRef.current = false;
  };

  // ---------- 锚点拖拽重路由 ----------
  // 思路：把要拖动的锚点作为唯一间接点，整体重算「起点 → 该锚点 → 终点」两段最短路径。
  // 拖终点锚点则只算「起点 → 终点」。不把其它中间锚点当硬性约束，
  // 避免多垂锚点互相拉扯而“织网”。新路径的每个格子仍会派生为可再拖的锚点。
  const onAnchorDown = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (!editor) return;
    e.preventDefault();
    e.stopPropagation();
    anchorIndex.current = index;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onAnchorMove = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (anchorIndex.current !== index || !editor) return;
    const cell = cellFromEvent(e.clientX, e.clientY);
    if (!cell) return;
    rerouteEditor(index, cell);
  };
  const onAnchorUp = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (anchorIndex.current === index) {
      const cell = cellFromEvent(e.clientX, e.clientY);
      if (cell && editor) rerouteEditor(index, cell);
    }
    anchorIndex.current = -1;
  };
  const rerouteEditor = (index: number, cell: Point) => {
    setEditor((cur) => {
      if (!cur) return cur;
      const start = startOf(cur.cid);
      const mover = moverOf(cur.cid);
      if (!start || !mover) return cur;
      const limit = effectiveMoveLimit(mover);
      if (limit <= 0) return { cid: cur.cid, path: [], dist: 0, limited: true };
      const isEndAnchor = index >= cur.path.length - 1;
      const end = cur.path[cur.path.length - 1];
      const blocked = blockedFor(cur.cid);
      const segs: Point[] = [];
      let lim = false;
      let spent = 0;
      const pushSegment = (a: Point, b: Point) => {
        if (a.x === b.x && a.y === b.y) return;
        const bp = buildPath(a, b, Math.max(1, limit - spent), cols, rows, blocked, wallSet, costOf, mover.size);
        if (bp.limited && bp.path.length === 0) lim = true;
        segs.push(...bp.path);
        spent += bp.cost;
      };
      pushSegment(start, cell);
      if (!isEndAnchor && end) pushSegment(cell, end);
      return { cid: cur.cid, path: segs, dist: segs.length, limited: lim };
    });
  };

  // ----- 路径格 / 效果线 / 锚点 -----
  const pathCells = activePreview
    ? activePreview.path.map((p, i) => {
        const last = i === activePreview.path.length - 1;
        return (
          <div
            key={"p" + i}
            className={"es-move-path" + (last ? " es-move-path-end" : "")}
            style={{ left: p.x * CELL, top: p.y * CELL, width: CELL, height: CELL }}
          />
        );
      })
    : [];

  const polylinePoints = activePreview
    ? activePreview.path
        .map((p, i) => {
          if (i === 0) return "";
          return `${p.x * CELL + CELL / 2},${p.y * CELL + CELL / 2}`;
        })
        .join(" ")
    : "";

  // 锚点：仅编辑路径（拖拽确认待落）时，在每格中心显示可拖动圆点
  const anchorDots =
    editor && editor.path.length > 0
      ? editor.path.map((p, i) => (
          <div
            key={"a" + i}
            className="es-anchor"
            style={{ left: p.x * CELL + CELL / 2, top: p.y * CELL + CELL / 2 }}
            onPointerDown={(e) => onAnchorDown(i, e)}
            onPointerMove={(e) => onAnchorMove(i, e)}
            onPointerUp={(e) => onAnchorUp(i, e)}
            onPointerCancel={(e) => onAnchorUp(i, e)}
          />
        ))
      : [];

  const moving = activePreview ? combatants.find((c) => c.cid === activePreview.cid) ?? null : null;
  const moveEnd = activePreview && activePreview.path.length > 0 ? activePreview.path[activePreview.path.length - 1] : null;

  // 确认/取消操作（拖拽编辑用本地，两步式用 App）。路径非法时仍显示，但确认按钮禁用。
  const confirmHandler = () => {
    if (!legal.ok) return; // 非法时确认不生效
    if (editor && moveEnd) {
      const from = moverOf(editor.cid)?.pos;
      if (from) animRef.current = { cid: editor.cid, from, path: editor.path }; // 记录待播放的移动动画
      onMoveTokenTo(editor.cid, moveEnd, editor.path, shiftMove); // 批 2-3：快步标记传入（不引发借机）
      setEditor(null);
      setShiftMove(false);
    } else if (!dragConflict) {
      onConfirmMove();
    }
  };

  // 确认移动后，沿路径用 transform 播放滑动动画（不改状态，结束后归零）
  useLayoutEffect(() => {
    const a = animRef.current;
    if (!a) return;
    animRef.current = null;
    const el = tokenEls.current.get(a.cid);
    const mover = combatants.find((c) => c.cid === a.cid);
    if (!el || !mover || !mover.pos || a.path.length === 0) return;
    const fin = mover.pos;
    const kf: Keyframe[] = [
      { transform: `translate3d(${(a.from.x - fin.x) * CELL}px, ${(a.from.y - fin.y) * CELL}px, 0)`, offset: 0 },
      ...a.path.map((p, i) => ({
        transform: `translate3d(${(p.x - fin.x) * CELL}px, ${(p.y - fin.y) * CELL}px, 0)`,
        offset: (i + 1) / a.path.length,
      })),
    ];
    el.animate(kf, { duration: Math.max(220, a.path.length * 120), easing: "ease-in-out" });
  }, [combatants]);
  const cancelHandler = () => {
    if (editor) {
      setEditor(null);
      setShiftMove(false);
    } else if (!dragConflict) onCancelMove();
  };

  // 有路径即显示按钮（哪怕非法）；按钮定位到落点格上方，避免与终点锚点重叠。
  // 落点在顶行时改为落到格子下方，防止超出地图被裁剪。
  const lastCell = activePreview && activePreview.path.length > 0 ? activePreview.path[activePreview.path.length - 1] : null;
  const placeBelow = !!lastCell && lastCell.y === 0;
  const showActions = !!activePreview && activePreview.path.length > 0 && !!lastCell;
  const moveActions = showActions ? (
    <div
      className={"es-move-actions" + (placeBelow ? " below" : "")}
      style={{
        left: lastCell!.x * CELL + CELL / 2,
        top: placeBelow ? (lastCell!.y + 1) * CELL : lastCell!.y * CELL,
      }}
    >
      {/* 批 2-3：1 格移动显示「快步」toggle（不引发借机攻击） */}
      {showActions && ((editor && editor.path.length === 1) || (!dragConflict && activePreview!.path.length === 1)) && (
        <button
          className={"es-move-shift" + (shiftMove ? " on" : "")}
          title="快步：只移动 1 格，不引发借机攻击"
          onClick={(e) => {
            e.stopPropagation();
            setShiftMove((v) => !v);
          }}
        >
          快步
        </button>
      )}
      <button className="es-move-confirm" disabled={!legal.ok} title={legal.ok ? "确认移动" : "路径不合法，无法确认"} onClick={(e) => { e.stopPropagation(); confirmHandler(); }}>✓</button>
      <button className="es-move-cancel" title="取消" onClick={(e) => { e.stopPropagation(); cancelHandler(); }}>×</button>
    </div>
  ) : null;

  const invalidHint =
    !dragConflict
      ? null
      : activePreview && activePreview.path.length === 0
        ? "无法移动到目标格（落点不可达或目标已封闭）"
        : activePreview && !legal.ok
          ? "路径不合法：" + (legal.reason ?? "落点不可达，请调整锚点。")
          : null;

  // 网格底格
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      cells.push(
        <div
          key={`${x}-${y}`}
          className="es-cell"
          style={{ gridColumn: x + 1, gridRow: y + 1 }}
          onClick={() => {
            // 拖动涂抹后：click 随手势而来，吞掉防双上色；未拖动（单击）时走正常切换
            if (paintGuardRef.current) return;
            onCellClick(x, y);
          }}
          onPointerDown={(e) => {
            if (!sceneTool) return;
            e.preventDefault(); // 阻止拖动过程中的文本选择 / 图片拖拽等默认行为
            paintingRef.current = true;
            lastPaintCellRef.current = `${x},${y}`;
            dragPaintedRef.current = false;
          }}
        />,
      );
    }
  }

  // 涂色层（批 5）：按格渲染用户涂抹的地图底色，位于地形覆盖层（z-index:1）之下
  const colorCells = Object.entries(cellColors).map(([k, color]) => {
    const [ox, oy] = k.split(",").map((n) => parseInt(n, 10));
    if (Number.isNaN(ox) || Number.isNaN(oy)) return null;
    return (
      <div
        key={"cc" + k}
        className="es-cell-color"
        style={{ left: ox * CELL, top: oy * CELL, width: CELL, height: CELL, backgroundColor: color }}
      />
    );
  });

  // 障碍格
  const obstacleCells = [...obstacles].map((k) => {
    const [ox, oy] = k.split(",").map((n) => parseInt(n, 10));
    if (Number.isNaN(ox) || Number.isNaN(oy)) return null;
    return (
      <div
        key={"o" + k}
        className="es-obstacle"
        style={{ left: ox * CELL, top: oy * CELL, width: CELL, height: CELL }}
      />
    );
  });

  // 物体目标 HP 徽标（批 4-4a-3）：被攻击过的墙/陷阱显示剩余 HP；完好的不显示避免遮挡
  const objectBadges = Object.values(objects)
    .filter((o) => o.hp < o.maxHp)
    .map((o) => (
      <div
        key={"ob" + o.id}
        className={"es-object-hp" + (o.hp <= 0 ? " broken" : "")}
        style={{ left: o.x * CELL, top: o.y * CELL, width: CELL, height: CELL }}
        title={`${o.name}：${o.hp}/${o.maxHp}（AC ${o.ac} / 强韧 ${o.fort} / 反射 ${o.ref}）`}
      >
        <span>{o.hp <= 0 ? "破" : `${o.hp}/${o.maxHp}`}</span>
      </div>
    ));

  // 困难地形格
  const difficultCells = [...difficult].map((k) => {
    const [ox, oy] = k.split(",").map((n) => parseInt(n, 10));
    if (Number.isNaN(ox) || Number.isNaN(oy)) return null;
    return (
      <div
        key={"d" + k}
        className="es-difficult"
        style={{ left: ox * CELL, top: oy * CELL, width: CELL, height: CELL }}
      />
    );
  });

  // 遮蔽层（轻迷雾 / 重迷雾 / 黑暗）
  const fogCells = Object.entries(fog).map(([k, level]) => {
    const [ox, oy] = k.split(",").map((n) => parseInt(n, 10));
    if (Number.isNaN(ox) || Number.isNaN(oy)) return null;
    return (
      <div
        key={"f" + k}
        className={"es-fog es-fog-" + level}
        style={{ left: ox * CELL, top: oy * CELL, width: CELL, height: CELL }}
      />
    );
  });

  // 通用：把一组"x,y"格渲染为指定 class 的覆盖层
  const terrainCells = (set: Set<string>, cls: string, prefix: string) =>
    [...set].map((k) => {
      const [ox, oy] = k.split(",").map((n) => parseInt(n, 10));
      if (Number.isNaN(ox) || Number.isNaN(oy)) return null;
      return (
        <div key={prefix + k} className={cls} style={{ left: ox * CELL, top: oy * CELL, width: CELL, height: CELL }} />
      );
    });

  // 当前场景画笔的悬停提示文案（擦除/涂色为清除/上色工具，不称"绘制"）
  const sceneHint = sceneTool
    ? (sceneTool === "erase" || sceneTool === "color" ? TERRAIN_TOOLS.find((t) => t.key === sceneTool)?.label + "模式：" : TERRAIN_TOOLS.find((t) => t.key === sceneTool)?.label + "绘制模式：") +
      TERRAIN_TOOLS.find((t) => t.key === sceneTool)?.desc
    : null;

  // Ctrl+滚轮缩放（Excel 式）：普通滚轮不拦截、交由 es-map-wrap 原生滚动（纵向；Shift/横向滚轮 → 横向）
  const handleMapWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const z0 = zoom;
    const z1 = Math.max(0.5, Math.min(2, Math.round((z0 + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
    if (z1 === z0) return;
    const wrap = wrapRef.current;
    if (!wrap) { setZoom(z1); return; }
    const k = z1 / z0;
    const wr = wrap.getBoundingClientRect();
    const dispX = e.clientX - wr.left;
    const dispY = e.clientY - wr.top;
    // 缩放前后保持光标下的网格点不动：换算该点在表面坐标的位置，再写回 scrollLeft/scrollTop
    const targetSX = GUTTER_W + (wrap.scrollLeft + dispX - GUTTER_W) * k;
    const targetSY = GUTTER_H + (wrap.scrollTop + dispY - GUTTER_H) * k;
    setZoom(z1);
    requestAnimationFrame(() => { wrap.scrollLeft = targetSX - dispX; wrap.scrollTop = targetSY - dispY; });
  };

  // 复制地图为 PNG 到剪贴板：整体捕获 es-map-scale（列标栏/行标栏/网格一体），
  // 行列标由浏览器按页面样式原生渲染，与格子像素级对齐（无需 canvas 手绘，避免样式差异）；
  // 捕获期间临时把 colhead/rowhead 从 sticky 改为 absolute 定位、尺寸改为无缩放格宽(CELL)，
  // 行标文字临时居中（页面默认右对齐），es-map transform:none + 背景 z-index 提升；生成中遮罩盖住布局变化，捕获后全部还原；
  // 剪贴板写入受浏览器焦点/权限限制（如 "Document is not focused"），失败时自动降级为下载 PNG 文件
  const copyMapToClipboard = async () => {
    const el = mapRef.current;
    if (!el) return;
    const scaleEl = el.parentElement as HTMLElement | null;
    if (!scaleEl) return;
    // 抢回文档焦点：Chrome 的 clipboard.write 要求 "Document is focused"，
    // 若焦点跑了（如点过 DevTools/地址栏）会直接抛错，先同步聚焦一次
    try {
      if (!document.hasFocus()) window.focus();
    } catch { /* 忽略跨域/策略限制 */ }
    const pr = 2; // 导出像素比
    const BORDER = 2; // es-map 边框宽（styles.css .es-map border: 2px）
    setMapCopying(true); // 生成中遮罩：盖住捕获瞬间布局变化，避免画面闪烁
    // 收集临时改动（捕获期间统一为"无缩放 + 绝对定位"，finally 全部还原）
    const saved: Array<[HTMLElement, string, string]> = [];
    const setTmp = (e: HTMLElement, prop: string, val: string) => {
      saved.push([e, prop, e.style.getPropertyValue(prop)]);
      e.style.setProperty(prop, val, "important");
    };
    const prevTransform = el.style.transform;
    el.style.transform = "none"; // 去除 scale，避免 html-to-image 双重缩放
    // 背景图 z-index:-1 会被 html-to-image 的 foreignObject 渲染丢弃（负 z-index 元素不可见），
    // 捕获期间临时把背景提升到 z-index:0：仍低于地形(1)/token(3)/虚线网格(4)，只盖住 static 的格子层
    const bgEl = el.querySelector<HTMLElement>(".es-map-bg");
    const prevBgZ = bgEl?.style.zIndex;
    if (bgEl) bgEl.style.zIndex = "0";
    try {
      // es-map-scale：临时撑开为无缩放尺寸（含边框），避免右/下边缘裁剪
      setTmp(scaleEl, "width", `${GUTTER_W + cols * CELL + BORDER * 2}px`);
      setTmp(scaleEl, "height", `${GUTTER_H + rows * CELL + BORDER * 2}px`);
      // 列标栏：sticky → absolute 固定到顶部，坐标从缩放值(C)改为原始格宽(CELL)
      const colhead = scaleEl.querySelector<HTMLElement>(".es-map-colhead");
      if (colhead) {
        setTmp(colhead, "position", "absolute");
        setTmp(colhead, "left", `${GUTTER_W}px`);
        setTmp(colhead, "top", "0");
        setTmp(colhead, "margin", "0");
        setTmp(colhead, "width", `${cols * CELL}px`);
        setTmp(colhead, "height", `${GUTTER_H}px`);
        colhead.querySelectorAll<HTMLElement>(".es-coord-col").forEach((elc) => {
          const i = Math.round(parseFloat(elc.style.left) / C);
          setTmp(elc, "left", `${i * CELL}px`);
          setTmp(elc, "width", `${CELL}px`);
        });
      }
      // 行标栏：sticky → absolute 固定到左侧，坐标改为原始格高(CELL)，文字临时居中（页面默认右对齐）
      const rowhead = scaleEl.querySelector<HTMLElement>(".es-map-rowhead");
      if (rowhead) {
        setTmp(rowhead, "position", "absolute");
        setTmp(rowhead, "left", "0");
        setTmp(rowhead, "top", `${GUTTER_H}px`);
        setTmp(rowhead, "width", `${GUTTER_W}px`);
        setTmp(rowhead, "height", `${rows * CELL}px`);
        rowhead.querySelectorAll<HTMLElement>(".es-coord-row").forEach((elr) => {
          const i = Math.round(parseFloat(elr.style.top) / C);
          setTmp(elr, "top", `${i * CELL}px`);
          setTmp(elr, "height", `${CELL}px`);
          setTmp(elr, "justifyContent", "center");
          setTmp(elr, "textAlign", "center");
          setTmp(elr, "paddingRight", "0");
        });
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // 等两帧，让无缩放布局生效
      // cacheBust:false —— 背景图是 blob: URL（IndexedDB 缓存），加 query 会破坏 blob 取回
      const mapCanvas = await toCanvas(scaleEl, { backgroundColor: "#ffffff", pixelRatio: pr, cacheBust: false, skipFonts: true });
      const blob = await new Promise<Blob>((res, rej) => mapCanvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG 编码失败"))), "image/png"));
      try {
        if (!navigator.clipboard?.write) throw new Error("浏览器不支持剪贴板写入");
        // 生成耗时期间焦点可能已跑掉，写入前再抢一次焦点并等一帧（Chrome 要求 Document is focused）
        if (!document.hasFocus()) window.focus();
        await new Promise((r) => requestAnimationFrame(r));
        await Promise.race([
          navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("剪贴板写入超时")), 5000)),
        ]);
        setMapCopied(true);
        setTimeout(() => setMapCopied(false), 1500);
      } catch (err) {
        // 剪贴板不可用（文档失焦/权限拒绝）→ 降级为下载 PNG 文件
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "map-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".png";
        a.click();
        URL.revokeObjectURL(url);
        alert("剪贴板写入失败（" + (err instanceof Error ? err.message : String(err)) + "），已改为下载 PNG 图片。");
      }
    } catch (err) {
      alert("生成地图图片失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      for (const [e, prop, val] of saved) {
        if (val) e.style.setProperty(prop, val);
        else e.style.removeProperty(prop);
      }
      if (bgEl) bgEl.style.zIndex = prevBgZ ?? "";
      el.style.transform = prevTransform;
      setMapCopying(false);
    }
  };

  return (
    <>
      <div ref={wrapRef} className="es-map-wrap">
      {/* 缩放容器：按 CELL*zoom 撑开真实尺寸供原生滚动；内含冻结行列标注 + 网格（网格 transform: scale 缩放） */}
      <div className="es-map-scale" style={{ width: GUTTER_W + cols * C, height: GUTTER_H + rows * C }}>
        {/* 左上角（含义格）：冻结固定 */}
        <div className="es-map-corner" />
        {/* 顶部列标 A/B/C…：sticky 顶部 + 横向随列滚动，始终可见 */}
        <div className="es-map-colhead" style={{ width: cols * C, height: GUTTER_H }}>
          {Array.from({ length: cols }, (_, i) => (
            <div key={"cl" + i} className="es-coord es-coord-col" style={{ left: i * C, width: C, margin: 0 }}>
              {indexToLabel(i)}
            </div>
          ))}
        </div>
        {/* 左侧行标 1/2/3…：sticky 左侧 + 纵向随行滚动，始终可见 */}
        <div className="es-map-rowhead" style={{ width: GUTTER_W, height: rows * C }}>
          {Array.from({ length: rows }, (_, i) => (
            <div key={"rl" + i} className="es-coord es-coord-row" style={{ top: i * C, height: C, margin: 0 }}>
              {i + 1}
            </div>
          ))}
        </div>
      <div
        ref={mapRef}
        className={"es-map" + (sceneTool ? " scene-editing" : "") + (dragCell || editor ? " dragging" : "") + (aim ? " aiming" : "") + (zoneBuild ? " zone-building" : "") + (mapBg ? " has-bg" : "")}
        style={{
          position: "absolute",
          left: GUTTER_W,
          top: GUTTER_H,
          gridTemplateColumns: `repeat(${cols}, ${CELL}px)`,
          gridTemplateRows: `repeat(${rows}, ${CELL}px)`,
          width: cols * CELL,
          height: rows * CELL,
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
        }}
        onWheel={handleMapWheel}
        onPointerMove={(e) => {
          // 画笔模式：按住左键拖动 → 划过的格连续涂抹（apply=true 只上色不切换，可延伸已画线条）；
          // 滑到新格才触发一次，同一格不重复涂
          if (paintingRef.current && sceneTool) {
            const cell = cellFromEvent(e.clientX, e.clientY);
            if (cell) {
              const key = cell.x + "," + cell.y;
              if (lastPaintCellRef.current !== key) {
                if (!dragPaintedRef.current) {
                  // 首次滑入新格：确定是拖动而非单击，起点格一并涂抹
                  dragPaintedRef.current = true;
                  const [sx, sy] = lastPaintCellRef.current!.split(",").map(Number);
                  onCellClick(sx, sy, true);
                }
                lastPaintCellRef.current = key;
                onCellClick(cell.x, cell.y, true);
              }
            }
            return;
          }
          if (!aim && !zoneBuild) return;
          setHoverCell(cellFromEvent(e.clientX, e.clientY));
        }}
        onPointerLeave={() => setHoverCell(null)}
        onContextMenu={(e) => {
          // 场景绘制模式下右键 → 退出绘制；待放置模式下右键 → 取消放置；区域放置模式下右键 → 取消放置；均阻止 token 右键菜单弹出
          if (sceneTool) {
            e.preventDefault();
            e.stopPropagation();
            onCancelSceneTool();
          } else if (pendingName) {
            e.preventDefault();
            e.stopPropagation();
            onCancelPendingPlace();
          } else if (zoneBuild) {
            e.preventDefault();
            e.stopPropagation();
            onCancelZoneBuild();
          }
        }}
      >
        {/* 地图背景图（导入地图）：置于方格下方（z-index:-1），保持纵横比不拉伸；对齐参数控制位置与缩放 */}
        {mapBg && (
          <img
            className="es-map-bg"
            src={mapBg}
            alt=""
            draggable={false}
            style={{
              left: mapBgAlign.offsetX,
              top: mapBgAlign.offsetY,
              // 宽度 = 基准宽度(baseW) * scale：与网格 cols 解耦，调整列数不拉伸背景图；旧档无 baseW 回退为当前网格宽
              width: (mapBgAlign.baseW ?? cols * CELL) * mapBgAlign.scale,
            }}
          />
        )}
        {/* 虚线对齐网格（导入地图后）：盖在所有图层最上方（z-index:4 > token 3），pointer-events:none 不挡交互；
           框选校准期间隐藏，避免与框选矩形干扰；校准结束（退出校准模式）后再显示 */}
        {mapBg && !calib && (
          <svg className="es-map-gridlines" width={cols * CELL} height={rows * CELL} style={{ opacity: mapBgAlign.gridOpacity ?? 1 }} aria-hidden="true">
            {Array.from({ length: cols + 1 }, (_, i) => (
              <g key={"gv" + i}>
                <line className="dark" x1={i * CELL} y1={0} x2={i * CELL} y2={rows * CELL} />
                <line className="light" x1={i * CELL} y1={0} x2={i * CELL} y2={rows * CELL} />
              </g>
            ))}
            {Array.from({ length: rows + 1 }, (_, i) => (
              <g key={"gh" + i}>
                <line className="dark" x1={0} y1={i * CELL} x2={cols * CELL} y2={i * CELL} />
                <line className="light" x1={0} y1={i * CELL} x2={cols * CELL} y2={i * CELL} />
              </g>
            ))}
          </svg>
        )}
        {/* 框选校准覆盖层：拦截所有交互，拖出矩形框住印刷网格的一个方格；松开后回调自动校准 */}
        {calib && (
          <div
            className="es-map-calib"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const el = mapRef.current;
              if (!el) return;
              const r = el.getBoundingClientRect();
              const x = (e.clientX - r.left) / zoom;
              const y = (e.clientY - r.top) / zoom;
              calibStart.current = { x, y };
              setCalibRect({ x, y, width: 0, height: 0 });
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const s = calibStart.current;
              const el = mapRef.current;
              if (!s || !el) return;
              const r = el.getBoundingClientRect();
              const x = (e.clientX - r.left) / zoom;
              const y = (e.clientY - r.top) / zoom;
              setCalibRect({
                x: Math.min(s.x, x),
                y: Math.min(s.y, y),
                width: Math.abs(x - s.x),
                height: Math.abs(y - s.y),
              });
            }}
            onPointerUp={() => {
              const rect = calibRect;
              calibStart.current = null;
              setCalibRect(null);
              if (rect && rect.width > 4 && rect.height > 4) onCalibRect(rect);
            }}
            onPointerCancel={() => {
              calibStart.current = null;
              setCalibRect(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCancelCalib();
            }}
          >
            <div className="es-map-calib-tip">在图片上框选印刷网格的一个方格（Esc / 右键取消）</div>
            {calibRect && calibRect.width > 0 && (
              <div
                className="es-map-calib-rect"
                style={{ left: calibRect.x, top: calibRect.y, width: calibRect.width, height: calibRect.height }}
              />
            )}
          </div>
        )}
        {cells}
        {colorCells}
        {obstacleCells}
        {objectBadges}
        {difficultCells}
        {fogCells}
        {terrainCells(water, "es-water", "w")}
        {terrainCells(chasm, "es-chasm", "c")}
        {terrainCells(traps, "es-trap", "t")}
        {/* 已放置的区域效果（zone=青绿覆盖；wall=青绿描边石纹）批 2b-3 */}
        {zones.flatMap((z) =>
          z.cells.map((k) => {
            const [zx, zy] = k.split(",").map(Number);
            if (Number.isNaN(zx) || Number.isNaN(zy)) return null;
            return (
              <div
                key={z.id + k}
                className={z.kind === "wall" ? "es-zone-wall" : "es-zone"}
                style={{ left: zx * CELL, top: zy * CELL, width: CELL, height: CELL }}
              />
            );
          }),
        )}
        {/* 放置期预览：已选格（zone=青绿覆盖；wall=青绿+序号+末格高亮）批 2b-4 */}
        {zoneBuild &&
          zoneBuild.seq.map((k, i) => {
            const [zx, zy] = k.split(",").map(Number);
            if (Number.isNaN(zx) || Number.isNaN(zy)) return null;
            const last = i === zoneBuild.seq.length - 1;
            return (
              <div
                key={"zb" + k}
                className={
                  (zoneBuild.kind === "wall" ? "es-zone-wall" : "es-zone") +
                  " placing" +
                  (zoneBuild.kind === "wall" && last ? " last" : "")
                }
                style={{ left: zx * CELL, top: zy * CELL, width: CELL, height: CELL }}
              >
                {zoneBuild.kind === "wall" && <span className="es-zone-seq">{i + 1}</span>}
              </div>
            );
          })}
        {/* 放置期 zone 悬停预览：以悬停格为中心的爆发格集（青绿半透明） */}
        {zoneHoverCells &&
          [...zoneHoverCells].map((k) => {
            const [zx, zy] = k.split(",").map(Number);
            if (Number.isNaN(zx) || Number.isNaN(zy)) return null;
            return (
              <div
                key={"zh" + k}
                className={"es-zone" + (zoneBuild?.seq.includes(k) ? " placed" : " hover")}
                style={{ left: zx * CELL, top: zy * CELL, width: CELL, height: CELL }}
              />
            );
          })}
        {/* 放置期 wall 悬停反馈：与上一格直连且可落 → 青绿；否则红标 */}
        {wallHoverState && !wallHoverState.ok && (
          <div
            className="es-zone-invalid hover"
            style={{ left: hoverCell!.x * CELL, top: hoverCell!.y * CELL, width: CELL, height: CELL }}
          />
        )}
        {/* 放置期校验失败红标（App 侧点击校验，如非法墙格） */}
        {invalidZoneCell &&
          (() => {
            const [zx, zy] = invalidZoneCell.split(",").map(Number);
            if (Number.isNaN(zx) || Number.isNaN(zy)) return null;
            return (
              <div
                className="es-zone-invalid"
                style={{ left: zx * CELL, top: zy * CELL, width: CELL, height: CELL }}
              />
            );
          })()}
        {sceneHint && <div className="es-obstacle-hint">{sceneHint}</div>}
        {pendingName && <div className="es-pending-hint">在地图上点击放置「{pendingName}」</div>}

        {combatants.map((c) =>
          c.pos ? (
            <div
              key={c.cid}
              ref={(el) => {
                if (el) tokenEls.current.set(c.cid, el);
                else tokenEls.current.delete(c.cid);
              }}
              className={
                "es-token" +
                (c.kind === "pc" ? " es-token-pc" : " es-token-monster") +
                (c.cid === selectedId ? " selected" : "") +
                (c.cid === currentCid ? " es-token-current" : "") +
                (c.hp <= 0 ? " dead" : c.hp <= c.bloodied ? " bloodied" : "") +
                (dragCell?.cid === c.cid || editor?.cid === c.cid ? " dragging" : "") +
                (moveMode === c.cid ? " moving" : "") +
                (aimMark ? (aimMark.ok.has(c.cid) ? " es-token-aim-ok" : aimMark.no.has(c.cid) ? " es-token-aim-no" : "") : "") +
                (forcedMove?.moverCid === c.cid ? " es-token-forced-active" : "") +
                (forcedMove && forcedMove.moved.includes(c.cid) ? " es-token-forced-moved" : "") +
                (bindTarget === c.cid ? " es-token-bind-target" : "") +
                (bindMaster === c.cid ? " es-token-bind-target" : "") +
                (isSummoned(c) ? " es-token-summon" : "")
              }
              style={{
                left: c.pos.x * CELL,
                top: c.pos.y * CELL,
                width: c.size * CELL,
                height: c.size * CELL,
                ...(c.color ? ({ "--tok-color": c.color } as React.CSSProperties) : {}),
                ...(moveMode === c.cid || dragCell?.cid === c.cid || editor?.cid === c.cid ? { zIndex: 8 } : {}),
              }}
              onPointerDown={(e) => onTokenDragStart(c.cid, e)}
              onPointerMove={(e) => onTokenDragMove(c.cid, e)}
              onPointerUp={(e) => onTokenDragEnd(c.cid, e)}
              onPointerCancel={(e) => {
                // 拖拽被系统中断：只清理拖拽状态，不生成待确认路径
                e.stopPropagation();
                clearLongPress();
                setMoveMode(null);
                pressRef.current = null;
                armRef.current = false;
                setDragCell(null);
              }}
              onClick={(e) => {
                e.stopPropagation();
                // 瞄准/绘制/区域模式不拖拽，dragOn 只可能在进入这些模式前被遗留为 true
                // （拖拽棋子后未清零）。此时绝不能把「点击目标」当成点击误触吞掉，
                // 否则瞄准中点击目标会毫无反应。非瞄准模式仍按原逻辑忽略拖拽后误触。
                if (dragOn.current && !aim && !sceneTool && !zoneBuild) return;
                onCellClick(c.pos!.x, c.pos!.y);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTokenMenu({ cid: c.cid, x: e.clientX, y: e.clientY, sub: null });
              }}
              onMouseEnter={(e) => {
                // hover 浮动卡（批 1-10）：绘制/瞄准/强制移动模式下不弹出，避免遮挡交互
                if (!sceneTool && !aim && !forcedMove) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setHoverCard({ cid: c.cid, x: r.left + r.width / 2, y: r.top });
                }
              }}
              onMouseLeave={() => setHoverCard((h) => (h?.cid === c.cid ? null : h))}
            >
              <span className="es-token-name">{c.name}</span>
              {isSummoned(c) && (
                <span className="es-token-summon-mark" title={c.summonerCid ? `召唤兽，绑定召出者：${summonerNameOf(c, combatants) ?? ""}` : "召唤兽（未绑定召出者）"}>
                  {c.summonerCid ? "召" : "唤"}
                </span>
              )}
              {seqOf.has(c.cid) && <span className="es-token-seq">{seqOf.get(c.cid)}</span>}
              {showHpBar && (
                <span className="es-token-hpbar">
                  <i style={{ width: `${Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100))}%` }} />
                </span>
              )}
              {c.conditions.length > 0 && (
                <span className="es-token-cond-row">
                  {c.conditions
                    .filter((k) => k !== "bloodied")
                    .map((k) => (
                      <span
                        key={k}
                        className={"es-token-cond" + (COND_HARM.has(k as ConditionKey) ? " es-token-cond--harm" : " es-token-cond--buff")}
                        title={CONDITION_LABEL[k as ConditionKey] ?? k}
                      >
                        {condShort(k)}
                      </span>
                    ))}
                </span>
              )}
            </div>
          ) : null,
        )}

        {invalidHint && <div className={"es-drop-invalid" + (legal.ok ? "" : " long")}>{invalidHint}</div>}

        {/* 强制移动方向模式：当前移动对象周围的 8 方向箭头（实时校验：灰暗=不可达，数字=可移格数；点箭头移动 1 格） */}
        {forcedArrows && (
          <div className="es-forced-arrows">
            {forcedArrows.arrows.map((a) => {
              const radius = (forcedArrows.size * CELL) / 2 + CELL * 0.85;
              const px = forcedArrows.center.x + a.dx * radius;
              const py = forcedArrows.center.y + a.dy * radius;
              return (
                <button
                  key={a.dx + "," + a.dy}
                  className={"es-forced-arrow" + (a.reach > 0 ? " ok" : " no")}
                  style={{ left: px, top: py }}
                  disabled={a.reach === 0}
                  title={a.reach > 0 ? `向${a.title}移动 ${a.reach} 格` : `向${a.title}：无法移动`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (a.reach > 0) onForcedMoveDir(forcedArrows.cid, a.dx, a.dy);
                  }}
                >
                  {a.label}
                  {a.reach > 0 && <span className="es-forced-arrow-n">{a.reach}</span>}
                </button>
              );
            })}
          </div>
        )}

        {pathCells}
        {activePreview && activePreview.path.length > 0 && (
          <svg className="es-move-line" width={cols * CELL} height={rows * CELL}>
            <polyline
              points={polylinePoints}
              fill="none"
              stroke={legal.ok ? "#f9c74f" : "#e5484d"}
              strokeWidth={4}
              strokeDasharray="2 8"
              strokeLinecap="round"
              filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))"
            />
          </svg>
        )}

        {/* 终点位置状态预览：半透明幽灵棋子 */}
        {moveEnd && moving && legal.ok && (
          <div
            className={"es-token es-token-ghost" + (moving.kind === "pc" ? " es-token-pc" : " es-token-monster")}
            style={{
              left: moveEnd.x * CELL,
              top: moveEnd.y * CELL,
              width: moving.size * CELL,
              height: moving.size * CELL,
            }}
          >
            <span className="es-token-name">{moving.name}</span>
          </div>
        )}

        {anchorDots}
        {moveActions}

        {/* 瞄准模式：范围 / 效果线覆盖层 */}
        {auraShape && (
          <svg className="es-aim-shapes" width={cols * CELL} height={rows * CELL}>
            <path className="es-aura-path" fillRule="evenodd" d={auraShape} />
          </svg>
        )}
        {aimShapes && (
          <svg className="es-aim-shapes" width={cols * CELL} height={rows * CELL}>
            {aimShapes.ring && <path className="es-aim-ring-path" fillRule="evenodd" d={aimShapes.ring} />}
            {aimShapes.cells && <path className="es-aim-cell-path" fillRule="evenodd" d={aimShapes.cells} />}
            {aimShapes.area && <path className="es-aim-area-path" fillRule="evenodd" d={aimShapes.area} />}
          </svg>
        )}
        {aimShapes?.sel && (
          <svg className="es-aim-shapes es-aim-shapes-sel" width={cols * CELL} height={rows * CELL}>
            <path className="es-aim-sel-path" fillRule="evenodd" d={aimShapes.sel} />
          </svg>
        )}
        {aimView && (
          <>
            {aimView.previewPoint && (
              <div
                className="es-aim-hover"
                style={{ left: aimView.previewPoint.x * CELL, top: aimView.previewPoint.y * CELL, width: CELL, height: CELL }}
              />
            )}
            {aimView.blastRect && (
              <div
                className="es-aim-cell es-aim-blast"
                style={{
                  left: aimView.blastRect.x * CELL,
                  top: aimView.blastRect.y * CELL,
                  width: aimView.blastRect.w * CELL,
                  height: aimView.blastRect.h * CELL,
                }}
              />
            )}
            {aimView.origin && (
              <div
                className="es-aim-origin"
                style={{ left: aimView.origin.x * CELL, top: aimView.origin.y * CELL, width: CELL, height: CELL }}
              />
            )}
            {aimView.lineTo && (
              <svg className="es-aim-line" width={cols * CELL} height={rows * CELL}>
                <line
                  x1={aimView.from.x * CELL + CELL / 2}
                  y1={aimView.from.y * CELL + CELL / 2}
                  x2={aimView.lineTo.x * CELL + CELL / 2}
                  y2={aimView.lineTo.y * CELL + CELL / 2}
                  stroke={aimView.lineOk ? "#4cc9f0" : "#e5484d"}
                  strokeWidth={3}
                  strokeDasharray="4 6"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </>
        )}

        {/* 放置期确认/取消条（批 2b-4）：zone=点中心后「完成」落地；wall=塑形 ≥2 格后「完成」落地 */}
        {zoneBuild && (
          <div className="es-zone-bar">
            <span className="es-zone-bar-label">
              {zoneBuild.kind === "wall"
                ? `塑形墙体【${zoneBuild.attack.name}】· 连续点击直连（≥2 格）`
                : `放置区域【${zoneBuild.attack.name}】· 点击选择中心`}
              {zoneBuild.seq.length > 0 && (
                <b>
                  {" · "}
                  {zoneBuild.kind === "wall" ? `已塑形 ${zoneBuild.seq.length} 格` : `已选 ${zoneBuild.seq.length} 格`}
                </b>
              )}
            </span>
            <button
              className="es-zone-confirm"
              disabled={!zoneBuildValid}
              title={zoneBuildValid ? "确认放置" : zoneBuild.kind === "wall" ? "墙至少需 2 格且直连无分叉" : "请先点击选择区域中心"}
              onClick={(e) => {
                e.stopPropagation();
                onConfirmZoneBuild();
              }}
            >
              完成
            </button>
            <button
              className="es-zone-cancel"
              title="取消放置"
              onClick={(e) => {
                e.stopPropagation();
                onCancelZoneBuild();
              }}
            >
              取消 ✕
            </button>
          </div>
        )}

        </div>
      </div>
      {/* 复制地图生成中遮罩：盖住捕获瞬间 transform:none 的布局变化，避免画面闪烁 */}
      {mapCopying && (
        <div className="es-map-copying">
          <span>正在生成地图图片…</span>
        </div>
      )}
      {/* 瞄准结算条：置于滚动容器外（与缩放控件同级，锚定 es-map-area），地图平移/缩放时始终可见 */}
      {aim && (
        <div className="es-aim-bar">
          <span className="es-aim-label">{aimView?.label ?? "…"}</span>
          {aimSel.length > 0 && (
            <div className="es-aim-strip">
              {aimSel.map((cid) => {
                const c = combatants.find((x) => x.cid === cid);
                if (!c) {
                  // 批 4-4a-3：物体目标（墙/陷阱）同样显示为可移除的已选芯片
                  const o = objects[cid];
                  if (!o) return null;
                  return (
                    <span
                      key={cid}
                      className="es-aim-chip es-aim-chip-obj"
                      title="点击移除该目标"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAimSel(cid);
                      }}
                    >
                      {o.name}（{o.x + 1},{o.y + 1}）<i>✕</i>
                    </span>
                  );
                }
                return (
                  <span
                    key={cid}
                    className="es-aim-chip"
                    title="点击移除该目标"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveAimSel(cid);
                    }}
                  >
                    {c.name} <i>✕</i>
                  </span>
                );
              })}
            </div>
          )}
          {aimSel.length > 0 && aimSpec && (
            <span className="es-aim-selected">
              已选：{aimSel.length}/{aimSpec.max}
            </span>
          )}
          {aimSpec && aimSel.length >= aimSpec.min && aimSel.length < aimSpec.max && (
            <button
              className="es-aim-confirm"
              onClick={(e) => {
                e.stopPropagation();
                onConfirmAim();
              }}
            >
              确认
            </button>
          )}
          <button
            className="es-aim-cancel"
            onClick={(e) => {
              e.stopPropagation();
              onCancelAim();
            }}
          >
            取消瞄准 ✕
          </button>
        </div>
      )}
    </div>
      {/* 缩放控件：置于滚动容器 es-map-wrap 之外，absolute 锚定 es-map-area 右下角（见 styles.css），不随地图滚动/缩放偏移 */}
      <div className="es-map-zoom-controls" title="Ctrl+滚轮或点击缩放地图">
        <button className="es-map-zoom-btn es-map-copy-btn" onClick={copyMapToClipboard} title={mapCopied ? "已复制地图为 PNG" : "复制地图为 PNG 图片到剪贴板"}>
          <span className={"material-symbols-outlined" + (mapCopied ? " check" : "")}>{mapCopied ? "check" : "image"}</span>
        </button>
        <button className="es-map-zoom-btn" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}>
          −
        </button>
        <span className="es-map-zoom-pct">{Math.round(zoom * 100)}%</span>
        <button className="es-map-zoom-btn" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))}>
          +
        </button>
        <button className="es-map-zoom-btn es-map-zoom-reset" onClick={() => {
          setZoom(1);
          if (wrapRef.current) { wrapRef.current.scrollLeft = 0; wrapRef.current.scrollTop = 0; }
        }} title="重置缩放与滚动">
          ⟳
        </button>
        {/* 背景图对齐重开按钮（导入地图后显示；对齐面板可能被关闭，随时可重新打开） */}
        {mapBg && (
          <button className="es-map-zoom-btn es-map-bg-align-btn" onClick={onOpenMapBg} title="背景对齐">
            <span className="material-symbols-outlined">tune</span>
          </button>
        )}
      </div>
      {/* 右键快捷菜单：置于滚动/缩放容器之外，position:fixed 锚定视口，避免受 transform 影响 */}
      {tokenMenu && (
        <PortalMenu
          menu={tokenMenu}
          combatants={combatants}
          currentCid={currentCid}
          onToggleCondition={onToggleCondition}
          onBindSummoner={onBindSummoner}
          onUnbindSummoner={onUnbindSummoner}
          onDismissSummon={onDismissSummon}
          onSetMaster={onSetMaster}
          onClearMaster={onClearMaster}
          onAction={onAction}
          onSelectCombatant={onSelectCombatant}
          onRemoveOngoing={onRemoveOngoing}
          onAddOngoing={onAddOngoing}
          onRemoveEffect={onRemoveEffect}
          onOpenRules={onOpenRules}
          onSetSub={(sub) => setTokenMenu((m) => (m ? { ...m, sub } : m))}
          onClose={() => setTokenMenu(null)}
        />
      )}
      {/* hover 浮动卡（批 1-10）：悬停棋子即显示 名称/HP(临时)/三防/状态+持续伤害（fixed 定位，避滚动裁剪） */}
      {hoverCard &&
        (() => {
          const c = combatants.find((x) => x.cid === hoverCard.cid);
          if (!c) return null;
          const conds = c.conditions.filter((k) => k !== "bloodied");
          const ongoing = c.ongoingDamage ?? [];
          return (
            <div className="es-token-hovercard" style={{ left: hoverCard.x, top: hoverCard.y }}>
              <div className="es-token-hover-name">{c.name}</div>
              <div className={"es-token-hover-hp" + (c.hp <= 0 ? " dead" : c.hp <= c.bloodied ? " low" : "")}>
                HP {c.hp}/{c.maxHp}
                {c.tempHp > 0 && <span className="es-token-hover-temp"> · 临时 +{c.tempHp}</span>}
                {c.hp <= 0 ? "（濒死）" : c.hp <= c.bloodied ? "（重伤）" : ""}
              </div>
              <div className="es-token-hover-def">
                AC {c.ac} · 强韧 {c.fort} · 反射 {c.ref} · 意志 {c.will}
              </div>
              {(conds.length > 0 || ongoing.length > 0 || (c.effects?.length ?? 0) > 0) && (
                <div className="es-token-hover-effects">
                  {conds.map((k) => (
                    <RuleTip
                      key={k}
                      kw={CONDITION_LABEL[k] ?? k}
                      onOpenRules={onOpenRules}
                      className={"es-token-hover-effect" + (COND_HARM.has(k) ? " harm" : " buff")}
                    >
                      {CONDITION_LABEL[k] ?? k}
                    </RuleTip>
                  ))}
                  {ongoing.map((od, i) => (
                    <span key={"od" + i} className="es-token-hover-effect harm">
                      持续{od.type ? DAMAGE_TYPE_LABEL[od.type as DamageType] ?? od.type : ""}伤害 {od.value}（豁免终止）
                    </span>
                  ))}
                  {/* 批 4b-4：已挂载效果（全防御/奔跑/标记/再生…）与右栏/数据栏同步展示 */}
                  {(c.effects ?? []).map((e, i) => (
                    <span key={"eff" + i} className="es-token-hover-effect buff" title={e.source ? `来源：${e.source}` : undefined}>
                      {e.label}
                      {e.duration ? `（${e.duration}）` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
    </>
  );
}

/** 右键菜单「行动」：基础动作快捷（批 4b-1，复用顶栏回调；仅当前行动者可用） */
const MENU_ACTIONS: { kind: BattleActionKind; label: string; slot: string; title: string; show: (c: Combatant) => boolean }[] = [
  { kind: "basic", label: "基本攻击", slot: "标准", title: "标准动作：用基本近战/远程武器攻击一个目标", show: () => true },
  { kind: "charge", label: "冲锋", slot: "标准", title: "标准动作：向目标冲去（至少 2 格、每格更近），到达后做基本近战攻击；冲锋中 AC -2", show: () => true },
  { kind: "rush", label: "冲撞", slot: "标准", title: "标准动作：对邻接目标力量 vs 强韧，命中将其推离 1 格", show: () => true },
  { kind: "defend", label: "全防御", slot: "标准", title: "标准动作：AC/强韧/反射/意志 +2 直到下回合开始", show: () => true },
  { kind: "wind", label: "回气", slot: "标准", title: "标准动作（每遭遇一次）：花费 1 次回复力回血，防御 +2 直到下回合开始", show: (c) => (c.surgesLeft ?? 0) > 0 },
  { kind: "run", label: "奔跑", slot: "移动", title: "移动动作：速度 +2、攻击骰 -5、对敌提供战斗优势（直到下回合开始）", show: () => true },
  { kind: "stand", label: "起身", slot: "移动", title: "移动动作：从倒地状态站起", show: (c) => c.conditions.includes("prone") },
  { kind: "prone", label: "卧倒", slot: "次要", title: "次要动作：主动倒地（对近战提供战斗优势、远程防御 +2）", show: (c) => !c.conditions.includes("prone") },
];

/** 右键快捷菜单（固定定位到视口坐标；含全屏遮罩用于点击关闭） */
function PortalMenu({
  menu,
  combatants,
  currentCid,
  onToggleCondition,
  onBindSummoner,
  onUnbindSummoner,
  onDismissSummon,
  onSetMaster,
  onClearMaster,
  onAction,
  onSelectCombatant,
  onRemoveOngoing,
  onAddOngoing,
  onRemoveEffect,
  onOpenRules,
  onSetSub,
  onClose,
}: {
  menu: TokenMenu;
  combatants: Combatant[];
  currentCid: string | null;
  onToggleCondition: (cid: string, k: ConditionKey) => void;
  onBindSummoner: (cid: string) => void;
  onUnbindSummoner: (cid: string) => void;
  onDismissSummon: (cid: string) => void;
  onSetMaster: (cid: string) => void;
  onClearMaster: (cid: string) => void;
  onAction: (kind: BattleActionKind) => void;
  onSelectCombatant: (cid: string) => void;
  onRemoveOngoing: (cid: string, index: number) => void;
  onAddOngoing: (cid: string, od: OngoingDamage) => void;
  onRemoveEffect: (cid: string, index: number) => void;
  onOpenRules: (keyword: string) => void;
  onSetSub: (sub: "status" | "action" | "effect" | "data" | null) => void;
  onClose: () => void;
}) {
  const c = combatants.find((x) => x.cid === menu.cid);
  const [addingOd, setAddingOd] = useState(false);
  const [odType, setOdType] = useState("fire");
  const [odVal, setOdVal] = useState(5);
  const [odSaveOn, setOdSaveOn] = useState<"end" | "start">("end");
  if (!c) return null;
  // 批 6f：该棋子是否作为「依赖外部主人」的守护者（其任一威能效果引用「主人」）→ 显示设定主人/清除主人入口
  const needsMaster = (c.attacks ?? []).some((a) => `${a.effectText ?? ""}${a.hit ?? ""}${a.trigger ?? ""}`.includes("主人"));
  const W = 248;
  const subH: Record<string, number> = { status: 330, action: 320, effect: 420, data: 210 };
  const H = menu.sub ? subH[menu.sub] ?? 160 : 260;
  const x = Math.max(0, Math.min(menu.x, window.innerWidth - W - 8));
  const y = Math.max(0, Math.min(menu.y, window.innerHeight - H - 8));
  const isActor = c.cid === currentCid;
  const conds = c.conditions.filter((k) => k !== "bloodied");
  const ongoing = c.ongoingDamage ?? [];
  const effects = c.effects ?? [];
  const doAction = (kind: BattleActionKind) => {
    onClose();
    onAction(kind);
  };
  return (
    <>
      <div className="es-token-menu-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="es-token-menu" style={{ left: x, top: y }}>
        <div className="es-token-menu-head">{c.name}</div>
        {menu.sub === null && (
          <>
            <button className="es-token-menu-item" onClick={() => onSetSub("status")}>
              状态
            </button>
            <button className="es-token-menu-item" onClick={() => onSetSub("action")}>
              行动
            </button>
            <button className="es-token-menu-item" onClick={() => onSetSub("effect")}>
              效果
            </button>
            <button
              className="es-token-menu-item"
              onClick={() => {
                onClose();
                onSelectCombatant(menu.cid);
              }}
            >
              数据
            </button>
            {/* 批 4-4a-4：坐骑战斗评估——大型+生物可为坐骑，但骑手共享空间/动作等规则未自动化，标注 DM 裁决 */}
            {(c.size ?? 1) >= 2 && (
              <div className="es-token-menu-item es-token-menu-disabled" title="坐骑规则（骑手进入坐骑空间、共享空间/动作、冲锋/倒地等）未自动化，由 DM 按万律书裁决。">
                坐骑战斗：DM 裁决
              </div>
            )}
            {/* 批 4-4a-2：召唤兽专属操作——绑定召出者/解除绑定/解除召唤 */}
            {isSummoned(c) && !c.summonerCid && (
              <button
                className="es-token-menu-item"
                onClick={() => {
                  onClose();
                  onBindSummoner(menu.cid);
                }}
              >
                绑定召出者…
              </button>
            )}
            {isSummoned(c) && c.summonerCid && (
              <button
                className="es-token-menu-item"
                title="不再随召出者先攻/移除"
                onClick={() => {
                  onClose();
                  onUnbindSummoner(menu.cid);
                }}
              >
                解除绑定召出者
              </button>
            )}
            {isSummoned(c) && (
              <button
                className="es-token-menu-item es-token-menu-danger"
                title="手动移除该召唤兽"
                onClick={() => {
                  onClose();
                  onDismissSummon(menu.cid);
                }}
              >
                解除召唤
              </button>
            )}
            {/* 批 6f：守护者绑定主人（依赖外部主人才能自动结算） */}
            {needsMaster && !c.masterCid && (
              <button
                className="es-token-menu-item"
                title="该守护者的灵气/特性围绕「主人」结算，需先指定一个在场棋子为主人"
                onClick={() => {
                  onClose();
                  onSetMaster(menu.cid);
                }}
              >
                设定主人…
              </button>
            )}
            {needsMaster && c.masterCid && (
              <button
                className="es-token-menu-item"
                title="解除主从绑定，改由 DM 裁决"
                onClick={() => {
                  onClose();
                  onClearMaster(menu.cid);
                }}
              >
                清除主人绑定
              </button>
            )}
          </>
        )}
        {menu.sub === "status" && (
          <div className="es-token-status">
            <div className="es-token-status-head">
              状态调整
              <button className="es-token-status-back" onClick={() => onSetSub(null)}>←</button>
            </div>
            <div className="es-token-conds">
              {ALL_CONDITIONS.filter((k) => k !== "bloodied").map((k) => (
                <button
                  key={k}
                  className={"es-cond" + (c.conditions.includes(k) ? " on" : "")}
                  onClick={() => onToggleCondition(menu.cid, k)}
                >
                  {CONDITION_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
        )}
        {menu.sub === "action" && (
          <div className="es-token-status">
            <div className="es-token-status-head">
              行动
              <button className="es-token-status-back" onClick={() => onSetSub(null)}>←</button>
            </div>
            {!isActor && <div className="es-token-menu-note">仅当前行动者（回合中）可执行基础动作。</div>}
            <div className="es-token-actions">
              {MENU_ACTIONS.filter((a) => a.show(c)).map((a) => (
                <button
                  key={a.kind}
                  className="es-token-menu-item es-token-menu-action"
                  disabled={!isActor}
                  title={a.title}
                  onClick={() => doAction(a.kind)}
                >
                  {a.label}
                  <span className="es-token-action-slot">{a.slot}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {menu.sub === "effect" && (
          <div className="es-token-status">
            <div className="es-token-status-head">
              当前效果
              <button className="es-token-status-back" onClick={() => onSetSub(null)}>←</button>
            </div>
            <div className="es-token-efflist">
              {conds.length === 0 && ongoing.length === 0 && effects.length === 0 && (
                <div className="es-token-menu-note">暂无状态/持续伤害/挂载效果。</div>
              )}
              {conds.length > 0 && (
                <div className="es-token-effgroup">
                  <div className="es-token-effgroup-label">状态（用「状态」菜单调整）</div>
                  <div className="es-token-conds es-token-conds-ro">
                    {conds.map((k) => (
                      <RuleTip
                        key={k}
                        kw={CONDITION_LABEL[k] ?? k}
                        onOpenRules={onOpenRules}
                        className="es-cond on"
                      >
                        {CONDITION_LABEL[k]}
                      </RuleTip>
                    ))}
                  </div>
                </div>
              )}
              {ongoing.length > 0 && (
                <div className="es-token-effgroup">
                  <div className="es-token-effgroup-label">持续伤害（豁免终止）</div>
                  {ongoing.map((od, i) => (
                    <div key={i} className="es-token-effrow" title={od.note ?? "点击 ✕ 移除"}>
                      <span className="es-token-efflabel">
                        {od.type ? DAMAGE_TYPE_LABEL[od.type as DamageType] ?? od.type : "无类型"} {od.value}
                        <em>{od.saveOn === "start" ? "回合开始豁免" : "回合结束豁免"}</em>
                      </span>
                      <button className="es-token-eff-del" title="移除该持续伤害" onClick={() => onRemoveOngoing(menu.cid, i)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              {effects.length > 0 && (
                <div className="es-token-effgroup">
                  <div className="es-token-effgroup-label">挂载效果</div>
                  {effects.map((ef, i) => (
                    <div key={i} className="es-token-effrow" title={ef.raw ?? ""}>
                      <span className="es-token-efflabel">
                        {ef.label}
                        {ef.duration && <em>{ef.duration}</em>}
                        {ef.source && <i>{ef.source}</i>}
                      </span>
                      <button className="es-token-eff-del" title="移除该效果" onClick={() => onRemoveEffect(menu.cid, i)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              className="es-token-menu-item es-token-menu-add"
              onClick={() => setAddingOd((v) => !v)}
            >
              {addingOd ? "收起添加表单" : "+ 添加持续伤害"}
            </button>
            {addingOd && (
              <div className="es-token-odadd">
                <select value={odType} onChange={(e) => setOdType(e.target.value)}>
                  {Object.entries(DAMAGE_TYPE_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={odVal}
                  onChange={(e) => setOdVal(Math.max(1, parseInt(e.target.value || "0", 10) || 0))}
                  title="每回合伤害值"
                />
                <select value={odSaveOn} onChange={(e) => setOdSaveOn(e.target.value as "end" | "start")}>
                  <option value="end">回合结束豁免</option>
                  <option value="start">回合开始豁免</option>
                </select>
                <button
                  className="es-token-menu-item"
                  disabled={odVal <= 0}
                  onClick={() => {
                    if (odVal <= 0) return;
                    onAddOngoing(menu.cid, { type: odType, value: odVal, saveOn: odSaveOn });
                  }}
                >
                  添加
                </button>
              </div>
            )}
          </div>
        )}
        {menu.sub === "data" && (
          <div className="es-token-status">
            <div className="es-token-status-head">
              数据
              <button className="es-token-status-back" onClick={() => onSetSub(null)}>←</button>
            </div>
            <div className="es-token-data">
              <div className="es-token-data-row"><span>AC</span><b>{c.ac}</b><span>强韧</span><b>{c.fort}</b><span>反射</span><b>{c.ref}</b><span>意志</span><b>{c.will}</b></div>
              <div className="es-token-data-row"><span>HP</span><b>{c.hp}/{c.maxHp}</b><span>临时</span><b>{c.tempHp ?? 0}</b></div>
              <div className="es-token-data-row"><span>速度</span><b>{c.speed}</b><span>占地</span><b>{c.size ?? 1}</b></div>
              <button
                className="es-token-menu-item"
                onClick={() => {
                  onClose();
                  onSelectCombatant(menu.cid);
                }}
              >
                在右栏查看完整数据 →
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function condShort(k: string): string {
  const map: Record<string, string> = {
    blinded: "盲",
    dazed: "眩",
    deafened: "聋",
    dominated: "支",
    dying: "濒",
    helpless: "助",
    immobilized: "定",
    marked: "标",
    petrified: "石",
    prone: "倒",
    restrained: "缚",
    slowed: "缓",
    stunned: "慑",
    surprised: "袭",
    unconscious: "失",
    weakened: "弱",
  };
  return map[k] ?? k.slice(0, 1);
}

/** 有害状态集合（批 1-10：状态胶囊带色，红=有害 / 蓝=增益；基础状态集内暂无纯增益，蓝类保留给后续） */
const COND_HARM = new Set<ConditionKey>([
  "blinded",
  "dazed",
  "deafened",
  "dominated",
  "dying",
  "helpless",
  "immobilized",
  "marked",
  "petrified",
  "prone",
  "restrained",
  "slowed",
  "stunned",
  "surprised",
  "unconscious",
  "weakened",
]);