// 角色卡视图：左栏 复用角色面板（导入/队伍管理）+ 角色池列表（点选角色、改卡）；
// 右栏（剩余全部空间）内嵌车卡器速览面板（OverviewView），编辑实时写回角色池。
// 速览改动（生命/回复力/威能勾选/行动点/休整等）经 onUpdateCharRaw 防抖落回
// 对应 rawChar，再由 App 重算派生数值（buildCharacterCombatant 支持 hpNow 覆盖）。
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { CombatantStats, Party, PartyMember } from "../types";
import type { LogEntry } from "../types";
import CharacterPane from "../battle/CharacterPane";
import OverviewView from "../4ebuild/OverviewView";
import { migrateCharacter, type Character } from "../4ebuild/sheet/character";
import ThemeScope from "../carbuild/ThemeScope";
import "../4ebuild/sheet.css";
import "../4ebuild/sheet-glance.css";

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
  /** 「改卡」：把角色的原始车卡数据带入车卡视图编辑 */
  onEditChar: (rawChar: Record<string, unknown>) => void;
  /** 速览写回：把速览面板编辑后的完整角色数据落回角色池（同名条目，防抖调用） */
  onUpdateCharRaw: (raw: Record<string, unknown>) => void;
  notify: (text: string, tone?: LogEntry["tone"]) => void;
}

export default function CharactersView(props: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selName, setSelName] = useState<string | null>(null);
  const [char, setCharState] = useState<Character | null>(null);

  // 选中条目：未点选时回退到池中第一张（写回只替换条目对象，名字稳定）
  const sel = (selName ? props.charPool.find((c) => c.name === selName) : props.charPool[0]) ?? null;

  // 供速览面板使用的 setChar（char 为 null 时忽略）
  const setChar: Dispatch<SetStateAction<Character>> = useCallback((action) => {
    setCharState((prev) => (prev ? (typeof action === "function" ? action(prev) : action) : prev));
  }, []);

  const charRef = useRef<Character | null>(null);
  charRef.current = char;
  const selRef = useRef(sel);
  selRef.current = sel;

  // 切换角色：先冲刷上一张卡未落盘的改动，再从池内 rawChar 迁移出新速览状态
  useEffect(() => {
    if (charRef.current) props.onUpdateCharRaw(charRef.current as unknown as Record<string, unknown>);
    const entry = selRef.current;
    setCharState(entry?.rawChar ? migrateCharacter(entry.rawChar as Partial<Character>) : null);
    // 依赖仅角色名：写回会替换池内条目对象（rawChar 引用变化），不能由此触发重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.name]);

  // 速览编辑防抖写回角色池（切换视图/角色时由上面的冲刷与卸载兜底）
  useEffect(() => {
    if (!char || !sel?.rawChar) return;
    const raw = char as unknown as Record<string, unknown>;
    const t = setTimeout(() => props.onUpdateCharRaw(raw), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char]);

  // 卸载兜底：离开角色卡视图时落盘最后 400ms 内的改动
  useEffect(() => {
    return () => {
      if (charRef.current) props.onUpdateCharRaw(charRef.current as unknown as Record<string, unknown>);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const poolCount = props.charPool.length;

  return (
    <div className="es-view chars">
      <header className="es-view-head">
        <h2>角色卡</h2>
        <span className="es-view-sub">导入车卡，用速览面板追踪角色状态（{poolCount} 张已导入）</span>
      </header>

      <div className="es-chars-cols">
        {/* 左栏：导入 + 队伍管理（布置桌面栏的角色面板）+ 角色池列表（点选 → 右栏速览） */}
        <aside className="es-chars-left">
          <div className="es-chars-import">
            <button className="md-btn primary" onClick={() => fileRef.current?.click()} title="导入车卡器导出的 .d4e.json 角色卡（可多选）">
              <span className="material-symbols-outlined">upload_file</span> 导入角色卡 .d4e.json
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const files = e.target.files;
                if (files) props.onImportD4e(Array.from(files));
                e.target.value = "";
              }}
            />
          </div>
          <CharacterPane
            parties={props.parties}
            monsters={props.monsters}
            charPool={props.charPool}
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

          <div className="es-chars-pool">
            <div className="es-chars-pool-head">角色池（{poolCount}）</div>
            {poolCount === 0 ? (
              <div className="es-library-empty">尚未导入角色卡。点击上方「导入角色卡 .d4e.json」选择车卡器导出的文件（可一次多选）。</div>
            ) : (
              props.charPool.map((s, i) => (
                <div
                  key={i + "-" + s.name}
                  className={"es-char-mini" + (sel?.name === s.name ? " on" : "")}
                  onClick={() => setSelName(s.name)}
                  title="点击在右侧速览面板中查看 / 追踪该角色"
                >
                  <span className="es-char-mini-name">{s.name}</span>
                  {s.char && <span className="es-char-mini-sub">{s.char.race ? s.char.race + " · " : ""}{s.char.className ?? ""}{s.level ? ` · ${s.level}级` : ""}</span>}
                  {s.rawChar && (
                    <button
                      className="es-char-mini-edit"
                      title="在车卡视图中编辑此角色（改完点「加入角色池」同名更新）"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onEditChar(s.rawChar!);
                      }}
                    >
                      <span className="material-symbols-outlined">edit_note</span> 改卡
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* 右栏：车卡器速览面板（占用剩余全部空间） */}
        <main className="es-chars-main">
          {char && sel?.rawChar ? (
            <div className="es-4e es-chars-glance">
              <ThemeScope>
                <OverviewView layout="double" char={char} setChar={setChar} />
              </ThemeScope>
            </div>
          ) : (
            <section className="es-set-card">
              <p className="es-set-note">
                {poolCount === 0
                  ? "尚未导入角色卡。点击左上方「导入角色卡 .d4e.json」选择车卡器导出的文件（可一次多选）。导入后可在左侧创建队伍、把角色加入遭遇。"
                  : sel && !sel.rawChar
                    ? "该角色缺少原始车卡数据，无法显示速览。可在车卡器中重建后「加入角色池」覆盖。"
                    : "从左侧角色池选择角色，此处显示速览面板（生命 / 防御 / 攻击 / 威能 / 资源实时追踪）。"}
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
