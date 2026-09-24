import { useMemo, type CSSProperties } from "react";
import type { Entry } from "../data/types";
import { POWER_COLORS, ITEM_COLOR, FEAT_COLOR } from "../lib/colors";
import { CATEGORY_LABELS } from "../data/labels";
import { tokenizeWikiBody, wikiToHtml } from "../lib/wikirender";
import { SmartHover } from "./SmartHover";

// 展开 details 中的 {{!!字段}} 引用、[[链接]] 与宏
function expandDetails(html: string, entry: Entry): string {
  return html
    .replace(/<<[^>]+>>/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\{\{!!([^}]+)\}\}/g, (_m, name: string) => String(entry.fields[name] ?? ""));
}

function powerColor(entry: Entry): string {
  // 按再生频率上色（辅助威能也分为随意/遭遇/每日），黑色仅作未知兜底
  if (entry.usage === "at-will") return POWER_COLORS.atWill;
  if (entry.usage === "encounter") return POWER_COLORS.encounter;
  if (entry.usage === "daily") return POWER_COLORS.daily;
  return POWER_COLORS.utility;
}

function PowerCard({ entry }: { entry: Entry }) {
  const color = powerColor(entry);
  return (
    <div className="power-card" style={{ "--pc": color } as CSSProperties}>
      <div className="pc-head">
        <span className="pc-name">{entry.name}{entry.nameEn ? " " + entry.nameEn : ""}</span>
        {entry.origin === "user" && <span className="origin-badge">自制</span>}
        <span className="pc-meta">{entry.powerType}{entry.level ? " " + entry.level : ""}</span>
      </div>
      {entry.flavorText && <div className="pc-flavor">{entry.flavorText}</div>}
      <div className="pc-keywords">
        <div>{entry.usageZh}{entry.keywords ? " ✦ " + entry.keywords : ""}</div>
        <div>{entry.actionType}{entry.range ? " ✦ " + entry.range : ""}</div>
      </div>
      {entry.details && <div className="pc-details" dangerouslySetInnerHTML={{ __html: entry.details }} />}
    </div>
  );
}

function ItemCard({ entry }: { entry: Entry }) {
  return (
    <div className="item-card" style={{ "--ic": ITEM_COLOR } as CSSProperties}>
      <div className="ic-head">
        <span className="ic-name">{entry.name}{entry.nameEn ? " " + entry.nameEn : ""}</span>
        {entry.origin === "user" && <span className="origin-badge">自制</span>}
        <span className="ic-meta">{[entry.itemCategory, entry.rarity, entry.itemLevel ? "L" + entry.itemLevel : ""].filter(Boolean).join(" · ")}</span>
      </div>
      {entry.flavorText && <div className="ic-flavor">{entry.flavorText}</div>}
      {entry.details && <div className="pc-details" dangerouslySetInnerHTML={{ __html: expandDetails(entry.details, entry) }} />}
    </div>
  );
}

// 专长文本中的 [[链接]]：resolve 到词条时转为悬浮预览卡片（portal 固定定位，避免被卡片 overflow 裁剪）
function FeatRichText({ text, fields, lookup }: { text: string; fields: Record<string, string>; lookup: (t: string) => Entry | undefined }) {
  const tokens = useMemo(() => tokenizeWikiBody(text, fields), [text, fields]);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "link") {
          const e = lookup(t.target);
          if (!e) return <span key={i} className="wiki-ref-plain">{t.alias}</span>;
          return (
            <SmartHover key={i} className="wiki-ref" popClass="wiki-ref-pop" portal pop={<EntryCard entry={e} />}>
              {t.alias}
            </SmartHover>
          );
        }
        if (t.kind === "html") return <div key={i} className="wiki-html" dangerouslySetInnerHTML={{ __html: t.html }} />;
        return <span key={i} dangerouslySetInnerHTML={{ __html: t.html }} />;
      })}
    </>
  );
}

function FeatBlock({ label, text, entry, lookup }: { label: string; text: string; entry: Entry; lookup?: (t: string) => Entry | undefined }) {
  return (
    <div className="fc-block">
      <div className="fc-label">{label}</div>
      <div className="fc-content">
        {lookup ? <FeatRichText text={text} fields={entry.fields} lookup={lookup} /> : <span dangerouslySetInnerHTML={{ __html: expandDetails(text, entry) }} />}
      </div>
    </div>
  );
}

function FeatCard({ entry, lookup }: { entry: Entry; lookup?: (t: string) => Entry | undefined }) {
  const special = entry.fields.special;
  return (
    <div className="feat-card" style={{ "--fc": FEAT_COLOR } as CSSProperties}>
      <div className="fc-head">
        <span className="fc-name">{entry.name}{entry.nameEn ? " " + entry.nameEn : ""}</span>
        {entry.origin === "user" && <span className="origin-badge">自制</span>}
        <span className="fc-meta">{entry.tierZh}{entry.source ? " · " + entry.source : ""}</span>
      </div>
      {entry.prerequisite && <FeatBlock label="前提" text={entry.prerequisite} entry={entry} lookup={lookup} />}
      {entry.benefit && <FeatBlock label="增益" text={entry.benefit} entry={entry} lookup={lookup} />}
      {special && <FeatBlock label="特殊" text={special} entry={entry} lookup={lookup} />}
    </div>
  );
}

// 通用词条卡片（种族/职业/典范/天命等）：关键字段 + 详情
const GENERIC_LABELS: [string, string][] = [
  ["abilityOne", "属性"], ["size", "体型"], ["speed", "速度"], ["vision", "视觉"],
  ["role", "职位"], ["powerSource", "威能来源"], ["tierZh", "层级"],
  ["itemLevel", "物品等级"], ["itemCategory", "类别"], ["rarity", "稀有度"],
  ["skill", "技能"], ["keySkill", "关键技能"],
];

function GenericCard({ entry }: { entry: Entry }) {
  const rows: [string, string][] = [];
  for (const [k, label] of GENERIC_LABELS) {
    if (k === "abilityOne") {
      if (entry.abilityOne) rows.push([label, entry.abilityOne + (entry.abilityTwo ? " / " + entry.abilityTwo : "")]);
      continue;
    }
    const v = entry[k];
    if (typeof v === "string" && v) rows.push([label, v]);
  }
  return (
    <div className="generic-card" style={{ "--gc": "var(--md-sys-color-primary)" } as CSSProperties}>
      <div className="gc-head">
        <span className="gc-name">{entry.name}{entry.nameEn ? " " + entry.nameEn : ""}</span>
        {entry.origin === "user" && <span className="origin-badge">自制</span>}
        <span className="gc-meta">{CATEGORY_LABELS[entry.category] ?? entry.category}{entry.source ? " · " + entry.source : ""}</span>
      </div>
      {rows.length > 0 && (
        <div className="gc-fields">
          {rows.map(([label, val]) => <span key={label} className="gc-field"><b>{label}</b>{val}</span>)}
        </div>
      )}
      {entry.flavorText && <div className="gc-flavor">{entry.flavorText}</div>}
      {entry.details ? (
        <div className="pc-details" dangerouslySetInnerHTML={{ __html: entry.details }} />
      ) : entry.sourceText ? (
        // sourceText 含不少原生 HTML（如生物 <div class=creature>…），需经 wikiToHtml 渲染，
        // 直接 stripWiki 会把 HTML 标签当成可见代码显示出来。
        <div className="pc-details gen-creature-card" dangerouslySetInnerHTML={{ __html: wikiToHtml(entry.sourceText, entry.fields) }} />
      ) : null}
    </div>
  );
}

// lookup 提供时，专长卡片正文中的 [[威能]] 等链接转为悬浮预览卡片（角色卡与选择专长界面共用）
export default function EntryCard({ entry, lookup }: { entry: Entry; lookup?: (t: string) => Entry | undefined }) {
  if (entry.category === "power") return <PowerCard entry={entry} />;
  if (entry.category === "equipment") return <ItemCard entry={entry} />;
  if (entry.category === "feat") return <FeatCard entry={entry} lookup={lookup} />;
  return <GenericCard entry={entry} />;
}
