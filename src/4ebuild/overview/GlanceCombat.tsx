// 速览页「属性与技能」「防御」「攻击 / 伤害」三个分区。
// 数值全部取自人物页同一套推导（defense.ts / 技能面板 / 攻击面板公式），
// 这里只叠加临时加值，并按顶部「掷骰 / 指令」开关决定点击是掷骰还是复制指令。
import type { Dispatch, SetStateAction } from "react";
import { ABILITY_KEYS, ABILITY_LABELS, type Character, type DefenseKey } from "../sheet/character";
import type { GlanceData } from "./derive";
import { GlanceCounter, GlanceZone, fmtMod } from "./ui";

/** 点击数值时的动作：掷骰或复制指令，由顶部开关决定。 */
export interface RollAct {
  mode: "roll" | "cmd";
  run: (label: string, expr: string) => void;
}

interface Props {
  char: Character;
  setChar: Dispatch<SetStateAction<Character>>;
  d: GlanceData;
  act: RollAct;
}

const actTitle = (act: RollAct, label: string, expr: string) =>
  act.mode === "cmd" ? "点击复制指令 .r " + expr : "点击掷骰：" + label + " " + expr;

/** 六属性 + 全部技能：调整值与检定值都含 ½ 等级，点击即掷骰或复制指令。 */
export function GlanceAbilities({ d, act }: { d: GlanceData; act: RollAct }) {
  return (
    <GlanceZone label="属性与技能" className="z-abi" meta={<span className="gl-zone-hint">检定值已含 ½ 等级 +{d.halfLevel}</span>}>
      <div className="gl-abi-grid">
        {ABILITY_KEYS.map((k) => {
          const check = d.mods[k] + d.halfLevel;
          const expr = "d20" + fmtMod(check);
          const label = ABILITY_LABELS[k].zh + "检定";
          return (
            <button key={k} type="button" className="gl-abi-cell" title={actTitle(act, label, expr)} onClick={() => act.run(label, expr)}>
              <span className="gl-abi-name">{ABILITY_LABELS[k].zh}</span>
              <span className="gl-abi-mod">{fmtMod(d.mods[k])}</span>
              <span className="gl-abi-sub">{d.abilities[k]} · 检定 {fmtMod(check)}</span>
            </button>
          );
        })}
      </div>
      <div className="gl-skill-row">
        {d.skills.map((s) => {
          const expr = "d20" + fmtMod(s.total);
          const label = s.name + "检定";
          return (
            <button
              key={s.name}
              type="button"
              className={"gl-skill" + (s.trained ? " trained" : "")}
              title={(s.trained ? "已受训 · " : "未受训 · ") + ABILITY_LABELS[s.ability].zh + " · " + actTitle(act, label, expr)}
              onClick={() => act.run(label, expr)}
            >
              <span className="gl-skill-name">{s.name}</span>
              <span className="gl-skill-val">{fmtMod(s.total)}</span>
            </button>
          );
        })}
      </div>
    </GlanceZone>
  );
}

/** 防御：AC / 强韧 / 反射 / 意志，每项各自带一个临时加值（掩蔽只加 AC 与反射，回气才是全加）。 */
export function GlanceDefenses({ char, setChar, d }: Omit<Props, "act">) {
  const temps = char.glance.defTemp;
  const anyTemp = d.defenses.some((def) => temps[def.key] !== 0);
  const bump = (key: DefenseKey, delta: number) =>
    setChar((p) => ({
      ...p,
      glance: {
        ...p.glance,
        defTemp: { ...p.glance.defTemp, [key]: Math.max(-20, Math.min(20, (p.glance.defTemp[key] ?? 0) + delta)) },
      },
    }));
  return (
    <GlanceZone
      label="防御"
      className="z-def"
      meta={<span className="gl-zone-hint">± 为该项临时加值</span>}
      actions={
        <button
          type="button"
          className="gl-mini-btn"
          title="清空四项临时加值"
          disabled={!anyTemp}
          onClick={() => setChar((p) => ({ ...p, glance: { ...p.glance, defTemp: { ac: 0, fort: 0, ref: 0, will: 0 } } }))}
        >
          ↺
        </button>
      }
    >
      <div className="gl-def-grid">
        {d.defenses.map((def) => {
          const t = temps[def.key] ?? 0;
          return (
            <div
              key={def.key}
              className={"gl-def-cell" + (t !== 0 ? " tempd" : "")}
              title={def.parts.map((p) => p.label + " " + fmtMod(p.value)).join("  ") + (t !== 0 ? "  临时 " + fmtMod(t) : "")}
            >
              <span className="gl-def-name">{def.label}</span>
              <span className="gl-def-val">{def.value + t}</span>
              <span className="gl-def-temp">
                <button type="button" className="gl-step" aria-label={def.label + " 临时加值 −1"} onClick={() => bump(def.key, -1)}>−</button>
                <span className={"gl-def-temp-val" + (t !== 0 ? " on" : "")}>{fmtMod(t)}</span>
                <button type="button" className="gl-step" aria-label={def.label + " 临时加值 +1"} onClick={() => bump(def.key, 1)}>＋</button>
              </span>
            </div>
          );
        })}
      </div>
    </GlanceZone>
  );
}

/** 攻击 / 伤害：按攻击面板的行一一对应，叠加临时加值后掷骰或复制指令。 */
export function GlanceAttacks({ char, setChar, d, act }: Props) {
  const atkTemp = char.glance.atkTemp;
  const dmgTemp = char.glance.dmgTemp;
  const rowCount = Math.max(d.attacks.length, d.damages.length);
  const setTemp = (patch: { atkTemp?: number; dmgTemp?: number }) =>
    setChar((p) => ({ ...p, glance: { ...p.glance, ...patch } }));
  const clamp = (n: number) => Math.max(-20, Math.min(20, n));

  return (
    <GlanceZone
      label="攻击与伤害"
      className="z-atk"
      actions={
        <>
          <GlanceCounter
            label="临时命中"
            tone={atkTemp !== 0 ? "accent" : "plain"}
            value={fmtMod(atkTemp)}
            onDec={() => setTemp({ atkTemp: clamp(atkTemp - 1) })}
            onInc={() => setTemp({ atkTemp: clamp(atkTemp + 1) })}
          />
          <GlanceCounter
            label="临时伤害"
            tone={dmgTemp !== 0 ? "accent" : "plain"}
            value={fmtMod(dmgTemp)}
            onDec={() => setTemp({ dmgTemp: clamp(dmgTemp - 1) })}
            onInc={() => setTemp({ dmgTemp: clamp(dmgTemp + 1) })}
          />
        </>
      }
    >
      {rowCount === 0 ? (
        <p className="hint">人物页的攻击面板还没有可用行。</p>
      ) : (
        <div className="gl-atk-list">
          {Array.from({ length: rowCount }, (_, i) => {
            const a = d.attacks[i];
            const dm = d.damages[i];
            const atkTotal = a ? a.total + atkTemp : 0;
            const dmgTotal = dm ? dm.total + dmgTemp : 0;
            const atkExpr = "d20" + fmtMod(atkTotal);
            const dmgExpr = dm && dm.dice ? dm.dice + fmtMod(dmgTotal) : "";
            // 这一对的名称（人物页可自定义），没填就退回序号
            const pairName = (a?.label || dm?.label || "").trim();
            const atkLabel = a ? (pairName ? pairName + " · 命中" : "命中 · " + ABILITY_LABELS[a.ability].zh) : "";
            const dmgLabel = dm ? (pairName ? pairName + " · 伤害" : "伤害 · " + ABILITY_LABELS[dm.ability].zh) : "";
            return (
              <div key={i} className="gl-atk-row">
                {a ? (
                  <button type="button" className="gl-atk-cell atk" title={actTitle(act, atkLabel, atkExpr)} onClick={() => act.run(atkLabel, atkExpr)}>
                    <span className="gl-cell-label">{atkLabel}{atkTemp !== 0 && <em className="gl-temp-tag">{fmtMod(atkTemp)}</em>}</span>
                    <span className="gl-cell-val">{fmtMod(atkTotal)}</span>
                    <span className="gl-cell-cmd">{act.mode === "cmd" ? ".r " + atkExpr : atkExpr}</span>
                  </button>
                ) : (
                  <div className="gl-atk-cell empty">无对应攻击行</div>
                )}
                {dm ? (
                  <button
                    type="button"
                    className="gl-atk-cell dmg"
                    title={dmgExpr ? actTitle(act, dmgLabel, dmgExpr) : "该行未选择基础武器，伤害骰未知"}
                    onClick={() => act.run(dmgLabel, dmgExpr)}
                  >
                    <span className="gl-cell-label">{dmgLabel}{dmgTemp !== 0 && <em className="gl-temp-tag">{fmtMod(dmgTemp)}</em>}</span>
                    <span className="gl-cell-val">{dm.dice || "—"}{fmtMod(dmgTotal)}</span>
                    <span className="gl-cell-cmd">{dmgExpr ? (act.mode === "cmd" ? ".r " + dmgExpr : dmgExpr) : "未选基础武器"}</span>
                  </button>
                ) : (
                  <div className="gl-atk-cell empty">无对应伤害行</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </GlanceZone>
  );
}