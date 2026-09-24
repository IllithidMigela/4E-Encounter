// 攻击结算条（底部固定、非模态，替代弹窗）——批1 核心 UI：
// 默认态只显示「目标 | d20+攻加+调整 → 总计 vs 防御 | 命中/未命中/重击/失手 | 伤害」+ 一个「应用」按钮；
// 右上角威能名+范围（点击展开原文）；调整折叠抽屉（8 情境调整值+伤害表达式+重掷+目标勾选，默认收起）；
// 目标行编辑（点行展开改骰值/伤害，近程/区域共享伤害标「共享」，整体重掷）；
// 「本次手动」单次跳过自动判定；Enter=应用、Esc=取消；应用后并入日志作为单个 undo 单元（App 侧保证）。
import { useEffect, useMemo, useState } from "react";
import type { AttackOption, AttackSegment, Combatant, DefenseKey, TargetResolution } from "./types";
import { DEFENSE_LABEL, CONDITION_LABEL } from "./types";
import type { AutoSettings } from "./uiPrefs";
import { exprBonus, formatDiceParts, maxDamage, parseDiceExpr, rollD20, rollDiceExpr } from "./dice";
import { fmtMod, parseRange, defModOf, grantsCA, isRunning, computeDamage } from "./engine";
import type { CoverLevel } from "./engine";

export interface AttackResolution {
  attack: AttackOption;
  /** 首个目标的 d20（用于日志展示；逐目标值见 targets[i].roll） */
  d20: number | null;
  attackBonus: number;
  /** 情境调整值合计 */
  modTotal: number;
  total: number;
  targets: TargetResolution[];
  /** 命中目标伤害合计（近程/区域为共享伤害×命中数等） */
  damageTotal: number;
  damageParts: number[];
  damageExpr: string;
  rangeText: string;
  isEffect: boolean;
}

/** 万律书 · 攻击骰调整值（由 DM 勾选） */
const MODIFIERS: { key: string; label: string; value: number; tooltip?: string }[] = [
  { key: "combatAdv", label: "战斗优势", value: 2, tooltip: "对目标有战斗优势 +2" },
  { key: "prone", label: "攻击者倒地", value: -2, tooltip: "攻击者倒地 -2" },
  { key: "restrained", label: "攻击者束缚", value: -2, tooltip: "攻击者束缚 -2" },
  { key: "cover", label: "目标部分掩护", value: -2, tooltip: "目标有部分掩护 -2" },
  { key: "superCover", label: "目标超级掩护", value: -5, tooltip: "目标有超级掩护 -5" },
  { key: "conceal", label: "目标部分隐蔽", value: -2, tooltip: "目标有部分隐蔽（只适用于近程和远程）-2" },
  { key: "totalConceal", label: "目标全隐蔽", value: -5, tooltip: "目标有全隐蔽（只适用于近程和远程）-5" },
  { key: "maxRange", label: "最大射程", value: -2, tooltip: "最大射程（只适用于武器攻击）-2" },
  { key: "running", label: "奔跑", value: -5, tooltip: "攻击者正在奔跑（直到其下回合开始）-5" },
];

/** 效果型威能：已语义化的效果摘要（供结算条直接展示） */
function effectSummary(attack: AttackOption): string[] {
  const specs = attack.effectSpecs ?? [];
  if (specs.length === 0) return [];
  return specs.map((s) => {
    switch (s.kind) {
      case "condition":
        return `状态：${s.condition ?? "?"}${s.saveOn ? "（豁免终止）" : ""}`;
      case "ongoing":
        return `持续伤害：${s.value ?? "?"} 点${s.type ? `（${s.type}）` : ""}${s.saveOn ? "（豁免终止）" : ""}`;
      case "push":
        return `推离 ${s.value ?? "?"} 格`;
      case "pull":
        return `拉近 ${s.value ?? "?"} 格`;
      case "slide":
        return `滑动 ${s.value ?? "?"} 格`;
      case "prone":
        return "击倒（倒地）";
      case "tempHp":
        return `临时生命 +${s.value ?? "?"}`;
      case "regeneration":
        return `再生 ${s.value ?? "?"}`;
      case "mark":
        return "被标记";
      case "teleport":
        return `传送 ${s.value ?? "?"} 格`;
      case "heal":
        return `恢复 ${s.value ?? "?"} 点生命`;
      case "grantCA":
        return `提供战斗优势${s.saveOn ? "（豁免终止）" : ""}`;
      case "buff":
        return s.label ?? `防御/攻击修正`;
      case "zone":
        return s.label ?? `区域/结界${s.duration ? `（${s.duration}）` : ""}`;
      case "move":
        return s.label ?? `移动效果${s.note ? `（${s.note}）` : ""}`;
      case "resist":
        return s.label ?? `临时抗力 ${s.value ?? "?"}`;
      case "hidden":
        return `${s.label ?? "隐形/隐蔽"}${s.duration ? `（${s.duration}）` : ""}${s.saveOn ? "（豁免终止）" : ""}`;
      case "transform":
        return s.label ?? "变形（改变形态）";
      case "removeCondition":
        return s.label ?? "行动恢复：回合结束移除自身状态";
      case "auraDamage":
        return `灵气触发伤害：${s.value ?? "?"} 点${s.type ? `（${s.type}）` : ""}${s.bloodiedValue ? `（重伤时 ${s.bloodiedValue}）` : ""}${s.trigger ? `（${s.trigger === "start" ? "回合开始" : s.trigger === "end" ? "回合结束" : "进入"}触发）` : ""}`;
      case "auraHeal":
        return `灵气触发治疗：${s.value ?? "?"} 点生命${s.targetBloodied ? "（目标重伤）" : ""}${s.trigger ? `（${s.trigger === "start" ? "回合开始" : "回合结束"}触发）` : ""}`;
      case "auraOngoing":
        return `灵气触发持续伤害：${s.value ?? "?"} 点${s.type ? `（${s.type}）` : ""}（豁免终止）${s.trigger ? `（${s.trigger === "start" ? "回合开始" : "回合结束"}触发）` : ""}${s.bloodiedOnly ? "（持有者重伤）" : ""}`;
      case "auraCondition":
        return `灵气触发状态：${s.condition ? CONDITION_LABEL[s.condition] : "?"}直到${s.expiryOwner ? "持有者" : "其"}下回合${s.expires === "start" ? "开始" : "结束"}${s.trigger ? `（${s.trigger === "start" ? "回合开始" : "回合结束"}触发）` : ""}`;
      case "manual":
        return `DM 裁决：${s.raw}`;
    }
  });
}

/** 批 3 · 伤害格子：显示「裸伤害」，当存在抗力/易伤/免疫/虚弱/虚体修正时补充「→ 实扣 N」说明。 */
function DmgCell({ eff }: { eff: { raw: number; eff: number; adj: string[] } }) {
  const diff = eff.eff !== eff.raw;
  return (
    <span className="es-settle-row-dmg">
      {eff.raw} 伤害
      {diff && (
        <span className="es-settle-row-adj">
          （{eff.adj.join(" · ")}→ 实扣 {eff.eff}）
        </span>
      )}
    </span>
  );
}

interface Props {
  attacker: Combatant;
  attack: AttackOption;
  /** 瞄准点选计算出的受影响目标（近战/远程为单目标） */
  targets: Combatant[];
  rangeText: string;
  /** 强制包含全部目标（目标词条为「每个/所有/全部」或区域内无数量词）：不可取消勾选 */
  locked?: boolean;
  /** 逐目标掩护等级（批 2-4）：auto.mods 打开时自动勾选部分/超级掩护调整值 */
  cover?: Record<string, CoverLevel>;
  /** 自动化设置（批1：A 攻击判定组驱动本条的自动/手动形态） */
  auto: AutoSettings;
  /** 全员数据栏展开高度偏移（结算条固定于其上方） */
  rosterOpen?: boolean;
  onResolve: (r: AttackResolution) => void;
  onClose: () => void;
}

/** 单目标的 d20 掷骰结果 */
interface TargetRoll {
  roll: number;
  isCrit: boolean;
  isFumble: boolean;
}

/** 近程/区域：全体共享一次伤害骰（行首标「共享」） */
export default function AttackDialog({ attacker, attack, targets, rangeText, locked = false, cover = {}, auto, rosterOpen = false, onResolve, onClose }: Props) {
  const A = auto.attack;
  // 任一关键环节关闭自动 → 本次默认进手动模式（结算条展开输入项）；「本次手动」按钮也可随时切入
  const [manual, setManual] = useState<boolean>(!A.roll || !A.hit || !A.damage || !A.mods);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(manual);
  const [dmgText, setDmgText] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // 召唤兽「你的等级 + N」：攻加值需手填，默认取 0
  const [bonus, setBonus] = useState(attack.attack ?? 0);
  const [bonusText, setBonusText] = useState(String(attack.attack ?? 0));
  // 可由棋子状态确定性推导的情境调整值：自动模式打开时自动勾选（仍可手动取消）
  const autoMods = useMemo(() => {
    const s = new Set<string>();
    if (attacker.conditions.includes("prone")) s.add("prone");
    if (attacker.conditions.includes("restrained")) s.add("restrained");
    if (isRunning(attacker)) s.add("running"); // 批 3-3b：奔跑中攻击骰 -5
    const adv =
      targets.length > 0 &&
      targets.every(
        (t) =>
          t.conditions.some((k) => k === "surprised" || k === "unconscious" || k === "helpless" || k === "stunned") ||
          grantsCA(t), // 批 3-3b：目标处于奔跑等状态时提供战斗优势
      );
    if (adv) s.add("combatAdv");
    // 批 2-4：掩护自动勾选（部分 -2 / 超级 -5；取最严者，DM 可手动取消）
    for (const t of targets) {
      const lv = cover[t.cid];
      if (lv === "superior") s.add("superCover");
      else if (lv === "partial") s.add("cover");
    }
    return s;
  }, [attacker, targets, cover]);
  const [mods, setMods] = useState<Set<string>>(A.mods ? autoMods : new Set());
  // 每个目标独立的 d20 掷骰（自动模式打开即掷；手动模式留空由 DM 填）
  const [rolls, setRolls] = useState<Record<string, TargetRoll>>({});
  // 手动模式：DM 手填的 d20 值（覆盖自动掷骰）
  const [rollManual, setRollManual] = useState<Record<string, number>>({});
  // 手动模式：逐目标伤害输入 / 共享伤害输入 / 命中覆盖
  const [dmgManual, setDmgManual] = useState<Record<string, string>>({});
  const [sharedManual, setSharedManual] = useState("");
  const [hitOverride, setHitOverride] = useState<Record<string, boolean>>({});
  // 目标行编辑展开的 cid（null = 收起）
  const [rowEdit, setRowEdit] = useState<string | null>(null);
  // 伤害骰预览：独立伤害逐命中目标掷一次；共享伤害全体掷一次（重击取最大）
  type DmgRoll = { total: number; parts: number[] };
  const [dmgRolls, setDmgRolls] = useState<{ byTarget: Record<string, DmgRoll>; shared: DmgRoll | null } | null>(null);
  // 重掷伤害骰的版本号：递增即重新掷骰
  const [dmgVer, setDmgVer] = useState(0);

  // 多重攻击（批 4-4a）：逐段统计（每段独立攻加/防御/伤害表达式；同威能多次 = 各段同统计）
  interface SegStats {
    label?: string;
    attackBonus: number;
    defense: DefenseKey;
    damageExpr: string;
    /** 该段引用的威能显式重击表达式（批 6）：重击伤害取 critExpr 最大 */
    critExpr?: string;
  }

  /** 效果型引用多重（multiRefs）：在攻击者攻击列表中解析引用 → 合成「虚拟多重攻击」（保留原名/频率/效果，攻击数据取引用威能）。
   * 解析失败回退原威能（保持效果路径 → DM 裁决）。 */
  const workingAttack = useMemo<AttackOption & { segRefs?: SegStats[] }>(() => {
    const refs = attack.multiRefs ?? [];
    if (refs.length === 0) return attack;
    const segRefs: SegStats[] = [];
    for (const ref of refs) {
      const found = attacker.attacks.find(
        (a) => a.attack !== null && !!a.damageExpr && a.name.replace(/（[^）]*）/g, "").includes(ref.name),
      );
      if (!found) return attack;
      for (let i = 0; i < ref.count; i++) {
        segRefs.push({
          label: found.name.replace(/（[^）]*）/g, ""),
          attackBonus: found.attack ?? 0,
          defense: found.defense,
          damageExpr: found.damageExpr,
          critExpr: found.critExpr,
        });
      }
    }
    return {
      ...(attacker.attacks.find((a) => a.key === attack.key && a.attack !== null) ?? attack),
      key: attack.key,
      name: attack.name,
      kind: attack.kind,
      freq: attack.freq,
      effectText: attack.effectText,
      effectSpecs: attack.effectSpecs,
      coverage: attack.coverage,
      unparsed: attack.unparsed,
      multiHits: segRefs.length,
      multiCond: false,
      segRefs,
    };
  }, [attack, attacker.attacks]);

  const isEffect = workingAttack.attack === null && !workingAttack.attackVar;
  const rangeType = useMemo(() => parseRange(attack.range).type, [attack.range]);
  const independentDmg = rangeType === "melee" || rangeType === "ranged" || rangeType === "none";

  // 多重攻击段数（条件多重：仅当威能只以一个生物为目标时触发）
  const effHits = useMemo(() => {
    if (isEffect) return 1;
    const mh = workingAttack.multiHits ?? 0;
    if (mh <= 1) return 1;
    if (workingAttack.multiCond && checked.size !== 1) return 1;
    return mh;
  }, [isEffect, workingAttack, checked]);

  /** 每段统计（effHits>1 时生效）：引用多重取各段引用数据；同威能多次各段同统计 */
  const segPlan = useMemo<SegStats[] | null>(() => {
    if (effHits <= 1) return null;
    if (workingAttack.segRefs) return workingAttack.segRefs.slice(0, effHits);
    return Array.from({ length: effHits }, () => ({
      attackBonus: workingAttack.attack ?? 0,
      defense: workingAttack.defense,
      damageExpr: dmgText,
      critExpr: workingAttack.critExpr,
    }));
  }, [effHits, workingAttack, dmgText]);

  // 多重攻击：逐目标逐段的 d20 掷骰（打开即掷，目标/段数变化取前 N 段）
  const [segRolls, setSegRolls] = useState<Record<string, TargetRoll[]>>({});
  // 手动模式：逐段 d20 输入 / 命中覆盖 / 伤害输入
  const [segManualRoll, setSegManualRoll] = useState<Record<string, (number | undefined)[]>>({});
  const [segHitOverride, setSegHitOverride] = useState<Record<string, (boolean | undefined)[]>>({});
  const [segDmgManual, setSegDmgManual] = useState<Record<string, (number | undefined)[]>>({});
  // 多重攻击：逐段自动伤害骰（重掷通过 dmgVer 触发）
  const [segDmg, setSegDmg] = useState<Record<string, DmgRoll[]>>({});


  // 打开即掷骰（自动）：每个目标独立掷一次 d20；多重攻击逐段预掷
  useEffect(() => {
    setChecked(new Set(targets.map((c) => c.cid)));
    if (isEffect) return;
    if (!A.roll) return; // 关闭自动掷骰：d20 留空由 DM 填
    const r: Record<string, TargetRoll> = {};
    const maxHits = workingAttack.multiHits ?? 1;
    const seg: Record<string, TargetRoll[]> = {};
    for (const c of targets) {
      const d = rollD20();
      r[c.cid] = { roll: d.total, isCrit: d.nat20 === true, isFumble: d.nat1 === true };
      if (maxHits > 1) {
        const arr: TargetRoll[] = [];
        for (let i = 0; i < maxHits; i++) {
          const sd = rollD20();
          arr.push({ roll: sd.total, isCrit: sd.nat20 === true, isFumble: sd.nat1 === true });
        }
        seg[c.cid] = arr;
      }
    }
    setRolls(r);
    if (maxHits > 1) setSegRolls(seg);
    setDmgText(workingAttack.damageExpr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modTotal = useMemo(() => MODIFIERS.filter((m) => mods.has(m.key)).reduce((s, m) => s + m.value, 0), [mods]);

  // 单个目标的命中判定（d20 可由 DM 编辑/覆盖）；多重攻击逐段独立判定
  const targetResults: TargetResolution[] = useMemo(() => {
    if (isEffect) return [];
    return targets
      .filter((c) => checked.has(c.cid))
      .map((c, ti) => {
        // 多重攻击：逐段独立掷骰
        if (effHits > 1 && segPlan) {
          // 批 5：分目标多重攻击（multiSplit）：「对一个目标做一次X攻击，且对另一个目标做一次Y攻击」
          // 第 i 个被选中的目标只结算第 i 段（第 i 段打第 i 个目标）；目标数超过段数的多余目标不参与段结算。
          // gi = 该段在 segPlan 中的真实下标（分目标=ti；同目标连击=si）。
          const split = workingAttack.multiSplit === true;
          const splitPlan = split ? segPlan.slice(ti, ti + 1) : segPlan;
          const splitOffset = split ? ti : 0;
          const segments: AttackSegment[] = splitPlan
            .map((sp, si): AttackSegment | null => {
              const gi = si + splitOffset;
              const r = segRolls[c.cid]?.[gi];
              const manualRoll = segManualRoll[c.cid]?.[gi];
              const rollVal = r ? r.roll : manualRoll;
              if (rollVal === undefined) return null; // 手动模式尚未填 d20
              const isCrit = r ? r.isCrit : rollVal === 20;
              const isFumble = r ? r.isFumble : rollVal === 1;
              const segTotal = rollVal + sp.attackBonus + modTotal;
              const defVal = c[sp.defense] + defModOf(c, sp.defense); // 批 3-3b：目标防御修正
              let hit = isCrit || (!isFumble && segTotal >= defVal);
              const ov = segHitOverride[c.cid]?.[gi];
              if (ov !== undefined) hit = ov;
              return {
                n: gi + 1,
                label: sp.label,
                roll: rollVal,
                attackBonus: sp.attackBonus,
                modTotal,
                total: segTotal,
                hit,
                crit: isCrit,
                fumble: isFumble,
                damage: 0, // 在 dmgResults 中填充
                damageParts: [],
                defense: defVal,
                defenseLabel: DEFENSE_LABEL[sp.defense],
              };
            })
            .filter((x): x is AttackSegment => x !== null);
          if (segments.length === 0) return null; // 手动模式尚未填任何段
          const s0 = segments[0];
          return {
            cid: c.cid,
            name: c.name,
            hit: segments.some((x) => x.hit),
            crit: segments.some((x) => x.crit),
            fumble: segments.some((x) => x.fumble),
            roll: s0.roll,
            attackBonus: s0.attackBonus,
            modTotal,
            total: s0.total,
            damageTotal: 0, // 在 dmgResults 中填充
            defense: s0.defense,
            defenseLabel: s0.defenseLabel,
            segments,
          };
        }
        const r = rolls[c.cid];
        const manualRoll = rollManual[c.cid];
        const rollVal = r ? r.roll : manualRoll;
        if (rollVal === undefined) return null; // 手动模式尚未填 d20
        const isCrit = r ? r.isCrit : rollVal === 20;
        const isFumble = r ? r.isFumble : rollVal === 1;
        const total = rollVal + bonus + modTotal;
        const defVal = c[attack.defense] + defModOf(c, attack.defense); // 批 3-3b：目标防御修正（全防御/奔跑等）
        let hit = isCrit || (!isFumble && total >= defVal);
        if (hitOverride[c.cid] !== undefined) hit = hitOverride[c.cid];
        return {
          cid: c.cid,
          name: c.name,
          hit,
          crit: isCrit,
          fumble: isFumble,
          roll: rollVal,
          attackBonus: bonus,
          modTotal,
          total,
          damageTotal: 0, // 在 dmgResults 中填充
          defense: defVal,
          defenseLabel: DEFENSE_LABEL[attack.defense],
        };
      })
      .filter((t): t is TargetResolution => t !== null);
  }, [isEffect, targets, checked, rolls, bonus, modTotal, attack.defense, rollManual, hitOverride, effHits, segPlan, segRolls, segManualRoll, segHitOverride, workingAttack]);

  const hitTargets = useMemo(() => targetResults.filter((t) => t.hit), [targetResults]);
  // 命中键（含多段逐段命中状态）：作为自动伤害骰的触发依赖
  const segHitKey = targetResults
    .map((t) => `${t.cid}:${t.segments ? t.segments.map((s) => (s.crit ? "C" : s.hit ? "H" : "M")).join("") : t.crit ? "C" : t.hit ? "H" : "M"}`)
    .join("|");
  const text = dmgText.trim();

  /** 重击伤害（批 6）：威能带显式重击表达式（critExpr）时取该表达式最大；否则取普通伤害表达式最大 */
  const critDamageOf = (base: string, ce?: string) => maxDamage((ce ?? "").trim() ? ce! : base);

  // 自动掷伤害（auto.damage 开启时）
  useEffect(() => {
    if (isEffect || !A.damage || !text || !parseDiceExpr(text) || hitTargets.length === 0) {
      setDmgRolls(null);
      setSegDmg({});
      return;
    }
    if (effHits > 1 && segPlan) {
      // 多段：逐目标逐段独立掷伤害
      const byT: Record<string, DmgRoll[]> = {};
      for (const t of hitTargets) {
        if (!t.segments) continue;
        byT[t.cid] = t.segments.map((sg) => {
          const expr = segPlan[sg.n - 1]?.damageExpr ?? text;
          if (!parseDiceExpr(expr)) return { total: 0, parts: [] };
          return sg.crit ? { total: critDamageOf(expr, segPlan[sg.n - 1]?.critExpr), parts: [] } : rollDiceExpr(expr) ?? { total: 0, parts: [] };
        });
      }
      setSegDmg(byT);
      return;
    }
    if (independentDmg) {
      const byTarget: Record<string, DmgRoll> = {};
      for (const t of hitTargets) {
        byTarget[t.cid] = t.crit ? { total: critDamageOf(text, workingAttack.critExpr), parts: [] } : rollDiceExpr(text) ?? { total: 0, parts: [] };
      }
      setDmgRolls({ byTarget, shared: null });
    } else {
      const allCrit = hitTargets.every((t) => t.crit);
      if (allCrit) setDmgRolls({ byTarget: {}, shared: { total: critDamageOf(text, workingAttack.critExpr), parts: [] } });
      else {
        const r = rollDiceExpr(text);
        setDmgRolls({ byTarget: {}, shared: r ? { total: r.total, parts: r.parts } : null });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segHitKey, text, independentDmg, isEffect, dmgVer, A.damage, effHits, segPlan]);

  /** 逐目标最终伤害（自动骰 / 手动输入；未命中=0）。多重攻击逐段伤害填入 segments 并求和。 */
  const dmgResults: Record<string, number> = useMemo(() => {
    const out: Record<string, number> = {};
    if (isEffect) return out;
    // 表达式无法解析时退化为手动伤害，避免应用被卡死
    const invalid = dmgText.trim() !== "" && !parseDiceExpr(dmgText.trim());
    for (const t of targetResults) {
      // 多重攻击：逐段伤害
      if (t.segments) {
        let sum = 0;
        for (const sg of t.segments) {
          let dmg = 0;
          let parts: number[] = [];
          if (sg.hit) {
            const expr = segPlan?.[sg.n - 1]?.damageExpr ?? text;
            if (!A.damage || invalid) {
              const v = parseInt(String(segDmgManual[t.cid]?.[sg.n - 1] ?? "").replace(/\s+/g, ""), 10);
              dmg = isNaN(v) ? 0 : v;
            } else if (sg.crit) {
              dmg = critDamageOf(expr, segPlan?.[sg.n - 1]?.critExpr);
            } else {
              const r = segDmg[t.cid]?.[sg.n - 1];
              dmg = r?.total ?? 0;
              parts = r?.parts ?? [];
            }
          }
          sg.damage = dmg;
          sg.damageParts = parts;
          sum += dmg;
        }
        out[t.cid] = sum;
        continue;
      }
      if (!t.hit) {
        out[t.cid] = 0;
        continue;
      }
      if (!A.damage || invalid) {
        // 手动伤害（自动掷伤害关闭或表达式无法解析时）
        if (independentDmg) {
          const v = parseInt((dmgManual[t.cid] ?? "").replace(/\s+/g, ""), 10);
          out[t.cid] = isNaN(v) ? 0 : v;
        } else {
          const v = parseInt((sharedManual ?? "").replace(/\s+/g, ""), 10);
          out[t.cid] = isNaN(v) ? 0 : v;
        }
        continue;
      }
      if (independentDmg) {
        out[t.cid] = t.crit ? critDamageOf(text, workingAttack.critExpr) : (dmgRolls?.byTarget[t.cid]?.total ?? 0);
      } else {
        const shared = hitTargets.every((x) => x.crit) ? critDamageOf(text, workingAttack.critExpr) : (dmgRolls?.shared?.total ?? 0);
        out[t.cid] = t.crit ? critDamageOf(text, workingAttack.critExpr) : shared;
      }
    }
    return out;
  }, [isEffect, targetResults, A.damage, dmgManual, sharedManual, independentDmg, text, dmgRolls, hitTargets, segPlan, segDmg, segDmgManual]);

  const previewTotal = useMemo(() => {
    if (isEffect) return null;
    return targetResults.reduce((s, t) => s + (dmgResults[t.cid] ?? 0), 0);
  }, [isEffect, targetResults, dmgResults]);

  // 批 3 · 伤害修正（P3/P7 收敛）：复用 engine.computeDamage 对每个命中目标做「类型→抗力/易伤/免疫→虚弱/虚体」结算，
  // 在结算条直接显示「裸伤害 → 实扣」，避免 DM 心算「结算条数值 ≠ 实际掉血」。
  const effDamage = useMemo<Record<string, { raw: number; eff: number; adj: string[] }>>(() => {
    const type = workingAttack.damageType;
    const out: Record<string, { raw: number; eff: number; adj: string[] }> = {};
    for (const t of targetResults) {
      const raw = dmgResults[t.cid] ?? 0;
      if (!t.hit || raw <= 0 || !type) {
        out[t.cid] = { raw, eff: raw, adj: [] };
        continue;
      }
      const target = targets.find((x) => x.cid === t.cid);
      if (!target) {
        out[t.cid] = { raw, eff: raw, adj: [] };
        continue;
      }
      const r = computeDamage(target, raw, { type });
      const adj: string[] = [];
      if (r.immune) adj.push("免疫");
      if (r.resisted > 0) adj.push(`抗性-${r.resisted}`);
      if (r.vulnBonus > 0) adj.push(`易伤+${r.vulnBonus}`);
      if (r.weakenedHalf) adj.push("虚弱减半");
      if (r.insubHalf) adj.push("虚体减半");
      out[t.cid] = { raw, eff: r.actual, adj };
    }
    return out;
  }, [targetResults, dmgResults, targets, workingAttack.damageType]);

  const toggleMod = (k: string) =>
    setMods((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const toggleTarget = (cid: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });

  const apply = () => {
    if (isEffect) {
      const effTargets = targets.filter((c) => checked.has(c.cid));
      onResolve({
        attack,
        d20: null,
        attackBonus: 0,
        modTotal: 0,
        total: 0,
        targets: effTargets.map((c) => ({
          cid: c.cid,
          name: c.name,
          hit: true,
          crit: false,
          fumble: false,
          roll: 0,
          attackBonus: 0,
          modTotal: 0,
          total: 0,
          damageTotal: 0,
          defense: c[attack.defense],
          defenseLabel: DEFENSE_LABEL[attack.defense],
        })),
        damageTotal: 0,
        damageParts: [],
        damageExpr: "",
        rangeText,
        isEffect: true,
      });
      return;
    }
    const res = targetResults.map((t) => ({ ...t, damageTotal: dmgResults[t.cid] ?? 0 }));
    const segParts = res.flatMap((t) => t.segments?.flatMap((s) => s.damageParts) ?? []);
    onResolve({
      attack,
      d20: res[0]?.roll ?? null,
      attackBonus: bonus,
      modTotal,
      total: res[0]?.total ?? 0,
      targets: res,
      damageTotal: res.reduce((s, t) => s + t.damageTotal, 0),
      damageParts: independentDmg ? segParts : (dmgRolls?.shared?.parts ?? []),
      damageExpr: text,
      rangeText,
      isEffect: false,
    });
  };

  // 键盘：Enter=应用、Esc=取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, onClose]);

  const anyHit = targetResults.some((t) => t.hit);
  const anyCrit = targetResults.some((t) => t.crit);
  const allHit =
    targetResults.length > 0 && targetResults.every((t) => (t.segments ? t.segments.every((s) => s.hit) : t.hit));
  // 命中段数 / 总段数（多段时逐段计数，单段=目标数）
  const hitSegCount = targetResults.reduce(
    (s, t) => s + (t.segments ? t.segments.filter((x) => x.hit).length : t.hit ? 1 : 0),
    0,
  );
  const totalSegCount = targetResults.reduce((s, t) => s + (t.segments ? t.segments.length : 1), 0);
  const effCount = isEffect ? targets.filter((c) => checked.has(c.cid)).length : 0;
  const dmgInvalid = !isEffect && dmgText.trim() !== "" && !parseDiceExpr(dmgText.trim());
  // 表达式无法解析：自动展开抽屉，展示手动伤害输入，避免应用被卡死
  useEffect(() => {
    if (dmgInvalid) setDrawerOpen(true);
  }, [dmgInvalid]);
  const settleTone = isEffect ? "effect" : anyCrit ? "crit" : allHit ? "hit" : anyHit ? "mixed" : targetResults.length === 0 ? "none" : "miss";
  const summary = effectSummary(attack);
  const barTone = settleTone;

  return (
    <div
      className={"es-settlebar" + (barTone !== "mixed" && barTone !== "none" ? " " + barTone : "")}
      style={{ bottom: rosterOpen ? "var(--es-roster-h, 176px)" : 0 }}
    >
      <div className="es-settlebar-main">
        {/* 顶部：威能名 + 范围 + 原文展开 + 状态 */}
        <div className="es-settle-head">
          <button
            className="es-settle-power"
            onClick={() => setDrawerOpen((v) => !v)}
            title={drawerOpen ? "收起调整抽屉" : "展开调整抽屉（情境调整值/伤害/目标）"}
          >
            <span className="es-settle-name">{attack.name}</span>
            <span className="es-settle-range">{attack.range}{attack.target ? ` · ${attack.target}` : ""}</span>
          </button>
          <div className={"es-settle-status"}>
            {isEffect
              ? `对 ${effCount} 目标应用效果`
              : anyCrit
                ? "⚡ 重击"
                : allHit
                  ? `✓ 全部命中（${totalSegCount} 段）`
                  : anyHit
                    ? `○ 部分命中（${hitSegCount}/${totalSegCount} 段）`
                    : targetResults.length === 0
                      ? "待判定"
                      : "✗ 全部未命中"}
          </div>
          <span className="es-settle-attacker">{attacker.name} 攻击</span>
        </div>

        {/* 效果型威能：直接显示语义化效果列表 */}
        {isEffect && (
          <div className="es-settle-effect">
            <div className="es-settle-effect-title">对 {effCount} 个目标应用效果</div>
            {summary.length > 0 ? (
              <div className="es-settle-effect-list">
                {summary.map((s, i) => (
                  <span key={i} className="es-settle-effect-chip">{s}</span>
                ))}
              </div>
            ) : attack.effectText ? (
              <div className="es-settle-effect-text">{attack.effectText}</div>
            ) : null}
          </div>
        )}

        {/* 目标行 */}
        <div className="es-settle-rows">
          {!isEffect && targetResults.length === 0 && !manual && (
            <div className="es-settle-empty">正在自动判定…</div>
          )}
          {!isEffect && targetResults.length === 0 && manual && (
            <div className="es-settle-empty">手动模式：请在抽屉中填写各目标的 d20 骰值。</div>
          )}
          {!isEffect &&
            targetResults.map((t) => {
              const shared = !independentDmg;
              const dmg = dmgResults[t.cid] ?? 0;
              return (
                <div key={t.cid} className={"es-settle-row" + (rowEdit === t.cid ? " edit" : "") + (t.hit ? " hit" : " miss")}>
                  <div className="es-settle-row-line" onClick={() => setRowEdit(rowEdit === t.cid ? null : t.cid)}>
                    <span className="es-settle-row-name">{t.name}</span>
                    {t.segments && <span className="es-settle-multi">×{t.segments.length}</span>}
                    {shared && !t.segments && <span className="es-settle-shared">共享</span>}
                    {t.segments ? (
                      <>
                        <span className={"es-settle-row-state " + (t.hit ? "hit" : "miss")}>
                          {t.crit ? "⚡重击" : t.hit ? `${t.segments.filter((x) => x.hit).length}/${t.segments.length} 命中` : "未命中"}
                        </span>
                        {t.hit && dmg > 0 && <DmgCell eff={effDamage[t.cid]} />}
                      </>
                    ) : (
                      <>
                        <span className="es-settle-row-dice">
                          <b>{t.roll}</b>
                          <span className="es-settle-row-plus">{fmtMod(t.attackBonus)}</span>
                          {t.modTotal !== 0 && <span className="es-settle-row-plus">{fmtMod(t.modTotal)}</span>}
                        </span>
                        <span className="es-settle-row-arrow">→</span>
                        <span className="es-settle-row-total">{t.total}</span>
                        <span className="es-settle-row-vs">vs {t.defenseLabel} {t.defense}</span>
                        <span className={"es-settle-row-state " + (t.hit ? "hit" : "miss")}>
                          {t.crit ? "⚡重击" : t.fumble ? "✗失手" : t.hit ? "命中" : "未命中"}
                        </span>
                        {t.hit && dmg > 0 && <DmgCell eff={effDamage[t.cid]} />}
                      </>
                    )}
                    {targets.length > 1 && (
                      <button
                        className="es-settle-row-x"
                        title="从目标移除"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTarget(t.cid);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {/* 多重攻击：逐段结果（每段独立 d20 + 命中 + 伤害） */}
                  {t.segments && (
                    <div className="es-settle-segs" onClick={() => setRowEdit(rowEdit === t.cid ? null : t.cid)}>
                      {t.segments.map((sg) => (
                        <span key={sg.n} className={"es-settle-seg " + (sg.hit ? "hit" : "miss")}>
                          <b>{sg.n}</b>
                          {sg.label && <em>{sg.label}</em>}
                          <i>d20 {sg.roll}</i>
                          {sg.attackBonus !== 0 && <i>{fmtMod(sg.attackBonus)}</i>}
                          {sg.modTotal !== 0 && <i>{fmtMod(sg.modTotal)}</i>}
                          <i>= {sg.total}</i>
                          <i>vs {sg.defenseLabel} {sg.defense}</i>
                          <b className={"es-settle-seg-state " + (sg.hit ? "hit" : "miss")}>
                            {sg.crit ? "⚡重击" : sg.fumble ? "✗失手" : sg.hit ? "命中" : "未命中"}
                          </b>
                          {sg.damage > 0 && <i className="es-settle-seg-dmg">{sg.damage} 伤害</i>}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* 行内编辑：改骰值 / 命中覆盖 / 伤害 */}
                  {rowEdit === t.cid && (
                    <div className="es-settle-row-edit">
                      {t.segments ? (
                        // 多重攻击：逐段编辑 d20 / 命中 / 伤害
                        t.segments.map((sg) => (
                          <div key={sg.n} className="es-settle-seg-edit">
                            <b className="es-settle-seg-edit-n">{sg.n}</b>
                            <label>
                              d20
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={segRolls[t.cid]?.[sg.n - 1]?.roll ?? segManualRoll[t.cid]?.[sg.n - 1] ?? ""}
                                placeholder="1–20"
                                onChange={(e) => {
                                  const v = parseInt(e.target.value, 10);
                                  if (isNaN(v)) return; // 清空不清除已有值，避免该段行消失而无法重输
                                  // 手动输入优先：覆盖该段 d20（auto 掷值同时清空该段）
                                  setSegManualRoll((prev) => {
                                    const arr = [...(prev[t.cid] ?? [])];
                                    arr[sg.n - 1] = v;
                                    return { ...prev, [t.cid]: arr };
                                  });
                                  setSegRolls((prev) => {
                                    const arr = [...(prev[t.cid] ?? [])];
                                    delete arr[sg.n - 1];
                                    return { ...prev, [t.cid]: arr };
                                  });
                                  setDrawerOpen(true);
                                }}
                              />
                            </label>
                            {(!A.hit || manual) && (
                              <label>
                                命中
                                <select
                                  value={segHitOverride[t.cid]?.[sg.n - 1] === undefined ? "" : String(segHitOverride[t.cid]?.[sg.n - 1])}
                                  onChange={(e) =>
                                    setSegHitOverride((prev) => {
                                      const arr = [...(prev[t.cid] ?? [])];
                                      if (e.target.value === "") delete arr[sg.n - 1];
                                      else arr[sg.n - 1] = e.target.value === "true";
                                      return { ...prev, [t.cid]: arr };
                                    })
                                  }
                                >
                                  <option value="">自动</option>
                                  <option value="true">命中</option>
                                  <option value="false">未命中</option>
                                </select>
                              </label>
                            )}
                            {sg.hit && !A.damage && (
                              <label>
                                伤害
                                <input
                                  type="number"
                                  value={segDmgManual[t.cid]?.[sg.n - 1] ?? ""}
                                  placeholder="0"
                                  onChange={(e) =>
                                    setSegDmgManual((prev) => {
                                      const arr = [...(prev[t.cid] ?? [])];
                                      arr[sg.n - 1] = parseInt(e.target.value, 10);
                                      return { ...prev, [t.cid]: arr };
                                    })
                                  }
                                />
                              </label>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="es-settle-edit-cols">
                          <div className="es-settle-edit-blk es-settle-edit-atk">
                            <label>
                              d20
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={rolls[t.cid]?.roll ?? rollManual[t.cid] ?? ""}
                                placeholder="1–20"
                                onChange={(e) => {
                                  const v = parseInt(e.target.value, 10);
                                  if (isNaN(v)) return; // 清空不清除已有值，避免目标行消失而无法重输
                                  // 手动输入优先于自动掷骰：始终可改，覆盖该目标的 d20
                                  setRollManual((prev) => ({ ...prev, [t.cid]: v }));
                                  setRolls((prev) => {
                                    const n = { ...prev };
                                    delete n[t.cid];
                                    return n;
                                  });
                                  setDrawerOpen(true);
                                }}
                              />
                            </label>
                            {(!A.hit || manual) && (
                              <label>
                                命中
                                <select
                                  value={hitOverride[t.cid] === undefined ? "" : String(hitOverride[t.cid])}
                                  onChange={(e) =>
                                    setHitOverride((prev) => {
                                      const n = { ...prev };
                                      if (e.target.value === "") delete n[t.cid];
                                      else n[t.cid] = e.target.value === "true";
                                      return n;
                                    })
                                  }
                                >
                                  <option value="">自动</option>
                                  <option value="true">命中</option>
                                  <option value="false">未命中</option>
                                </select>
                              </label>
                            )}
                            <span className="es-settle-atk-formula" title="命中公式：d20 + 攻加值（±调整值）= 总值 vs 防御">
                              d20 {t.roll}
                              {t.attackBonus !== 0 && ` ${fmtMod(t.attackBonus)}`}
                              {t.modTotal !== 0 && ` ${fmtMod(t.modTotal)}`}
                              <b>= {t.total}</b>
                              <i>vs {t.defenseLabel} {t.defense}</i>
                            </span>
                          </div>
                          <div className="es-settle-edit-blk es-settle-edit-dmg">
                            {A.damage && !dmgInvalid && t.hit && dmg > 0 && (
                              <span className="es-settle-edit-roll">
                                {shared
                                  ? hitTargets.every((x) => x.crit)
                                    ? `${text} → 最大 ${critDamageOf(text, workingAttack.critExpr)}`
                                    : dmgRolls?.shared
                                      ? formatDiceParts(dmgRolls.shared.parts, exprBonus(text))
                                      : "…"
                                  : t.crit
                                    ? `${text} → 最大 ${critDamageOf(text, workingAttack.critExpr)}`
                                    : dmgRolls?.byTarget[t.cid]
                                      ? formatDiceParts(dmgRolls.byTarget[t.cid].parts, exprBonus(text))
                                      : "…"}
                              </span>
                            )}
                            <button className="es-settle-reroll" onClick={() => setDmgVer((v) => v + 1)}>重掷伤害</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* 底部操作 */}
        <div className="es-settle-actions">
          <div className="es-settle-actions-left">
            {A.roll && A.hit && A.damage && A.mods && (
              <button className={"es-settle-manual" + (manual ? " on" : "")} onClick={() => setManual((v) => !v)}>
                {manual ? "恢复自动" : "本次手动"}
              </button>
            )}
            <button className="es-settle-drawer-btn" onClick={() => setDrawerOpen((v) => !v)}>
              {drawerOpen ? "收起调整" : "调整"}
            </button>
          </div>
          <div className="es-settle-actions-right">
            <button className="es-settle-cancel" onClick={onClose}>取消 <kbd>Esc</kbd></button>
            <button
              className="es-settle-apply"
              onClick={apply}
              disabled={isEffect ? effCount === 0 : targetResults.length === 0}
            >
              {isEffect
                ? effCount === 0
                  ? "无勾选目标"
                  : `应用效果（${effCount} 个目标）`
                : targetResults.length === 0
                  ? "待填骰值"
                  : hitTargets.length > 0 && dmgInvalid
                    ? `应用（伤害手动 · ${hitTargets.length}/${targetResults.length} 命中）`
                    : `应用（${previewTotal != null && previewTotal > 0 ? `${previewTotal} 伤害 · ` : ""}${hitTargets.length}/${targetResults.length} 命中）`}
              <kbd>Enter</kbd>
            </button>
          </div>
        </div>
      </div>

      {/* 调整折叠抽屉：情境调整值 / 伤害表达式 / 目标勾选 */}
      <div className={"es-settle-drawer" + (drawerOpen ? " open" : "")}>
        <div className="es-settle-drawer-inner">
          {!isEffect && (
            <>
              <div className="es-settle-drawer-col">
                <div className="es-settle-drawer-title">情境调整值（攻击骰）</div>
                <div className="es-mods-grid">
                  {MODIFIERS.map((m) => (
                    <button
                      key={m.key}
                      className={"es-mod" + (mods.has(m.key) ? " on" : "") + (m.value > 0 ? " pos" : " neg")}
                      title={m.tooltip}
                      onClick={() => toggleMod(m.key)}
                    >
                      {m.label} {m.value > 0 ? `+${m.value}` : m.value}
                    </button>
                  ))}
                </div>
                {attack.attackVar && (
                  <div className="es-settle-drawer-title es-settle-bonus-line">
                    攻加值（召唤兽＝召唤者等级 + N）
                    <input
                      className="es-bonus-input"
                      value={bonusText}
                      onChange={(e) => {
                        setBonusText(e.target.value);
                        const v = parseInt(e.target.value.replace(/\s+/g, ""), 10);
                        setBonus(isNaN(v) ? 0 : v);
                      }}
                      title="召唤兽攻击加值请手填"
                    />
                    vs {DEFENSE_LABEL[attack.defense]}
                  </div>
                )}
              </div>
              <div className="es-settle-drawer-col">
                <div className="es-settle-drawer-title">
                  伤害表达式
                  {independentDmg ? "" : `（近程/区域：共享伤害${hitTargets.length} 个目标）`}
                </div>
                <div className="es-settle-drawer-dmg">
                  <input value={dmgText} onChange={(e) => setDmgText(e.target.value)} placeholder="如 2d6+4，留空则仅命中" />
                  {dmgInvalid && <span className="es-crit-hint">无法自动解析该表达式，请直接在下方为每个命中目标填写伤害</span>}
                  {anyCrit && dmgText.trim() && <span className="es-crit-hint">重击目标默认最大伤害</span>}
                  {!dmgInvalid && A.damage && hitTargets.length > 0 && (
                    <button className="es-settle-reroll" onClick={() => setDmgVer((v) => v + 1)}>重掷</button>
                  )}
                </div>
                {(!A.damage || dmgInvalid) && hitTargets.length > 0 && (
                  independentDmg ? (
                    <div className="es-settle-drawer-dmg es-settle-manual-dmg">
                      {hitTargets.map((ht) => (
                        <label key={ht.cid} className="es-settle-manual-dmg-row">
                          <span>{ht.name}</span>
                          <input
                            type="number"
                            value={dmgManual[ht.cid] ?? ""}
                            placeholder="伤害"
                            onChange={(e) => setDmgManual((prev) => ({ ...prev, [ht.cid]: e.target.value }))}
                          />
                        </label>
                      ))}
                      <span className="es-crit-hint">{dmgInvalid ? "表达式无法解析，请为每个命中目标填写伤害" : "已关闭自动掷伤害：请为每个命中目标填写伤害"}</span>
                    </div>
                  ) : (
                    <div className="es-settle-drawer-dmg">
                      <input value={sharedManual} onChange={(e) => setSharedManual(e.target.value)} placeholder="手动伤害值" />
                      <span className="es-crit-hint">{dmgInvalid ? "表达式无法解析，请填写伤害值" : "已关闭自动掷伤害：请在行内/此处填写伤害"}</span>
                    </div>
                  )
                )}
              </div>
            </>
          )}
          {targets.length > 1 && (
            <div className="es-settle-drawer-col">
              <div className="es-settle-drawer-title">
                {locked ? "影响目标（强制词条已自动全勾，可排除个别）" : "影响目标（可取消勾选排除）"}
              </div>
              <div className="es-settle-targets">
                {targets.map((c) => {
                  const on = checked.has(c.cid);
                  const res = targetResults.find((t) => t.cid === c.cid);
                  return (
                    <label key={c.cid} className={"es-area-target" + (on ? " on" : "")}>
                      <input type="checkbox" checked={on} onChange={() => toggleTarget(c.cid)} />
                      <span className="es-area-t-name">{c.name}</span>
                      <span className="es-area-t-def">
                        {!isEffect && res
                          ? `${DEFENSE_LABEL[attack.defense]} ${c[attack.defense]} · d20 ${res.roll} → ${res.total} · ${res.hit ? "命中" : "未命中"}`
                          : `HP ${c.hp}/${c.maxHp}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {rangeText && (
            <div className={"es-settle-range-line" + (rangeText.includes("超出") || rangeText.includes("遮挡") ? " short" : "")}>{rangeText}</div>
          )}
          {attack.effectText && <div className="es-settle-effect-text">{attack.effectText}</div>}
        </div>
      </div>
    </div>
  );
}
