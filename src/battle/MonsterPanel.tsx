// 怪物面板（布置桌面·怪物）：怪物库（搜索+筛选+点击进入放置模式）与 怪物编队（双栏条目，点“+”放图并减数）
import { useMemo, useState } from "react";
import type { CombatantStats } from "../types";
import type { MonsterTeam } from "../uiPrefs";
import { fmtMod } from "../engine";

interface Props {
  monsters: CombatantStats[];
  teams: MonsterTeam[];
  /** team：所属怪物编队 id（批 8 队伍判定）；怪物库直放时不传 → 默认怪物队 "monster" */
  onAdd: (stats: CombatantStats, team?: string) => void;
  /** 场上已放置棋子计数（键＝`阵营|名称`，怪物为 `monster|巴菲门特`），键不存在即未上场 */
  onFieldCount: Map<string, number>;
}

export default function MonsterPanel({ monsters, teams, onAdd, onFieldCount }: Props) {
  const [sub, setSub] = useState<"library" | "team">("library");
  const [q, setQ] = useState("");
  // 筛选状态（与 MonstersView 怪物库一致）
  const [lvlMin, setLvlMin] = useState<number | "">("");
  const [lvlMax, setLvlMax] = useState<number | "">("");
  const [xpMin, setXpMin] = useState<number | "">("");
  const [xpMax, setXpMax] = useState<number | "">("");
  const [roleSel, setRoleSel] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState("");
  const [origin, setOrigin] = useState("");
  const [species, setSpecies] = useState("");
  const [sizeSel, setSizeSel] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // 各维度的可选值（来自当前怪物库）
  const roleOpts = useMemo(() => [...new Set(monsters.map((m) => m.role).filter((r): r is string => !!r))].sort(), [monsters]);
  const categoryOpts = useMemo(() => [...new Set(monsters.map((m) => m.category).filter((c): c is string => !!c))].sort(), [monsters]);
  const originOpts = useMemo(() => [...new Set(monsters.map((m) => m.origin).filter((o): o is string => !!o))].sort(), [monsters]);
  const speciesOpts = useMemo(() => [...new Set(monsters.map((m) => m.species).filter((s): s is string => !!s))].sort(), [monsters]);
  // 体型：优先用解析出的体型类别 sizeClass；缺失时按占格数 size 兜底 → 9 超巨型 / 4 巨型 / 2 大型 / 其余为中型
  const sizeLabel = (m?: CombatantStats): string =>
    m?.sizeClass ?? (m?.size === 9 ? "超巨型" : m?.size === 4 ? "巨型" : m?.size === 2 ? "大型" : "中型");
  // 体型类别按万律体格从小到大排序（避免微型/小型/中型被 1 格合并漏掉）
  const SIZE_CLASS_ORDER = ["超小型", "微型", "小型", "中型", "大型", "大型或巨型", "超大型", "巨型", "超巨型"];
  const sizeOpts = useMemo(
    () => Array.from(new Set(monsters.map((m) => sizeLabel(m)).filter((s) => s)))
      .filter((s) => s !== "大型或巨型") // 不单列混合体格，由「大型/巨型」选中时兜住
      .sort((a, b) => SIZE_CLASS_ORDER.indexOf(a) - SIZE_CLASS_ORDER.indexOf(b)),
    [monsters],
  );
  // 选「大型」或「巨型」时，一并包含体格为「大型或巨型」的目标
  const matchesSize = (m: CombatantStats, sel: string): boolean => {
    const c = sizeLabel(m);
    if (c === sel) return true;
    if (sel === "大型" && c === "大型或巨型") return true;
    if (sel === "巨型" && c === "大型或巨型") return true;
    return false;
  };

  // 职能行的额外筛选项：杂兵/精英/头目 匹配 tier，召唤生物 匹配 summoned；其余匹配 role
  const ROLE_TIER_CHIPS = ["杂兵", "精英", "头目", "强者"];
  const matchesRoleChip = (m: CombatantStats, r: string): boolean => {
    if (r === "召唤生物") return m.summoned === true;
    if (ROLE_TIER_CHIPS.includes(r)) return m.tier === r || (m.tierTags ?? []).includes(r);
    return m.role === r;
  };
  const roleFilterChips = useMemo(() => [...ROLE_TIER_CHIPS, "召唤生物", ...roleOpts], [roleOpts]);

  const toggleRole = (r: string) => {
    setRoleSel((prev) => {
      const n = new Set(prev);
      if (n.has(r)) n.delete(r);
      else n.add(r);
      return n;
    });
  };

  const resetFilters = () => {
    setLvlMin("");
    setLvlMax("");
    setXpMin("");
    setXpMax("");
    setRoleSel(new Set());
    setCategory("");
    setOrigin("");
    setSpecies("");
    setSizeSel("");
  };

  // 已激活的标签筛选数（不含搜索词）
  const activeFilters = useMemo(() => {
    let n = 0;
    if (lvlMin !== "") n++;
    if (lvlMax !== "") n++;
    if (xpMin !== "") n++;
    if (xpMax !== "") n++;
    n += roleSel.size;
    if (category) n++;
    if (origin) n++;
    if (species) n++;
    if (sizeSel) n++;
    return n;
  }, [lvlMin, lvlMax, xpMin, xpMax, roleSel, category, origin, species, sizeSel]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let arr = monsters;
    if (lvlMin !== "") arr = arr.filter((m) => (m.level ?? 0) >= Number(lvlMin));
    if (lvlMax !== "") arr = arr.filter((m) => (m.level ?? 0) <= Number(lvlMax));
    // 经验值：无 XP 数据（召唤生物/坐骑等）在设了下限时视为不匹配
    if (xpMin !== "") arr = arr.filter((m) => m.xp !== undefined && m.xp >= Number(xpMin));
    if (xpMax !== "") arr = arr.filter((m) => m.xp !== undefined && m.xp <= Number(xpMax));
    if (roleSel.size > 0) arr = arr.filter((m) => [...roleSel].every((r) => matchesRoleChip(m, r)));
    if (category) arr = arr.filter((m) => m.category === category);
    if (origin) arr = arr.filter((m) => m.origin === origin);
    if (species) arr = arr.filter((m) => m.species === species);
    if (sizeSel) arr = arr.filter((m) => matchesSize(m, sizeSel));
    if (kw) {
      // 名称搜索：名称 + 类型/职能 + 等级 + 威能名/效果 + 原始文本
      arr = arr.filter(
        (m) =>
          m.name.toLowerCase().includes(kw) ||
          (m.tier ?? "").toLowerCase().includes(kw) ||
          (m.role ?? "").toLowerCase().includes(kw) ||
          String(m.level ?? "").includes(kw) ||
          m.attacks.some(
            (a) =>
              a.name.toLowerCase().includes(kw) ||
              a.range.toLowerCase().includes(kw) ||
              a.target.toLowerCase().includes(kw) ||
              (a.effectText ?? "").toLowerCase().includes(kw),
          ) ||
          (m.rawText ?? "").toLowerCase().includes(kw),
      );
    }
    // 默认按名称排序（首字母，中英文混合时按拼音/字母序）
    return [...arr]
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-Hans-CN"))
      .slice(0, 300);
  }, [monsters, q, lvlMin, lvlMax, xpMin, xpMax, roleSel, category, origin, species, sizeSel]);

  // 每支编队内按名称统计出现次数
  const teamGroups = useMemo(
    () =>
      teams.map((t) => {
        const m = new Map<string, number>();
        for (const s of t.stats) m.set(s.name, (m.get(s.name) ?? 0) + 1);
        return { team: t, groups: [...m.entries()] };
      }),
    [teams],
  );

  return (
    <div className="es-mon">
      <div className="es-lib-tabs">
        <button className={"es-lib-tab" + (sub === "library" ? " on" : "")} onClick={() => setSub("library")}>怪物库</button>
        <button className={"es-lib-tab" + (sub === "team" ? " on" : "")} onClick={() => setSub("team")}>怪物编队</button>
      </div>

      {sub === "library" ? (
        <>
          <div className="es-mon-toolbar">
            <input className="es-search" placeholder="搜索怪物名 / 类型 / 职能 / 威能 / 效果…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button
              className={"es-mon-filters-toggle" + (filterOpen ? " open" : "")}
              onClick={() => setFilterOpen((v) => !v)}
              title={filterOpen ? "收起筛选器" : "展开筛选器"}
            >
              <span className="material-symbols-outlined">filter_list</span>
              {activeFilters > 0 && <span className="es-mon-filters-badge">{activeFilters}</span>}
              <span className="es-mon-filters-caret">{filterOpen ? "▴" : "▾"}</span>
            </button>
            <span className="es-f-result-count" title="当前筛选结果数">{list.length} 条</span>
            {activeFilters > 0 && (
              <button className="md-btn es-btn-sm" onClick={resetFilters} title="清除全部筛选">
                <span className="material-symbols-outlined">filter_alt_off</span>
              </button>
            )}
          </div>
          {filterOpen && (
            <div className="es-mon-filters">
              <div className="es-f-field">
                <span className="es-f-label">等级</span>
                <input
                  className="es-search es-filter-num" type="number" min={1} max={40} placeholder="≥"
                  value={lvlMin === "" ? "" : lvlMin} onChange={(e) => setLvlMin(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <span className="es-f-sep">–</span>
                <input
                  className="es-search es-filter-num" type="number" min={1} max={40} placeholder="≤"
                  value={lvlMax === "" ? "" : lvlMax} onChange={(e) => setLvlMax(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="es-f-field">
                <span className="es-f-label">经验</span>
                <input
                  className="es-search es-filter-num" type="number" min={0} placeholder="≥"
                  value={xpMin === "" ? "" : xpMin} onChange={(e) => setXpMin(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <span className="es-f-sep">–</span>
                <input
                  className="es-search es-filter-num" type="number" min={0} placeholder="≤"
                  value={xpMax === "" ? "" : xpMax} onChange={(e) => setXpMax(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="es-f-field">
                <span className="es-f-label">类别</span>
                <select className="es-search es-filter-select" value={category} onChange={(e) => setCategory(e.target.value)} title="按生物类别筛选">
                  <option value="">全部</option>
                  {categoryOpts.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="es-f-field">
                <span className="es-f-label">界域</span>
                <select className="es-search es-filter-select" value={origin} onChange={(e) => setOrigin(e.target.value)} title="按界域筛选">
                  <option value="">全部</option>
                  {originOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="es-f-field">
                <span className="es-f-label">种群</span>
                <select className="es-search es-filter-select" value={species} onChange={(e) => setSpecies(e.target.value)} title="按生物种群筛选">
                  <option value="">全部</option>
                  {speciesOpts.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="es-f-field">
                <span className="es-f-label">体型</span>
                <select className="es-search es-filter-select" value={sizeSel} onChange={(e) => setSizeSel(e.target.value)} title="按生物体型（占格）筛选">
                  <option value="">全部</option>
                  {sizeOpts.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="es-f-field es-f-field--chips">
                <span className="es-f-label">职能</span>
                <div className="es-fchips">
                  {roleFilterChips.map((r) => (
                    <button key={r} className={"es-fchip" + (roleSel.has(r) ? " on" : "")} onClick={() => toggleRole(r)} title="可多选，需同时满足">{r}</button>
                  ))}
                </div>
              </div>
              {activeFilters > 0 && (
                <div className="es-f-field es-f-field--full">
                  <button className="md-btn es-btn-sm" onClick={resetFilters} title="清除全部筛选">
                    <span className="material-symbols-outlined">filter_alt_off</span> 清除筛选
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="es-library-list">
            {list.length === 0 && <div className="es-library-empty">未找到匹配的怪物</div>}
            {list.map((m) => (
              <div
                key={m.id ?? m.name}
                className="es-library-item"
                onClick={() => onAdd(m)}
              >
                <div className="es-library-item-name es-library-item-name--meta">
                  <span className="es-library-item-title">
                    <span className="es-library-item-text">{m.name}</span>
                  </span>
                  {m.level !== undefined ? (
                    <span className="es-library-item-level">{m.level}级</span>
                  ) : (
                    <span className="es-library-item-level es-library-item-level--summon">召唤生物</span>
                  )}
                </div>
                <div className="es-library-item-row">
                  <span className="es-library-item-left">
                    {sizeLabel(m)}
                    {m.role ? " · " + m.role : ""}
                  </span>
                  <span className="es-library-item-right">速 {m.speed}</span>
                </div>
                <div className="es-library-item-row">
                  <span className="es-library-item-left">防御 {m.ac}/{m.fort}/{m.ref}/{m.will}</span>
                  <span className="es-library-item-right">先攻 {fmtMod(m.init)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="es-team-list">
          {teams.length === 0 && (
            <div className="es-library-empty">还没有怪物编队。请到「怪物」页创建编队，再回到这里逐个放入地图。</div>
          )}
          {teamGroups.map(({ team, groups }) => (
            <div key={team.id} className="es-team-panel">
              <div className="es-team-panel-head">
                <span className="es-team-panel-name">{team.name}</span>
                <span className="es-team-panel-count">{team.stats.length} 只</span>
              </div>
              <div className="es-team-2col">
                {groups.map(([name, total]) => {
                  const stats = team.stats.find((s) => s.name === name);
                  if (!stats) return null;
                  // “剩余/已有”统一以地图实有数为准：剩余 = 编队总数 − 场上同名实有只数
                  const onField = onFieldCount.get("monster|" + name) ?? 0;
                  const remain = total - onField;
                  const canAdd = remain > 0;
                  return (
                    <div
                      key={name}
                      className={"es-team-entry" + (canAdd ? "" : " empty") + (onField > 0 ? " placed" : "")}
                      title={
                        canAdd
                          ? `场上有 ${onField}/${total} 只，还可放 ${remain} 只：点「＋」放一只到地图`
                          : `<${name}> 编队配额已用尽（场上 ${onField} 只）：需先从地图移除才能再放`
                      }
                    >
                      <div className="es-team-entry-info">
                        <div className="es-team-entry-name">
                          {name}
                          {stats.level !== undefined && <span className="es-library-item-level">{stats.level}级</span>}
                          {onField > 0 && <span className="es-char-member-badge">已有{onField > 1 ? `×${onField}` : ""}</span>}
                        </div>
                        <div className="es-team-entry-sub">
                          {stats.role ?? "怪物"} · 剩余 {Math.max(0, remain)}/{total}
                        </div>
                      </div>
                      <button
                        className="md-btn add"
                        title="放一只到地图"
                        disabled={!canAdd}
                        onClick={() => onAdd(stats, `mt:${team.id}`)}
                      >
                        <span className="material-symbols-outlined">add</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}