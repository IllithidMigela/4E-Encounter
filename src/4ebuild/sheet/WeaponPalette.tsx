import { useState } from "react";
import { BASE_SHIELDS, BASE_IMPLEMENTS, baseItemId, type BaseWeapon, type BaseImplement } from "../lib/baseitems";
import { armorProficient } from "./proficiency";

// 已擅长武器条目（供「已擅长武器」按钮展示）
export interface WeapInfo { id: string; name: string; main: string; sub: string; }

export const IMPL_GROUPS = ["圣徽", "法珠", "权杖", "法杖", "魔典", "图腾", "魔杖", "匕首", "气印"];
export function implGroup(name: string): string {
  return IMPL_GROUPS.find((g) => name.includes(g)) ?? "";
}

export interface WeaponPaletteProps {
  // 主武器池（已按专长范围过滤；基础武器选择传 BASE_WEAPONS）
  weapons: BaseWeapon[];
  // 是否显示法器/护盾导航（基础武器选择=是，擅长武器专长=否）
  allowImplShield: boolean;
  // 武器类别按钮（默认 全部/简易/军用/优异/双头）
  categories?: string[];
  // 已擅长武器（「已擅长武器」按钮左下角展示）
  proficientInfos: WeapInfo[];
  // 法器池（提供时渲染法器选择面板，参考擅长武器的结构；如奥术法器擅长）
  implements?: BaseImplement[];
  // 已擅长的法器组（法器面板「已擅长/未擅长」用；缺省视为全未擅长）
  proficientImplGroups?: string[];
  // 法器档位：all=基础+优异；basic=仅基础（奥术法器擅长）；superior=仅优异（优异法器训练）
  implTier?: "all" | "basic" | "superior";
  // 护甲/盾牌擅长 token 集（护盾面板「擅长」角标用；缺省视为全未擅长）
  armorTokens?: Set<string>;
  shieldTokens?: Set<string>;
  // 当前已选武器名（高亮）
  currentName?: string;
  // 选择回调：传入 (baseItemId, 武器名)
  onSelect: (id: string, name: string) => void;
}

// 基础武器/擅长武器/法器专长共用选择面板：左侧类别导航 + 持握过滤 + 分格卡片 + 左下角「已擅长/未擅长武器」
export default function WeaponPalette({ weapons: pool, allowImplShield, categories, proficientInfos, implements: implPool, proficientImplGroups, implTier, armorTokens, shieldTokens, currentName, onSelect }: WeaponPaletteProps) {
  const implMode = !!implPool && implPool.length > 0;
  const implList = implMode ? implPool! : BASE_IMPLEMENTS;
  const tier = implMode ? (implTier ?? "all") : "all";
  const tierImps = implList.filter((im) => tier === "all" ? true : tier === "basic" ? !im.superior : !!im.superior);
  const [wcat, setWcat] = useState(implMode ? "法器" : "");
  const [whand, setWhand] = useState("");
  const [wgroup, setWgroup] = useState("");
  const [implG, setImplG] = useState("");
  // view：grid=可选武器网格；prof=已擅长武器；unprof=未擅长武器
  const [view, setView] = useState<"grid" | "prof" | "unprof">("grid");
  const implProGroup = new Set(proficientImplGroups ?? []);
  const toImplCard = (im: BaseImplement): WeapInfo => ({
    id: baseItemId("implement", im.name),
    name: im.name,
    main: String(im.price) + "gp",
    sub: im.properties ? im.properties + " · " + im.category + "法器" : im.category + "法器",
  });
  const profImpls = implMode ? tierImps.filter((im) => implProGroup.has(implGroup(im.name))).map(toImplCard) : [];
  const unprofImpls = implMode ? tierImps.filter((im) => !implProGroup.has(implGroup(im.name))).map(toImplCard) : [];

  const catBtns = categories ?? ["全部", "简易", "军用", "优异", "双头"];
  const card = (id: string, name: string, main: string, sub: string, proficient = false) => (
    <button key={id} type="button" className={name === currentName ? "picker-card base-picker-card selected" : "picker-card base-picker-card"} onClick={() => onSelect(id, name)}>
      <span className="bi-name">{name}</span>
      <span className="bi-dice">{main}</span>
      <span className="bi-traits">{sub}</span>
      {proficient && <span className="prof-badge">擅长</span>}
    </button>
  );

  // 武器卡片：第1行 中文名(左)+武器组(右)；第2行 英文名(左，小号)；第3行 伤害骰(左)+擅长加值(中)+射程(右)；第4行 特性(左)+右下角擅长角标
  const weaponCard = (w: BaseWeapon, proficient: boolean) => (
    <button key={baseItemId("weapon", w.name)} type="button" className={w.name === currentName ? "picker-card base-picker-card selected" : "picker-card base-picker-card"} onClick={() => onSelect(baseItemId("weapon", w.name), w.name)}>
      <span className="wk-row1">
        <span className="bi-name">{w.name.split(/\s/)[0]}</span>
        {proficient && <span className="prof-badge">擅长</span>}
        <span className="wk-range">{w.range && w.range !== "—" ? "射程 " + w.range : ""}</span>
      </span>
      <span className="wk-en">{w.name.split(/\s/).slice(1).join(" ")}</span>
      <span className="wk-row2">
        <span className="bi-dice">{w.dice}</span>
        <span className="wk-prof">{w.prof ? "+" + w.prof : "—"}</span>
      </span>
      <span className="wk-row3">
        <span className="bi-traits">{w.traits && w.traits !== "—" ? w.traits : ""}</span>
        <span className="wk-group">{w.group}</span>
      </span>
    </button>
  );

  const filterWeapon = (w: BaseWeapon) => {
    if (wcat === "双头") { if (!w.category.includes("双头")) return false; }
    else if (wcat) { if (!w.category.startsWith(wcat)) return false; }
    if (whand === "单手") { if (!w.category.includes("·单手")) return false; }
    else if (whand === "双手") { if (!w.category.includes("·双手") && !w.category.includes("双头")) return false; }
    else if (whand === "远程") { if (!w.category.includes("远程")) return false; }
    else if (whand === "弹药") { if (!w.category.includes("·弹药")) return false; }
    if (wgroup && !w.group.split(/[，,]/).includes(wgroup)) return false;
    return true;
  };
  // 武器组筛选按钮：从当前池动态提取实际存在的武器组
  const weaponGroups = Array.from(new Set(pool.map((w) => w.group.split(/[，,]/)).flat())).filter(Boolean);
  const visibleWeapons = pool.filter(filterWeapon);

  const proficientNames = new Set(proficientInfos.map((p) => p.name));
  const unprofWeapons = pool.filter((w) => filterWeapon(w) && !proficientNames.has(w.name));
  const profWeapons = pool.filter((w) => filterWeapon(w) && proficientNames.has(w.name));

  return (
    <div className="class-layout base-class-layout">
      <div className="class-sources">
        {wcat === "法器" ? (
          <>
            {!implMode && (
              <button type="button" className="cl-item cl-back" title="返回武器分类" onClick={() => { setWcat(""); setImplG(""); }}><span className="cl-back-ic">←</span>返回</button>
            )}
            <button type="button" className={implG === "" ? "cl-item active" : "cl-item"} onClick={() => setImplG("")}>全部法器</button>
            {IMPL_GROUPS.filter((g) => implMode ? tierImps.some((im) => implGroup(im.name) === g) : true).map((g) => (
              <button key={g} type="button" className={implG === g ? "cl-item active" : "cl-item"} onClick={() => setImplG(g)}>{g}法器</button>
            ))}
          </>
        ) : (
          <>
            <button type="button" className={wcat === "" ? "cl-item active" : "cl-item"} onClick={() => setWcat("")}>全部</button>
            {catBtns.filter((c) => c !== "全部").map((c) => (
              <button key={c} type="button" className={wcat === c ? "cl-item active" : "cl-item"} onClick={() => setWcat(c)}>{c}</button>
            ))}
            {allowImplShield && (
              <>
                <button type="button" className={"cl-item" + (wcat === "法器" ? " active" : "")} onClick={() => setWcat("法器")}>法器</button>
                <button type="button" className={"cl-item" + (wcat === "护盾" ? " active" : "")} onClick={() => setWcat("护盾")}>护盾</button>
              </>
            )}
          </>
        )}
      </div>
      <div className="class-main">
        {!implMode && (view !== "grid" || wcat !== "法器") && (
          <div className="class-roles">
            <button type="button" className={whand === "" ? "cr-item active" : "cr-item"} onClick={() => setWhand("")}>全部持握</button>
            {["单手", "双手", "远程", "弹药"].map((h) => (
              <button key={h} type="button" className={whand === h ? "cr-item active" : "cr-item"} onClick={() => setWhand(h)}>{h}</button>
            ))}
          </div>
        )}
        {!implMode && (view !== "grid" || wcat !== "法器") && weaponGroups.length > 0 && (
          <div className="class-roles">
            <button type="button" className={wgroup === "" ? "cr-item active" : "cr-item"} onClick={() => setWgroup("")}>全部武器组</button>
            {weaponGroups.map((g) => (
              <button key={g} type="button" className={wgroup === g ? "cr-item active" : "cr-item"} onClick={() => setWgroup(g)}>{g}</button>
            ))}
          </div>
        )}
        {view === "prof" ? (
          <div className="class-grid pp-prof-grid">
            {implMode ? (profImpls.length === 0 ? <p className="hint">暂无可展示的已擅长法器。</p> : profImpls.map((it) => card(it.id, it.name, it.main, it.sub, implProGroup.has(implGroup(it.name)))))
              : (profWeapons.length === 0 ? <p className="hint">暂无可展示的已擅长武器。</p> : profWeapons.map((w) => weaponCard(w, true)))}
          </div>
        ) : view === "unprof" ? (
          <div className="class-grid pp-prof-grid">
            {implMode ? (unprofImpls.length === 0 ? <p className="hint">暂无可展示的未擅长法器。</p> : unprofImpls.map((it) => card(it.id, it.name, it.main, it.sub, implProGroup.has(implGroup(it.name)))))
              : (unprofWeapons.length === 0 ? <p className="hint">暂无可展示的未擅长武器。</p> : unprofWeapons.map((w) => weaponCard(w, false)))}
          </div>
        ) : wcat === "法器" ? (
          <div className="impl-groups">
            {IMPL_GROUPS.filter((g) => !implG || implG === g).map((g) => {
              const groupImps = tierImps.filter((im) => implGroup(im.name) === g);
              if (groupImps.length === 0) return null;
              const base = groupImps.filter((im) => !im.superior);
              const sup = groupImps.filter((im) => im.superior);
              return (
                <div key={g} className="impl-group">
                  <div className="impl-group-title">{g}法器</div>
                  {base.length > 0 && (
                    <div className="impl-subgroup">
                      <div className="impl-sub-label">简易</div>
                      <div className="picker-cards">
                        {base.map((im) => card(baseItemId("implement", im.name), im.name, String(im.price) + "gp", im.category + "法器", implProGroup.has(implGroup(im.name))))}
                      </div>
                    </div>
                  )}
                  {sup.length > 0 && (
                    <div className="impl-subgroup">
                      <div className="impl-sub-label">优异</div>
                      <div className="picker-cards">
                        {sup.map((im) => card(baseItemId("implement", im.name), im.name, String(im.price) + "gp", (im.properties || "") + " · " + im.category + "法器", implProGroup.has(implGroup(im.name))))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : wcat === "护盾" ? (
          <div className="class-grid">
            {BASE_SHIELDS.map((s) => card(baseItemId("shield", s.name), s.name, "+" + s.ac + " AC", s.traits, armorProficient(armorTokens ?? new Set(), shieldTokens ?? new Set(), s.name)))}
          </div>
        ) : (
          <div className="class-grid">
            {visibleWeapons.map((w) => weaponCard(w, proficientNames.has(w.name)))}
            {visibleWeapons.length === 0 && <p className="hint">无匹配武器。</p>}
          </div>
        )}
        <div className="pick-palette-footer">
          {view === "grid" ? (
            <>
              <button type="button" className="ppf-btn" onClick={() => setView("prof")}>{implMode ? "已擅长法器" : "已擅长武器"}（{implMode ? profImpls.length : profWeapons.length}）</button>
              <button type="button" className="ppf-btn" onClick={() => setView("unprof")}>{implMode ? "未擅长法器" : "未擅长武器"}（{implMode ? unprofImpls.length : unprofWeapons.length}）</button>
            </>
          ) : (
            <>
              <span className="ppf-label">{(view === "prof" ? (implMode ? "已擅长法器" : "已擅长武器") : (implMode ? "未擅长法器" : "未擅长武器"))}（{view === "prof" ? (implMode ? profImpls.length : profWeapons.length) : (implMode ? unprofImpls.length : unprofWeapons.length)}）</span>
              <button type="button" className="ppf-btn" onClick={() => setView("grid")}>{implMode ? "返回选择法器" : "返回选择武器"}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}