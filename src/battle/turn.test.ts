// 阶段 0 重构的纯函数单测：锁定「改前/改后行为一致」，防后续抽取回归。
// 夹具构造仅含触发所必需字段，避免维护一份巨型 Combatant 快照。
import { describe, it, expect } from "vitest";
import type { AttackOption, Combatant } from "../types";
import { advanceActor, expiredConditionTargets, settleTurnStart, rollEndSaves, forcedStep } from "./turn";
import { applyCombatantHitDamage, hitDamageLogText, attackRollLogText, objectHitLogText, objectImmuneLogText, resolveCombatantHitDamages, splitAttackSpecs, collectHitReactions, hasMountableEffect } from "./resolve";
import { applyOaDamage, type OAProvoker, type OAResult } from "./triggers";

function mk(cid: string, over: Partial<Combatant> = {}): Combatant {
  return {
    kind: "monster",
    name: cid,
    cid,
    size: 1,
    maxHp: 50,
    bloodied: 25,
    hp: 50,
    tempHp: 0,
    surgeValue: 10,
    ac: 12,
    fort: 12,
    ref: 12,
    will: 12,
    init: 5,
    speed: 6,
    attacks: [],
    pos: { x: 0, y: 0 },
    conditions: [],
    initResult: 5,
    ...over,
  };
}

function mkPower(name: string): AttackOption {
  return { key: name, name, kind: "standard", range: "近战1", target: "一个生物", attack: 0, defense: "ac", damageExpr: "1d10", effectText: "" };
}

function mkOa(over: Partial<OAResult>): OAResult {
  const provoker: OAProvoker = { enemyCid: "e1", power: mkPower("借机斩"), atIndex: 0, fromCell: { x: 1, y: 1 } };
  return {
    provoker,
    enemyName: "矮人",
    d20: 12,
    attackBonus: 5,
    markedBonus: 0,
    total: 17,
    hit: true,
    crit: false,
    fumble: false,
    defense: 12,
    defenseLabel: "AC",
    damage: 8,
    applied: true,
    ...over,
  };
}

describe("advanceActor", () => {
  it("跳过已死棋子，停在第一个存活者（不跨轮）", () => {
    const a = mk("a");
    const b = mk("b", { hp: -30 });
    const c = mk("c");
    const r = advanceActor([a, b, c], ["a", "b", "c"], 0, 1); // 当前为 a，下一 b 已死 → 应跳到未跨轮点的 c
    expect(r.cid).toBe("c");
    expect(r.nextIndex).toBe(2);
    expect(r.wrapped).toBe(false);
    expect(r.newRound).toBe(1);
  });

  it("不跨轮：走到下一位存活者，轮数不变", () => {
    const a = mk("a");
    const b = mk("b");
    const r = advanceActor([a, b], ["a", "b"], 0, 3);
    expect(r.cid).toBe("b");
    expect(r.wrapped).toBe(false);
    expect(r.newRound).toBe(3);
  });

  it("跨轮：从末位前进到首位 → wrapped 且轮数 +1", () => {
    const a = mk("a");
    const b = mk("b");
    const r = advanceActor([a, b], ["a", "b"], 1, 2);
    expect(r.cid).toBe("a");
    expect(r.wrapped).toBe(true);
    expect(r.newRound).toBe(3);
  });

  it("turnOrder 为空时安全返回", () => {
    const r = advanceActor([], [], 0, 1);
    expect(r.cid).toBe("");
    expect(r.wrapped).toBe(false);
  });
});

describe("expiredConditionTargets", () => {
  const marked = mk("m", { conditions: ["marked"] as Combatant["conditions"], condUntil: { marked: { at: "end", source: "m" } } });

  it("轮到持有者回合边界 → 移除对应到期状态并返回该棋子", () => {
    const cleared = expiredConditionTargets([marked], "m", "end");
    expect(cleared.length).toBe(1);
    expect(cleared[0].conditions).not.toContain("marked");
    expect(cleared[0].condUntil?.marked).toBeUndefined();
  });

  it("未轮到持有者边界 → 无变化", () => {
    const cleared = expiredConditionTargets([marked], "other", "end");
    expect(cleared.length).toBe(0);
  });
});

describe("settleTurnStart", () => {
  it("再生回血 + 持续伤害结算，且 ongoingOnly/curState 语义正确", () => {
    const c = mk("x", { hp: 40, regeneration: 5, ongoingDamage: [{ type: "fire", value: 4, saveOn: "end" }] });
    const s = settleTurnStart(c);
    expect(s.regenHealed).toBe(5);
    expect(s.ongoingTotal).toBe(4);
    expect(s.ongoingParts).toContain("持续火焰伤害 4");
    // 仅持续伤害 on 原态（死亡判定）
    expect(s.ongoingOnly.hp).toBe(36);
    // 再生+持续伤害 最终（死亡豁免状态判定）
    expect(s.curState.hp).toBe(41);
  });

  it("无再生/无持续伤害时零值", () => {
    const c = mk("x");
    const s = settleTurnStart(c);
    expect(s.regenHealed).toBe(0);
    expect(s.ongoingTotal).toBe(0);
    expect(s.ongoingParts).toHaveLength(0);
  });
});

describe("rollEndSaves", () => {
  it("无持续伤害 → hasOngoing=false 短路", () => {
    const c = mk("x");
    const r = rollEndSaves(c, () => 10);
    expect(r.hasOngoing).toBe(false);
    expect(r.rolls).toHaveLength(0);
    expect(r.next).toBe(c);
  });

  it("逐项豁免：失败保留、成功移除，统计成功数", () => {
    const c = mk("x", { ongoingDamage: [{ type: "fire", value: 4, saveOn: "end" }, { type: "poison", value: 3, saveOn: "end" }] });
    const rolls = [5, 12]; // fire 失败 / poison 成功
    const r = rollEndSaves(c, () => rolls.shift()!);
    expect(r.hasOngoing).toBe(true);
    expect(r.success).toBe(1);
    expect(r.rolls).toHaveLength(2);
    expect(r.next.ongoingDamage).toHaveLength(1);
    expect(r.next.ongoingDamage![0].type).toBe("fire");
  });
});

describe("forcedStep", () => {
  it("无障碍时该方向最远可达为 maxDist，本步目标为邻格", () => {
    const r = forcedStep(mk("m", { pos: { x: 2, y: 2 } }), { dx: 1, dy: 0 }, 5, 20, 20, new Set(), []);
    expect(r.reach).toBe(5);
    expect(r.to).toEqual({ x: 3, y: 2 });
  });

  it("中途障碍截止可达数，但本步目标仍为邻格", () => {
    const r = forcedStep(mk("m", { pos: { x: 2, y: 2 } }), { dx: 1, dy: 0 }, 5, 20, 20, new Set(["4,2"]), []);
    expect(r.reach).toBe(1); // 第 1 步 {3,2} 通，第 2 步 {4,2} 堵
    expect(r.to).toEqual({ x: 3, y: 2 });
  });

  it("首步就被其它棋子占据 → 不可达", () => {
    const other = mk("o", { pos: { x: 3, y: 2 } });
    const r = forcedStep(mk("m", { pos: { x: 2, y: 2 } }), { dx: 1, dy: 0 }, 5, 20, 20, new Set(), [other]);
    expect(r.reach).toBe(0);
  });

  it("出界不可达", () => {
    const r = forcedStep(mk("m", { pos: { x: 19, y: 2 } }), { dx: 1, dy: 0 }, 1, 20, 20, new Set(), []);
    expect(r.reach).toBe(0);
  });
});

describe("applyCombatantHitDamage", () => {
  const noShield = () => null as number | null;

  it("普通命中：扣血满额，absorbed=0，不致死", () => {
    const r = applyCombatantHitDamage(mk("v", { hp: 30 }), 12, noShield);
    expect(r.next.hp).toBe(18);
    expect(r.dealt).toBe(12);
    expect(r.absorbed).toBe(0);
    expect(r.died).toBe(false);
  });

  it("临时生命吸收：dealt 只含落到生命的伤害，absorbed=被吸收量", () => {
    const r = applyCombatantHitDamage(mk("v", { hp: 30, tempHp: 5 }), 12, noShield);
    expect(r.dealt).toBe(7); // 12 中 5 被 tempHp 吸收，7 算生命伤害
    expect(r.absorbed).toBe(5);
    expect(r.next.hp).toBe(23);
  });

  it("主人守护减半：注入 halfDamage 返回护盾，只承受一半", () => {
    const r = applyCombatantHitDamage(mk("v", { hp: 30 }), 20, () => 10);
    expect(r.dealt).toBe(10);
    expect(r.next.hp).toBe(20);
    expect(r.absorbed).toBe(10);
  });

  it("怪物致死判定（hp≤0）", () => {
    const r = applyCombatantHitDamage(mk("v", { hp: 6, bloodied: 3 }), 25, noShield);
    expect(r.died).toBe(true);
    expect(r.next.hp).toBeLessThanOrEqual(0);
  });

  it("PC 濒死（0 至 -bloodied）不死，至 -bloodied 才判定死亡", () => {
    const pc = (hp: number) => mk("p", { kind: "pc", hp, bloodied: 10, maxHp: 40 });
    // 生命 5，命中 10 → HP -5（在 -bloodied=-10 之上）→ 濒死但未死
    expect(applyCombatantHitDamage(pc(5), 10, noShield).died).toBe(false);
    // 生命 1，命中 12 → HP -11 ≤ -10 → 死亡
    expect(applyCombatantHitDamage(pc(1), 12, noShield).died).toBe(true);
  });
});

describe("hitDamageLogText", () => {
  it("健康：无吸收/掷骰注记、无伤势后缀", () => {
    expect(hitDamageLogText("兽人", 12, 0, 30, 50, 25, [])).toBe("兽人 受到 12 点伤害，HP 30/50");
  });

  it("含掷骰注记与临时生命吸收注记", () => {
    expect(hitDamageLogText("兽人", 12, 5, 23, 50, 5, ["1d8+4"])).toBe(
      "兽人 受到 12 点伤害（5 点被临时生命吸收）（骰子：1d8+4），HP 23/50",
    );
  });

  it("伤势推导：濒死(hp≤0) 优先于 重伤(hp≤bloodied)", () => {
    expect(hitDamageLogText("怪物", 25, 0, -5, 40, 10, [])).toBe("怪物 受到 25 点伤害，HP -5/40（濒死）");
    expect(hitDamageLogText("怪物", 25, 0, 8, 40, 10, [])).toBe("怪物 受到 25 点伤害，HP 8/40（重伤）");
  });
});

describe("attackRollLogText", () => {
  const base = {
    attackerName: "法师",
    targetName: "兽人",
    power: "火球术",
    crit: false,
    fumble: false,
    roll: 10,
    attackBonus: 8,
    modTotal: 0,
    total: 18,
    defenseLabel: "AC",
    defense: 16,
    hit: true,
  };

  it("单段命中：读数模板 + 结尾【威能名】", () => {
    expect(attackRollLogText(base)).toBe("法师 对 兽人：d20 10 +8 = 18 vs AC 16，【火球术】命中。");
  });

  it("单段未命中 + 调整值注记", () => {
    expect(attackRollLogText({ ...base, hit: false, modTotal: 2 })).toBe(
      "法师 对 兽人：d20 10 +8 +2（调整值） = 18 vs AC 16，【火球术】未命中。",
    );
  });

  it("多重攻击分段：开头【威能名】+ 段名，结尾直接命中", () => {
    expect(attackRollLogText({ ...base, seg: { n: 2, name: "2 段" } })).toBe("法师 对 兽人【火球术】第2段（2 段）：d20 10 +8 = 18 vs AC 16，命中。");
    expect(attackRollLogText({ ...base, seg: { n: 1, name: "横扫" } })).toBe("法师 对 兽人【火球术】第1段（横扫）：d20 10 +8 = 18 vs AC 16，命中。");
  });

  it("重击：固定⭐文案（单段/分段）", () => {
    expect(attackRollLogText({ ...base, crit: true })).toBe("⚡ 法师 对 兽人 掷出天然20，【火球术】重击命中！");
    expect(attackRollLogText({ ...base, crit: true, seg: { n: 2, name: "2 段" } })).toBe("⚡ 法师 对 兽人 第2段掷出天然20，【火球术】重击命中！");
  });

  it("失手：固定✗文案", () => {
    expect(attackRollLogText({ ...base, fumble: true })).toBe("✗ 法师 对 兽人 掷出天然1，【火球术】失手！");
  });
});

describe("objectHitLogText / objectImmuneLogText", () => {
  it("对象命中：HP 按 0 钳制，未毁为 warn", () => {
    const r = objectHitLogText("木门", 30, 50, 60);
    expect(r).toEqual({ text: "木门 受到 30 点伤害，HP 20/60", level: "warn", hp: 20 });
  });
  it("对象摧毁：HP 归 0 且标注，level=crit", () => {
    const r = objectHitLogText("木门", 80, 50, 60);
    expect(r).toEqual({ text: "木门 受到 80 点伤害，HP 0/60，被破坏摧毁！", level: "crit", hp: 0 });
  });
  it("免疫文案：意志→对抗意志的攻击，其余按类型标签", () => {
    expect(objectImmuneLogText("石像", "will", undefined)).toBe("石像 免疫对抗意志的攻击，不受影响。");
    expect(objectImmuneLogText("石像", "ac", "fire")).toBe("石像 免疫火焰伤害，不受影响。");
    expect(objectImmuneLogText("石像", "ac", "unknown")).toBe("石像 免疫该类型伤害，不受影响。");
  });
});

describe("resolveCombatantHitDamages", () => {
  const noShield = () => null as number | null;
  const mkTarget = (cid: string, over: Partial<import("../types").TargetResolution> = {}) => ({
    cid, name: cid, hit: false, crit: false, fumble: false, roll: 10, attackBonus: 5,
    modTotal: 0, total: 15, damageTotal: 0, defense: 14, defenseLabel: "AC", ...over,
  });
  const combatants = [
    { cid: "a", hp: 30, bloodied: 5 },
    { cid: "b", hp: 8, bloodied: 5 },
  ].map((x) => mk(x.cid, { hp: x.hp, bloodied: x.bloodied }));
  const find = (cid: string) => combatants.find((c) => c.cid === cid);

  it("只收命中且伤害>0 的目标", () => {
    const out = resolveCombatantHitDamages(
      [
        mkTarget("a", { hit: true, damageTotal: 10 }),
        mkTarget("a", { cid: "miss", hit: false, damageTotal: 20 }), // 未命中
        mkTarget("a", { cid: "zero", hit: true, damageTotal: 0 }), // 0 伤
        mkTarget("a", { cid: "gone", hit: true, damageTotal: 10 }), // 找不到战斗员
      ],
      find,
      noShield,
    );
    expect(out).toHaveLength(1);
    expect(out[0].t.cid).toBe("a");
    expect(out[0].c.hp).toBe(20);
    expect(out[0].dealt).toBe(10);
    expect(out[0].died).toBe(false);
  });

  it("致死判定落到结果", () => {
    const out = resolveCombatantHitDamages([mkTarget("b", { hit: true, damageTotal: 99 })], find, noShield);
    expect(out[0].died).toBe(true);
  });
});

describe("splitAttackSpecs", () => {
  const s = (over: Partial<import("../types").EffectSpec> & { kind: import("../types").EffectSpec["kind"] }) => over as import("../types").EffectSpec;
  it("按 when 拆命中/失手，推拉滑单列", () => {
    const all = [
      s({ kind: "condition", when: "hit" }),
      s({ kind: "mark", when: "miss" }),
      s({ kind: "ongoing" }), // 恒生效
      s({ kind: "push", when: "hit" }),
      s({ kind: "slide" }), // 恒定强制移动
    ];
    const { hitSpecs, missSpecs, fmSpecs } = splitAttackSpecs(all);
    // hitSpecs：非 miss（condition-hit, ongoing, push-hit, slide）
    expect(hitSpecs.map((x) => x.kind)).toEqual(["condition", "ongoing", "push", "slide"]);
    // missSpecs：非 hit（mark-miss, ongoing, slide）
    expect(missSpecs.map((x) => x.kind)).toEqual(["mark", "ongoing", "slide"]);
    // fmSpecs：命中段里的推拉滑（push-hit, slide）
    expect(fmSpecs.map((x) => x.kind)).toEqual(["push", "slide"]);
  });
  it("空列表安全", () => {
    const out = splitAttackSpecs([]);
    expect(out.hitSpecs).toHaveLength(0);
    expect(out.missSpecs).toHaveLength(0);
    expect(out.fmSpecs).toHaveLength(0);
  });
});

describe("collectHitReactions", () => {
  const mkT = (cid: string, name: string): import("../types").TargetResolution => ({
    cid, name, hit: true, crit: false, fumble: false, roll: 10, attackBonus: 5,
    modTotal: 0, total: 15, damageTotal: 10, defense: 14, defenseLabel: "AC",
  });
  it("仅收集存活命中者的反应，跳过死亡目标", () => {
    const hurt = [
      { t: mkT("a", "A"), c: mk("a", { hp: 30 }), dealt: 5, absorbed: 0, died: false },
      { t: mkT("b", "B"), c: mk("b", { hp: -5 }), dealt: 20, absorbed: 0, died: true }, // 死亡
    ];
    const reactions = collectHitReactions(hurt, (target) => [`r-${target.cid}`]);
    expect(reactions).toEqual(["r-a"]);
  });
  it("空/全伤亡安全", () => {
    expect(collectHitReactions([], () => ["x"])).toEqual([]);
    const hurt = [{ t: mkT("b", "B"), c: mk("b", { hp: 0 }), dealt: 20, absorbed: 0, died: false }];
    expect(collectHitReactions(hurt, () => ["x"])).toEqual([]);
  });
});

describe("hasMountableEffect", () => {
  const t = mk("v", { hp: 20 });

  it("无目标或无效力段 → false", () => {
    expect(hasMountableEffect([], [], () => null)).toBe(false);
    expect(hasMountableEffect([t], [], null as never)).toBe(false);
  });

  it("存在任一目标被应用到 → true", () => {
    const spec = {};
    expect(hasMountableEffect([mk("a", {}), t], [spec as never], (c) => (c.cid === "v" ? { cid: "v" } : null))).toBe(true);
  });

  it("全体目标均不可应用 → false", () => {
    expect(hasMountableEffect([mk("a", {}), mk("b", {})], [{} as never], () => null)).toBe(false);
  });
});

describe("applyOaDamage", () => {
  it("命中伤害累积并保持存活", () => {
    const victim = mk("v", { hp: 20, bloodied: 10 });
    const out = applyOaDamage(victim, [mkOa({ damage: 12 })], "oa");
    expect(out.hits).toHaveLength(1);
    expect(out.next.hp).toBe(8);
    expect(out.died).toBe(false);
    // oa 分支文案不含【威能名】
    expect(out.hits[0].rollText).toContain("借机攻击");
    expect(out.hits[0].rollText).not.toContain("【");
  });

  it("reaction 分支文案含【威能名】", () => {
    const victim = mk("v", { hp: 20 });
    const out = applyOaDamage(victim, [mkOa({ damage: 3 })], "reaction");
    expect(out.hits[0].rollText).toContain("被命中反应【借机斩】");
  });

  it("非 applied 或 0 伤害不结算", () => {
    const victim = mk("v", { hp: 20 });
    const out = applyOaDamage(victim, [mkOa({ applied: false }), mkOa({ damage: 0 })], "oa");
    expect(out.hits).toHaveLength(0);
    expect(out.next.hp).toBe(20);
  });

  it("致死判定（怪物 hp<=0）", () => {
    const victim = mk("v", { hp: 6, bloodied: 3 });
    const out = applyOaDamage(victim, [mkOa({ damage: 25 })], "oa");
    expect(out.died).toBe(true);
    expect(out.next.hp).toBeLessThanOrEqual(0);
  });
});