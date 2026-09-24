// 构建时预解析：把全部怪物属性块解析为 CombatantStats（含威能语义化第 2 层），
// 输出 public/data/powers.json —— 运行时零解析（loadLibrary 直接读取，缺失时回退运行时解析）。
// 同时输出：
//   public/data/powers-report.md —— 解析覆盖率报告（每条威能标 fully/partial/manual + DM 裁决样本清单）
//   控制台摘要（覆盖率 + 目标词条分布）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCreature, parseTargetSpec, xpSanity } from "../src/monsterParse.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcFile = join(root, "public", "data", "creature.json");
const destFile = join(root, "public", "data", "powers.json");
const reportFile = join(root, "public", "data", "powers-report.md");

function exists(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

if (!exists(srcFile)) {
  console.error("[build-creatures] 未找到 " + srcFile + "，请先运行 npm run copy-data");
  process.exit(1);
}
const creatures = JSON.parse(readFileSync(srcFile, "utf8"));

/** 威能覆盖率三档计数 */
const covCount = { fully: 0, partial: 0, manual: 0, noEffect: 0 };
/** 目标词条分布 */
const tgt = { total: 0, enemy: 0, ally: 0, any: 0, forced: 0, condTarget: 0, sizeCond: [] };
/** DM 裁决样本清单（怪物名 → 威能名 → 未解析短语） */
const manualSamples = [];
/** 未解析短语频次（批 4c-3：数字归一化归簇 → TOP 榜，指导下一轮模式扩展） */
const phraseFreq = new Map();

const monsters = {};
let parsedCount = 0;
/** XP 清洗后仍与「等级×类型」表不一致的条目（源数据笔误，交人工复核） */
const xpIssues = [];

for (const e of creatures) {
  const stats = parseCreature(e);
  if (!stats) continue;
  parsedCount++;
  // 归一化：运行态初始 HP = maxHp
  const s = { ...stats, hp: stats.maxHp, tempHp: 0 };
  monsters[e.id] = s;

  // XP 复核：清洗后仍不匹配的列入报告
  const xp = xpSanity(s);
  if (!xp.ok) xpIssues.push(`${e.name} L${s.level} ${s.tier ?? "标准"} xp=${s.xp} 期望${xp.expected}`);

  for (const a of s.attacks) {
    const cov = a.coverage ?? "noEffect";
    covCount[cov]++;
    if (cov !== "noEffect" && cov !== "fully") {
      manualSamples.push({ monster: e.name, power: a.name, coverage: cov, unparsed: a.unparsed ?? [] });
      for (const p of a.unparsed ?? []) {
        // 数字归一化归簇（「推离2格」与「推离5格」视为同簇），保留首个原始样本展示
        const k = p.replace(/\d+/g, "N");
        if (!phraseFreq.has(k)) phraseFreq.set(k, { count: 0, sample: p });
        phraseFreq.get(k).count++;
      }
    }
    // 目标词条分布
    const ts = parseTargetSpec(a.target);
    tgt.total++;
    if (ts.faction === "enemy") tgt.enemy++;
    else if (ts.faction === "ally") tgt.ally++;
    else tgt.any++;
    if (ts.forced) tgt.forced++;
    if (ts.condTarget) tgt.condTarget++;
    if (ts.sizeCond) tgt.sizeCond.push(`${e.name}·${a.name}：${a.target}`);
  }
}

const total = covCount.fully + covCount.partial + covCount.manual + covCount.noEffect;
const out = {
  generatedAt: new Date().toISOString(),
  monsters,
  coverage: {
    total,
    fully: covCount.fully,
    partial: covCount.partial,
    manual: covCount.manual,
    noEffect: covCount.noEffect,
  },
  targetSpecs: {
    total: tgt.total,
    enemy: tgt.enemy,
    ally: tgt.ally,
    any: tgt.any,
    forced: tgt.forced,
    condTarget: tgt.condTarget,
    sizeCond: tgt.sizeCond,
  },
};
mkdirSync(join(root, "public", "data"), { recursive: true });
writeFileSync(destFile, JSON.stringify(out));

// ---------- 覆盖率报告（markdown，供人工补解析） ----------
const pct = (n) => ((n / Math.max(1, total)) * 100).toFixed(1) + "%";
const reportLines = [];
reportLines.push("# 威能解析覆盖率报告（批 1 构建时预解析）");
reportLines.push("");
reportLines.push(`生成时间：${out.generatedAt}`);
reportLines.push(`解析怪物数：${parsedCount} / ${creatures.length}（未解析的为召唤生物/模板，不含属性块）`);
reportLines.push("");
reportLines.push(`## 经验值复核（XP 清洗后仍与「等级×类型」表不一致）`);
reportLines.push("");
if (xpIssues.length === 0) {
  reportLines.push("无。全部怪物 XP 与 4e 等级×类型表一致。");
} else {
  reportLines.push(`| 怪物（L 类型 xp=原文 期望=表值） |`);
  reportLines.push(`| --- |`);
  for (const x of xpIssues) reportLines.push(`| ${x} |`);
}
reportLines.push("");
reportLines.push(`## 覆盖率总览（共 ${total} 条威能）`);
reportLines.push("");
reportLines.push(`| 档位 | 数量 | 占比 | 含义 |`);
reportLines.push(`| --- | --- | --- | --- |`);
reportLines.push(`| fully | ${covCount.fully} | ${pct(covCount.fully)} | 全部效果已语义化，可自动结算 |`);
reportLines.push(`| partial | ${covCount.partial} | ${pct(covCount.partial)} | 部分效果已语义化，剩余需 DM 裁决 |`);
reportLines.push(`| manual | ${covCount.manual} | ${pct(covCount.manual)} | 无任何效果被语义化，全部需 DM 裁决 |`);
reportLines.push(`| noEffect | ${covCount.noEffect} | ${pct(covCount.noEffect)} | 纯伤害/纯描述，无效果可解析 |`);
reportLines.push("");
reportLines.push(`## 目标词条分布（共 ${tgt.total} 条）`);
reportLines.push("");
reportLines.push(`| 维度 | 数量 |`);
reportLines.push(`| --- | --- |`);
reportLines.push(`| 仅敌人 enemy | ${tgt.enemy} |`);
reportLines.push(`| 仅盟友 ally | ${tgt.ally} |`);
reportLines.push(`| 不限 any | ${tgt.any} |`);
reportLines.push(`| forced（强制全选） | ${tgt.forced} |`);
reportLines.push(`| 条件目标 | ${tgt.condTarget} |`);
reportLines.push(`| 体型条件 | ${tgt.sizeCond.length} |`);
if (tgt.sizeCond.length > 0) {
  reportLines.push("");
  reportLines.push(`### 体型条件目标样本`);
  for (const x of tgt.sizeCond) reportLines.push(`- ${x}`);
}
reportLines.push("");
reportLines.push(`## 需 DM 裁决样本（${manualSamples.length} 条）`);
reportLines.push("");
if (manualSamples.length === 0) {
  reportLines.push("无。全部威能效果已语义化。");
} else {
  reportLines.push(`| 怪物 | 威能 | 档位 | 未解析短语 |`);
  reportLines.push(`| --- | --- | --- | --- |`);
  for (const m of manualSamples) {
    reportLines.push(`| ${m.monster} | ${m.power} | ${m.coverage} | ${m.unparsed.join("；")} |`);
  }
}

// ---------- 未解析短语 TOP 榜（批 4c-3：按出现次数，数字归一化归簇；指导下一轮模式扩展） ----------
reportLines.push("");
reportLines.push(`## 未解析短语 TOP 榜（共 ${phraseFreq.size} 簇，按出现次数降序，数字归一化 N）`);
reportLines.push("");
reportLines.push(`| 次数 | 短语样本（首个出现） |`);
reportLines.push(`| --- | --- |`);
const topPhrases = [...phraseFreq.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 40);
for (const [k, v] of topPhrases) reportLines.push(`| ${v.count} | ${v.sample} |`);
writeFileSync(reportFile, reportLines.join("\n"), "utf8");

// ---------- 控制台摘要 ----------
console.log(`[build-creatures] ${parsedCount}/${creatures.length} 怪物已解析 → public/data/powers.json`);
console.log(`[build-creatures] 威能覆盖率: fully=${covCount.fully} partial=${covCount.partial} manual=${covCount.manual} noEffect=${covCount.noEffect}（共 ${total}）`);
console.log(`[build-creatures] 目标词条: enemy=${tgt.enemy} ally=${tgt.ally} any=${tgt.any} forced=${tgt.forced} 条件目标=${tgt.condTarget} 体型条件=${tgt.sizeCond.length}`);
console.log(`[build-creatures] DM 裁决样本 ${manualSamples.length} 条 → public/data/powers-report.md`);
console.log(`[build-creatures] XP 复核：${xpIssues.length} 条不匹配（已清洗，交人工复核）`);
if (topPhrases.length > 0) {
  const top5 = topPhrases.slice(0, 5).map(([k, v]) => `${v.sample.slice(0, 24)}×${v.count}`).join(" | ");
  console.log(`[build-creatures] 未解析短语 TOP 5：${top5}`);
}
