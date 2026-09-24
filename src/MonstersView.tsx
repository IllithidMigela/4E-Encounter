// 怪物视图：三栏布局
// 左栏：完整怪物库（全条目 + 标签筛选）+ 勾选加入目标队伍
// 中栏：怪物队伍管理（新建/删除/展开详情 + 队伍级/成员级描边色彩管理 + 加入遭遇）
// 右栏：复用棋子栏·怪物面板 (SidePanel/WikiStatBlock) 展示选中怪物的战斗数据（只读向导）
import { useMemo, useState } from "react";
import type { Combatant, CombatantStats } from "./types";
import type { MonsterTeam } from "./uiPrefs";
import SidePanel from "./SidePanel";

interface Props {
  monsters: CombatantStats[];
  teams: MonsterTeam[];
  onSaveTeams: (t: MonsterTeam[]) => void;
}

/** 棋子描边预设色（第一项为“无”）——与角色队伍保持一致 */
const STROKES: (string | undefined)[] = [undefined, "#e5484d", "#f5a524", "#46a758", "#168fd4", "#7c5ce0", "#d43d8e"];

/** 队伍内按名称分组：name → { 首只属性, 数量 } */
function teamGroups(t: MonsterTeam): [string, { stats: CombatantStats; count: number }][] {
  const m = new Map<string, { stats: CombatantStats; count: number }>();
  for (const s of t.stats) {
    const g = m.get(s.name);
    if (g) g.count++;
    else m.set(s.name, { stats: s, count: 1 });
  }
  return [...m.entries()];
}

export default function MonstersView({ monsters, teams, onSaveTeams }: Props) {
  // 左栏筛选：名称 / 等级 / 经验 / 类别 / 职能（多选） / 界域 / 种群
  const [q, setQ] = useState("");
  const [lvlMin, setLvlMin] = useState<number | "">("");
  const [lvlMax, setLvlMax] = useState<number | "">("");
  const [xpMin, setXpMin] = useState<number | "">("");
  const [xpMax, setXpMax] = useState<number | "">("");
  const [roleSel, setRoleSel] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState("");
  const [origin, setOrigin] = useState("");
  const [species, setSpecies] = useState("");
  const [sizeSel, setSizeSel] = useState("");
  // 筛选器是否展开（默认收起，避免挤压条目列表）
  const [filterOpen, setFilterOpen] = useState(false);
  // 勾选与目标队伍
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [targetTeamId, setTargetTeamId] = useState("");
  // 中栏展开的队伍（支持多支同时展开）
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 右栏详情（选中怪物）
  const [detail, setDetail] = useState<CombatantStats | null>(null);

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

  const toggle = (name: string) => {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  };

  const toggleRole = (r: string) => {
    setRoleSel((prev) => {
      const n = new Set(prev);
      if (n.has(r)) n.delete(r);
      else n.add(r);
      return n;
    });
  };

  const resetFilters = () => {
    setQ("");
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

  // 切换某支队伍的展开状态
  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
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
    return [...arr].sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-Hans-CN"));
  }, [monsters, q, lvlMin, lvlMax, xpMin, xpMax, roleSel, category, origin, species, sizeSel]);

  // ---------- 队伍操作 ----------
  const createTeam = () => {
    const t: MonsterTeam = {
      id: "t" + Date.now(),
      name: "未命名队伍" + (teams.length + 1),
      stats: [],
    };
    const next = [...teams, t];
    onSaveTeams(next);
    setTargetTeamId(t.id);
    // 队伍展开：让新队伍保持展开（支持多支同时展开）
    setExpanded((prev) => new Set(prev).add(t.id));
  };

  /** 把单只怪物直接加入当前选中的队伍 */
  const addMonsterToTeam = (m: CombatantStats) => {
    const team = teams.find((t) => t.id === targetTeamId);
    if (!team) return;
    onSaveTeams(teams.map((t) => (t.id === team.id ? { ...t, stats: [...t.stats, { ...m }] } : t)));
    setExpanded((prev) => new Set(prev).add(team.id));
  };

  /** 把当前勾选的全部怪物（按名称去重）加入选中队伍 */
  const addAllSelectedToTeam = () => {
    const team = teams.find((t) => t.id === targetTeamId);
    if (!team || sel.size === 0) return;
    const unique = new Map<string, CombatantStats>();
    for (const m of list) {
      if (sel.has(m.name) && !unique.has(m.name)) unique.set(m.name, m);
    }
    if (unique.size === 0) return;
    onSaveTeams(teams.map((t) => (t.id === team.id ? { ...t, stats: [...t.stats, ...[...unique.values()].map((m) => ({ ...m }))] } : t)));
    setExpanded((prev) => new Set(prev).add(team.id));
  };

  const removeGroup = (teamId: string, name: string) => {
    onSaveTeams(teams.map((t) => (t.id === teamId ? { ...t, stats: t.stats.filter((s) => s.name !== name) } : t)));
  };

  // 描边色选择弹窗：目标为队伍颜色或队伍内某怪物
  const [colorFor, setColorFor] = useState<{ teamId: string; name?: string } | null>(null);

  const applyColor = (c: string | undefined) => {
    if (!colorFor) return;
    const { teamId, name } = colorFor;
    if (name) {
      onSaveTeams(
        teams.map((t) => {
          if (t.id !== teamId) return t;
          const colors = { ...(t.memberColors ?? {}) };
          if (c) colors[name] = c;
          else delete colors[name];
          return { ...t, memberColors: colors };
        }),
      );
    } else {
      onSaveTeams(teams.map((t) => (t.id === teamId ? { ...t, color: c } : t)));
    }
    setColorFor(null);
  };

  // 队伍重命名（内联编辑）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setDraftName(name);
  };
  const commitRename = () => {
    if (editingId) {
      const nm = draftName.trim() || "未命名队伍";
      onSaveTeams(teams.map((t) => (t.id === editingId ? { ...t, name: nm } : t)));
    }
    setEditingId(null);
  };
  const cancelRename = () => setEditingId(null);

  // 把选中的怪物数据包成 Combatant 供右栏 SidePanel 展示（未放置、仅只读向导）
  const detailC = useMemo<Combatant | null>(
    () =>
      detail
        ? { ...detail, cid: "mon-detail-" + detail.name + "-" + (detail.level ?? 0), pos: null, conditions: [], initResult: null }
        : null,
    [detail],
  );

  const targetValid = teams.some((t) => t.id === targetTeamId);

  // 弹窗当前选中色
  const currentColor = colorFor
    ? colorFor.name
      ? teams.find((t) => t.id === colorFor.teamId)?.memberColors?.[colorFor.name]
      : teams.find((t) => t.id === colorFor.teamId)?.color
    : undefined;

  return (
    <div className="es-view mon">
      <header className="es-view-head">
        <h2>怪物</h2>
        <span className="es-view-sub">{monsters.length} 条怪物数据 · {teams.length} 支队伍</span>
      </header>

      <div className="es-mons-cols">
        {/* 左栏：完整怪物库（全条目 + 标签筛选 + 勾选加入队伍） */}
        <aside className="es-mons-left">
          <section className="es-mon-panel es-mon-lib">
            <div className="es-mon-toolbar">
              <input className="es-search" placeholder="搜索名称/类型/职能/威能/效果…" value={q} onChange={(e) => setQ(e.target.value)} />
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
            </div>
            )}
            <div className="es-mon-selbar">
              <span className="es-mon-selcount">已选 {sel.size}</span>
              <select
                className="es-search es-filter-select"
                value={targetValid ? targetTeamId : ""}
                onChange={(e) => setTargetTeamId(e.target.value)}
                title="选择要加入的队伍"
              >
                <option value="">选择队伍…</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button
                className="md-btn add"
                disabled={!targetValid || sel.size === 0}
                title={!targetValid ? "请先选择队伍" : "将勾选的怪物全部加入队伍"}
                onClick={addAllSelectedToTeam}
              >
                <span className="material-symbols-outlined">playlist_add</span> 全部入队
              </button>
            </div>
            <div className="es-mon-list">
              {list.length === 0 && <div className="es-empty">未找到匹配的怪物。</div>}
              {list.map((m) => (
                <div
                  key={m.id ?? m.name}
                  className={"es-mon-card" + (sel.has(m.name) ? " sel" : "") + (detail === m ? " detail" : "")}
                  onClick={() => setDetail(detail === m ? null : m)}
                >
                  <div className="es-mon-card-top">
                    <label className="es-mon-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel.has(m.name)} onChange={() => toggle(m.name)} />
                    </label>
                    <div className="es-mon-card-name">
                      <div className="es-mon-card-title">
                        {m.name} {m.level !== undefined ? <span className="es-mon-lvl">{m.level}级</span> : <span className="es-mon-lvl es-mon-lvl--summon">召唤生物</span>}
                      </div>
                      <div className="es-mon-card-sub">
                        {[m.tier, m.role].filter(Boolean).join(" ")}{[m.tier, m.role].some(Boolean) ? " · " : ""}HP {m.maxHp} · AC {m.ac}/{m.fort}/{m.ref}/{m.will} · 速 {m.speed}
                      </div>
                    </div>
                    <button
                      className="md-btn add"
                      title={targetValid ? "加入队伍" : "请先选择队伍"}
                      disabled={!targetValid}
                      onClick={(e) => { e.stopPropagation(); addMonsterToTeam(m); }}
                    >
                      <span className="material-symbols-outlined">playlist_add</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>

        {/* 中栏：怪物队伍 + 详情 + 色彩管理 */}
        <main className="es-mons-main">
          <section className="es-mon-panel es-mon-panel-team">
            <div className="es-mon-teams-head">
              <h3>怪物队伍</h3>
              <button className="md-btn" onClick={createTeam}>
                <span className="material-symbols-outlined">group_add</span> 新建队伍
              </button>
            </div>
            {teams.length === 0 && (
              <div className="es-empty">还没有队伍。点「新建队伍」，再在左侧怪物库勾选怪物「加入队伍」。</div>
            )}
            {teams.map((t) => (
              <div key={t.id} className={"es-team-card" + (expanded.has(t.id) ? " open" : "")}>
                <div className="es-team-card-head" onClick={() => toggleExpanded(t.id)} title="展开/收起队伍详情">
                  <button
                    className={"es-char-color" + (t.color ? "" : " none")}
                    style={t.color ? { background: t.color } : undefined}
                    title="点击选择队伍描边色"
                    onClick={(e) => { e.stopPropagation(); setColorFor({ teamId: t.id }); }}
                  />
                  {editingId === t.id ? (
                    <input
                      className="es-team-rename"
                      value={draftName}
                      autoFocus
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commitRename();
                        else if (e.key === "Escape") cancelRename();
                      }}
                      onBlur={commitRename}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="es-team-name" title="点击重命名" onClick={(e) => { e.stopPropagation(); startRename(t.id, t.name); }}>{t.name}</span>
                  )}
                  <span className="es-team-count">{t.stats.length} 只</span>
                  <span className="es-team-actions">
                    <button className="md-btn danger" title="删除该队伍" onClick={(e) => { e.stopPropagation(); onSaveTeams(teams.filter((x) => x.id !== t.id)); }}>
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </span>
                </div>
                {expanded.has(t.id) && (
                  <div className="es-team-detail">
                    {t.stats.length === 0 && <div className="es-empty">空队伍</div>}
                    {teamGroups(t).map(([name, g]) => {
                      const st = g.stats;
                      const tag = [st.tier, st.role].filter(Boolean).join(" ");
                      return (
                        <div
                          key={name}
                          className={"es-team-row" + (detail === st ? " active" : "")}
                          title="点击在右侧查看详情"
                          onClick={() => setDetail(detail === st ? null : st)}
                        >
                          <button
                            className={"es-char-color" + (t.memberColors?.[name] ? "" : " none")}
                            style={t.memberColors?.[name] ? { background: t.memberColors[name] } : undefined}
                            title="点击更换该怪物的描边色"
                            onClick={(e) => { e.stopPropagation(); setColorFor({ teamId: t.id, name }); }}
                          />
                          <span className="es-team-row-body">
                            <span className="es-team-row-name">
                              {name}
                              {st.level !== undefined ? <span className="es-team-row-lvl">{st.level}级</span> : <span className="es-team-row-lvl es-team-row-lvl--summon">召唤生物</span>}
                              {g.count > 1 ? <b className="es-team-row-multi">×{g.count}</b> : ""}
                            </span>
                            <span className="es-team-row-sub">
                              {tag}{tag ? " " : ""}
                              <em className="es-team-row-stats">HP{st.maxHp} · AC{st.ac}/{st.fort}/{st.ref}/{st.will} · 速{st.speed}</em>
                            </span>
                          </span>
                          <button className="es-char-del" title="从队伍移除该怪物" onClick={(e) => { e.stopPropagation(); removeGroup(t.id, name); }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </section>
        </main>

        {/* 右栏：复用棋子栏·怪物面板（wiki 属性块）展示选中怪物详情 */}
        <aside className="es-mons-right">
          {detailC ? (
            // 只读怪卡：复用怪卡组件但隐藏全部交互按钮（HP 调整/威能瞄准/编辑/移除）
            <SidePanel
              c={detailC}
              onPatch={() => void 0}
              onApplyDamage={() => void 0}
              onApplyHeal={() => void 0}
              onUseSurge={() => void 0}
              onRemove={() => setDetail(null)}
              onSetAttacks={() => void 0}
              onSelectAttack={() => void 0}
              readOnly
            />
          ) : (
            <div className="es-side-empty">在左侧选择一只怪物，右侧展示其 wiki 属性块（含威能/特性，可直接扫码加入遭遇）。</div>
          )}
        </aside>
      </div>

      {/* 描边色选择弹窗 */}
      {colorFor && (
        <div className="es-color-pop-mask" onClick={() => setColorFor(null)}>
          <div className="es-color-pop" onClick={(e) => e.stopPropagation()}>
            <div className="es-color-pop-title">
              选择描边颜色
              <span className="es-color-pop-mem">{colorFor.name ?? "整队"}</span>
            </div>
            <div className="es-color-pop-grid">
              <button
                key="none"
                className="es-char-color none es-color-pop-swatch"
                title="无描边"
                onClick={() => applyColor(undefined)}
              />
              {STROKES.filter((s): s is string => !!s).map((c) => (
                <button
                  key={c}
                  className={"es-char-color es-color-pop-swatch" + (currentColor === c ? " sel" : "")}
                  style={{ background: c }}
                  title={c}
                  onClick={() => applyColor(c)}
                />
              ))}
            </div>
            <button className="md-btn es-color-pop-cancel" onClick={() => setColorFor(null)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}