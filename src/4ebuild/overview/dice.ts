// 速览页掷骰：解析「d20+16」「1d8+7」「2d6-1」这类表达式并投出结果。
// 只在速览页用；指令模式下同一个表达式会被拼成 ".r <表达式>" 复制给骰子机器人。

export interface RollResult {
  label: string;                 // 这次掷骰是什么，如「敏捷检定」「命中 · 敏捷」
  expr: string;                  // 原始表达式，如 d20+16
  faces: number;                 // 骰面数
  rolls: number[];               // 每颗骰子的点数
  modifier: number;              // 加值
  total: number;                 // 合计
  crit: "high" | "low" | null;   // 单颗 d20 的自然 20 / 自然 1
}

const EXPR = /^(\d*)d(\d+)([+-]\d+)?$/i;

/** 取 [1, sides] 的随机点数，优先用密码学随机源（无则退回 Math.random）。 */
function rollDie(sides: number): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    // 拒绝采样，避免取模带来的偏斜
    const limit = Math.floor(0xffffffff / sides) * sides;
    let v = 0;
    do {
      crypto.getRandomValues(buf);
      v = buf[0];
    } while (v >= limit);
    return (v % sides) + 1;
  }
  return Math.floor(Math.random() * sides) + 1;
}

/** 表达式 → 掷骰结果；无法解析时按 d20 处理，保证点击一定有反馈。 */
export function rollExpr(expr: string, label: string): RollResult {
  const m = EXPR.exec(expr.trim());
  const count = m ? Math.max(1, Math.min(20, parseInt(m[1] || "1", 10))) : 1;
  const faces = m ? Math.max(2, Math.min(1000, parseInt(m[2], 10))) : 20;
  const modifier = m && m[3] ? parseInt(m[3], 10) : 0;
  const rolls = Array.from({ length: count }, () => rollDie(faces));
  const sum = rolls.reduce((a, b) => a + b, 0);
  return {
    label,
    expr,
    faces,
    rolls,
    modifier,
    total: sum + modifier,
    // 大成功/大失败只对单颗 d20 有意义（攻击与各类检定）
    crit: faces === 20 && count === 1 ? (rolls[0] === 20 ? "high" : rolls[0] === 1 ? "low" : null) : null,
  };
}

export function fmtSigned(n: number): string {
  return n >= 0 ? "+" + n : String(n);
}
