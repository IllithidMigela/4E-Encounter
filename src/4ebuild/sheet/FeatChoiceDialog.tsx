import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import WeaponPalette, { type WeapInfo } from "./WeaponPalette";
import type { BaseWeapon, BaseImplement } from "../lib/baseitems";
import type { FeatOption } from "./proficiency";
import type { Entry } from "../data/types";
import { stripWiki } from "../lib/text";
import { SmartHover } from "./SmartHover";
import EntryCard from "./EntryCard";
import { DeepSearchField } from "./DeepSearch";

interface Props {
  featName: string;
  label: string;
  options: FeatOption[];
  // 选用武器型专长（cat="weapon"）时传入，渲染与「选择基础武器」一致的面板
  weaponPool?: BaseWeapon[];
  categories?: string[];
  // 选用法器型专长（如奥术法器擅长）时传入，渲染法器选择面板
  implementPool?: BaseImplement[];
  // 法器档位：basic=仅基础（奥术法器擅长）；superior=仅优异（优异法器训练）
  implTier?: "basic" | "superior";
  // 已擅长的法器组（法器面板「已擅长/未擅长」用）
  proficientImplGroups?: string[];
  proficientInfos?: WeapInfo[];
  // 混职天赋 Hybrid Talent：两个混职职业的「混职天赋选项」分组（来源职业名 + 选项标题/正文）
  // ref 存在时：原文展示 + 目标职业特性悬浮超链接（hover 弹出源职业同名特性正文）
  hybridGroups?: { source: string; intro?: string; options: { title: string; body: string; ref?: { before: string; label: string; after: string; popup: string } }[] }[];
  // wiki 条目查询（混职天赋选项正文的描述渲染用；供悬浮调色等功能预留）
  lookup?: (t: string) => Entry | undefined;
  current?: string;
  onChoose: (item: string) => void;
  onClose: () => void;
}

// 混职天赋选项正文 → 可读纯文本（去 wiki 标记并压缩空白）
function plainDesc(body: string): string {
  return stripWiki(body).replace(/\s+/g, " ").trim();
}

// 渲染正文片段：其中 [[威能]]（或 [[目标|别名]]）wiki 链接转为悬浮预览卡片（可解析时），
// 其余文字走 plainDesc。与职业特性正文 WikiBody 的 [[链接]]→hover 卡片行为保持一致。
function renderHybridText(text: string, lookup?: (t: string) => Entry | undefined): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let m: RegExpExecArray | null;
  let last = 0;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={k++}>{plainDesc(text.slice(last, m.index))}</span>);
    const target = m[1].trim();
    const alias = (m[2] ?? m[1]).trim();
    const entry = lookup ? lookup(target) : undefined;
    if (entry) {
      out.push(
        <SmartHover key={k++} className="wiki-ref" popClass="wiki-ref-pop" portal pop={<EntryCard entry={entry} />}>
          {alias}
        </SmartHover>
      );
    } else {
      out.push(<span key={k++}>{alias}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={k++}>{plainDesc(text.slice(last))}</span>);
  return out;
}

// 混职天赋选项描述：
//  - 无等价引用时：展示原文，其中 [[威能]] 链接转为悬浮预览卡片。
//  - 若存在「完全一样」的等价引用 ref：保留原文，目标职业特性片段渲染为悬浮超链接
//    （hover 弹出源职业同名特性正文），前后文字中的 [[威能]] 仍转悬浮预览。
function hybridDesc(
  o: { body: string; ref?: { before: string; label: string; after: string; popup: string } },
  lookup?: (t: string) => Entry | undefined
) {
  if (!o.ref || !o.ref.popup) return <>{renderHybridText(o.body, lookup)}</>;
  return (
    <>
      {renderHybridText(o.ref.before, lookup)}
      <SmartHover className="hy-link" popClass="hy-pop" portal
        pop={<span className="hy-pop-body">{plainDesc(o.ref.popup)}</span>}
        title={o.ref.label}>
        <span className="hy-link-label">{o.ref.label}</span>
      </SmartHover>
      {renderHybridText(o.ref.after, lookup)}
    </>
  );
}

// 选择型专长弹窗：武器型/法器型专长套用「选择基础武器」面板；其余用简版卡片列表
export default function FeatChoiceDialog({ featName, label, options, weaponPool, categories, implementPool, implTier, proficientImplGroups, proficientInfos, current, hybridGroups, lookup, onChoose, onClose }: Props) {
  const [q, setQ] = useState("");
  const [deep, setDeep] = useState(false); // 全文搜索开关
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) =>
      deep
        ? (o.name + " " + o.main + " " + o.sub).toLowerCase().includes(s)
        : o.name.toLowerCase().includes(s)
    );
  }, [q, deep, options]);
  const paletteMode = (!!weaponPool && weaponPool.length > 0) || (!!implementPool && implementPool.length > 0);

  const shell = (inner: React.ReactNode) =>
    createPortal(
      <div className="picker-overlay" onClick={onClose}>
        <div className={"picker-dialog" + (paletteMode ? " class-dialog base-dialog" : "")} onClick={(e) => e.stopPropagation()}>
          <div className="picker-head">
            <span className="picker-title">选择 · {featName}</span>
            <div className="picker-head-btns">
              <button type="button" className="crop-btn" onClick={onClose}>关闭</button>
            </div>
          </div>
          <p className="hint">{label}</p>
          {inner}
        </div>
      </div>,
      document.body
    );

  if (weaponPool && weaponPool.length) {
    return shell(
      <WeaponPalette
        weapons={weaponPool}
        allowImplShield={false}
        categories={categories}
        proficientInfos={proficientInfos ?? []}
        currentName={current}
        onSelect={(_id, name) => { onChoose(name); onClose(); }}
      />
    );
  }

  if (implementPool && implementPool.length) {
    return shell(
      <WeaponPalette
        weapons={[]}
        allowImplShield={false}
        implements={implementPool}
        implTier={implTier}
        proficientImplGroups={proficientImplGroups}
        proficientInfos={[]}
        currentName={current}
        onSelect={(_id, name) => { onChoose(name); onClose(); }}
      />
    );
  }

  // 混职天赋 Hybrid Talent：按来源混职职业分组展示「混职天赋选项」（标题 + 规则描述）
  if (hybridGroups && hybridGroups.length > 0) {
    return shell(
      <div className="hy-talent-picker">
        {hybridGroups.map((g) => (
          <div key={g.source} className="hy-talent-group">
            <div className="hy-talent-source">{g.source}</div>
            {g.intro && <div className="hy-talent-intro">{renderHybridText(g.intro, lookup)}</div>}
            <div className="picker-cards">
              {g.options.map((o) => (
                <button key={g.source + "::" + o.title} type="button" className={o.title === current ? "picker-card base-picker-card selected" : "picker-card base-picker-card"} onClick={() => { onChoose(o.title); onClose(); }}>
                  <span className="bi-name">{o.title}</span>
                  {<span className="bi-hy-desc">{hybridDesc(o, lookup)}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        {hybridGroups.length === 0 && <p className="hint">暂无可选的混职天赋选项。</p>}
      </div>
    );
  }

  return shell(
    <>
      <DeepSearchField value={q} deep={deep} onChange={setQ} onToggleDeep={() => setDeep((d) => !d)} />
      <div className="picker-cards">
        {filtered.map((o) => (
          <button key={o.name} type="button" className={o.name === current ? "picker-card base-picker-card selected" : "picker-card base-picker-card"} onClick={() => { onChoose(o.name); onClose(); }}>
            <span className="bi-name">{o.name}</span>
            <span className="bi-dice">{o.main}</span>
            <span className="bi-traits">{o.sub}</span>
            {proficientImplGroups?.includes(o.name) && <span className="prof-badge">擅长</span>}
          </button>
        ))}
        {filtered.length === 0 && <p className="hint">无匹配项。</p>}
      </div>
    </>
  );
}