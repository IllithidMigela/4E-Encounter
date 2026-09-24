// 棋子栏（右栏）：场景（图标+规则+万律出）/ 怪物与角色（复用 SidePanel 属性块；角色右上角「打开角色卡」+ 车卡器速览面板）
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AttackOption, Combatant, TerrainTool } from "../types";
import { TERRAIN_TOOLS } from "../types";
import SidePanel from "../SidePanel";
import OverviewView from "../4ebuild/OverviewView";
import { useGlance } from "../4ebuild/overview/derive";
import type { Entry } from "../4ebuild/data/types";
import { migrateCharacter, type Character } from "../4ebuild/sheet/character";
import { pcPowerToAttack } from "./pcPower";
import ThemeScope from "../carbuild/ThemeScope";
import "../4ebuild/sheet.css";
import "../4ebuild/sheet-glance.css";

interface Props {
  c: Combatant | null;
  sceneTool: TerrainTool;
  onPatch: (patch: Partial<Combatant>) => void;
  /** 按 cid 打补丁（速览面板写回：切换棋子时旧棋子的冲刷不能写进新选中棋子） */
  onPatchCid: (cid: string, patch: Partial<Combatant>) => void;
  onApplyDamage: (n: number) => void;
  onApplyHeal: (n: number) => void;
  onUseSurge: () => void;
  onRemove: () => void;
  onSetAttacks: (attacks: AttackOption[]) => void;
  onSelectAttack: (cid: string, attack: AttackOption) => void;
  onOpenCharacter: (c: Combatant) => void;
  onOpenRules: (keyword: string) => void;
}

// 场景画笔 → 万律书检索关键词
const SCENE_RULE_KW: Record<string, string> = {
  wall: "困难地形",
  difficult: "困难地形",
  water: "困难地形",
  chasm: "坠落地形",
  trap: "陷阱",
  lightFog: "遮蔽",
  heavyFog: "遮蔽",
  dim: "昏暗",
  dark: "黑暗",
};

export default function TokenSidePanel({ c, sceneTool, onPatch, onPatchCid, onApplyDamage, onApplyHeal, onUseSurge, onRemove, onSetAttacks, onSelectAttack, onOpenCharacter, onOpenRules }: Props) {
  // 场景画笔被选中时：优先展示该场景的规则说明（即便未选中棋子也可展示）
  const scene = sceneTool ? TERRAIN_TOOLS.find((t) => t.key === sceneTool) : undefined;

  if (!c) {
    if (scene) {
      return (
        <div className="estk">
          <div className="es-token-scene">
            <span className="material-symbols-outlined es-token-scene-icon">{scene.icon}</span>
            <div className="es-token-scene-title">{scene.label}</div>
            <div className="es-token-scene-desc">{scene.desc}</div>
            <div className="es-token-scene-rules">
              <button className="es-rules-link" onClick={() => onOpenRules(SCENE_RULE_KW[scene.key] ?? scene.label)} title="在「万律」页检索相关规则">
                <span className="material-symbols-outlined">menu_book</span> 万律条目：{SCENE_RULE_KW[scene.key] ?? scene.label}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return <div className="es-side-empty">从布置桌面选择场景 / 怪物 / 角色，或点击地图上的棋子查看详情与操作</div>;
  }

  return (
    <div className="es-token-side">
      {c.kind === "pc" && c.rawChar ? (
        <>
          <button className="es-open-char" onClick={() => onOpenCharacter(c)} title="打开角色卡">
            <span className="material-symbols-outlined">person</span> 打开角色卡
          </button>
          <TokenGlance key={c.cid} c={c} onPatchCid={onPatchCid} onSelectAttack={onSelectAttack} />
        </>
      ) : (
        <>
          {c.kind === "pc" && c.char && (
            <button className="es-open-char" onClick={() => onOpenCharacter(c)} title="打开角色卡">
              <span className="material-symbols-outlined">person</span> 打开角色卡
            </button>
          )}
          {/* 操作/编辑已并入全屏详情页（战斗数据栏「详情」按钮），不再单列动态数据表 */}
          <SidePanel
            c={c}
            onPatch={onPatch}
            onApplyDamage={onApplyDamage}
            onApplyHeal={onApplyHeal}
            onUseSurge={onUseSurge}
            onRemove={onRemove}
            onSetAttacks={onSetAttacks}
            onSelectAttack={onSelectAttack}
          />
        </>
      )}
    </div>
  );
}

// ===== 棋子速览面板（车卡器 OverviewView 内嵌于棋子栏） =====
// 把战斗棋子的战斗数值（HP / 回复力 / 行动点 / 临时 HP / 死亡豁免 / 回气）套进速览角色：
// - 战斗 → 速览：结算条扣血、回合结算、休整等引擎改动实时流入面板（值相同则跳过，滤掉写回回声）
// - 速览 → 战斗：面板编辑防抖 400ms 写回棋子（含 rawChar 快照，「打开角色卡」带走最新数据）
//   key={c.cid} 切换棋子时整体重挂载，卸载兜底冲刷最后 400ms 内的改动

/** 战斗数值套进速览角色（只覆盖映射字段，保留速览本地字段：威能/专长勾选、临时加值等） */
function syncFromBattle(base: Character, c: Combatant): Character {
  return {
    ...base,
    hpNow: { ...base.hpNow, max: c.hp, surges: c.surgesLeft },
    tempHp: c.tempHp,
    actionPoints: c.actionPoints ?? 1,
    glance: { ...base.glance, deathFails: c.deathSaveFails ?? 0, secondWind: c.secondWindUsed ?? false },
  };
}

/** 速览角色 → 棋子补丁 */
function patchOf(ch: Character): Partial<Combatant> {
  return {
    hp: ch.hpNow.max,
    surgesLeft: ch.hpNow.surges,
    tempHp: ch.tempHp,
    actionPoints: ch.actionPoints,
    deathSaveFails: ch.glance.deathFails,
    secondWindUsed: ch.glance.secondWind,
    rawChar: ch as unknown as Record<string, unknown>,
  };
}

function TokenGlance({ c, onPatchCid, onSelectAttack }: { c: Combatant; onPatchCid: (cid: string, patch: Partial<Combatant>) => void; onSelectAttack: (cid: string, attack: AttackOption) => void }) {
  const [char, setCharState] = useState<Character>(() => syncFromBattle(migrateCharacter(c.rawChar as Partial<Character>), c));
  const dirtyRef = useRef(false); // 有未落盘的速览编辑（首次挂载 / 引擎回流不算脏）
  const charRef = useRef(char);
  charRef.current = char;
  const patchRef = useRef(onPatchCid);
  patchRef.current = onPatchCid;

  const setChar: Dispatch<SetStateAction<Character>> = useCallback((action) => {
    dirtyRef.current = true;
    setCharState(action);
  }, []);

  // 战斗 → 速览
  useEffect(() => {
    setCharState((prev) => {
      const same =
        prev.hpNow.max === c.hp &&
        prev.hpNow.surges === c.surgesLeft &&
        prev.tempHp === c.tempHp &&
        prev.actionPoints === (c.actionPoints ?? 1) &&
        prev.glance.deathFails === (c.deathSaveFails ?? 0) &&
        prev.glance.secondWind === (c.secondWindUsed ?? false);
      return same ? prev : syncFromBattle(prev, c);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.hp, c.surgesLeft, c.tempHp, c.actionPoints, c.deathSaveFails, c.secondWindUsed]);

  // 速览 → 战斗（防抖写回）
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => {
      dirtyRef.current = false;
      patchRef.current(c.cid, patchOf(charRef.current));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char]);

  // 卸载兜底：切换棋子 / 关闭棋子栏时冲刷未落盘的编辑
  useEffect(() => {
    return () => {
      if (dirtyRef.current) patchRef.current(c.cid, patchOf(charRef.current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 速览威能 chip 的 ⚔ 攻击入口：把威能词条转成 AttackOption 后进入地图瞄准。
  // 转换依赖角色数值推导（GlanceData），在本组件用同一份 useGlance 取得，保证攻加/伤害与角色卡一致。
  const glance = useGlance(char);
  const onSelectRef = useRef(onSelectAttack);
  onSelectRef.current = onSelectAttack;
  const usePower = useCallback((p: Entry) => {
    const a = pcPowerToAttack(p, glance);
    if (!a) return;
    onSelectRef.current(c.cid, a);
  }, [glance, c.cid]);

  return (
    <div className="es-4e es-token-glance">
      <ThemeScope>
        <OverviewView layout="single" char={char} setChar={setChar} onUsePower={usePower} />
      </ThemeScope>
    </div>
  );
}