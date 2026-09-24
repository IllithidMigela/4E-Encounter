// 管理遭遇阶段：存档库遭遇卡片网格（靠左排序、固定尺寸、一行四个、无限行）
import MapThumbnail from "./MapThumbnail";
import { parseSnapshotForThumb } from "./encounterLib";
import type { EncounterMeta } from "./encounterLib";

interface Props {
  lib: EncounterMeta[];
  /** 点击卡片：加载该遭遇并进入进行阶段 */
  onOpen: (meta: EncounterMeta) => void;
  onDelete: (id: string) => void;
  onCreateMap: () => void;
}

/** 卡片固定尺寸 */
const CARD_W = 220;
const CARD_H = 150;

export default function ManageCards({ lib, onOpen, onDelete, onCreateMap }: Props) {
  if (lib.length === 0) {
    return (
      <div className="es-manage-body">
        <div className="es-manage-empty">
          <div className="es-manage-empty-icon material-symbols-outlined">map</div>
          <div className="es-manage-empty-text">暂无遭遇 · 点击「创建地图」开始</div>
          <button className="md-btn primary" onClick={onCreateMap}>
            <span className="material-symbols-outlined">add</span> 创建地图
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="es-manage-body">
      <div className="es-manage-cards">
        {lib.map((meta) => {
          const t = parseSnapshotForThumb(meta.snapshot);
          return (
            <div key={meta.id} className="es-card" onClick={() => onOpen(meta)} title="点击加载该遭遇并进入进行阶段">
              <div className="es-card-thumb">
                <MapThumbnail
                  cols={t.cols}
                  rows={t.rows}
                  combatants={t.combatants}
                  obstacles={t.obstacles}
                  difficult={t.difficult}
                  fog={t.fog}
                  water={t.water}
                  chasm={t.chasm}
                  traps={t.traps}
                  width={CARD_W}
                  height={CARD_H}
                />
              </div>
              <div className="es-card-info">
                <div className="es-card-name">{meta.name}</div>
                <div className="es-card-date">{new Date(meta.savedAt).toLocaleString()}</div>
              </div>
              <button
                className="md-btn danger es-card-del"
                title="删除存档"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onDelete(meta.id);
                }}
              >
                <span className="material-symbols-outlined">delete</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
