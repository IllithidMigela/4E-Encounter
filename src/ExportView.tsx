// 导出视图：导出全部或部分数据（怪物组合 / 遭遇记录）
import { useState } from "react";
import type { Combatant, FogLevel, LogEntry, Party } from "./types";
import type { MonsterTeam, Settings } from "./uiPrefs";

interface Props {
  combatants: Combatant[];
  obstacles: Set<string>;
  difficult: Set<string>;
  fog: Record<string, FogLevel>;
  water: Set<string>;
  chasm: Set<string>;
  traps: Set<string>;
  cols: number;
  rows: number;
  turnOrder: string[];
  turnIndex: number;
  teams: MonsterTeam[];
  parties: Party[];
  settings: Settings;
  notify: (text: string, tone?: LogEntry["tone"]) => void;
}

export default function ExportView({ combatants, obstacles, difficult, fog, water, chasm, traps, cols, rows, turnOrder, turnIndex, teams, parties, settings, notify }: Props) {
  const [wantEncounter, setWantEncounter] = useState(true);
  const [wantTeams, setWantTeams] = useState(true);
  const [wantSettings, setWantSettings] = useState(false);

  const download = (perhapsAll: boolean) => {
    const useEnc = perhapsAll || wantEncounter;
    const useTeams = perhapsAll || wantTeams;
    const useSettings = perhapsAll || wantSettings;
    if (!useEnc && !useTeams && !useSettings) {
      notify("请至少勾选一项要导出的内容。", "warn");
      return;
    }
    const payload: Record<string, unknown> = {
      app: "4E-Encounter",
      version: 1,
      exportedAt: new Date().toISOString(),
    };
    if (useEnc) {
      payload.encounter = {
        combatants: combatants.map((c) => ({ ...c, conditions: [...c.conditions] })),
        obstacles: [...obstacles],
        difficult: [...difficult],
        fog,
        water: [...water],
        chasm: [...chasm],
        trap: [...traps],
        parties,
        map: { cols, rows },
        turnOrder,
        turnIndex,
      };
    }
    if (useTeams) payload.teams = teams;
    if (useSettings) payload.settings = settings;

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "4E-遭遇-导出.json";
    a.click();
    URL.revokeObjectURL(a.href);
    notify("导出成功。");
  };

  const stats = {
    monsters: combatants.filter((c) => c.kind === "monster").length,
    pcs: combatants.filter((c) => c.kind === "pc").length,
    obstacles: obstacles.size,
  };

  return (
    <div className="es-view">
      <header className="es-view-head">
        <h2>导出</h2>
        <span className="es-view-sub">保存 4E 数据为 JSON</span>
      </header>

      <section className="es-set-card">
        <h3>当前遭遇概览</h3>
        <div className="es-set-row">
          <span className="chip">PC {stats.pcs} 个</span>
          <span className="chip">怪物 {stats.monsters} 个</span>
          <span className="chip">障碍 {stats.obstacles} 格</span>
          <span className="chip">地图 {cols}×{rows}</span>
        </div>
      </section>

      <section className="es-set-card">
        <h3>选择导出内容</h3>
        <label className="es-set-row">
          <input type="checkbox" checked={wantEncounter} onChange={(e) => setWantEncounter(e.target.checked)} />
          <span>当前遭遇记录（参战者 · 障碍 · 地图 · 先攻）</span>
        </label>
        <label className="es-set-row">
          <input type="checkbox" checked={wantTeams} onChange={(e) => setWantTeams(e.target.checked)} />
          <span>怪物队伍（{teams.length} 支）</span>
        </label>
        <label className="es-set-row">
          <input type="checkbox" checked={wantSettings} onChange={(e) => setWantSettings(e.target.checked)} />
          <span>界面设置</span>
        </label>
      </section>

      <section className="es-set-card es-export-actions">
        <button className="md-btn primary" onClick={() => download(false)}>
          <span className="material-symbols-outlined">download</span> 导出所选
        </button>
        <button className="md-btn" onClick={() => download(true)}>
          <span className="material-symbols-outlined">save_alt</span> 导出全部
        </button>
      </section>
    </div>
  );
}