// 怪物属性块 · wiki 渲染 + 实时战斗数据（可操作）
// 输入为 TiddlyWiki 源码（rawText）：''标签'' → <strong>，{{$:/dnd/images/xxx}} → 图标
// 复刻 wiki 视觉：深橄榄标题条(#4D5C2D)、分类头(#70794D)、威能条(#C8C3B4)、米色数据行(#E6E7D6)
// 与原样渲染不同，本组件把属性块与 Combatant 实时状态绑定：
//  - HP 行显示实时 hp/maxHp/重伤/临时HP（调整模块已并入右栏「动态数据」表）
//  - AC/强韧/反射/意志/速度/先攻 显示实时值，点击即可就地编辑
//  - 威能行（bold bg-power）匹配对应 attack，hover 出 ⚔ 可发起瞄准攻击
//  - 标题行右侧提供移除参战者按钮
import { useMemo, useState } from "react";
import type { AttackOption, Combatant } from "./types";
import { freqKindOf, freqLimitOf, freqShortLabel } from "./engine";

interface TitleBlock { type: "title"; cells: string[] }
interface SubtitleBlock { type: "subtitle"; cells: string[] }
interface StatBlock { type: "stat"; cells: string[] }
interface CatBlock { type: "category"; text: string }
interface PowerBlock { type: "power"; html: string; canAttack: boolean }
interface DescBlock { type: "desc"; html: string }
type Block = TitleBlock | SubtitleBlock | StatBlock | CatBlock | PowerBlock | DescBlock;

/** {{$:/dnd/images/xxx}} 图标 → Material 图标 */
const ICON_MAP: Record<string, string> = {
  aura: "blur_on",
  melee: "swords",
  meleebasic: "gavel",
  close: "explosion",
  area: "grid_on",
  range: "gps_fixed",
  rangebasic: "radio_button_checked",
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&nbsp;": " ",
  "&#39;": "'",
  "&apos;": "'",
};

/** wiki 统计行标签 → Combatant 实时字段（其余标签如豁免/技能/属性等保持原文只读） */
const STAT_MAP: Record<string, "ac" | "fort" | "ref" | "will" | "speed" | "init"> = {
  AC: "ac",
  强韧: "fort",
  反射: "ref",
  意志: "will",
  速度: "speed",
  先攻: "init",
};

function iconHtml(key: string): string {
  const icon = ICON_MAP[key] ?? "bolt";
  return `<span class="material-symbols-outlined wst-ico">${icon}</span>`;
}

/** TiddlyWiki 行内语法 → HTML：''x'' 加粗；{{$:/dnd/images/x}} 图标；解码实体 */
function convertInline(src: string): string {
  let s = src.replace(/\{\{\$:\/dnd\/images\/([a-zA-Z0-9_]+)\}\}/g, (_m, k: string) => iconHtml(k));
  s = s.replace(/''([^'']+)''/g, "<strong>$1</strong>");
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  return s;
}

function stripText(html: string): string {
  let s = html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "");
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  return s.trim();
}

/** 把 wiki 怪物属性块源码拆成顶层 div 序列 */
function parseBlocks(raw: string): Block[] {
  const out: Block[] = [];
  // 剥掉外层 <div class=creature> 容器，避免其被非贪婪匹配吞掉内部标题块
  let s = raw.trim();
  s = s.replace(/^<div[^>]*class\s*=\s*"?creature"?[^>]*>/i, "").replace(/<\/div>\s*$/i, "");
  const re = /<div\b([^>]*)>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  /** 批 6e 展示修复：源数据把跨 description 的效果句拆成「尾随标题块句首 + 句尾块」两块，
   * （如恐怖守护者「不死之盾\{{meleebasic}}在该…只受到一半</div><div class=description>伤害。」），
   * 若把句首单独当 power 块渲染会显示成标题；暂存等下一 description 合并为整句。 */
  let pendingCont: string | null = null;
  while ((m = re.exec(s)) !== null) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const cm = attrs.match(/class\s*=\s*(?:"([^"]*)"|([^\s>]+))/);
    const cls = (cm?.[1] ?? cm?.[2] ?? "").trim();
    if (!cls && inner.trim() === "") continue;

    const spans = [...inner.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => x[1]);
    if (cls.includes("bg-category")) {
      out.push({ type: "category", text: stripText(inner) });
    } else if (cls.includes("bg-power")) {
      // 续行句首块：含 wiki 图标、无✦频率、文本是未完从句（长度>12 且含从句标点/时词）
      const textOnly = stripText(inner);
      const isCont = /\{\{\$:\/dnd\/images\//.test(inner) && !inner.includes("✦") && /[，．。"“]|时$/.test(textOnly) && textOnly.length > 12;
      if (isCont) {
        pendingCont = textOnly;
        continue;
      }
      // 仅带 bold 的威能行可对应攻击；其余（技能/属性/装备等 ability 行）保持只读
      out.push({ type: "power", html: convertInline(inner), canAttack: cls.includes("bold") });
    } else if (cls.includes("bg-title")) {
      const cells = spans.length ? spans.map(convertInline) : [convertInline(inner)];
      out.push({ type: cls.includes("font-size-h4") ? "title" : "subtitle", cells });
    } else if (cls === "description") {
      const tail = convertInline(inner);
      if (pendingCont) {
        out.push({ type: "desc", html: pendingCont + tail });
        pendingCont = null;
      } else {
        out.push({ type: "desc", html: tail });
      }
    } else if (spans.length) {
      // stat 行：保留原始 wiki 文本，渲染时再绑定实时字段
      out.push({ type: "stat", cells: spans });
    }
  }
  return out;
}

interface Props {
  c: Combatant;
  onPatch: (patch: Partial<Combatant>) => void;
  onSelectAttack: (cid: string, attack: AttackOption) => void;
  onRemove: () => void;
  /** 只读模式：隐藏全部交互（移除/就地编辑/威能瞄准/充能），仅展示怪卡 */
  readOnly?: boolean;
}

export default function WikiStatBlock({ c, onPatch, onSelectAttack, onRemove, readOnly = false }: Props) {
  const blocks = useMemo(() => parseBlocks(c.rawText ?? ""), [c.rawText]);
  // 当前就地编辑的字段键（ac/fort/ref/will/speed/init），null=无
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // 威能块（bold bg-power）→ 匹配解析出的攻击（按名称前缀匹配，避免同名/顺序错位）
  const attackFor = useMemo(() => {
    const map = new Map<number, AttackOption>();
    blocks.forEach((b, i) => {
      if (b.type === "power" && b.canAttack) {
        const text = stripText(b.html);
        const hit = c.attacks.find((a) => text.startsWith(a.name) || text.includes(a.name));
        if (hit) map.set(i, hit);
      }
    });
    return map;
  }, [blocks, c.attacks]);

  const startEdit = (k: string, v: number) => {
    setEditing(k);
    setDraft(String(v));
  };
  const commitEdit = (k: string) => {
    const n = Number(draft);
    if (!Number.isNaN(n)) onPatch({ [k]: n } as Partial<Combatant>);
    setEditing(null);
  };

  /** 可编辑数值：显示实时值，点击就地输入；只读模式下仅静态展示 */
  const field = (label: string, k: "ac" | "fort" | "ref" | "will" | "speed" | "init") =>
    readOnly ? (
      <span className="wst-fv" key={k}>
        <strong>{label}</strong>
        <span className="wst-val" title={label}>{c[k]}</span>
      </span>
    ) : editing === k ? (
      <span className="wst-fv" key={k}>
        <strong>{label}</strong>
        <input
          className="wst-edit"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitEdit(k)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      </span>
    ) : (
      <span className="wst-fv" key={k}>
        <strong>{label}</strong>
        <span className="wst-val" title={`点击编辑${label}`} onClick={() => startEdit(k, c[k])}>{c[k]}</span>
      </span>
    );

  /** 单个统计 cell：含"生命值"则渲染 HP 行，否则逐字段绑定实时值/保持原文 */
  const statCell = (raw: string, idx: number) => {
    const text = stripText(raw);
    if (/生命值/.test(text)) {
      // 杂兵（最大生命=1）：只有 1 HP，不显示最大值与重伤状态/值
      const isMinion = c.maxHp === 1;
      const hpCls = c.hp <= 0 ? " dead" : (!isMinion && c.hp <= c.bloodied) ? " bloodied" : "";
      // HP 调整模块已并入右栏「动态数据」表，怪卡上仅展示实时值
      return (
        <span className="wst-hp" key={"hp" + idx}>
          <strong>生命值</strong>
          <span className={"wst-hp-val" + hpCls}>{c.hp}{!isMinion && <i className="wst-hp-max">/{c.maxHp}</i>}</span>
          {c.tempHp > 0 && <span className="wst-temp" title="临时生命">+{c.tempHp}</span>}
          {!isMinion && <span className="wst-bloodied">重伤 {c.bloodied}</span>}
        </span>
      );
    }
    // 普通统计 cell：按 ''标签'' 切分，已知字段绑定实时值，其余原文
    const parts = raw.split("''");
    const nodes: React.ReactNode[] = [];
    if (parts[0] && stripText(parts[0])) {
      nodes.push(<span key="pre" dangerouslySetInnerHTML={{ __html: convertInline(parts[0]) }} />);
    }
    for (let i = 1; i < parts.length; i += 2) {
      const label = parts[i];
      const valRaw = parts[i + 1] ?? "";
      const k = STAT_MAP[label];
      if (k) {
        nodes.push(field(label, k));
      } else {
        nodes.push(<span key={"x" + i} dangerouslySetInnerHTML={{ __html: convertInline("''" + label + "''" + valRaw) }} />);
      }
    }
    return <span key={"c" + idx}>{nodes}</span>;
  };

  return (
    <div className="estk-wiki">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "title":
            return (
              <div className="wst-title" key={i}>
                <span>{b.cells.map((h, j) => <span key={j} dangerouslySetInnerHTML={{ __html: h }} />)}</span>
                {!readOnly && <button className="wst-remove" onClick={onRemove} title="移除参战者">×</button>}
              </div>
            );
          case "subtitle":
            return (
              <div className="wst-subtitle" key={i}>
                {b.cells.map((h, j) => <span key={j} dangerouslySetInnerHTML={{ __html: h }} />)}
              </div>
            );
          case "stat":
            return (
              <div className="wst-stat" key={i}>
                {b.cells.map((h, j) => statCell(h, j))}
              </div>
            );
          case "category":
            return <div className="wst-cat" key={i}>{b.text}</div>;
          case "power": {
            const atk = attackFor.get(i);
            // 批 3-3c：威能频率计数——遭遇/每日/充能已用尽则禁用瞄准 + 充能手动重置按钮
            const fk = atk ? freqKindOf(atk.freq) : "atwill";
            const usedN = atk ? c.powerUses?.[atk.key] ?? 0 : 0;
            const exhausted = atk && (fk === "encounter" || fk === "daily" || fk === "recharge") && usedN >= (fk === "encounter" ? freqLimitOf(atk.freq) : 1);
            const flabel = atk ? freqShortLabel(atk.freq) : null;
            return (
              <div
                key={i}
                className={"wst-power" + (atk && !readOnly ? " wst-power--live" : "") + (exhausted ? " wst-power--used" : "")}
                onClick={!readOnly && atk && !exhausted ? () => onSelectAttack(c.cid, atk) : undefined}
                title={!readOnly && atk ? (exhausted ? `已用尽（${flabel}威能）` : `瞄准：${atk.name}`) : undefined}
              >
                <span dangerouslySetInnerHTML={{ __html: b.html }} />
                {flabel && <span className={"wst-freq" + (fk === "encounter" ? " enc" : fk === "daily" ? " daily" : fk === "recharge" ? " recharge" : "")}>{exhausted ? `${flabel}·已用` : flabel}</span>}
                {/* 批 3 收尾：解析质量徽标——partial=部分自动、manual=需裁决 */}
                {atk?.coverage === "partial" && <span className="wst-pcov partial" title="该威能已解析主体，部分效果需 DM 手动裁决">部分自动</span>}
                {atk?.coverage === "manual" && <span className="wst-pcov manual" title="该威能解析不出可执行效果，由 DM 裁决">需裁决</span>}
                {!readOnly && exhausted && fk === "recharge" && (
                  <button
                    className="wst-recharge"
                    title="充能重掷（DM 判定条件已满足时手动重置该威能）"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPatch({ powerUses: { ...(c.powerUses ?? {}), [atk!.key]: 0 } });
                    }}
                  >
                    充能
                  </button>
                )}
                {!readOnly && atk && !exhausted && <span className="wst-attack" title="用此威能在地图上点选目标">⚔</span>}
              </div>
            );
          }
          case "desc":
            return <div className="wst-desc" key={i} dangerouslySetInnerHTML={{ __html: b.html }} />;
        }
      })}
    </div>
  );
}
