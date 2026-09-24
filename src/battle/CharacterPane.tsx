// 角色面板（布置桌面·角色）：创建队伍 + 队伍列表（改名/加NPC/加角色/删除X + 颜色块改棋子描边 + 点击条目放地图）
import { useState } from "react";
import type { CombatantStats, Party, PartyMember } from "../types";
import type { LogEntry } from "../types";
import NpcPickerDialog from "./NpcPickerDialog";
import PartyPoolDialog from "./PartyPoolDialog";

/** 棋子描边预设色（第一项为“无”） */
const STROKES: (string | undefined)[] = [undefined, "#e5484d", "#f5a524", "#46a758", "#168fd4", "#7c5ce0", "#d43d8e"];

export function nextMemberId(): string {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

interface Props {
  parties: Party[];
  monsters: CombatantStats[];
  charPool: CombatantStats[];
  onImportD4e: (files: File[]) => void;
  onCreateParty: () => void;
  onRenameParty: (id: string, name: string) => void;
  onDeleteParty: (id: string) => void;
  onAddPartyMember: (partyId: string, member: PartyMember) => void;
  onRemovePartyMember: (partyId: string, memberId: string) => void;
  onMemberColor: (partyId: string, memberId: string, color: string | undefined) => void;
  onPlacePartyMember: (partyId: string, stats: CombatantStats, color?: string) => void;
  /** 场上已放置棋子计数（键＝`阵营|名称`，例如 `pc|维德瑞.科洛纳`），键不存在即未上场；省略=无追踪 */
  onFieldCount?: Map<string, number>;
  notify: (text: string, tone?: LogEntry["tone"]) => void;
}

export default function CharacterPane(props: Props) {
  const {
    parties, monsters, charPool, onImportD4e, onCreateParty,
    onRenameParty, onDeleteParty, onAddPartyMember, onRemovePartyMember,
    onMemberColor, onPlacePartyMember, onFieldCount = new Map(), notify,
  } = props;
  const [editingName, setEditingName] = useState<string | null>(null); // partyId 正在改名
  const [nameDraft, setNameDraft] = useState("");
  const [poolPartyId, setPoolPartyId] = useState<string | null>(null);
  const [npcPartyId, setNpcPartyId] = useState<string | null>(null);

  const cycleColor = (partyId: string, member: PartyMember) => {
    const idx = STROKES.indexOf(member.color);
    onMemberColor(partyId, member.id, STROKES[(idx + 1) % STROKES.length]);
  };

  const subtitle = (s: CombatantStats): string => {
    const c = s.char;
    return [c?.className, c?.race, s.level !== undefined ? `${s.level}级` : ""].filter(Boolean).join(" · ") || "怪物";
  };

  return (
    <div className="es-char">
      <button className="md-btn" onClick={onCreateParty}>
        <span className="material-symbols-outlined">group_add</span> 创建队伍
      </button>

      <div className="es-char-parties">
        {parties.length === 0 && <div className="es-library-empty">还没有队伍。点「创建队伍」建立一支，再添加角色 / NPC。</div>}
        {parties.map((p) => (
          <div key={p.id} className="es-char-party">
            <div className="es-char-party-head">
              {editingName === p.id ? (
                <input
                  className="es-search es-char-name-input"
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    if (nameDraft.trim()) onRenameParty(p.id, nameDraft.trim());
                    setEditingName(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (nameDraft.trim()) onRenameParty(p.id, nameDraft.trim());
                      setEditingName(null);
                    } else if (e.key === "Escape") setEditingName(null);
                  }}
                />
              ) : (
                <span className="es-char-party-name">{p.name}</span>
              )}
              <span className="es-char-party-actions">
                <button className="es-char-btn" title="修改名称" onClick={() => { setEditingName(p.id); setNameDraft(p.name); }}>
                  <span className="material-symbols-outlined">edit</span>
                </button>
                <button className="es-char-btn" title="添加NPC" onClick={() => setNpcPartyId(p.id)}>
                  <span className="material-symbols-outlined">person_add</span>NPC
                </button>
                <button className="es-char-btn" title="添加角色" onClick={() => setPoolPartyId(p.id)}>
                  <span className="material-symbols-outlined">person_add</span>角色
                </button>
                <button className="es-char-btn danger" title="删除队伍" onClick={() => onDeleteParty(p.id)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </span>
            </div>

            <div className="es-char-members">
              {p.members.length === 0 && <div className="es-library-empty">空队伍</div>}
              {p.members.map((m) => {
                const onFieldCountFor = onFieldCount.get(m.source + "|" + m.name) ?? 0;
                const placed = onFieldCountFor > 0;
                return (
                  <div
                    key={m.id}
                    className={"es-char-member" + (placed ? " placed" : "")}
                    onClick={placed ? undefined : () => onPlacePartyMember(p.id, m.stats, m.color)}
                    title={placed ? "已有一枚在场上：点击不会重复放入，需右下角「＋」显式再放一枚" : "点击把该棋子放上地图"}
                  >
                    <span className="es-char-member-name">
                      {m.name}
                      {placed && <span className="es-char-member-badge">已有{onFieldCountFor > 1 ? `×${onFieldCountFor}` : ""}</span>}
                    </span>
                    <span className="es-char-member-sub">{subtitle(m.stats)}</span>
                    {placed && (
                      <button
                        className="es-char-place"
                        title="已有棋子：显式再放一枚（进入放置模式，点地图放置）"
                        onClick={(e) => { e.stopPropagation(); onPlacePartyMember(p.id, m.stats, m.color); }}
                      >
                        ＋
                      </button>
                    )}
                    <button
                      className={"es-char-color" + (m.color ? "" : " none")}
                      title="点击更换棋子描边颜色"
                      style={m.color ? { background: m.color } : undefined}
                      onClick={(e) => { e.stopPropagation(); cycleColor(p.id, m); }}
                    />
                    <button
                      className="es-char-del"
                      onClick={(e) => { e.stopPropagation(); onRemovePartyMember(p.id, m.id); }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {poolPartyId && (
        <PartyPoolDialog
          pool={charPool}
          onImport={onImportD4e}
          onClose={() => setPoolPartyId(null)}
          onPick={(stats) => {
            onAddPartyMember(poolPartyId, { id: nextMemberId(), name: stats.name, source: "pc", stats });
            setPoolPartyId(null);
            notify(`已把「${stats.name}」加入队伍。`, "normal");
          }}
        />
      )}

      {npcPartyId && (
        <NpcPickerDialog
          monsters={monsters}
          onClose={() => setNpcPartyId(null)}
          onPick={(stats) => {
            onAddPartyMember(npcPartyId, { id: nextMemberId(), name: stats.name, source: "monster", stats });
            setNpcPartyId(null);
            notify(`已把「${stats.name}」作为 NPC 加入队伍。`, "normal");
          }}
        />
      )}
    </div>
  );
}