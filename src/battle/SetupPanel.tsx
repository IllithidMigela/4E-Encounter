// 布置桌面栏（左栏）：场景 / 怪物 / 角色 三个互斥 tab
import { useState } from "react";
import type { CombatantStats, Party, PartyMember, TerrainTool } from "../types";
import type { LogEntry } from "../types";
import type { MonsterTeam } from "../uiPrefs";
import ScenePane from "./ScenePane";
import MonsterPanel from "./MonsterPanel";
import CharacterPane from "./CharacterPane";

interface Props {
  sceneTool: TerrainTool;
  onSetSceneTool: (tool: TerrainTool) => void;
  mapCols: number;
  mapRows: number;
  onSetMapSize: (cols: number, rows: number) => void;
  mapColor: string;
  onSetMapColor: (c: string) => void;
  /** 历史涂色（最近 16 个，最新在前） */
  colorHistory: string[];
  monsters: CombatantStats[];
  teams: MonsterTeam[];
  onAdd: (stats: CombatantStats, team?: string) => void;
  onFieldCount: Map<string, number>;
  parties: Party[];
  charPool: CombatantStats[];
  onImportD4e: (files: File[]) => void;
  onCreateParty: () => void;
  onRenameParty: (id: string, name: string) => void;
  onDeleteParty: (id: string) => void;
  onAddPartyMember: (partyId: string, member: PartyMember) => void;
  onRemovePartyMember: (partyId: string, memberId: string) => void;
  onMemberColor: (partyId: string, memberId: string, color: string | undefined) => void;
  onPlacePartyMember: (partyId: string, stats: CombatantStats, color?: string) => void;
  notify: (text: string, tone?: LogEntry["tone"]) => void;
}

const TABS: { key: string; label: string }[] = [
  { key: "scene", label: "场景" },
  { key: "monster", label: "怪物" },
  { key: "character", label: "角色" },
];

export default function SetupPanel(props: Props) {
  const [tab, setTab] = useState("scene");
  return (
    <div className="es-setup">
      <div className="es-setup-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={"es-setup-tab" + (tab === t.key ? " on" : "")}
            onClick={() => {
              // 切离「场景」tab 时退出绘制模式，避免画笔在怪物/角色栏残留
              if (tab === "scene" && t.key !== "scene") props.onSetSceneTool(null);
              setTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="es-setup-body">
        {tab === "scene" && (
          <ScenePane
            sceneTool={props.sceneTool}
            onSetSceneTool={props.onSetSceneTool}
            mapCols={props.mapCols}
            mapRows={props.mapRows}
            onSetMapSize={props.onSetMapSize}
            mapColor={props.mapColor}
            onSetMapColor={props.onSetMapColor}
            colorHistory={props.colorHistory}
          />
        )}
        {tab === "monster" && (
          <MonsterPanel monsters={props.monsters} teams={props.teams} onAdd={props.onAdd} onFieldCount={props.onFieldCount} />
        )}
        {tab === "character" && (
          <CharacterPane
            parties={props.parties}
            monsters={props.monsters}
            charPool={props.charPool}
            onFieldCount={props.onFieldCount}
            onImportD4e={props.onImportD4e}
            onCreateParty={props.onCreateParty}
            onRenameParty={props.onRenameParty}
            onDeleteParty={props.onDeleteParty}
            onAddPartyMember={props.onAddPartyMember}
            onRemovePartyMember={props.onRemovePartyMember}
            onMemberColor={props.onMemberColor}
            onPlacePartyMember={props.onPlacePartyMember}
            notify={props.notify}
          />
        )}
      </div>
    </div>
  );
}