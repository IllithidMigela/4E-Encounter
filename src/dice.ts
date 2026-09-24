// 统一投骰工具：解析 NdM+偏 / 纯数值 / +偏 表达式并掷骰
import type { DiceResult } from "./types";

/** 清洗伤害表达式：去掉伤害类型等尾部后缀与中文标点，仅保留先导数值/骰式 */
function cleanExpr(expr: string): string {
  return expr.replace(/[，。、（）()【】\[\]\s·×]/g, "").trim();
}

/**
 * 解析伤害表达式（不掷骰）：提取先导的纯数值 / NdM[±B] 部分。
 * 容忍「2d6+4 光耀」「3 火焰」「1d10+2物理」等带伤害类型后缀的写法；仍解析不出返回 null。
 */
export function parseDiceExpr(expr: string): { diceCount: number; diceSides: number; bonus: number } | null {
  const s = cleanExpr(expr);
  if (!s) return null;
  // 先匹配骰式（避免「4d6+4 光耀」被判成纯数值 4）
  const m = s.match(/^(\d*)d(\d+)([+-]\d+)?/);
  if (m) {
    const diceCount = m[1] ? parseInt(m[1], 10) : 1;
    const diceSides = parseInt(m[2], 10);
    const bonus = m[3] ? parseInt(m[3], 10) : 0;
    if (diceCount <= 0 || diceSides <= 0) return null;
    return { diceCount, diceSides, bonus };
  }
  // 纯数值（先导数字，忽略尾部类型字样）
  if (/^[+-]?\d/.test(s)) return { diceCount: 0, diceSides: 0, bonus: parseInt(s, 10) };
  return null;
}

export function rollDiceExpr(expr: string): DiceResult | null {
  const s = cleanExpr(expr);
  if (!s) return null;

  const p = parseDiceExpr(s);
  if (!p) return null;

  // 纯数值
  if (p.diceSides === 0) {
    return { total: p.bonus, parts: [], expr: s };
  }

  const parts: number[] = [];
  let sum = 0;
  for (let i = 0; i < p.diceCount; i++) {
    const roll = 1 + Math.floor(Math.random() * p.diceSides);
    parts.push(roll);
    sum += roll;
  }
  const total = sum + p.bonus;
  return {
    total,
    parts,
    expr: s,
    nat20: p.diceSides === 20 && p.diceCount === 1 && parts[0] === 20,
    nat1: p.diceSides === 20 && p.diceCount === 1 && parts[0] === 1,
  };
}

/** 掷 d20（用于先攻与攻击） */
export function rollD20(): DiceResult {
  const v = 1 + Math.floor(Math.random() * 20);
  return { total: v, parts: [v], expr: "1d20", nat20: v === 20, nat1: v === 1 };
}

/** 计算表达式「骰子全取最大」的重击伤害（4e 规则：骰子取最大，非翻倍） */
export function maxDamage(expr: string): number {
  const s = cleanExpr(expr);
  const m = s.match(/^(\d*)d(\d+)([+-]\d+)?/);
  if (m) {
    const diceCount = m[1] ? parseInt(m[1], 10) : 1;
    const diceSides = parseInt(m[2], 10);
    const bonus = m[3] ? parseInt(m[3], 10) : 0;
    return diceCount * diceSides + bonus;
  }
  if (/^[+-]?\d/.test(s)) return parseInt(s, 10);
  return 0;
}

/** 把骰点列表格式化为展示串，如 3d6+2 → 「4, 1, 5(+2) = 12」 */
export function formatDiceParts(parts: number[], bonus: number): string {
  const inner = parts.join(" + ");
  const total = parts.reduce((a, b) => a + b, 0) + bonus;
  if (bonus > 0) return inner + " + " + bonus + " = " + total;
  if (bonus < 0) return inner + " − " + Math.abs(bonus) + " = " + total;
  return inner + " = " + total;
}

/** 从伤害表达式提取偏移（重击/伤害展示用） */
export function exprBonus(expr: string): number {
  const s = expr.trim();
  const m = s.match(/([+-]\s*\d+)$/);
  return m ? parseInt(m[1].replace(/\s+/g, ""), 10) : 0;
}
