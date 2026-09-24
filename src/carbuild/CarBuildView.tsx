// 车卡视图：内嵌最新版车卡器（4E-NEXT 同步副本 src/4ebuild）的完整交互建卡/改卡界面。
// - 多卡管理（新建/切换/重命名/删除/立即保存）+ .d4e.json 导入导出：复用 4ebuild/lib/storage（localStorage kcc.cards.v1）
// - 编辑/渲染模式、单/双栏布局切换（偏好存 kcc-layout，与独立车卡器一致）
// - 「加入角色池」：当前卡交给 App 侧走 buildCharacterCombatant 管道（同名替换/异名追加）
// - 「改卡」种子：从角色池带入 rawChar，同名卡更新为池内最新版并激活，否则新建卡
//
// 样式隔离：车卡器 UI 全部在 .es-4e 容器内（scripts/scope-sheet-css.mjs 生成的作用域 sheet.css）；
// portal 弹窗（.picker-overlay/.crop-overlay 渲染到 document.body）的样式由 scope 脚本保持全局。
import { useEffect, useRef, useState } from "react";
import CharacterSheet from "../4ebuild/sheet/CharacterSheet";
import { defaultCharacter, migrateCharacter, type Character } from "../4ebuild/sheet/character";
import { loadCards, saveCards, loadActiveId, saveActiveId, uid, type SavedCard } from "../4ebuild/lib/storage";
import { TextButton } from "../4ebuild/components/md";
import SheetDialog from "../4ebuild/components/SheetDialog";
import ThemeScope from "./ThemeScope";
import "../4ebuild/sheet.css";
import "../4ebuild/sheet-extra.css";
import "../4ebuild/sheet-glance.css";

interface Props {
  /** 改卡种子：角色池角色的原始数据（rawChar），消费后由 App 侧清空 */
  seed: Record<string, unknown> | null;
  onSeedConsumed: () => void;
  /** 加入角色池（App 侧：buildCharacterCombatant → 同名替换/异名追加 + 日志） */
  onAddToPool: (char: Character) => void;
}

export default function CarBuildView(props: Props) {
  const [layout, setLayout] = useState<"single" | "double">(() =>
    localStorage.getItem("kcc-layout") !== "single" ? "double" : "single",
  );
  const [mode, setMode] = useState<"edit" | "render">("edit");
  const [cards, setCards] = useState<SavedCard[]>(() => {
    const loaded = loadCards().map((card) => ({ ...card, char: migrateCharacter(card.char) }));
    if (loaded.length > 0) return loaded;
    const first: SavedCard = { id: uid(), name: "角色 1", char: defaultCharacter(), updatedAt: Date.now() };
    saveCards([first]);
    return [first];
  });
  const [activeId, setActiveId] = useState<string>(() => loadActiveId() ?? "");
  const [char, setChar] = useState<Character>(() => {
    // activeId 初始化可能为空（首次使用）→ 取第一张卡
    const id = loadActiveId();
    const loaded = loadCards();
    const target = (id ? loaded.find((c) => c.id === id) : undefined) ?? loaded[0];
    return target ? migrateCharacter(target.char) : defaultCharacter();
  });
  const [cardOpen, setCardOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // activeId 为空时对齐到第一张卡
  useEffect(() => {
    if (!activeId && cards.length > 0) {
      setActiveId(cards[0].id);
      saveActiveId(cards[0].id);
    }
  }, [activeId, cards]);

  // 主题变量作用域化（ThemeProvider 变量搬移 + portal 弹窗镜像）由 ThemeScope 统一处理

  // ---------- 改卡种子消费 ----------
  useEffect(() => {
    if (!props.seed) return;
    const migrated = migrateCharacter(props.seed as Partial<Character>);
    const name = migrated.name || "未命名";
    const idx = cards.findIndex((c) => c.name === name);
    const next =
      idx >= 0
        ? cards.map((c, i) => (i === idx ? { ...c, char: migrated, updatedAt: Date.now() } : c))
        : [...cards, { id: uid(), name, char: migrated, updatedAt: Date.now() }];
    const card = next[idx >= 0 ? idx : next.length - 1];
    setCards(next);
    saveCards(next);
    setActiveId(card.id);
    saveActiveId(card.id);
    setChar(migrated);
    setMode("edit");
    props.onSeedConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.seed]);

  // 自动保存：char 变更防抖写回当前卡（与独立车卡器一致）
  useEffect(() => {
    const t = setTimeout(() => {
      setCards((p) => {
        const next = p.map((c) => (c.id === activeId ? { ...c, char, updatedAt: Date.now() } : c));
        saveCards(next);
        return next;
      });
    }, 400);
    return () => clearTimeout(t);
  }, [char, activeId]);

  // 卸载落盘：防抖计时器外丢失最后 400ms 内的改动（视图切换即组件卸载）
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const charRef = useRef(char);
  charRef.current = char;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  useEffect(() => {
    return () => {
      const next = cardsRef.current.map((c) =>
        c.id === activeIdRef.current ? { ...c, char: charRef.current, updatedAt: Date.now() } : c,
      );
      saveCards(next);
    };
  }, []);

  function toggleLayout() {
    setLayout((p) => {
      const next = p === "single" ? "double" : "single";
      localStorage.setItem("kcc-layout", next);
      return next;
    });
  }

  function switchCard(id: string) {
    const target = cards.find((c) => c.id === id);
    if (!target) return;
    setChar(target.char);
    setActiveId(id);
    saveActiveId(id);
    setCardOpen(false);
  }

  function newCard() {
    const card: SavedCard = { id: uid(), name: "角色 " + (cards.length + 1), char: defaultCharacter(), updatedAt: Date.now() };
    const next = [...cards, card];
    setCards(next);
    saveCards(next);
    setChar(card.char);
    setActiveId(card.id);
    saveActiveId(card.id);
    setCardOpen(false);
  }

  function deleteCard(id: string) {
    if (cards.length <= 1) return;
    const rest = cards.filter((c) => c.id !== id);
    setCards(rest);
    saveCards(rest);
    if (activeId === id) {
      const next = rest[0];
      setChar(next.char);
      setActiveId(next.id);
      saveActiveId(next.id);
    }
    if (renamingId === id) setRenamingId(null);
  }

  function saveCardNow(id: string) {
    setCards((p) => {
      const next = p.map((c) => (c.id === id ? { ...c, char: id === activeId ? char : c.char, updatedAt: Date.now() } : c));
      saveCards(next);
      return next;
    });
  }

  function confirmRename() {
    const name = renameText.trim();
    if (renamingId && name) {
      setCards((p) => {
        const next = p.map((c) => (c.id === renamingId ? { ...c, name } : c));
        saveCards(next);
        return next;
      });
    }
    setRenamingId(null);
  }

  // 导出存档：单文件 JSON（与独立车卡器格式互通）
  function exportSave() {
    const data = {
      app: "dnd4e-kcc",
      format: 1,
      exportedAt: new Date().toISOString(),
      pages: {
        character: char,
        reserve: { spellbook: char.spellbook ?? [], backpack: char.backpack ?? [] },
        overview: {},
        background: char.creation ?? {},
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (char.name || "角色").replace(/[\\/:*?"<>|]/g, "_") + ".d4e.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // 导入存档：解析并覆盖当前卡（校验格式）
  function importSave(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const c = data && data.pages && data.pages.character ? migrateCharacter(data.pages.character) : null;
        if (!c || data.app !== "dnd4e-kcc") throw new Error("bad");
        setChar(c);
        setCards((p) => {
          const next = p.map((x) => (x.id === activeId ? { ...x, char: c, name: c.name || x.name, updatedAt: Date.now() } : x));
          saveCards(next);
          return next;
        });
      } catch {
        window.alert("导入失败：文件格式不正确（请使用车卡器导出的 .d4e.json）。");
      }
    };
    reader.readAsText(file);
  }

  const activeCard = cards.find((c) => c.id === activeId);

  return (
    <div className="es-view carbuild">
      <header className="es-view-head">
        <h2>车卡器</h2>
        <span className="es-carbuild-ver" title="内嵌车卡器版本（4E-NEXT 同步源）">v{__CARBUILD_VERSION__}B</span>
        <span className="es-view-sub">
          建卡 / 改卡（当前：{activeCard ? activeCard.name : "无卡"} · Lv{char.level}）
        </span>
        <div className="es-carbuild-tools">
          <button className="md-btn" onClick={() => setCardOpen(true)} title="管理多张人物卡（新建/切换/重命名/删除）">
            <span className="material-symbols-outlined">folder</span> 存档
          </button>
          <button className="md-btn" onClick={() => setMode((m) => (m === "edit" ? "render" : "edit"))} title={mode === "edit" ? "切换到渲染模式（只读预览）" : "切换到编辑模式"}>
            <span className="material-symbols-outlined">{mode === "edit" ? "lock" : "edit"}</span>
            {mode === "edit" ? "渲染" : "编辑"}
          </button>
          <button className="md-btn" onClick={toggleLayout} title={layout === "single" ? "切换到双栏布局" : "切换到单栏布局"}>
            <span className="material-symbols-outlined">{layout === "single" ? "view_module" : "view_agenda"}</span>
            {layout === "single" ? "双栏" : "单栏"}
          </button>
          <button className="md-btn" onClick={() => importRef.current?.click()} title="导入车卡器导出的 .d4e.json（覆盖当前卡）">
            <span className="material-symbols-outlined">upload</span> 导入
          </button>
          <button className="md-btn" onClick={exportSave} title="导出当前卡为 .d4e.json（与独立车卡器互通）">
            <span className="material-symbols-outlined">download</span> 导出
          </button>
          <button className="md-btn primary" onClick={() => props.onAddToPool(char)} title="把当前卡加入遭遇模拟器角色池（同名角色自动更新）">
            <span className="material-symbols-outlined">group_add</span> 加入角色池
          </button>
        </div>
      </header>

      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importSave(f);
          e.target.value = "";
        }}
      />

      {/* 车卡器主体：作用域容器 .es-4e；内部复用其 .content/.view-anim 布局（居中 960px + 视图切换动画） */}
      <div className="es-4e es-carbuild-body">
        <ThemeScope>
          <div className="content">
            <div className="view-anim" key={mode + layout}>
              <CharacterSheet layout={layout} mode={mode} char={char} setChar={setChar} />
            </div>
          </div>
          {/* 存档管理对话框（md-dialog 原生顶层渲染；样式按 .es-4e 后代作用域化，必须挂在容器内） */}
          {cardOpen && (
            <SheetDialog
              open
              headline="存档"
              sub={`${cards.length} 张卡`}
              onClose={() => setCardOpen(false)}
              actions={
                <>
                  <TextButton onClick={newCard}>＋ 新建人物卡</TextButton>
                </>
              }
            >
              <div className="preset-list">
                {cards.map((c) => (
                  <div key={c.id} className={c.id === activeId ? "card-row active" : "card-row"}>
                    <div className="card-row-main">
                      {renamingId === c.id ? (
                        <input
                          className="card-rename-input"
                          value={renameText}
                          autoFocus
                          onChange={(e) => setRenameText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") confirmRename();
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setRenamingId(null);
                            }
                          }}
                          onBlur={() => setRenamingId(null)}
                        />
                      ) : (
                        <button type="button" className="card-row-name" onClick={() => switchCard(c.id)} title="切换到这张卡">
                          <span className="preset-name">{c.name}{c.id === activeId ? "（当前）" : ""}</span>
                          <span className="preset-label">Lv{c.char.level} · {new Date(c.updatedAt).toLocaleString("zh-CN")}</span>
                        </button>
                      )}
                    </div>
                    <div className="card-row-btns">
                      <button type="button" className="crop-btn" onClick={() => saveCardNow(c.id)}>保存</button>
                      <button type="button" className="crop-btn" onClick={() => { setRenamingId(c.id); setRenameText(c.name); }}>重命名</button>
                      {cards.length > 1 && <button type="button" className="crop-btn crop-danger" onClick={() => deleteCard(c.id)}>删除</button>}
                    </div>
                  </div>
                ))}
              </div>
            </SheetDialog>
          )}
        </ThemeScope>
      </div>
    </div>
  );
}
