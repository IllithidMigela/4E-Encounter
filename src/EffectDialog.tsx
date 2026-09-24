// 效果施加弹窗（移动后的效果结算；批 1-8 起降为「DM 裁决」兜底，后又优化为「精简智能确认」）：
// 效果型威能先在地图进入「强制移动模式」手动移目标；语义化解析出的可挂载效果（attack.effectSpecs）
// 以只读筹码形式在顶部展示为「将施加的效果」，目标默认预选。
// 通用「状态 / 持续伤害 / 再生」折叠进可展开的「更多」区（仅属 DM 手动追加）；
// 纯 manual（解析不出）时通用区默认展开，行为与旧版一致。
import { useMemo, useState } from "react";
import type { AttackOption, Combatant, ConditionKey, EffectApplyTarget, EffectSpec } from "./types";
import { ALL_CONDITIONS, CONDITION_LABEL } from "./types";
import { specsToApplyTarget } from "./battle/triggers";
import { isDead } from "./engine";

export type { EffectApplyTarget };

// 血量推导状态（重伤/濒死）不在此手动施加，避免与 HP 推导冲突
const APPLICABLE = ALL_CONDITIONS.filter((k) => k !== "bloodied" && k !== "dying");

// 不进弹窗筹码、留待地图处理的移动类与 manual
// move 为施放者自身移位（快步/冲锋等），非对目标施加的效果，不列入受影响目标的结算
const EXCLUDED_KINDS = new Set(["push", "pull", "slide", "teleport", "manual", "move"]);

/** 每条解析出的效果 → 筹码主文案 */
function specLabel(s: EffectSpec, attackerName?: string): string {
  const who = (base: string) => (attackerName ? `${base}（${attackerName}）` : base);
  switch (s.kind) {
    case "buff":
      return s.label ?? "属性修正";
    case "condition":
    case "prone":
      return who(s.condition ? CONDITION_LABEL[s.condition] ?? s.condition : "状态");
    case "mark":
      return who("被标记");
    case "grantCA":
      return s.label ?? "提供战斗优势";
    case "ongoing":
      return `${s.value ?? 0}点持续伤害${s.type ? `（${s.type}）` : ""}`;
    case "regeneration":
      return `${s.value}点再生`;
    case "tempHp":
      return `${s.value}点临时生命`;
    case "heal":
      return `${s.value}点治疗`;
    case "hidden":
      return "隐形";
    case "transform":
      return s.label ?? "变形";
    default:
      return s.label ?? "效果";
  }
}

function specDur(s: EffectSpec): string | undefined {
  return s.duration ?? (s.saveOn === "end" ? "豁免终止" : undefined);
}

interface Props {
  attack: AttackOption;
  combatants: Combatant[];
  /** 施法者（对 self/selfAlly 增益做受体默认预选） */
  attackerId?: string;
  /** 本次被强制移动的目标，默认预选 */
  defaultTargets: string[];
  /** 本次可挂载的语义化效果子集（按 4e 命中/未命中分段过滤）；缺省 = attack.effectSpecs 全部 */
  specsOverride?: EffectSpec[];
  onApply: (targets: EffectApplyTarget[]) => void;
  onClose: () => void;
}

/** 战场队伍的简化判定：未显式指定 team 时按 pc/monster 兜底 */
function teamOf(c: Combatant): string {
  return c.team ?? c.kind;
}

export default function EffectDialog({ attack, combatants, attackerId, defaultTargets, specsOverride, onApply, onClose }: Props) {
  const placed = useMemo(() => combatants.filter((c) => c.pos), [combatants]);
  // 可自动挂载的解析效果（移动类/manual 除外）；有 specsOverride 时以其为准（命中/未命中分段过滤）
  const applicable = useMemo(
    () => (specsOverride ?? attack.effectSpecs ?? []).filter((s) => !EXCLUDED_KINDS.has(s.kind)),
    [specsOverride, attack.effectSpecs],
  );
  const hasDetected = applicable.length > 0;

  // 增益受体判定：取第一个带 beneficiary 的解析效果；据其文本判定该增益应加给谁（self/ally/selfAlly）与范围
  const voter = useMemo(() => applicable.find((s) => s.beneficiary) ?? null, [applicable]);
  const verdict = voter?.beneficiary ?? null;
  const attacker = useMemo(() => combatants.find((c) => c.cid === attackerId) ?? null, [combatants, attackerId]);
  const allyRange = voter ? (voter.raw.match(/离你(\d+)格/) ?? voter.raw.match(/(\d+)\s*格内/))?.[1] : undefined;
  const allyRangeNum = allyRange ? parseInt(allyRange, 10) : undefined;
  // 推荐受体（作为默认预选）：self/selfAlly → 施法者；ally → 预选范围内盟友们（DM 再单选其一）
  const recommended = useMemo(() => {
    if (!verdict || !attacker || !attacker.pos) return [];
    const allies = placed
      .filter((c) => c.cid !== attacker.cid && teamOf(c) === teamOf(attacker))
      .filter((c) => allyRangeNum == null || (c.pos && Math.abs(c.pos.x - attacker.pos!.x) + Math.abs(c.pos.y - attacker.pos!.y) <= allyRangeNum));
    if (verdict === "ally") return allies.map((c) => c.cid);
    return [attacker.cid];
  }, [verdict, attacker, placed, allyRangeNum]);

  // 可勾选的目标清单：有受体判定（verdict）时只列可能受体（盟友，self/selfAlly 加施法者），并按「N格内」过滤；
  // 无判定则回退为全部已放置棋子。
  const targetList = useMemo(() => {
    if (!verdict || !attacker || !attacker.pos) return placed;
    const dist = (c: Combatant) => Math.abs(c.pos!.x - attacker.pos!.x) + Math.abs(c.pos!.y - attacker.pos!.y);
    const allies = placed.filter(
      (c) => c.cid !== attacker.cid && teamOf(c) === teamOf(attacker) && (allyRangeNum == null || (c.pos && dist(c) <= allyRangeNum)),
    );
    if (verdict === "self") return [attacker];
    if (verdict === "ally") return allies;
    return [attacker, ...allies]; // selfAlly
  }, [verdict, attacker, placed, allyRangeNum]);

  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    const pick = recommended.length > 0 ? recommended : defaultTargets;
    for (const c of placed) init[c.cid] = !isDead(c) && pick.includes(c.cid); // 死亡目标不可预选（置灰）
    return init;
  });
  const [conds, setConds] = useState<Set<ConditionKey>>(new Set());
  const [odText, setOdText] = useState("");
  const [regenText, setRegenText] = useState("");
  // 「更多」默认收起（有自动解析效果时）；纯 manual（无解析效果）时为 true 展开
  const [showMore, setShowMore] = useState(false);
  const moreOpen = !hasDetected || showMore;

  const odNum = odText.trim() === "" ? 0 : parseInt(odText.replace(/\s+/g, ""), 10);
  const odVal = isNaN(odNum) || odNum < 0 ? 0 : odNum;
  const regenNum = regenText.trim() === "" ? 0 : parseInt(regenText.replace(/\s+/g, ""), 10);
  const regenVal = isNaN(regenNum) ? 0 : regenNum;
  const selCount = targetList.filter((c) => !isDead(c) && checked[c.cid]).length;
  const hasManualAction = conds.size > 0 || odVal > 0 || regenVal !== 0;
  const hasAction = hasManualAction || hasDetected;

  const toggleCond = (k: ConditionKey) =>
    setConds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const apply = () => {
    const targets: EffectApplyTarget[] = placed
      .filter((c) => checked[c.cid])
      .map((c) => {
        const base = specsToApplyTarget(c, applicable, attacker?.name) ?? { cid: c.cid, conditions: [] as ConditionKey[] };
        return {
          ...base,
          cid: c.cid,
          conditions: [...new Set([...(base.conditions ?? []), ...conds])],
          ...(odVal > 0 ? { ongoingDamage: { value: odVal, saveOn: "end" as const } } : {}),
          ...(regenVal !== 0 ? { regeneration: regenVal } : {}),
        };
      });
    onApply(targets);
    onClose();
  };

  return (
    <div className="es-overlay" onClick={onClose}>
      <div className="es-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="es-dialog-head">
          <span className="es-dialog-title">结算效果</span>
          <span className="es-dialog-sub">【{attack.name}】{attack.range ? ` · ${attack.range}` : ""}</span>
          <button className="es-dialog-close" onClick={onClose}>×</button>
        </div>

        {attack.effectText && <div className="es-effect-text">{attack.effectText}</div>}

        {/* 将施加的效果（语义化解析出，只读筹码） */}
        {hasDetected && (
          <div className="es-detected">
            <div className="es-detected-title">将施加的效果</div>
            <div className="es-detected-effects">
              {applicable.map((s, i) => (
                <span key={i} className="es-detected-chip">
                  {specLabel(s, attacker?.name)}
                  {specDur(s) && <span className="es-detected-duration">（{specDur(s)}）</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 目标多选 */}
        <div className="es-area-targets">
          <div className="es-area-sticky">
            <div className="es-area-title">影响目标（默认预选本次效果作用目标，可增删）</div>
            {verdict && (
              <div className="es-area-judge">
                目标判断：
                {verdict === "selfAlly" && (allyRangeNum != null ? `施法者或 ${allyRangeNum} 格内一名盟友（已默认预选施法者）` : `施法者或一名盟友（已默认预选施法者）`)}
                {verdict === "self" && "施法者自身（已默认预选）"}
                {verdict === "ally" && `施法者的一名${allyRangeNum != null ? ` ${allyRangeNum} 格内` : ""}盟友（请勾选受体）`}
              </div>
            )}
          </div>
          {placed.length === 0 && <div className="es-area-title">地图上暂无已放置的棋子。</div>}
          {targetList.length > 0 && (
            <label className={"es-selall"}>
              <input type="checkbox" checked={selCount === targetList.filter((c) => !isDead(c)).length} onChange={(e) => {
                const v = e.target.checked;
                setChecked((prev) => {
                  const next = { ...prev };
                  for (const c of targetList) next[c.cid] = !isDead(c) && v;
                  return next;
                });
              }} />
              <span className="es-area-t-name">全部</span>
            </label>
          )}
          {targetList.map((c) => {
            const dead = isDead(c);
            return (
            <label key={c.cid} className={"es-area-target" + (checked[c.cid] ? " on" : "") + (dead ? " dead" : "")}>
              <input type="checkbox" checked={!!checked[c.cid]} disabled={dead} onChange={() => !dead && setChecked({ ...checked, [c.cid]: !checked[c.cid] })} />
              <span className="es-area-t-name">{c.name}{dead ? <em className="es-area-t-deadnote">（死亡）</em> : null}</span>
              <span className="es-area-t-def">HP {c.hp}/{c.maxHp}</span>
              {c.conditions.length > 0 && (
                <span className="es-area-t-conds">{c.conditions.map((k) => CONDITION_LABEL[k]).join("、")}</span>
              )}
            </label>
            );
          })}
        </div>

        {/* 更多：手动追加状态 / 持续伤害 / 再生（默认收起） */}
        <div className={"es-more" + (moreOpen ? " open" : " collapsed")}>
          {hasDetected && (
            <button className="es-more-toggle" onClick={() => setShowMore((v) => !v)}>
              {moreOpen ? "收起追加选项" : "显示更多选项"}
            </button>
          )}
          {moreOpen && (
            <>
              {/* 状态胶囊 */}
              <div className="es-mods">
                <div className="es-mods-title">追加状态（可多选；点击切换）</div>
                <div className="es-mods-grid">
                  {APPLICABLE.map((k) => (
                    <button
                      key={k}
                      className={"es-mod" + (conds.has(k) ? " on" : "")}
                      onClick={() => toggleCond(k)}
                    >
                      {CONDITION_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 持续伤害 / 再生 */}
              <div className="es-dmg-section">
                <div className="es-dmg-row">
                  <label>持续伤害 <span className="es-dmg-note">（豁免终止；留空不加）</span></label>
                  <input value={odText} onChange={(e) => setOdText(e.target.value)} type="number" min="0" placeholder="如 5" />
                </div>
                <div className="es-dmg-row">
                  <label>再生 <span className="es-dmg-note">（回合开始时；正回血、负强制扣血）</span></label>
                  <input value={regenText} onChange={(e) => setRegenText(e.target.value)} type="number" placeholder="如 5 或 -5" />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="es-dialog-actions">
          <button className="es-btn-cancel" onClick={onClose}>取消</button>
          <button
            className="es-btn-apply"
            onClick={apply}
            disabled={selCount === 0 || !hasAction}
          >
            {selCount === 0
              ? "未选目标"
              : !hasAction
                ? "选择效果/状态/持续伤害/再生"
                : `结算效果（${selCount} 个目标）`}
          </button>
        </div>
      </div>
    </div>
  );
}