// 统一诊断日志：把「程序运行输出 + 用户操作 + 战斗记录 + 文字状态快照」记进同一份带时间戳的日志，
// 供「导出程序日志」（原始全面）与「导出战斗日志」（筛出战斗/操作相关）复用。
// 目标：即使完全不懂程序，也能把日志整份丢给 AI 还原「做了什么操作、画面当时显示什么、程序有没有报错」。

type Entry = {
  t: number;
  // kind: console=控制台输出（带 level）；op=用户操作；battle=回合/结算记录；snapshot=文字状态快照
  kind: "console" | "op" | "battle" | "snapshot";
  level?: "log" | "info" | "warn" | "error";
  text: string;
};

const RING_MAX = 6000;
let buffer: Entry[] = [];
let installed = false;

/** 追加一条任意分类的诊断记录（供全局导入调用，可在任意模块执行） */
export function logEvt(kind: Entry["kind"], text: string): void {
  try {
    buffer.push({ t: Date.now(), kind, text });
    if (buffer.length > RING_MAX) buffer = buffer.slice(-RING_MAX);
  } catch {
    /* 记录失败不影响功能 */
  }
}

/** 打印到控制台的一份快照文本（用于开发者直接在终端看，同时进日志由 wraps 负责） */

export function installDiagLog(): void {
  if (installed) return;
  installed = true;

  // 让 console 输出也进入统一日志（kind=console, 带 level）
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const wrap = (level: Exclude<Entry["level"], undefined>) =>
    function (...args: unknown[]) {
      logEvt("console", `${level.toUpperCase()} ${args.map(fmtArg).join(" ")}`);
      (orig[level] as (...a: unknown[]) => void).apply(console, args);
    };
  console.log = wrap("log") as typeof console.log;
  console.info = wrap("info") as typeof console.info;
  console.warn = wrap("warn") as typeof console.warn;
  console.error = wrap("error") as typeof console.error;

  window.addEventListener("error", (e) => {
    logEvt("console", `ERROR 全局错误 ${e.message || "(空)"} @ ${e.filename || ""}:${e.lineno ?? "?"} (${e.colno ?? ""})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const detail = r instanceof Error ? r.stack || r.message || String(r) : String(r);
    logEvt("console", `ERROR 未处理的 Promise 拒绝: ${detail}`);
  });
}

function fmtArg(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || v.message || String(v);
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ts(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const KIND_LABEL: Record<Entry["kind"], string> = {
  console: "技术",
  op: "操作",
  battle: "战斗",
  snapshot: "画面快照",
};

/** 导出一行文本 */
function fmtLine(e: Entry): string {
  const tag = e.kind === "console" ? `[${KIND_LABEL[e.kind]}-${e.level?.toUpperCase() ?? ""}]` : `[${KIND_LABEL[e.kind]}]`;
  return `${ts(e.t)} ${tag} ${e.text}`;
}

/** 导出程序日志：整份原样（含 console 技术输出，适合给 AI 排查程序问题） */
export function formatProgramLog(): string {
  const head = `4E 遭遇模拟器 · 程序日志（原始全面版，共 ${buffer.length} 条 / 上限 ${RING_MAX}）\n导出时间：${new Date().toLocaleString()}\n每一行: 时间  [类别] 内容 ; 类别=技术/操作/战斗/画面快照\n${"─".repeat(64)}\n`;
  return head + buffer.map(fmtLine).join("\n") + "\n" + "─".repeat(64) + `\n（日志已完整导出，可整体交给 AI 分析。）`;
}

/** 导出战斗日志：从统一日志中筛出与战斗相关的一层（操作+战斗记录+画面快照，并夹带 program 层的 error/warn），供复盘与排查战斗问题 */
export function formatCombatLog(): string {
  const pick = (e: Entry) =>
    e.kind === "op" || e.kind === "battle" || e.kind === "snapshot" || (e.kind === "console" && (e.level === "error" || e.level === "warn"));
  const picked = buffer.filter(pick);
  const head = `4E 遭遇模拟器 · 战斗日志（建立在统一诊断日志之上，共 ${picked.length} 条）\n导出时间：${new Date().toLocaleString()}\n包含：操作轨迹 + 回合记录 + 文字画面快照 + 关键报错/警告\n每一行: 时间  [类别] 内容 ; 类别=操作/战斗/画面快照/技术-错误\n${"─".repeat(64)}\n`;
  return head + picked.map(fmtLine).join("\n") + "\n" + "─".repeat(64) + "\n（战斗日志基于完整程序日志筛选，缺细节请同时查看程序日志。）";
}