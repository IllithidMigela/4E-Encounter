// 速览页「资源追踪」：威能 / 专长 / 装备与魔法物品。
// 使用标记写回人物页同一份字段（powerUsed / equipmentUsed / featUsed），
// 因此在这里点掉的威能，在人物页对应槽位上同样是划斜线的「已使用」状态。
import type { Dispatch, SetStateAction } from "react";
import type { Entry } from "../data/types";
import { EQUIPMENT_SLOTS, type Character, type PowerSlots } from "../sheet/character";
import { magicItemDailyUses } from "../sheet/powerpoints";
import { itemLevels, enhancementBonusForLevel } from "../lib/levelprices";
import { POWER_COLORS, ITEM_COLOR, FEAT_COLOR } from "../lib/colors";
import EntryCard from "../sheet/EntryCard";
import { SmartHover } from "../sheet/SmartHover";
import type { GlanceData } from "./derive";
import { GlanceCounter, GlanceZone } from "./ui";
import { pcPowerHasAttack } from "../../battle/pcPower";

interface Props {
  char: Character;
  setChar: Dispatch<SetStateAction<Character>>;
  d: GlanceData;
  /** 遭遇模拟器注入：可使用该威能发起攻击（非速览场景缺省）。接收威能词条。 */
  onUsePower?: (p: Entry) => void;
}

// 与人物页威能面板同序、同色；随意威能无需追踪消耗
const SLOT_CATS: { key: keyof PowerSlots; label: string; color: string; track: boolean }[] = [
  { key: "atWill", label: "随意威能", color: POWER_COLORS.atWill, track: false },
  { key: "encounter", label: "遭遇威能", color: POWER_COLORS.encounter, track: true },
  { key: "daily", label: "每日威能", color: POWER_COLORS.daily, track: true },
  { key: "utility", label: "辅助威能", color: POWER_COLORS.utility, track: true },
  { key: "special", label: "种族/职业威能", color: POWER_COLORS.daily, track: true },
];

export const powerUsedKey = (cat: keyof PowerSlots, index: number) => cat + "-" + index;
export const equipUsedKey = (kind: "fixed" | "other" | "consumable" | "wondrous", index: number) =>
  (kind === "fixed" ? "e" : kind === "other" ? "o" : kind === "consumable" ? "c" : "w") + "-" + index;

// 根据当前增强加值，从物品的多等级列表（如 "2 7 12 17 22 27"，对应 ＋1/＋2/＋3…）中反推出对应的单个物品等级
function levelForEnhance(itemLevel: string, enhance: number): number {
  const levels = itemLevels(itemLevel);
  if (!levels.length) return 0;
  const match = levels.find((lv) => enhancementBonusForLevel(lv) === enhance);
  return match ?? levels[Math.max(0, Math.min(enhance - 1, levels.length - 1))] ?? 0;
}

/** 专长的可用频率：从增益/特殊正文里识别「每次遭遇 / 每日」，用于短休、长休恢复与标签展示。 */
export function featUsageTag(f: Entry | undefined): "encounter" | "daily" | undefined {
  if (!f) return undefined;
  const text = (f.benefit ?? "") + " " + String(f.fields?.special ?? "");
  if (/每次遭遇|每遭遇|该遭遇一次/.test(text)) return "encounter";
  if (/每日|每天|一日一次/.test(text)) return "daily";
  return undefined;
}

export function GlancePowers({ char, setChar, d, onUsePower }: Props) {
  const groups = SLOT_CATS.map((c) => {
    const list = char.powerSlots[c.key]
      .map((id, i) => ({ id, i }))
      .filter((x): x is { id: string; i: number } => !!x.id);
    const used = list.filter((x) => char.powerUsed?.[powerUsedKey(c.key, x.i)]).length;
    return { ...c, list, used };
  });
  const tracked = groups.filter((g) => g.track);
  const totalTracked = tracked.reduce((s, g) => s + g.list.length, 0);
  const usedTracked = tracked.reduce((s, g) => s + g.used, 0);
  const empty = groups.every((g) => g.list.length === 0);

  function toggle(cat: keyof PowerSlots, index: number) {
    const key = powerUsedKey(cat, index);
    setChar((p) => {
      const used = { ...(p.powerUsed ?? {}) };
      if (used[key]) delete used[key];
      else used[key] = true;
      return { ...p, powerUsed: used };
    });
  }

  function resetCat(cat: keyof PowerSlots) {
    setChar((p) => {
      const used = { ...(p.powerUsed ?? {}) };
      for (const k of Object.keys(used)) if (k.startsWith(cat + "-")) delete used[k];
      return { ...p, powerUsed: used };
    });
  }

  return (
    <GlanceZone
      label="威能"
      className="z-pow"
      meta={empty ? undefined : <span className="gl-zone-hint">可用 {totalTracked - usedTracked}/{totalTracked}</span>}
    >
      {empty ? (
        <p className="hint">人物页尚未选择威能。选好之后，这里可以逐个点掉已经用出去的威能。</p>
      ) : (
        groups
          .filter((g) => g.list.length > 0)
          .map((g) => (
            <div key={g.key} className="gl-group">
              <div className="gl-group-head">
                <span className="gl-dot" style={{ background: g.color }} />
                <span className="gl-group-name">{g.label}</span>
                <span className="gl-group-count">{g.track ? g.list.length - g.used + " / " + g.list.length : "无限"}</span>
                {g.track && (
                  <button type="button" className="gl-mini-btn" title={"恢复全部" + g.label} disabled={g.used === 0} onClick={() => resetCat(g.key)}>↺</button>
                )}
              </div>
              <div className="gl-chips">
                {g.list.map(({ id, i }) => {
                  const p = d.powerMap.get(id);
                  const used = !!char.powerUsed?.[powerUsedKey(g.key, i)];
                  const name = p ? p.name : id;
                  // 遭遇模拟器注入：可攻击威能 → 在 chip 上额外挂一个 ⚔ 按钮（点击标记已用的语义保持不变）
                  const attackable = !!onUsePower && !!p && pcPowerHasAttack(p);
                  const atkDisabled = attackable && g.track && used;
                  return (
                    <SmartHover
                      key={i}
                      className={"gl-chip" + (used ? " used" : "") + (g.track ? "" : " static")}
                      popClass="gl-pop"
                      portal
                      pop={p ? <EntryCard entry={p} /> : undefined}
                      title={g.track ? (used ? "点击恢复：" + name : "点击标记已使用：" + name) : "随意威能，无需追踪消耗"}
                      onClick={() => g.track && toggle(g.key, i)}
                    >
                      <span className="gl-chip-dot" style={{ background: g.color }} />
                      <span className="gl-chip-name">{name}</span>
                      {p?.actionType && <span className="gl-chip-sub">{p.actionType}</span>}
                      {attackable && p && (
                        <button
                          type="button"
                          className="gl-chip-atk"
                          title={atkDisabled ? `${name} 已用尽，短休/长休后恢复` : "选择此威能发起攻击：在地图上点选目标"}
                          disabled={atkDisabled}
                          onClick={(e) => {
                            e.stopPropagation();
                            onUsePower!(p);
                          }}
                        >
                          ⚔
                        </button>
                      )}
                    </SmartHover>
                  );
                })}
              </div>
            </div>
          ))
      )}
    </GlanceZone>
  );
}

export function GlanceFeats({ char, setChar, d }: Props) {
  const rows = [
    ...char.featSlots.map((id, i) => ({ key: String(i), id, granted: false })).filter((x) => !!x.id),
    ...(char.classGrantedFeatIds ?? []).map((id) => ({ key: "g-" + id, id, granted: true })),
  ];
  const used = rows.filter((r) => char.featUsed?.[r.key]).length;

  function toggle(key: string) {
    setChar((p) => {
      const next = { ...(p.featUsed ?? {}) };
      if (next[key]) delete next[key];
      else next[key] = true;
      return { ...p, featUsed: next };
    });
  }

  return (
    <GlanceZone
      label="专长"
      className="z-feat"
      meta={rows.length === 0 ? undefined : <span className="gl-zone-hint">已用 {used}/{rows.length}</span>}
    >
      {rows.length === 0 ? (
        <p className="hint">人物页尚未选择专长。</p>
      ) : (
        <div className="gl-chips">
          {rows.map((r) => {
            const f = d.featMap.get(r.id);
            const tag = featUsageTag(f);
            const isUsed = !!char.featUsed?.[r.key];
            const name = f ? f.name : r.id;
            return (
              <SmartHover
                key={r.key}
                className={"gl-chip" + (isUsed ? " used" : "")}
                popClass="gl-pop"
                portal
                pop={f ? <EntryCard entry={f} /> : undefined}
                title={isUsed ? "点击恢复：" + name : "点击标记已使用：" + name}
                onClick={() => toggle(r.key)}
              >
                <span className="gl-chip-dot" style={{ background: FEAT_COLOR }} />
                <span className="gl-chip-name">{name}</span>
                {tag && <span className={"gl-chip-tag " + tag}>{tag === "encounter" ? "遭遇" : "每日"}</span>}
                {r.granted && <span className="gl-chip-sub">赠送</span>}
              </SmartHover>
            );
          })}
        </div>
      )}
    </GlanceZone>
  );
}

export function GlanceItems({ char, setChar, d }: Props) {
  const fixed = char.equipmentSlots
    .map((id, i) => ({ id, i }))
    .filter((x): x is { id: string; i: number } => !!x.id)
    .map((x) => ({ key: equipUsedKey("fixed", x.i), id: x.id, slot: EQUIPMENT_SLOTS[x.i] ?? "装备", enhance: d.enhanceOf(x.i), kind: "fixed" as const }));
  const wondrous = char.wondrousSlots.map((id, i) => ({ id, i })).filter((x): x is { id: string; i: number } => !!x.id)
    .map((x) => ({ key: equipUsedKey("wondrous", x.i), id: x.id, slot: "奇物", enhance: 0, kind: "wondrous" as const }));
  const other = char.otherSlots.map((id, i) => ({ id, i })).filter((x): x is { id: string; i: number } => !!x.id)
    .map((x) => ({ key: equipUsedKey("other", x.i), id: x.id, slot: "其他", enhance: 0, kind: "other" as const }));
  const consumable = char.consumableSlots.map((id, i) => ({ id, i })).filter((x): x is { id: string; i: number } => !!x.id)
    .map((x) => ({ key: equipUsedKey("consumable", x.i), id: x.id, slot: "消耗品", enhance: 0, kind: "consumable" as const }));
  const rows = [...fixed, ...wondrous, ...other, ...consumable];
  const used = rows.filter((r) => char.equipmentUsed?.[r.key]).length;

  const dailyMax = magicItemDailyUses(char.level, char.milestones ?? 0);
  const dailyUsed = char.glance.itemDailyUsed;

  function toggle(key: string) {
    setChar((p) => {
      const next = { ...(p.equipmentUsed ?? {}) };
      if (next[key]) delete next[key];
      else next[key] = true;
      return { ...p, equipmentUsed: next };
    });
  }
  const setDaily = (n: number) => setChar((p) => ({ ...p, glance: { ...p.glance, itemDailyUsed: Math.max(0, Math.min(99, n)) } }));

  return (
    <GlanceZone
      label="装备与魔法物品"
      className="z-item"
      meta={rows.length === 0 ? undefined : <span className="gl-zone-hint">已用 {used}/{rows.length}</span>}
      actions={
        <GlanceCounter
          label="每日威能"
          title={"魔法物品每日威能：英雄层 1 次 / 典范层 2 次 / 传奇层 3 次，每达成一个里程碑再 +1（当前上限 " + dailyMax + " 次）"}
          value={dailyUsed + " / " + dailyMax}
          tone={dailyUsed >= dailyMax ? "accent" : "plain"}
          onDec={() => setDaily(dailyUsed - 1)}
          onInc={() => setDaily(dailyUsed + 1)}
        />
      }
    >
      {rows.length === 0 ? (
        <p className="hint">人物页尚未装备魔法物品。装备之后，这里可以记录哪件物品的每日威能已经用过。</p>
      ) : (
        <div className="gl-item-list">
          {rows.map((r) => {
            const it = d.itemMap.get(r.id);
            const isUsed = !!char.equipmentUsed?.[r.key];
            const name = it ? it.name : r.id;
            return (
              <SmartHover
                key={r.key}
                className={"gl-item-row" + (isUsed ? " used" : "")}
                popClass="gl-pop"
                portal
                pop={it ? <EntryCard entry={it} /> : undefined}
                title={isUsed ? "点击恢复：" + name : "点击标记已使用：" + name}
                onClick={() => toggle(r.key)}
              >
                <span className="gl-chip-dot" style={{ background: ITEM_COLOR }} />
                <span className="gl-item-slot">{r.slot}</span>
                <span className="gl-chip-name">{name}</span>
                {r.enhance > 0 && <span className="gl-item-enh">增强 +{r.enhance}</span>}
                {it?.itemLevel && <span className="gl-chip-sub">L{levelForEnhance(it.itemLevel, r.enhance)}</span>}
              </SmartHover>
            );
          })}
        </div>
      )}
    </GlanceZone>
  );
}