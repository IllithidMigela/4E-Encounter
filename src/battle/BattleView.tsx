// 遭遇视图：先攻轮顶栏 + 中心地图（日志已移至左栏回合栏）+ 左栏(布置桌面/回合栏/回合阶段，可收起) + 右栏棋子栏；工具条(地图尺寸+开关)位于顶部操作栏
import { useEffect, useMemo, useState } from "react";
import type { AttackOption, BattleActionKind, Combatant, CombatantStats, ConditionKey, FogLevel, MovePreview, ObjectTarget, OngoingDamage, Party, PartyMember, TerrainTool, Zone, ZoneBuild } from "../types";
import type { LogEntry } from "../types";
import type { MonsterTeam } from "../uiPrefs";
import MapGrid from "../MapGrid";
import ManageCards from "./ManageCards";
import InitiativeBar from "./InitiativeBar";
import type { EncounterMeta, MapBgAlign } from "./encounterLib";
import MapBgDialog from "./MapBgDialog";
import TurnPanel from "./TurnPanel";
import SetupPanel from "./SetupPanel";
import TokenSidePanel from "./TokenSidePanel";
import RosterPanel from "./RosterPanel";
import { isDead } from "../engine";
import type { Point } from "../engine";
import { freshActionBudget } from "./resolve";

export interface BattleViewProps {
  /** 遭遇阶段：manage=管理遭遇(存档库卡片总览) / run=进行遭遇(完整地图) */
  stage: "manage" | "run";
  onCreateMap: () => void;
  onExportEncounter: () => void;
  onImportEncounter: () => void;
  /** 地图背景图（导入地图）：触发隐藏文件框 / 背景图 data URL / 对齐参数 / 对齐面板开关与回调 */
  onImportMapBg: () => void;
  mapBg: string | null;
  mapBgAlign: MapBgAlign;
  mapBgDlg: boolean;
  mapBgCalib: boolean;
  onOpenMapBg: () => void;
  onCloseMapBg: () => void;
  onRemoveMapBg: () => void;
  onMapBgAlign: (a: MapBgAlign) => void;
  /** 框选校准：进入/取消框选模式，框选完成返回矩形（es-map 表面坐标） */
  onStartCalib: () => void;
  onCancelCalib: () => void;
  onCalibRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  /** 遭遇存档库（管理阶段卡片 + 存档库共用） */
  encLib: EncounterMeta[];
  onSetEncLib: React.Dispatch<React.SetStateAction<EncounterMeta[]>>;
  /** 点击卡片：加载该遭遇并进入进行阶段 */
  onOpenEncounter: (meta: EncounterMeta) => void;
  combatants: Combatant[];
  selectedId: string | null;
  movePreview: MovePreview | null;
  pendingPlaceName: string | null;
  /** 待放置的怪物/角色（放置模式下右侧棋子栏展示其完整数据） */
  pendingCombatant: Combatant | null;
  /** 放置模式下在地图上右键 → 取消放置 */
  onCancelPendingPlace: () => void;
  obstacles: Set<string>;
  difficult: Set<string>;
  fog: Record<string, FogLevel>;
  water: Set<string>;
  chasm: Set<string>;
  traps: Set<string>;
  /** 涂色图层：格 "x,y" → 底色；mapColor = 涂色工具当前画笔颜色 */
  cellColors: Record<string, string>;
  mapColor: string;
  onSetMapColor: (c: string) => void;
  /** 历史涂色（最近 16 个，最新在前） */
  colorHistory: string[];
  /** 物体目标（批 4-4a-3）：墙/陷阱格 → 物体数据；地图上显示 HP 徽标 */
  objects: Record<string, ObjectTarget>;
  sceneTool: TerrainTool;
  mapCols: number;
  mapRows: number;
  onSetMapSize: (cols: number, rows: number) => void;
  turnOrder: string[];
  turnIndex: number;
  round: number;
  log: LogEntry[];
  monsters: CombatantStats[];
  teams: MonsterTeam[];
  parties: Party[];
  charPool: CombatantStats[];
  aim: { attackerId: string; attack: AttackOption } | null;
  aimOrigin: Point | null;
  aimSel: string[];
  aimArea: { cells: Set<string>; label: string } | null;
  /** 当前展示的灵气（灵气N）：地图高亮环绕持有者的填满区域 */
  auraView: { attackerId: string; attack: AttackOption; radius: number } | null;
  /** 已放置的区域效果 / 墙（批 2b-3：地图青绿渲染） */
  zones: Zone[];
  /** 区域效果放置模式（批 2b-4）：zone=点中心选格集；wall=连续塑形墙；null=无放置 */
  zoneBuild: ZoneBuild | null;
  /** 放置期校验失败的红标格（如非法墙格） */
  invalidZoneCell: string | null;
  /** 放置确认（「完成」按钮） */
  onConfirmZoneBuild: () => void;
  /** 放置取消（「取消」按钮 / 右键地图） */
  onCancelZoneBuild: () => void;
  /** 强制移动方向模式（批 1-8）：当前移动对象 + 最大可移距离 + 已移动目标 */
  forcedMove: { moverCid: string; maxDist: number; moved: string[] } | null;

  onCellClick: (x: number, y: number) => void;
  onConfirmMove: () => void;
  onCancelMove: () => void;
  onMoveTokenTo: (cid: string, end: Point, path?: Point[], shift?: boolean) => void;
  onToggleCondition: (cid: string, k: ConditionKey) => void;
  /** 批 4-4a-2：召唤兽绑定召出者模式 / 绑定 / 解除绑定 / 解除召唤 */
  bindTarget: string | null;
  onBindSummoner: (cid: string) => void;
  onUnbindSummoner: (cid: string) => void;
  onDismissSummon: (cid: string) => void;
  /** 批 6f：守护者绑定主人模式 / 绑定 / 解除绑定 */
  bindMaster: string | null;
  onSetMaster: (cid: string) => void;
  onClearMaster: (cid: string) => void;
  onConfirmAim: () => void;
  onCancelAim: () => void;
  /** 从目标清单条移除一个已选目标（toggle 的快捷入口） */
  onRemoveAimSel: (cid: string) => void;
  /** 强制移动方向模式：沿 (dx,dy) 方向移动 1 格 */
  onForcedMoveDir: (cid: string, dx: number, dy: number) => void;
  onSelectCombatant: (cid: string) => void;
  onPickAttack: (cid: string, attack: AttackOption) => void;
  onPatch: (patch: Partial<Combatant>) => void;
  /** 按 cid 打补丁（棋子栏速览写回：不依赖当前选中） */
  onPatchCid: (cid: string, patch: Partial<Combatant>) => void;
  onApplyDamage: (n: number) => void;
  onApplyHeal: (n: number) => void;
  /** 数据栏 HP 微调：按指定棋子扣血/治疗（批 1-9） */
  onApplyDamageTo: (cid: string, n: number) => void;
  onApplyHealTo: (cid: string, n: number) => void;
  onUseSurge: () => void;
  onRemove: (cid?: string) => void;
  onSetAttacks: (attacks: AttackOption[]) => void;
  onSetSceneTool: (tool: TerrainTool) => void;
  onRollInitiative: () => void;
  onEndTurn: () => void;
  /** 批 3-3b：基础动作（动作预算开关 + 动作派发） */
  autoActionBudget: boolean;
  onAction: (kind: BattleActionKind) => void;
  /** 批 4b-1：右键菜单「效果」——持续伤害/挂载效果的增删 */
  onRemoveOngoing: (cid: string, index: number) => void;
  onAddOngoing: (cid: string, od: OngoingDamage) => void;
  onRemoveEffect: (cid: string, index: number) => void;
  /** 批 3-3c：手动死亡豁免 / 行动点 */
  onDeathSave: () => void;
  onSpendActionPoint: () => void;
  /** 撤回指定操作单元（回滚到该操作之前） */
  onUndoUnit: (unitId: number) => void;
  /** 整回合回滚（撤销该棋子某一回合的全部操作） */
  onUndoTurn: (cid: string, round: number) => void;
  onSurprise: () => void;
  onAddCombatant: (stats: CombatantStats, team?: string) => void;
  onPlacePartyMember: (partyId: string, stats: CombatantStats, color?: string) => void;
  onImportD4e: (files: File[]) => void;
  onCreateParty: () => void;
  onRenameParty: (id: string, name: string) => void;
  onDeleteParty: (id: string) => void;
  onAddPartyMember: (partyId: string, member: PartyMember) => void;
  onRemovePartyMember: (partyId: string, memberId: string) => void;
  onMemberColor: (partyId: string, memberId: string, color: string | undefined) => void;
  onOpenCharacter: (c: Combatant) => void;
  onOpenRules: (keyword: string) => void;
  leftTab: "setup" | "turn";
  leftOpen: boolean;
  sideOpen: boolean;
  /** 底部「全员数据」数据栏是否显示 */
  rosterOpen: boolean;
  /** 棋子底部 2px 血条（批 1-10） */
  showHpBar: boolean;
  notify: (text: string, tone?: LogEntry["tone"]) => void;
}

export default function BattleView(props: BattleViewProps) {
  const {
    combatants, selectedId, movePreview, pendingPlaceName, pendingCombatant, obstacles, difficult, fog, water, chasm, traps, cellColors, mapColor, onSetMapColor, colorHistory, objects, sceneTool,
    mapCols, mapRows, onSetMapSize, turnOrder, turnIndex, round, log, monsters, teams, parties, charPool,
    aim, aimOrigin, aimSel, aimArea, auraView, forcedMove,
    zones, zoneBuild, invalidZoneCell, onConfirmZoneBuild, onCancelZoneBuild,
    stage, onCreateMap, onExportEncounter, onImportEncounter,
    onImportMapBg, mapBg, mapBgAlign, mapBgDlg, mapBgCalib, onOpenMapBg, onCloseMapBg, onRemoveMapBg, onMapBgAlign,
    onStartCalib, onCancelCalib, onCalibRect,
    encLib, onSetEncLib, onOpenEncounter,
    onCellClick, onConfirmMove, onCancelMove, onMoveTokenTo, onToggleCondition, onConfirmAim,
    bindTarget, onBindSummoner, onUnbindSummoner, onDismissSummon,
    bindMaster, onSetMaster, onClearMaster,
    onCancelAim, onRemoveAimSel, onForcedMoveDir, onSelectCombatant, onPickAttack, onPatch, onPatchCid, onApplyDamage, onApplyHeal, onUseSurge,
    onApplyDamageTo, onApplyHealTo,
    onRemove, onSetAttacks, onSetSceneTool, onRollInitiative, onEndTurn,
    autoActionBudget, onAction, onRemoveOngoing, onAddOngoing, onRemoveEffect, onDeathSave, onSpendActionPoint,
    onUndoUnit, onUndoTurn, onSurprise, onAddCombatant, onPlacePartyMember, onImportD4e, onCreateParty,
    onRenameParty, onDeleteParty, onAddPartyMember, onRemovePartyMember, onMemberColor, onOpenCharacter, onOpenRules, notify,
    leftTab, leftOpen, sideOpen, rosterOpen, onCancelPendingPlace,
    showHpBar,
  } = props;

  /** 全员数据栏是否展开填满中间内容栏（不覆盖左右栏） */
  const [rosterExpanded, setRosterExpanded] = useState(false);
  /** 左栏宽度（null = 默认 260px） */
  const [leftW, setLeftW] = useState<number | null>(null);
  /** 右栏宽度（null = 默认 336px） */
  const [rightW, setRightW] = useState<number | null>(null);

  /** 把当前左右栏宽度同步为全局 CSS 变量，供悬浮结算条（攻击/借机等）按实际栏宽定位 */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--es-left-w", `${leftW ?? 260}px`);
    root.style.setProperty("--es-right-w", `${rightW ?? 336}px`);
    return () => {
      root.style.removeProperty("--es-left-w");
      root.style.removeProperty("--es-right-w");
    };
  }, [leftW, rightW]);

  /** 拖动左右栏交界手柄调整栏宽（左栏：拖右变宽；右栏：拖左变宽）；双击恢复默认宽度 */
  const startSideResize = (side: "left" | "right") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略：部分环境不支持手动捕获 */
    }
    const startX = e.clientX;
    const startW = side === "left" ? (leftW ?? 260) : (rightW ?? 336);
    const [minW, maxW] = side === "left" ? [160, 480] : [240, 640];
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) dragged = true;
      const dx = side === "left" ? ev.clientX - startX : startX - ev.clientX;
      const w = Math.min(maxW, Math.max(minW, startW + dx));
      if (side === "left") setLeftW(w);
      else setRightW(w);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      // 仅当确实拖拽过才吞掉紧随其后的那一次 click，避免误触栏内交互
      if (dragged) {
        const swallow = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          document.removeEventListener("click", swallow, true);
        };
        requestAnimationFrame(() => document.addEventListener("click", swallow, true));
        window.setTimeout(() => document.removeEventListener("click", swallow, true), 300);
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    document.body.style.cursor = "col-resize";
  };

  const selected = combatants.find((c) => c.cid === selectedId) ?? null;

  // 场上已放置棋子的计数（按 阵营|名称 分组；pos 非 null 才算在场上），
  // 供布置栏把「已在场上 / 多只已放置」的队伍与角色成员标记为“已有”，并要求走显式按钮才能再放。
  const onFieldCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of combatants) {
      if (!c.pos) continue;
      const k = c.kind + "|" + c.name;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [combatants]);

  // 底部提示栏：按优先级返回「当前此刻」的单条指引。等待操作 / 需完成 / 已完成 三类互斥，每次只现一条。
  const hint = (() => {
    const SLOT_CN: Record<"standard" | "move" | "minor", string> = { standard: "标准", move: "移动", minor: "次要" };
    const slotOk = (c: Combatant, s: "standard" | "move" | "minor") =>
      (c.actionBudget ?? freshActionBudget())[s];
    // 1. 瞄准中
    if (aim) {
      const attackerName = combatants.find((c) => c.cid === aim.attackerId)?.name ?? "";
      return `瞄准中：${attackerName} 使用【${aim.attack.name}】→ 点击地图目标格 / 生物（点攻击者自身取消）`;
    }
    // 2. 场景绘制
    if (sceneTool) return "场景绘制模式：按住左键拖动连续绘制，单格点击切换，右键退出绘制";
    // 3. 放置棋子
    if (pendingPlaceName) return `放置模式：在地图上点击放置「${pendingPlaceName}」（右键取消放置）`;
    // 4. 区域 / 墙体塑形
    if (zoneBuild) return "区域效果塑形中：连续点击地图铺格 / 成墙，点「完成」落地，右键取消";
    // 5. 强制移动
    if (forcedMove) {
      const moverName = combatants.find((c) => c.cid === forcedMove.moverCid)?.name ?? forcedMove.moverCid;
      return forcedMove.moved.length > 0
        ? `强制移动中：<${moverName}> 已移动，继续点 8 方向箭头 / 直线落点，结束后点「结算效果」`
        : `强制移动中：点 8 方向箭头 / 直线合法落点移动 <${moverName}>，逐格步进，结束后点「结算效果」`;
    }
    // 6. 召唤绑定目标
    if (bindTarget) return "选择要绑定为召出者的棋子";
    if (bindMaster) return "选择要设为主人的棋子";
    // 7. 未掷先攻
    if (turnOrder.length === 0) return "先攻尚未确定——地图上放至少两名参战者后点「投掷先攻」或「以突袭轮开始」";
    // 8. 当前行动者
    const cur = combatants.find((c) => c.cid === turnOrder[turnIndex]);
    if (cur) {
      if (!cur.pos) return `轮到 <${cur.name}>：尚未放置，在地图上点击放置`;
      if (cur.kind === "pc" && cur.hp <= 0 && !isDead(cur))
        return `轮到 <${cur.name}>：濒死，掷死亡豁免（已失败 ${cur.deathSaveFails ?? 0}/3）`;
      if (cur.conditions.includes("prone")) return `轮到 <${cur.name}>：倒地，可花移动动作起身`;
      if (autoActionBudget) {
        const remaining = (["standard", "move", "minor"] as const).filter((s) => slotOk(cur, s));
        if (remaining.length > 0)
          return `轮到 <${cur.name}>：还有 ${remaining.map((s) => SLOT_CN[s]).join("、")} 未用，可移动 / 攻击 / 发动次要` ;
        return `轮到 <${cur.name}>：本回合 标准 / 移动 / 次要 动作已用尽，可点「下一回合」结束`;
      }
    }
    // 9. 选中参战者辅助
    if (selected && selected.pos) return "拖拽棋子可移动（长按再拖）并调整路径；右侧面板选威能可发起攻击";
    if (selected) return "该参战者尚未放置：点击格子放置";
    // 10. 兜底
    return "从左侧加入角色/怪物，或创建队伍后点击成员放上地图";
  })();

  return (
    <div className="es-body">
      <div className="es-battle-row">
        {/* ===== 左栏（管理遭遇阶段不显示左右边栏） ===== */}
        {stage !== "manage" && leftOpen && (
          <aside className="es-left" style={leftW !== null ? { width: leftW, flex: "none" } : undefined}>
            {/* Tab 切换已并入顶部操作栏（布置桌面 / 回合栏） */}
            <div className="es-left-body">
              {leftTab === "setup" && (
                <SetupPanel
                  sceneTool={sceneTool}
                  onSetSceneTool={onSetSceneTool}
                  mapCols={mapCols}
                  mapRows={mapRows}
                  onSetMapSize={onSetMapSize}
                  mapColor={mapColor}
                  onSetMapColor={onSetMapColor}
                  colorHistory={colorHistory}
                  monsters={monsters}
                  teams={teams}
                  onAdd={onAddCombatant}
                  onFieldCount={onFieldCount}
                  parties={parties}
                  charPool={charPool}
                  onImportD4e={onImportD4e}
                  onCreateParty={onCreateParty}
                  onRenameParty={onRenameParty}
                  onDeleteParty={onDeleteParty}
                  onAddPartyMember={onAddPartyMember}
                  onRemovePartyMember={onRemovePartyMember}
                  onMemberColor={onMemberColor}
                  onPlacePartyMember={onPlacePartyMember}
                  notify={notify}
                />
              )}
              {leftTab === "turn" && (
                <TurnPanel
                  round={round}
                  turnOrder={turnOrder}
                  turnIndex={turnIndex}
                  combatants={combatants}
                  log={log}
                  onUndoUnit={onUndoUnit}
                  onUndoTurn={onUndoTurn}
                />
              )}
            </div>
          </aside>
        )}
        {/* 左栏拖拽手柄：置于左栏与中心之间，横向拖动调整宽度；双击恢复默认 */}
        {stage !== "manage" && leftOpen && (
          <div
            className="es-resize-v"
            title="拖动调整宽度，双击恢复"
            onPointerDown={startSideResize("left")}
            onDoubleClick={() => setLeftW(null)}
          >
            <span className="material-symbols-outlined">drag_handle</span>
          </div>
        )}

        {/* ===== 中心 ===== */}
        <main className="es-center">
          {/* 二层顶栏：管理阶段为遭遇管理按钮，进行阶段为先攻轮 */}
          {stage === "manage" ? (
            <div className="es-manage-bar">
              <div className="es-manage-bar-title">管理遭遇</div>
              <button className="md-btn" onClick={onCreateMap} title="新建空地图并进入进行阶段">
                <span className="material-symbols-outlined">add</span> 创建地图
              </button>
              <button className="md-btn" onClick={onImportMapBg} title="导入地图图片作为背景，手动对齐方格">
                <span className="material-symbols-outlined">map</span> 导入地图
              </button>
              <span className="es-top-sep" />
              <button className="md-btn" onClick={onExportEncounter} title="导出当前遭遇为 .enc.json 文件">
                <span className="material-symbols-outlined">download</span> 导出遭遇
              </button>
              <button className="md-btn" onClick={onImportEncounter} title="导入 .enc.json 遭遇文件">
                <span className="material-symbols-outlined">upload_file</span> 导入遭遇
              </button>
            </div>
          ) : (
            <InitiativeBar
              turnOrder={turnOrder}
              turnIndex={turnIndex}
              round={round}
              combatants={combatants}
              canRoll={combatants.filter((c) => c.pos).length >= 2}
              onRollInitiative={onRollInitiative}
              onSurprise={onSurprise}
              onSelectCombatant={onSelectCombatant}
              onEndTurn={onEndTurn}
              autoActionBudget={autoActionBudget}
              onDeathSave={onDeathSave}
              onSpendActionPoint={onSpendActionPoint}
            />
          )}

          {stage === "manage" ? (
            /* 管理遭遇：中间内容区显示存档库遭遇卡片网格（点击卡片进入进行阶段） */
            <ManageCards
              lib={encLib}
              onOpen={onOpenEncounter}
              onDelete={(id) => onSetEncLib((prev) => prev.filter((e) => e.id !== id))}
              onCreateMap={onCreateMap}
            />
          ) : (
            <>
              <div className="es-map-area">
                <MapGrid
                  cols={mapCols}
                  rows={mapRows}
                  mapBg={mapBg}
                  mapBgAlign={mapBgAlign}
                  calib={mapBgCalib}
                  onCalibRect={onCalibRect}
                  onCancelCalib={onCancelCalib}
                  onOpenMapBg={onOpenMapBg}
                  combatants={combatants}
                  selectedId={selectedId}
                  movePreview={movePreview}
                  pendingName={pendingPlaceName}
                  obstacles={obstacles}
                  difficult={difficult}
                  fog={fog}
                  water={water}
                  chasm={chasm}
                  traps={traps}
                  cellColors={cellColors}
                  objects={objects}
                  onCancelSceneTool={() => onSetSceneTool(null)}
                  onCancelPendingPlace={onCancelPendingPlace}
                  sceneTool={sceneTool}
                  aim={aim}
                  aimOrigin={aimOrigin}
                  aimSel={aimSel}
                  aimArea={aimArea}
                  auraView={auraView}
                  forcedMove={forcedMove}
                  zones={zones}
                  zoneBuild={zoneBuild}
                  invalidZoneCell={invalidZoneCell}
                  onConfirmZoneBuild={onConfirmZoneBuild}
                  onCancelZoneBuild={onCancelZoneBuild}
                  currentCid={turnOrder[turnIndex] ?? null}
                  showHpBar={showHpBar}
                  onConfirmAim={onConfirmAim}
                  onCellClick={onCellClick}
                  onConfirmMove={onConfirmMove}
                  onCancelMove={onCancelMove}
                  onCancelAim={onCancelAim}
                  onRemoveAimSel={onRemoveAimSel}
                  onForcedMoveDir={onForcedMoveDir}
                  onMoveTokenTo={onMoveTokenTo}
                  onToggleCondition={onToggleCondition}
                  bindTarget={bindTarget}
                  onBindSummoner={onBindSummoner}
                  onUnbindSummoner={onUnbindSummoner}
                  onDismissSummon={onDismissSummon}
                  bindMaster={bindMaster}
                  onSetMaster={onSetMaster}
                  onClearMaster={onClearMaster}
                  onAction={onAction}
                  onSelectCombatant={onSelectCombatant}
                  onRemoveOngoing={onRemoveOngoing}
                  onAddOngoing={onAddOngoing}
                  onRemoveEffect={onRemoveEffect}
                  onOpenRules={onOpenRules}
                />
                {/* 地图背景对齐面板（进行阶段；浮层不阻塞地图，滑块实时生效） */}
                {mapBg && mapBgDlg && (
                  <MapBgDialog
                    align={mapBgAlign}
                    onAlign={onMapBgAlign}
                    cols={mapCols}
                    rows={mapRows}
                    onSetMapSize={onSetMapSize}
                    calib={mapBgCalib}
                    onStartCalib={onStartCalib}
                    onCancelCalib={onCancelCalib}
                    onRemove={onRemoveMapBg}
                    onClose={onCloseMapBg}
                  />
                )}
              </div>
              <div className="es-hint">{hint}</div>
              {/* 底栏·全员数据（进行阶段常驻，与顶栏一样夹在左右栏之间）：遭遇中所有棋子的速查表格 */}
              {!rosterExpanded && rosterOpen && combatants.length > 0 && (
                <div className="es-bottom">
                  <RosterPanel
                    combatants={combatants}
                    turnOrder={turnOrder}
                    turnIndex={turnIndex}
                    onSelect={onSelectCombatant}
                    onApplyDamageTo={onApplyDamageTo}
                    onApplyHealTo={onApplyHealTo}
                    onToggleCondition={onToggleCondition}
                    onPatchCid={onPatchCid}
                    expanded={false}
                    onToggleExpanded={() => setRosterExpanded(true)}
                    onRemove={onRemove}
                  />
                </div>
              )}
              {/* 展开态·全员数据：填满中间内容栏（覆盖地图与底栏，不覆盖左右栏） */}
              {rosterExpanded && rosterOpen && combatants.length > 0 && (
                <div className="es-roster-expand">
                  <RosterPanel
                    combatants={combatants}
                    turnOrder={turnOrder}
                    turnIndex={turnIndex}
                    onSelect={onSelectCombatant}
                    onApplyDamageTo={onApplyDamageTo}
                    onApplyHealTo={onApplyHealTo}
                    onToggleCondition={onToggleCondition}
                    onPatchCid={onPatchCid}
                    expanded
                    onToggleExpanded={() => setRosterExpanded(false)}
                    onRemove={onRemove}
                  />
                </div>
              )}
            </>
          )}
        </main>

        {/* 右栏拖拽手柄：置于中心与右栏之间，横向拖动调整宽度；双击恢复默认 */}
        {stage !== "manage" && sideOpen && (
          <div
            className="es-resize-v"
            title="拖动调整宽度，双击恢复"
            onPointerDown={startSideResize("right")}
            onDoubleClick={() => setRightW(null)}
          >
            <span className="material-symbols-outlined">drag_handle</span>
          </div>
        )}
        {/* ===== 右栏棋子栏（管理遭遇阶段不显示） ===== */}
        {stage !== "manage" && sideOpen && (
          <aside className="es-right" style={rightW !== null ? { width: rightW, flex: "none" } : undefined}>
            <TokenSidePanel
              c={pendingCombatant ?? selected}
              sceneTool={sceneTool}
              onPatch={onPatch}
              onPatchCid={onPatchCid}
              onApplyDamage={onApplyDamage}
              onApplyHeal={onApplyHeal}
              onUseSurge={onUseSurge}
              onRemove={onRemove}
              onSetAttacks={onSetAttacks}
              onSelectAttack={onPickAttack}
              onOpenCharacter={onOpenCharacter}
              onOpenRules={onOpenRules}
            />
          </aside>
        )}
      </div>
    </div>
  );
}