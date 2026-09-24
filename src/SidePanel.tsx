// 右侧面板：选中参战者的数据页
// 怪物：wiki 属性块原样渲染（数据）+ 下方工具区（战斗数据/生命调整/威能操作/移除）
// 角色：车卡摘要 + 属性行 + 工具区（沿用 estk 样式）
import { useMemo, useState } from "react";
import { DEFENSE_LABEL, KIND_LABEL } from "./types";
import type { AttackKind, AttackOption, Combatant } from "./types";
import { fmtMod, freqShortLabel, freqKindOf, freqLimitOf } from "./engine";
import WikiStatBlock from "./WikiStatBlock";

interface Props {
  c: Combatant;
  onPatch: (patch: Partial<Combatant>) => void;
  onApplyDamage: (n: number) => void;
  onApplyHeal: (n: number) => void;
  onUseSurge: () => void;
  onRemove: () => void;
  onSetAttacks: (attacks: AttackOption[]) => void;
  /** 点击威能进入瞄准模式（在地图上点选目标） */
  onSelectAttack: (cid: string, attack: AttackOption) => void;
  /** 只读模式：隐藏全部交互（生命调整/威能操作/移除/就地编辑），仅展示卡 */
  readOnly?: boolean;
}

const SIZE_CN: Record<number, string> = { 1: "中型", 2: "大型", 4: "巨型", 9: "超巨型" };

// 技能按动作分区的展示顺序
const KIND_ORDER: AttackKind[] = ["trait", "aura", "standard", "move", "minor", "free", "immediate"];

function groupPowers(attacks: AttackOption[]): { kind: AttackKind; items: AttackOption[] }[] {
  const g = new Map<AttackKind, AttackOption[]>();
  for (const a of attacks) {
    const arr = g.get(a.kind);
    if (arr) arr.push(a);
    else g.set(a.kind, [a]);
  }
  return KIND_ORDER.filter((k) => g.has(k)).map((k) => ({ kind: k, items: g.get(k)! }));
}

export default function SidePanel({ c, onPatch, onApplyDamage, onApplyHeal, onUseSurge, onRemove, onSetAttacks, onSelectAttack, readOnly = false }: Props) {
  const [dmg, setDmg] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [editAttack, setEditAttack] = useState<string | null>(null);

  const quarter = Math.max(1, Math.floor(c.maxHp / 4));
  const powerGroups = useMemo(() => groupPowers(c.attacks), [c.attacks]);

  // 怪物且带 wiki 源码 → 原样渲染数据块；其余（角色/无源码怪物）沿用 estk 整页
  const isWiki = c.kind === "monster" && !!c.rawText;

  const patchAttack = (key: string, patch: Partial<AttackOption>) => {
    const next = c.attacks.map((a) => (a.key === key ? { ...a, ...patch } : a));
    onSetAttacks(next);
  };
  const addAttack = (kind: AttackKind) => {
    const key = "manual-" + Date.now().toString(36);
    const next = [
      ...c.attacks,
      { key, name: "新能力", kind, range: "近战1", target: "一个生物", attack: 0, defense: "ac" as const, damageExpr: "1d8", effectText: "" },
    ];
    onSetAttacks(next);
    setEditAttack(key);
  };
  const removeAttack = (key: string) => {
    onSetAttacks(c.attacks.filter((a) => a.key !== key));
  };

  const vitals = (
    <div className="estk-vitals">
      <div className="estk-vline">
        <span className="estk-lbl">HP</span>
        <b className={c.hp <= 0 ? "dead" : c.hp <= c.bloodied ? "bloodied" : undefined}>{c.hp}</b>
        <span className="estk-sep">/ {c.maxHp}</span>
        {c.tempHp > 0 && <span className="estk-temp">(+{c.tempHp} 临时)</span>}
        <span className="estk-bloodied">重伤线 {c.bloodied}</span>
      </div>
      <div className="estk-vline">
        <span className="estk-lbl">AC</span> <b>{c.ac}</b>
        <span className="estk-lbl">强韧</span> <b>{c.fort}</b>
        <span className="estk-lbl">反射</span> <b>{c.ref}</b>
        <span className="estk-lbl">意志</span> <b>{c.will}</b>
      </div>
      <div className="estk-vline">
        <span className="estk-lbl">速度</span> <b>{c.speed}</b>
        <span className="estk-lbl">先攻</span> <b>{fmtMod(c.init)}</b>
        {c.surges !== undefined && (
          <span className="estk-surge">回复力 {c.surgesLeft}/{c.surges}（{c.surgeValue}）</span>
        )}
      </div>
    </div>
  );

  const lifeBox = (
    <div className="estk-box">
      <div className="estk-box-title">生命调整</div>
      <div className="estk-hp-edit">
        <label>当前
          <input type="number" value={c.hp} onChange={(e) => onPatch({ hp: Math.max(0, Math.min(c.maxHp, Number(e.target.value) || 0)) })} />
        </label>
        <label>临时
          <input type="number" value={c.tempHp} min={0} onChange={(e) => onPatch({ tempHp: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <button onClick={() => onApplyDamage(quarter)}>伤害 ¼</button>
        <button onClick={() => onApplyHeal(quarter)}>回复 ¼</button>
        {c.surges !== undefined && (
          <button onClick={onUseSurge} disabled={!c.surgesLeft}>治疗回复力</button>
        )}
        <div className="estk-dmg-input">
          <input type="number" placeholder="自定" value={dmg} onChange={(e) => setDmg(e.target.value)} />
          <button onClick={() => { const n = Number(dmg); if (n) { onApplyDamage(n); setDmg(""); } }}>伤害</button>
        </div>
      </div>
    </div>
  );

  const powersSection = (
    <div className="estk-powers">
      {powerGroups.length === 0 && <div className="estk-empty">暂无能力项</div>}
      {powerGroups.map((g) => (
        <div className="estk-pgroup" key={g.kind}>
          <div className="estk-pkind">{KIND_LABEL[g.kind]}</div>
          {g.items.map((a) => {
            const fk = freqKindOf(a.freq);
            const usedN = c.powerUses?.[a.key] ?? 0;
            const exhausted = (fk === "encounter" || fk === "daily" || fk === "recharge") && usedN >= (fk === "encounter" ? freqLimitOf(a.freq) : 1);
            const flabel = freqShortLabel(a.freq);
            return (
            <div className={"estk-p" + (exhausted ? " estk-p--used" : "")} key={a.key}>
              <div className="estk-phead">
                <span className="estk-pname">{a.name}</span>
                {flabel && <span className={"estk-pfreq" + (fk === "encounter" ? " enc" : fk === "daily" ? " daily" : fk === "recharge" ? " recharge" : "")}>{exhausted ? `${flabel}·已用` : flabel}</span>}
                {/* 批 3 收尾：解析质量徽标——partial=部分自动、manual=需裁决，hover 提示 */}
                {a.coverage === "partial" && <span className="estk-pcov partial" title="该威能已解析主体，部分效果需 DM 手动裁决">部分自动</span>}
                {a.coverage === "manual" && <span className="estk-pcov manual" title="该威能解析不出可执行效果，由 DM 裁决">需裁决</span>}
                <span className="estk-prange">{a.range}</span>
                {a.target && <span className="estk-ptarget">{a.target}</span>}
                {a.attack !== null && (
                  <span className="estk-pmeta">+{a.attack} vs {DEFENSE_LABEL[a.defense]}</span>
                )}
                {a.damageExpr && <span className="estk-pdmg">{a.damageExpr}</span>}
                <span className="estk-pops">
                  {!readOnly && (
                    <button className="estk-attack" disabled={exhausted} title={exhausted ? `已用尽（${flabel}威能），休息/充能后恢复` : "选中此威能，在地图上点选目标"} onClick={() => onSelectAttack(c.cid, a)}>⚔</button>
                  )}
                  {!readOnly && <button className="estk-edit" onClick={() => setEditAttack(editAttack === a.key ? null : a.key)}>✎</button>}
                  {!readOnly && <button className="estk-del" onClick={() => removeAttack(a.key)}>×</button>}
                </span>
              </div>
              {a.effectText && <div className="estk-peffect">{a.effectText}</div>}
              {editAttack === a.key && (
                <div className="estk-pform">
                  <input value={a.name} onChange={(e) => patchAttack(a.key, { name: e.target.value })} placeholder="名称" />
                  <input value={a.range} onChange={(e) => patchAttack(a.key, { range: e.target.value })} placeholder="射程，如 近战1/远程10" />
                  <input value={a.attack === null ? "" : String(a.attack)} onChange={(e) => patchAttack(a.key, { attack: e.target.value === "" ? null : Number(e.target.value) })} placeholder="攻加值" type="number" />
                  <select value={a.defense} onChange={(e) => patchAttack(a.key, { defense: e.target.value as AttackOption["defense"] })}>
                    <option value="ac">AC</option>
                    <option value="fort">强韧</option>
                    <option value="ref">反射</option>
                    <option value="will">意志</option>
                  </select>
                  <input value={a.damageExpr} onChange={(e) => patchAttack(a.key, { damageExpr: e.target.value })} placeholder="伤害，如 2d6+4" />
                  <textarea value={a.effectText} onChange={(e) => patchAttack(a.key, { effectText: e.target.value })} placeholder="命中效果/说明" rows={2} />
                </div>
              )}
            </div>
            );
          })}
        </div>
      ))}
      {/* 添加任意分区 */}
      {!readOnly && (
        <div className="estk-pkind estk-pkind-add">
          添加分区
          <button className="estk-add" onClick={() => addAttack("standard")}>标准</button>
          <button className="estk-add" onClick={() => addAttack("trait")}>特性</button>
          <button className="estk-add" onClick={() => addAttack("aura")}>灵气</button>
          <button className="estk-add" onClick={() => addAttack("minor")}>次要</button>
          <button className="estk-add" onClick={() => addAttack("move")}>移动</button>
          <button className="estk-add" onClick={() => addAttack("immediate")}>触发</button>
          <button className="estk-add" onClick={() => addAttack("free")}>自由</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="estk">
      {isWiki ? (
        // ===== wiki 属性块：实时数据 + 可操作（数值编辑 / 威能瞄准 / 移除）=====
        <WikiStatBlock
          c={c}
          onPatch={onPatch}
          onSelectAttack={onSelectAttack}
          onRemove={onRemove}
          readOnly={readOnly}
        />
      ) : (
        <>
          {/* ===== 顶部色条 ===== */}
          <div className={"estk-rule " + c.kind} />

          {/* ===== 名称 / 副题 / 移除 ===== */}
          <div className="estk-head">
            <div className="estk-title">
              <span className={"estk-name " + c.kind}>{c.name}</span>
              {!readOnly && <button className="estk-remove" onClick={onRemove} title="移除参战者">移除参战者</button>}
            </div>
            <div className="estk-sub">
              <span className="estk-role">{c.kind === "pc" ? "玩家角色" : c.role ?? "怪物"}</span>
              {c.level !== undefined && <span className="estk-lv">等级 {c.level}</span>}
              <span className="estk-role">{SIZE_CN[c.size] ?? "中型"}</span>
            </div>
          </div>

          {/* ===== 角色卡摘要（导入角色）===== */}
          {c.char && (
            <div className="estk-char">
              <div className="estk-char-row">
                {c.char.race && <span>种族 {c.char.race}</span>}
                {c.char.className && <span>职业 {c.char.className}</span>}
              </div>
              <div className="estk-char-abis">
                {Object.entries(c.char.abilities).map(([k, v]) => (
                  <span key={k} className="estk-abi">{k} {v}</span>
                ))}
              </div>
              {c.char.trainedSkills.length > 0 && <div className="estk-char-line">技能：{c.char.trainedSkills.join("、")}</div>}
              {c.char.powerNames.length > 0 && (
                <details><summary>威能（{c.char.powerNames.length}）</summary><div className="estk-char-names">{c.char.powerNames.join("；")}</div></details>
              )}
              {c.char.equipmentNames.length > 0 && (
                <details><summary>装备（{c.char.equipmentNames.length}）</summary><div className="estk-char-names">{c.char.equipmentNames.join("；")}</div></details>
              )}
            </div>
          )}

          {vitals}
          {!readOnly && lifeBox}
          {powersSection}

          {/* ===== 数据原文 ===== */}
          {c.rawText && (
            <div className="estk-box">
              <button className="estk-raw" onClick={() => setShowRaw(!showRaw)}>
                {showRaw ? "收起" : "展开"}数据原文
              </button>
              {showRaw && <div className="estk-raw-body" dangerouslySetInnerHTML={{ __html: c.rawText }} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
