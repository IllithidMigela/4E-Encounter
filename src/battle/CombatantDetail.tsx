// 全屏详情页：罗列单个棋子的完整数据与当前状态，并提供「动态数据」的快捷操作。
// 由战斗数据栏（RosterPanel）左列「详情」按钮触发；原右栏「动态数据」表已并入此页（HP/临时/再生/持续伤害）。
import { useEffect, useState } from "react";
import type { ActiveEffect, Combatant, ConditionKey, DamageType } from "../types";
import { ALL_CONDITIONS, CONDITION_LABEL, DAMAGE_TYPE_LABEL } from "../types";
import { condUntilOf as condUntilOfShared, fmtMod } from "../engine";

/** 可手动添加的状态：排除由生命值推导的重伤/濒死 */
const APPLICABLE = ALL_CONDITIONS.filter((k) => k !== "bloodied" && k !== "dying");

/** 持续伤害完整展示（与数据栏一致，避免与 RosterPanel 循环依赖） */
function ongoingText(d: { type?: string; value: number; saveOn?: "end" | "start" }): string {
  const t = d.type ? DAMAGE_TYPE_LABEL[d.type as DamageType] ?? d.type : "";
  return `持续${t}伤害 ${d.value}（${d.saveOn === "start" ? "回合开始豁免" : "豁免终止"}）`;
}

/** 状态到期边界 → 中文（状态列的简易补充；condUntil 存在时提示边界与来源） */
function condExpiry(c: Combatant, k: ConditionKey): string {
  const u = c.condUntil?.[k];
  if (!u) return "";
  // 来源：被谁标记/被谁施加状态（如「被矮人氏族守卫标记」）
  const src = u.source ? `（被${u.source}标记）` : "";
  if (u.dur) return `${src} · ${u.dur}`;
  const who = u.source ? "" : "该灵气持有者";
  return `${src} · 直到${who}下回合${u.at === "start" ? "开始" : "结束"}解除`;
}

function attackKindLabel(k: string): string {
  const map: Record<string, string> = { standard: "标准动作", move: "移动动作", minor: "次要动作", free: "自由动作", immediate: "触发", trait: "特性", aura: "灵气" };
  return map[k] ?? k;
}

/** 常用正面效果快捷项：点击直接添加；如需精确时长再用手动输入 */
const EFFECT_PRESETS = [
  "全抗力",
  "攻击骰 +2",
  "伤害骰 +2",
  "AC +2",
  "反射 +2",
  "意志 +2",
  "强韧 +2",
  "再生",
  "隐形",
  "飞行",
];

/** 效果持续时长的全部方式（覆盖 4E 标准时长；v="" 为空选项、v="__custom__" 触发自定义输入） */
const DUR_OPTIONS: { v: string; label: string }[] = [
  { v: "", label: "时长（可选）" },
  { v: "直到你下回合开始", label: "直到你下回合开始" },
  { v: "直到你下回合结束", label: "直到你下回合结束" },
  { v: "直到目标下回合结束", label: "直到目标下回合结束" },
  { v: "直到遭遇结束", label: "直到遭遇结束" },
  { v: "豁免终止", label: "豁免终止" },
  { v: "直到长休息", label: "直到长休息" },
  { v: "每日", label: "每日" },
  { v: "__custom__", label: "自定义…" },
];

/** 统一时长下拉：覆盖全部时长方式；选「自定义…」展开自由输入框（内部自管自定义状态） */
function DurSelect({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [custom, setCustom] = useState(false);
  const isCustom = custom || (value !== "" && !DUR_OPTIONS.some((o) => o.v === value));
  return (
    <>
      <select
        value={isCustom ? "__custom__" : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom__") { setCustom(true); onChange(""); }
          else { setCustom(false); onChange(v); }
        }}
      >
        {DUR_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
      {isCustom && <input type="text" placeholder={placeholder ?? "自定义时长"} value={value} onChange={(e) => onChange(e.target.value)} />}
    </>
  );
}

interface Props {
  c: Combatant;
  onClose: () => void;
  onApplyDamageTo: (cid: string, n: number) => void;
  onApplyHealTo: (cid: string, n: number) => void;
  onPatchCid: (cid: string, patch: Partial<Combatant>) => void;
  /** 快捷切换棋子状态（添加/移除用） */
  onToggleCondition: (cid: string, k: ConditionKey) => void;
}

export default function CombatantDetail({ c, onClose, onApplyDamageTo, onApplyHealTo, onPatchCid, onToggleCondition }: Props) {
  const resist = c.resistances && Object.keys(c.resistances).length > 0;
  const vuln = c.vulnerabilities && Object.keys(c.vulnerabilities).length > 0;

  const dead = c.hp <= 0;
  const bloodied = !dead && c.hp <= c.bloodied;
  const ongoing = c.ongoingDamage ?? [];
  const budget = c.actionBudget;
  const quarter = Math.max(1, Math.floor(c.maxHp / 4));
  const budgetOk = (k: "standard" | "move" | "minor") => (budget ? budget[k] : true);

  // 快捷操作输入（切换棋子时重置，不带上前一个棋子的编辑值）
  const [hpOpen, setHpOpen] = useState(false);
  const [hpDmg, setHpDmg] = useState("");
  const [hpHeal, setHpHeal] = useState("");
  const [hpTemp, setHpTmp] = useState("");
  const [regen, setRegen] = useState<string>(c.regeneration != null ? String(c.regeneration) : "");
  const [og, setOg] = useState("");
  /** 添加状态模式：进入后才展开「添加状态」面板，同时显示仅在此刻有意义的持续伤害/再生操作 */
  const [adding, setAdding] = useState(false);
  /** 状态多选：选中的状态键（commit 后一起加入） */
  const [condSel, setCondSel] = useState<ConditionKey[]>([]);
  /** 选中状态的共享时长文本（""=不设；自动推导 at 边界） */
  const [condDur, setCondDur] = useState<string>("");
  /** 手动行：指定单个状态 + 其时长 */
  const [manualC, setManualC] = useState<ConditionKey | "">("");
  const [manualDur, setManualDur] = useState<string>("");
  /** 当前效果区独立编辑态：展开「添加正面效果」输入行 */
  const [addingEff, setAddingEff] = useState(false);
  const [effText, setEffText] = useState("");
  const [effDur, setEffDur] = useState("");
  /** 预设效果多选：选中的标签列表 */
  const [selEffs, setSelEffs] = useState<string[]>([]);

  useEffect(() => {
    setRegen(c.regeneration != null ? String(c.regeneration) : "");
    setOg("");
    setHpDmg("");
    setHpHeal("");
    setHpTmp("");
    setHpOpen(false);
    setEffText("");
    setEffDur("");
    setSelEffs([]);
    setCondSel([]);
    setCondDur("");
    setManualC("");
    setManualDur("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.cid]);

  const applyRegen = () => {
    const v = parseInt(regen, 10);
    if (Number.isNaN(v)) return;
    onPatchCid(c.cid, { regeneration: v });
  };

  const addOg = () => {
    const v = parseInt(og, 10);
    if (Number.isNaN(v) || v <= 0) return;
    onPatchCid(c.cid, { ongoingDamage: [...ongoing, { value: v, saveOn: "end" as const }] });
    setOg("");
  };

  const removeOg = (i: number) => {
    onPatchCid(c.cid, { ongoingDamage: ongoing.filter((_, idx) => idx !== i) });
  };

  /** 切换预设效果选中（多选） */
  const togglePreset = (label: string) => {
    setSelEffs((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]));
  };

  /** 切换状态选中（多选） */
  const toggleCondSel = (k: ConditionKey) => {
    setCondSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  };

  /** 把时长文本映射为状态下限条目：统一走 engine.condUntilOf（at 按是否含「开始」推导，dur 保存原文用于展示） */
  const condUntilOf = (dur: string) => condUntilOfShared(dur);

  /** 把选中的状态一次性加入（可带共享时长） */
  const applyCondSel = () => {
    if (condSel.length === 0) return;
    const already = (k: ConditionKey) => c.conditions.includes(k);
    const next = condSel.filter((k) => !already(k));
    if (next.length === 0) {
      setCondSel([]);
      return;
    }
    let cu = { ...c.condUntil };
    const entry = condUntilOf(condDur);
    if (entry) next.forEach((k) => { cu = { ...cu, [k]: entry }; });
    onPatchCid(c.cid, { conditions: [...c.conditions, ...next], condUntil: cu });
    setCondSel([]);
    setCondDur("");
  };

  /** 手动行：单独加入某个状态 + 其时长 */
  const addManualCond = () => {
    if (!manualC || c.conditions.includes(manualC)) return;
    const entry = condUntilOf(manualDur);
    const cu = entry ? { ...c.condUntil, [manualC]: entry } : c.condUntil;
    onPatchCid(c.cid, { conditions: [...c.conditions, manualC], condUntil: cu });
    setManualC("");
    setManualDur("");
  };

  /** 把全部选中预设（+ 共享时长）一次性添加 */
  const addSelectedEffects = () => {
    if (selEffs.length === 0) return;
    const dur = effDur.trim() || undefined;
    const tail: ActiveEffect[] = selEffs.map((label) => (dur ? { kind: "buff", label, duration: dur } : { kind: "buff", label }));
    onPatchCid(c.cid, { effects: [...(c.effects ?? []), ...tail] });
    setSelEffs([]);
  };

  const addEffect = () => {
    const label = effText.trim();
    if (!label) return;
    const dur = effDur.trim();
    const e: ActiveEffect = dur ? { kind: "buff", label, duration: dur } : { kind: "buff", label };
    onPatchCid(c.cid, { effects: [...(c.effects ?? []), e] });
    setEffText("");
    setEffDur("");
  };

  const removeEffect = (i: number) => {
    onPatchCid(c.cid, { effects: (c.effects ?? []).filter((_, idx) => idx !== i) });
  };

  return (
    <div className="es-detail" onClick={onClose}>
      <div className="es-detail-card" onClick={(e) => e.stopPropagation()}>
        <header className="es-detail-head">
          <div>
            <div className="es-detail-name">
              {c.name}
              {c.tier && <em>{c.tier}</em>}
              {c.role && <em>{c.role}</em>}
            </div>
            <div className="es-detail-sub">
              {c.kind === "pc" ? "玩家角色" : "怪物"} · Lv{c.level ?? "—"}
              {c.xp != null && ` · 经验 ${c.xp}`}
              {c.origin && ` · ${c.origin}`}
              {c.category && ` · ${c.category}`}
              {c.species && `（${c.species}）`}
              {c.sizeClass && ` · ${c.sizeClass}`}
              {c.team && ` · 队伍 ${c.team}`}
            </div>
          </div>
          <button className="es-detail-close" onClick={onClose} title="关闭">✕</button>
        </header>

        <div className="es-detail-body">
          {/* 核心数值 */}
          <section className="es-detail-sec es-detail-sec-wide">
            <div className="es-detail-sec-title">属性</div>
            <div className="es-detail-grid">
              <div className="es-detail-stat"><b>{c.ac}</b><span>AC</span></div>
              <div className="es-detail-stat"><b>{c.fort}</b><span>强韧</span></div>
              <div className="es-detail-stat"><b>{c.ref}</b><span>反射</span></div>
              <div className="es-detail-stat"><b>{c.will}</b><span>意志</span></div>
              <div className="es-detail-stat"><b>{c.initResult ?? fmtMod(c.init)}</b><span>先攻</span></div>
              <div className="es-detail-stat"><b>{c.speed}</b><span>速度</span></div>
            </div>
          </section>

          {/* 生命 + 操作 */}
          <section className="es-detail-sec">
            <div className="es-detail-sec-title">生命</div>
            <div className="es-detail-line">
              生命 <b className={dead ? "es-detail-hp-dead" : bloodied ? "es-detail-hp-low" : undefined}>{c.hp}</b>/{c.maxHp}（重伤线 {c.bloodied}）
              {c.tempHp > 0 && <span className="es-detail-tag">临时 +{c.tempHp}</span>}
            </div>
            <div className="es-detail-hpbar">
              <button className="es-detail-step dmg" onClick={() => onApplyDamageTo(c.cid, 5)}>伤害5</button>
              <button className="es-detail-step heal" onClick={() => onApplyHealTo(c.cid, 5)}>回复5</button>
              <button className="es-detail-step" onClick={() => onApplyDamageTo(c.cid, quarter)}>伤害¼</button>
              <button className="es-detail-step" onClick={() => onApplyHealTo(c.cid, quarter)}>回复¼</button>
              <button className="es-detail-step" onClick={() => onPatchCid(c.cid, { hp: c.maxHp })}>满血</button>
              <button className={"es-detail-step" + (hpOpen ? " on" : "")} onClick={() => setHpOpen((v) => !v)}>{hpOpen ? "收起" : "精确"}</button>
            </div>
            {hpOpen && (
              <div className="es-detail-hp-panel">
                <span className="es-detail-hp-row">
                  <input type="number" placeholder="扣血" value={hpDmg} onChange={(e) => setHpDmg(e.target.value)} />
                  <button className="es-detail-step dmg" onClick={() => { const n = Number(hpDmg); if (n) onApplyDamageTo(c.cid, n); setHpDmg(""); }}>扣血</button>
                  <input type="number" placeholder="回复" value={hpHeal} onChange={(e) => setHpHeal(e.target.value)} />
                  <button className="es-detail-step heal" onClick={() => { const n = Number(hpHeal); if (n) onApplyHealTo(c.cid, n); setHpHeal(""); }}>回复</button>
                </span>
                <span className="es-detail-hp-row">
                  <input type="number" min={0} placeholder="临时" value={hpTemp} onChange={(e) => setHpTmp(e.target.value)} />
                  <button className="es-detail-step" onClick={() => { const n = Number(hpTemp) || 0; onPatchCid(c.cid, { tempHp: Math.max(0, n) }); setHpTmp(""); }}>设临时</button>
                </span>
              </div>
            )}
            {c.kind === "pc" && (
              <div className="es-detail-line">
                回复力 <b>{c.surgesLeft ?? 0}/{c.surges}</b>（每次回复 {c.surgeValue}）
                {c.secondWindUsed ? <span className="es-detail-tag">回气已用</span> : null}
              </div>
            )}
            {(c.deathSaveFails ?? 0) > 0 && (
              <div className="es-detail-line">死亡豁免失败：{c.deathSaveFails} / 3</div>
            )}
          </section>

          {/* 战斗资源：行动点 / 动作预算 / 再生 */}
          <section className="es-detail-sec">
            <div className="es-detail-sec-title">战斗资源</div>
            <div className="es-detail-line">
              行动点：{c.actionPoints ?? 1}
              {c.apUsedThisRound && <span className="es-detail-tag">本回合已用</span>}
            </div>
            <div className="es-detail-line">
              动作预算：标准 {budgetOk("standard") ? "✓" : "✗"} · 移动 {budgetOk("move") ? "✓" : "✗"} · 次要 {budgetOk("minor") ? "✓" : "✗"}
            </div>
            {adding && (
              <div className="es-detail-line">
                再生：{c.regeneration != null && c.regeneration !== 0 ? `每回合 ${c.regeneration > 0 ? "+" : ""}${c.regeneration} 生命` : <span className="es-detail-empty">无</span>}
                <span className="es-detail-edit">
                  <input type="number" value={regen} placeholder="0" onChange={(e) => setRegen(e.target.value)} />
                  <button className="md-btn es-btn-sm" onClick={applyRegen} title="设置本棋子的再生值（回合开始自动回血）">设置</button>
                </span>
              </div>
            )}
          </section>

          {/* 抗性/易伤/免疫 */}
          {(resist || vuln || (c.immunities?.length ?? 0) > 0 || c.insubstantial) && (
            <section className="es-detail-sec">
              <div className="es-detail-sec-title">抗性与免疫</div>
              {c.insubstantial && <div className="es-detail-chip">虚体：伤害减半</div>}
              {c.resistances && Object.entries(c.resistances).map(([k, v]) => (
                <div key={k} className="es-detail-chip">抗力 {DAMAGE_TYPE_LABEL[k as DamageType] ?? k} {v}</div>
              ))}
              {c.vulnerabilities && Object.entries(c.vulnerabilities).map(([k, v]) => (
                <div key={k} className="es-detail-chip">易伤 {DAMAGE_TYPE_LABEL[k as DamageType] ?? k} {v}</div>
              ))}
              {c.immunities?.map((k) => (
                <div key={k} className="es-detail-chip">免疫 {k}</div>
              ))}
            </section>
          )}

          {/* 当前异常状态 + 当前效果：左右双栏并排显示 */}
          <div className="es-detail-sec-pair">
            <section className="es-detail-sec">
              <div className="es-detail-sec-head">
                <div className="es-detail-sec-title">当前异常状态</div>
                <button className="es-detail-step" onClick={() => setAdding((v) => !v)}>{adding ? "收起添加" : "添加状态"}</button>
              </div>
              <div className="es-detail-chiprow">
                {c.conditions.length === 0 ? (
                  <span className="es-detail-empty">无</span>
                ) : (
                  c.conditions.map((k) => (
                    <span key={k} className="es-detail-chip danger">
                      {CONDITION_LABEL[k]}
                      {condExpiry(c, k)}
                      <button className="es-detail-del" onClick={() => onToggleCondition(c.cid, k)} title="移除该状态">×</button>
                    </span>
                  ))
                )}
              </div>
              {adding && (
                <div className="es-detail-cond-add">
                  <div className="es-detail-sec-sub">多选要加入的状态</div>
                  <div className="es-detail-chiprow">
                    {APPLICABLE.filter((k) => !c.conditions.includes(k)).map((k) => (
                      <button
                        key={k}
                        className={"es-detail-chip" + (condSel.includes(k) ? " on" : "")}
                        onClick={() => toggleCondSel(k)}
                      >{CONDITION_LABEL[k]}</button>
                    ))}
                  </div>
                  <span className="es-detail-hp-row">
                    <DurSelect value={condDur} onChange={setCondDur} />
                    <button className="md-btn es-btn-sm" onClick={applyCondSel} disabled={condSel.length === 0} title="添加所有选中的状态">
                      添加选中{condSel.length > 0 ? ` (${condSel.length})` : ""}
                    </button>
                  </span>
                  <div className="es-detail-sec-sub mt">或手动指定单个状态</div>
                  <span className="es-detail-hp-row">
                    <select value={manualC} onChange={(e) => setManualC(e.target.value === "" ? "" : (e.target.value as ConditionKey))}>
                      <option value="">选择状态</option>
                      {APPLICABLE.filter((k) => !c.conditions.includes(k)).map((k) => (
                        <option key={k} value={k}>{CONDITION_LABEL[k]}</option>
                      ))}
                    </select>
                    <DurSelect value={manualDur} onChange={setManualDur} />
                    <button className="md-btn es-btn-sm" onClick={addManualCond} disabled={!manualC || c.conditions.includes(manualC)}>添加</button>
                  </span>
                </div>
              )}
            </section>

            <section className="es-detail-sec">
              <div className="es-detail-sec-head">
                <div className="es-detail-sec-title">当前效果</div>
                <button className="es-detail-step" onClick={() => setAddingEff((v) => !v)}>{addingEff ? "收起添加" : "添加正面效果"}</button>
              </div>
              <div className="es-detail-chiprow">
                {(c.effects?.length ?? 0) === 0 ? (
                  <span className="es-detail-empty">无</span>
                ) : (
                  c.effects!.map((e, i) => (
                    <div key={i} className="es-detail-chip">
                      {e.label}
                      {(() => {
                        // 时长若已写进标签则不再重复追加；来源始终保留
                        const dur = e.duration && !e.label.includes(e.duration) ? e.duration : null;
                        const parts = [dur, e.source].filter(Boolean);
                        return parts.length > 0 ? <em>{parts.join(" · ")}</em> : null;
                      })()}
                      <button className="es-detail-del" onClick={() => removeEffect(i)} title="移除该效果">×</button>
                    </div>
                  ))
                )}
              </div>
              {addingEff && (
                <div className="es-detail-cond-add">
                  <div className="es-detail-sec-sub">多选常用效果（可多选）</div>
                  <div className="es-detail-chiprow">
                    {EFFECT_PRESETS.map((label) => {
                      const on = selEffs.includes(label);
                      return (
                        <button
                          key={label}
                          className={"es-detail-chip" + (on ? " on" : "")}
                          onClick={() => togglePreset(label)}
                        >{label}</button>
                      );
                    })}
                  </div>
                  <span className="es-detail-hp-row">
                    <DurSelect value={effDur} onChange={setEffDur} />
                    <button className="md-btn es-btn-sm" onClick={addSelectedEffects} disabled={selEffs.length === 0} title="添加所有选中的效果">
                      添加选中{selEffs.length > 0 ? ` (${selEffs.length})` : ""}
                    </button>
                  </span>
                  <div className="es-detail-sec-sub mt">或手动输入单个效果</div>
                  <span className="es-detail-hp-row">
                    <input type="text" placeholder="效果名" value={effText} onChange={(e) => setEffText(e.target.value)} />
                    <DurSelect value={effDur} onChange={setEffDur} />
                    <button className="md-btn es-btn-sm" onClick={addEffect}>添加</button>
                  </span>
                </div>
              )}
            </section>
          </div>

          {/* 持续伤害 + 操作：仅进入「添加状态」时显示 */}
          {adding && (
            <section className="es-detail-sec">
              <div className="es-detail-sec-title">持续伤害</div>
              {ongoing.length === 0 ? (
                <div className="es-detail-empty">无</div>
              ) : (
                ongoing.map((d, i) => (
                  <div key={i} className="es-detail-chip danger">
                    {ongoingText(d)}
                    <button className="es-detail-del" onClick={() => removeOg(i)} title="移除该持续伤害">×</button>
                  </div>
                ))
              )}
              <span className="es-detail-edit">
                <input type="number" min={1} value={og} placeholder="数值" onChange={(e) => setOg(e.target.value)} />
                <button className="md-btn es-btn-sm" onClick={addOg} title="添加持续伤害">添加</button>
              </span>
            </section>
          )}

          {/* 正在生效（灵气/特性）：只列常驻生效项；纯动作威能（标准/移动/次要/触发等）属「等待使用」，不入此页 */}
          {(() => {
            const active = (c.attacks ?? []).filter((a) => a.kind === "trait" || a.kind === "aura");
            if (active.length === 0) return null;
            return (
              <section className="es-detail-sec">
                <div className="es-detail-sec-title">正在生效（灵气/特性）</div>
                {active.map((a, i) => (
                  <div key={i} className="es-detail-power">
                    <div className="es-detail-power-name">{a.name}<em>{attackKindLabel(a.kind)}</em></div>
                    {/* 常驻项无射程/命中，直接完整展示整段原文（不缩略） */}
                    {a.range && <div className="es-detail-power-meta">{a.range}{a.hit && ` · ${a.hit}`}</div>}
                    {a.effectText && <div className="es-detail-power-full">{a.effectText}</div>}
                  </div>
                ))}
              </section>
            );
          })()}

          {/* 怪物原文 / 角色摘要 */}
          {c.rawText && (
            <details className="es-detail-raw">
              <summary>怪物数据原文</summary>
              <pre>{c.rawText}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}