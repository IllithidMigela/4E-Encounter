// 怪物构建器（MonsterBuilder）：积木点选 + 手写双模
// ============================================================
// - 头部数值表单 → CombatantStats 静态字段
// - 威能列表：分区类型 + 名称/射程/攻加值/防御/伤害骰 + 效果文本
//   · 积木拼装区：点选积木生成规范中文句追加到 effectText
//   · 手写 textarea：250ms 防抖实时校验（句级 coverage 高亮）+ 输入预测候选条 + 未识别建议
// - 实时预览：头块 + 威能清单 + 每威能 coverage 汇总
// - 投入战斗：组装 CombatantStats 调 onDeploy（复用 App.addCombatant → 进入放置模式）
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { KIND_LABEL } from "./types";
import type { AttackKind, AttackOption, CombatantStats, DefenseKey } from "./types";
import { blocksByCategory } from "./effectTemplates";
import { validateEffectText, computeCoverage, predict, suggestForSentence, grammarHints, PLACEHOLDER_ZH } from "./effectValidation";

interface Props {
  onDeploy: (stats: CombatantStats) => void;
}

/** 250ms 防抖 */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface MonsterDraft {
  name: string;
  level: string;
  tier: string;
  role: string;
  size: string;
  origin: string;
  category: string;
  hp: string;
  ac: string;
  fort: string;
  ref: string;
  will: string;
  speed: string;
  init: string;
  xp: string;
}

interface AttackDraft {
  key: string;
  kind: AttackKind;
  name: string;
  range: string;
  target: string;
  attack: string;
  defense: DefenseKey;
  damageExpr: string;
  effectText: string;
}

const DEFAULT_DRAFT: MonsterDraft = {
  name: "",
  level: "",
  tier: "",
  role: "",
  size: "中型",
  origin: "自然界",
  category: "魔法兽",
  hp: "50",
  ac: "14",
  fort: "14",
  ref: "14",
  will: "14",
  speed: "6",
  init: "5",
  xp: "",
};

const KIND_ORDER: AttackKind[] = ["standard", "trait", "aura", "move", "minor", "immediate", "free"];

const SIZE_OPTIONS = ["微型", "小型", "中型", "大型", "巨型", "超巨型"];

function newAttack(kind: AttackKind, i: number): AttackDraft {
  // 特性是纯被动效果：不带攻击/命中，攻击相关字段全部留空
  const effectOnly = kind === "trait";
  return {
    key: "b" + Date.now().toString(36) + i,
    kind,
    name: "",
    range: effectOnly ? "" : "近战1",
    target: effectOnly ? "" : "一个生物",
    attack: "",
    defense: "ac",
    damageExpr: "",
    effectText: "",
  };
}

/** 效果文本 → 组装 AttackOption 的 effectSpecs/coverage/unparsed */
function effectMeta(text: string): Pick<AttackOption, "coverage" | "unparsed"> {
  const { coverage, unparsed } = computeCoverage(text);
  return coverage === "fully" ? { coverage } : { coverage, unparsed };
}

function toStats(d: MonsterDraft, attacks: AttackDraft[]): CombatantStats {
  const maxHp = Math.max(1, Number(d.hp) || 1);
  const n = (s: string, def: number) => {
    const v = Number(s);
    return Number.isFinite(v) && v !== 0 ? v : def;
  };
  return {
    kind: "monster",
    name: d.name || "未命名怪物",
    level: n(d.level, 0) || undefined,
    tier: d.tier || undefined,
    role: d.role || undefined,
    xp: n(d.xp, 0) || undefined,
    origin: d.origin || undefined,
    category: d.category || undefined,
    size: 1,
    sizeClass: d.size,
    maxHp,
    bloodied: Math.floor(maxHp / 2),
    hp: maxHp,
    tempHp: 0,
    surgeValue: 0,
    ac: n(d.ac, 10),
    fort: n(d.fort, 10),
    ref: n(d.ref, 10),
    will: n(d.will, 10),
    init: n(d.init, 0),
    speed: n(d.speed, 6),
    attacks: attacks.map((a) => ({
      key: a.key,
      name: a.name || "新能力",
      kind: a.kind,
      range: a.range || "近战1",
      target: a.target || "一个生物",
      attack: a.attack === "" ? null : Number(a.attack),
      defense: a.defense,
      damageExpr: a.damageExpr,
      effectText: a.effectText,
      ...effectMeta(a.effectText),
    })),
  };
}

export default function MonsterBuilder({ onDeploy }: Props) {
  const [draft, setDraft] = useState<MonsterDraft>(DEFAULT_DRAFT);
  const [attacks, setAttacks] = useState<AttackDraft[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const set = (patch: Partial<MonsterDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const patchAttack = (key: string, patch: Partial<AttackDraft>) =>
    setAttacks((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const addAttack = (kind: AttackKind) => setAttacks((list) => [...list, newAttack(kind, list.length)]);
  const removeAttack = (key: string) => {
    setAttacks((list) => list.filter((a) => a.key !== key));
    if (activeKey === key) setActiveKey(null);
  };

  const stats = useMemo(() => toStats(draft, attacks), [draft, attacks]);
  const blockGroups = useMemo(() => blocksByCategory(), []);

  return (
    <div className="es-builder">
      <div className="es-builder-toolbar">
        <div className="es-builder-title">怪物构建器</div>
        <button className="es-builder-deploy" onClick={() => onDeploy(stats)} title="组装为怪物卡并进入战斗放置">
          投入战斗
        </button>
      </div>
      <div className="es-builder-cols">
        <div className="es-builder-left">
          {/* ===== 头部数值区（身份 / 战斗数值 两组） ===== */}
          <div className="es-builder-section">
            <div className="es-builder-section-title">头部数值</div>
            <div className="es-builder-group-label">身份</div>
            <div className="es-builder-grid">
              <Field label="名称" value={draft.name} onChange={(v) => set({ name: v })} placeholder="自定义怪物" />
              <Field label="等级" value={draft.level} onChange={(v) => set({ level: v })} placeholder="5" num />
              <Field label="层级" value={draft.tier} onChange={(v) => set({ tier: v })} placeholder="精英/杂兵/强者" />
              <Field label="职能" value={draft.role} onChange={(v) => set({ role: v })} placeholder="护卫/游击/蛮战…" />
              <Field label="体型" value={draft.size} onChange={(v) => set({ size: v })} select={SIZE_OPTIONS} />
              <Field label="起源" value={draft.origin} onChange={(v) => set({ origin: v })} placeholder="自然界" />
              <Field label="类别" value={draft.category} onChange={(v) => set({ category: v })} placeholder="魔法兽" />
            </div>
            <div className="es-builder-group-label">战斗数值</div>
            <div className="es-builder-grid">
              <Field label="HP" value={draft.hp} onChange={(v) => set({ hp: v })} num />
              <Field label="AC" value={draft.ac} onChange={(v) => set({ ac: v })} num />
              <Field label="强韧" value={draft.fort} onChange={(v) => set({ fort: v })} num />
              <Field label="反射" value={draft.ref} onChange={(v) => set({ ref: v })} num />
              <Field label="意志" value={draft.will} onChange={(v) => set({ will: v })} num />
              <Field label="速度" value={draft.speed} onChange={(v) => set({ speed: v })} num />
              <Field label="先攻" value={draft.init} onChange={(v) => set({ init: v })} num />
              <Field label="XP" value={draft.xp} onChange={(v) => set({ xp: v })} placeholder="200" num />
            </div>
          </div>

          {/* ===== 威能列表 ===== */}
          <div className="es-builder-section">
            <div className="es-builder-section-title">威能（拼装）</div>
            <div className="es-builder-addrow">
              {KIND_ORDER.map((k) => (
                <button key={k} className="es-builder-add" onClick={() => addAttack(k)}>
                  +{KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {attacks.length === 0 && <div className="es-builder-empty">点上方按钮添加威能/特性分区</div>}
            {attacks.map((a, i) => (
              <PowerEditor
                key={a.key}
                a={a}
                blocks={blockGroups}
                onChange={(patch) => {
                  setActiveKey(a.key);
                  patchAttack(a.key, patch);
                }}
                onActive={() => setActiveKey(a.key)}
                onRemove={() => removeAttack(a.key)}
                index={i}
              />
            ))}
          </div>
        </div>

        {/* ===== 实时预览（wiki 属性块样式，常驻贴边） ===== */}
        <div className="es-builder-right">
          <div className="es-builder-section">
            <div className="es-builder-section-title">预览（投入战斗前检查）</div>
            {stats.attacks.length === 0 && <div className="es-builder-empty">尚未添加任何威能</div>}
            <StatBlockPreview stats={stats} activeKey={activeKey} />
          </div>
        </div>
      </div>
    </div>
  );
}

const DEFENSE_CN: Record<DefenseKey, string> = { ac: "AC", fort: "强韧", ref: "反射", will: "意志" };

/** 动作分区 → wiki 属性块分类头文案 */
const CAT_CN: Record<AttackKind, string> = {
  standard: "标准动作",
  move: "移动动作",
  minor: "次要动作",
  free: "自由动作",
  immediate: "触发动作",
  aura: "灵气",
  trait: "特性",
};

/** 预览描述行：仅有命中加值时显示攻击行（特性等被动效果不显示），行间用 <br/> 分隔 */
function previewLines(a: AttackOption): string[] {
  const lines: string[] = [];
  if (a.attack !== null) lines.push(`攻击：${a.range}（${a.target}）；+${a.attack} vs. ${DEFENSE_CN[a.defense]}`);
  if (a.damageExpr) lines.push(`伤害：${a.damageExpr}`);
  if (a.effectText) lines.push(`效果：${a.effectText}`);
  if (a.unparsed && a.unparsed.length > 0) lines.push(`未识别：${a.unparsed.join("；")}`);
  return lines;
}

/** 语法提示的剩余部分：{v}→N、{type}→类型 等占位符用强调样式显示 */
function PatternRest({ s }: { s: string }) {
  const parts = s.split(/(\{\w+\})/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        /^\{\w+\}$/.test(p) ? (
          <em key={i} className="es-builder-ghint-ph">
            {PLACEHOLDER_ZH[p.slice(1, -1)] ?? "…"}
          </em>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * 结构化怪物属性块：复刻 wiki 属性块（estk-wiki / wst-*）的 div 视觉，
 * 直接从 CombatantStats 渲染（不依赖 rawText），供构建器右侧实时预览。
 */
function StatBlockPreview({ stats, activeKey }: { stats: CombatantStats; activeKey?: string | null }) {
  const titleSub = [stats.level ? `${stats.level}级` : "", stats.tier, stats.role].filter(Boolean).join(" ");
  const subtitleLeft = [stats.sizeClass, stats.origin, stats.category].filter(Boolean).join(" ");
  const subtitleRight = stats.xp ? `XP ${stats.xp}` : "";
  const groups = KIND_ORDER.map((k) => ({ kind: k, items: stats.attacks.filter((a) => a.kind === k) })).filter(
    (g) => g.items.length > 0,
  );
  const fmtInit = stats.init > 0 ? `+${stats.init}` : String(stats.init);
  const powerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 编辑区聚焦某威能 → 预览自动滚到对应威能并高亮
  useEffect(() => {
    if (activeKey && powerRefs.current[activeKey]) {
      powerRefs.current[activeKey]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeKey]);

  return (
    <div className="estk-wiki estk-wiki--pin">
      <div className="estk-wiki-scroll">
        {/* 头部（名字/副标题/数值行）随栏常驻，滚动拼装威能时仍可见 */}
        <div className="estk-wiki-pin">
          <div className="wst-title">
            <span>
              <span>{stats.name}</span>
              {titleSub && <span>{titleSub}</span>}
            </span>
          </div>
          {(subtitleLeft || subtitleRight) && (
            <div className="wst-subtitle">
              <span>{subtitleLeft}</span>
              {subtitleRight && <span>{subtitleRight}</span>}
            </div>
          )}
          <div className="wst-stat">
            <span>
              <span className="wst-hp">
                <strong>生命值</strong>
                <span className="wst-hp-val">
                  {stats.maxHp}
                  {stats.maxHp > 1 && <i className="wst-hp-max">/{stats.maxHp}</i>}
                </span>
                {stats.maxHp > 1 && <span className="wst-bloodied">重伤 {stats.bloodied}</span>}
              </span>
              <span className="wst-fv">
                <strong>先攻</strong>
                <span>{fmtInit}</span>
              </span>
            </span>
          </div>
          <div className="wst-stat">
            <span>
              {([["AC", stats.ac], ["强韧", stats.fort], ["反射", stats.ref], ["意志", stats.will]] as const).map(([l, v]) => (
                <span className="wst-fv" key={l}>
                  <strong>{l}</strong>
                  <span>{v}</span>
                </span>
              ))}
            </span>
            <span>
              <span className="wst-fv">
                <strong>速度</strong>
                <span>{stats.speed}</span>
              </span>
            </span>
          </div>
        </div>
        {groups.length === 0 && <div className="wst-desc">（无威能）</div>}
        {groups.map((g) => (
          <div key={g.kind}>
            <div className="wst-cat">{CAT_CN[g.kind]}</div>
          {g.items.map((a) => (
            <div
              key={a.key}
              ref={(el) => {
                powerRefs.current[a.key] = el;
              }}
              className={a.key === activeKey ? "es-builder-preview-active" : undefined}
            >
              <div className="wst-power">
                <span>{a.name || "新能力"}</span>
                {a.coverage === "partial" && <span className="wst-pcov partial" title="已解析主体，部分效果需 DM 裁决">部分自动</span>}
                {a.coverage === "manual" && <span className="wst-pcov manual" title="解析不出可执行效果，由 DM 裁决">需裁决</span>}
              </div>
              <div className="wst-desc">
                {previewLines(a).map((l, i) => (
                  <Fragment key={i}>
                    {i > 0 && <br />}
                    {l}
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  num?: boolean;
  select?: string[];
}) {
  const { label, value, onChange, placeholder, num, select } = props;
  return (
    <label className="es-builder-field">
      <span className="es-builder-field-label">{label}</span>
      {select ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {select.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          type={num ? "number" : "text"}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function PowerEditor(props: {
  a: AttackDraft;
  blocks: ReturnType<typeof blocksByCategory>;
  onChange: (patch: Partial<AttackDraft>) => void;
  onRemove: () => void;
  onActive: () => void;
  index: number;
}) {
  const { a, blocks, onChange, onRemove, onActive, index } = props;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  const debounced = useDebouncedValue(a.effectText, 250);
  const reports = useMemo(() => validateEffectText(debounced), [debounced]);
  const candidates = useMemo(() => predict(a.effectText, cursor, 5), [a.effectText, cursor]);
  const hints = useMemo(() => grammarHints(a.effectText, cursor, 3), [a.effectText, cursor]);
  const suggestions = useMemo(() => {
    const out: { block: string; label: string; insert: string; from: string }[] = [];
    for (const r of reports) {
      if (r.cov === "fully") continue;
      for (const s of suggestForSentence(r.text)) out.push({ ...s, from: r.text });
    }
    return out.slice(0, 4);
  }, [reports]);

  const appendSentence = (sentence: string) => {
    onChange({ effectText: a.effectText ? `${a.effectText}。${sentence}` : sentence });
  };

  const insertAtCursor = (text: string) => {
    const ta = taRef.current;
    const pos = ta ? ta.selectionStart : a.effectText.length;
    const end = ta ? ta.selectionEnd : pos;
    const next = a.effectText.slice(0, pos) + text + a.effectText.slice(end);
    onChange({ effectText: next });
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.focus();
        const p = pos + text.length;
        taRef.current.setSelectionRange(p, p);
        setCursor(p);
      }
    });
  };

  const badCount = reports.filter((r) => r.cov !== "fully").length;

  return (
    <div className={"es-builder-power" + (collapsed ? " collapsed" : "")}>
      <div className="es-builder-phead">
        <button className="es-builder-pfold" onClick={() => setCollapsed((c) => !c)} title={collapsed ? "展开编辑" : "收起编辑"}>
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="es-builder-pkind">{KIND_LABEL[a.kind]}</span>
        <input className="es-builder-pname" value={a.name} placeholder="威能名称" onChange={(e) => onChange({ name: e.target.value })} />
        {a.kind !== "trait" && (
          <>
            <input className="es-builder-prange" value={a.range} placeholder="近战1" onChange={(e) => onChange({ range: e.target.value })} />
            <input className="es-builder-ptarget" value={a.target} placeholder="一个生物" onChange={(e) => onChange({ target: e.target.value })} />
            <input className="es-builder-patk" value={a.attack} type="number" placeholder="攻+5" onChange={(e) => onChange({ attack: e.target.value })} />
            <select className="es-builder-pdef" value={a.defense} onChange={(e) => onChange({ defense: e.target.value as DefenseKey })}>
              <option value="ac">AC</option>
              <option value="fort">强韧</option>
              <option value="ref">反射</option>
              <option value="will">意志</option>
            </select>
            <input className="es-builder-pdmg" value={a.damageExpr} placeholder="伤害 2d6+4" onChange={(e) => onChange({ damageExpr: e.target.value })} />
          </>
        )}
        <button className="es-builder-pdel" onClick={onRemove} title="移除该威能">×</button>
      </div>

      {!collapsed && (
        <div className="es-builder-pbody">
        {/* 积木拼装区 */}
        <div className="es-builder-blocks-palette">
          {blocks.map((g) => (
            <div key={g.category} className="es-builder-blockcat">
              <span className="es-builder-blockcat-title">{g.category}</span>
              {g.blocks.map((b) => (
                <button key={b.id} className="es-builder-block" title={b.pattern} onClick={() => appendSentence(b.toText(b.defaults))}>
                  {b.name}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* 手写区 + 实时校验 */}
        <div className="es-builder-edit">
          <textarea
            ref={taRef}
            className="es-builder-textarea"
            value={a.effectText}
            placeholder="手写效果文本，例如：目标受到3d8+12寒冷和火焰伤害，且目标晕眩直到其下回合结束。"
            rows={3}
            onChange={(e) => {
              onChange({ effectText: e.target.value });
              setCursor(e.target.selectionStart);
            }}
            onClick={(e) => {
              setCursor(e.currentTarget.selectionStart);
              onActive();
            }}
            onFocus={onActive}
            onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
          />
          <div className="es-builder-status">
            <span className={"es-builder-cov " + (badCount === 0 ? "fully" : badCount === reports.length ? "manual" : "partial")}>
              {badCount === 0 ? "全部可识别" : `${badCount}/${reports.length} 句需注意`}
            </span>
            {/* 句级高亮：每个句子一个色点 */}
            {reports.map((r, i) => (
              <span key={i} className={"es-builder-sent " + r.cov} title={r.cov === "fully" ? r.text : `未识别：${r.unparsed.join("；")}`}>
                {r.cov === "fully" ? "●" : r.cov === "partial" ? "◐" : "○"}
              </span>
            ))}
          </div>
          {/* 语法提示：正在书写的可识别语法骨架（已写部分高亮 + 占位符） */}
          {hints.length > 0 && (
            <div className="es-builder-ghints">
              {hints.map((h) => (
                <button
                  key={h.id}
                  className="es-builder-ghint"
                  onClick={() => appendSentence(h.insert)}
                  title={`语法：${h.pattern}\n点按追加：${h.insert}`}
                >
                  <span className="es-builder-ghint-matched">{h.pattern.slice(0, h.cover)}</span>
                  <PatternRest s={h.pattern.slice(h.cover)} />
                </button>
              ))}
            </div>
          )}
          {candidates.length > 0 && (
            <div className="es-builder-cands">
              {candidates.map((c) => (
                <button key={c.id + c.label} className="es-builder-cand" onClick={() => insertAtCursor(c.insert)} title={c.insert}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="es-builder-suggests">
              {suggestions.map((s, i) => (
                <div key={i} className="es-builder-suggest">
                  <span className="es-builder-suggest-from">「{s.from.slice(0, 18)}…」</span>
                  <span className="es-builder-suggest-arrow">→</span>
                  <button onClick={() => appendSentence(s.insert)} title={s.insert}>
                    是否想写：{s.label}？
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="es-builder-seq">威能 #{index + 1}</div>
        </div>
        </div>
      )}
    </div>
  );
}
