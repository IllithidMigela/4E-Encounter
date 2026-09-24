// 地图背景图对齐面板（导入地图功能）：浮动于地图区域左下，滑块实时生效，不阻塞地图交互。
// 通过 缩放/水平偏移/垂直偏移/列数/行数 让方格与图片上印刷的网格对齐。
import type { MapBgAlign } from "./encounterLib";
import { CELL } from "../MapGrid";

interface Props {
  align: MapBgAlign;
  onAlign: (a: MapBgAlign) => void;
  cols: number;
  rows: number;
  onSetMapSize: (cols: number, rows: number) => void;
  /** 框选校准：进入/取消模式 */
  calib: boolean;
  onStartCalib: () => void;
  onCancelCalib: () => void;
  onRemove: () => void;
  onClose: () => void;
}

const clampMap = (n: number) => {
  if (Number.isNaN(n)) return 20;
  return Math.max(4, Math.min(30, n));
};

export default function MapBgDialog({ align, onAlign, cols, rows, onSetMapSize, calib, onStartCalib, onCancelCalib, onRemove, onClose }: Props) {
  const setAlign = (patch: Partial<MapBgAlign>) => onAlign({ ...align, ...patch });
  const offXMax = Math.max(50, Math.round(cols * CELL));
  const offYMax = Math.max(50, Math.round(rows * CELL));

  return (
    <div className="es-map-bg-dlg">
      <div className="es-map-bg-dlg-head">
        <span className="material-symbols-outlined">tune</span> 背景对齐
      </div>
      <div className="es-map-bg-body">
        <label className="es-map-bg-row">
          <span>缩放</span>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.01}
            value={align.scale}
            onChange={(e) => setAlign({ scale: Number(e.target.value) })}
          />
          <span className="es-map-bg-step">
            <button type="button" onClick={() => setAlign({ scale: Math.round((align.scale - 0.01) * 100) / 100 })} title="缩小 1%">−</button>
            <b>{Math.round(align.scale * 100)}%</b>
            <button type="button" onClick={() => setAlign({ scale: Math.round((align.scale + 0.01) * 100) / 100 })} title="放大 1%">+</button>
          </span>
        </label>
        <label className="es-map-bg-row">
          <span>水平偏移</span>
          <input
            type="range"
            min={-offXMax}
            max={offXMax}
            step={1}
            value={align.offsetX}
            onChange={(e) => setAlign({ offsetX: Number(e.target.value) })}
          />
          <span className="es-map-bg-step">
            <button type="button" onClick={() => setAlign({ offsetX: align.offsetX - 1 })} title="左移 1px">−</button>
            <b>{align.offsetX}px</b>
            <button type="button" onClick={() => setAlign({ offsetX: align.offsetX + 1 })} title="右移 1px">+</button>
          </span>
        </label>
        <label className="es-map-bg-row">
          <span>垂直偏移</span>
          <input
            type="range"
            min={-offYMax}
            max={offYMax}
            step={1}
            value={align.offsetY}
            onChange={(e) => setAlign({ offsetY: Number(e.target.value) })}
          />
          <span className="es-map-bg-step">
            <button type="button" onClick={() => setAlign({ offsetY: align.offsetY - 1 })} title="上移 1px">−</button>
            <b>{align.offsetY}px</b>
            <button type="button" onClick={() => setAlign({ offsetY: align.offsetY + 1 })} title="下移 1px">+</button>
          </span>
        </label>
        <label className="es-map-bg-row">
          <span>虚线透明度</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={align.gridOpacity ?? 1}
            onChange={(e) => setAlign({ gridOpacity: Number(e.target.value) })}
          />
          <span className="es-map-bg-step">
            <button type="button" onClick={() => setAlign({ gridOpacity: Math.max(0, Math.round(((align.gridOpacity ?? 1) - 0.05) * 100) / 100) })} title="变淡 5%">−</button>
            <b>{Math.round((align.gridOpacity ?? 1) * 100)}%</b>
            <button type="button" onClick={() => setAlign({ gridOpacity: Math.min(1, Math.round(((align.gridOpacity ?? 1) + 0.05) * 100) / 100) })} title="加深 5%">+</button>
          </span>
        </label>
        <div className="es-map-bg-row">
          <span>列数 / 行数</span>
          <input
            className="es-map-bg-num"
            type="number"
            min={4}
            max={30}
            value={cols}
            onChange={(e) => onSetMapSize(clampMap(Number(e.target.value)), rows)}
          />
          <span className="es-map-bg-sep">×</span>
          <input
            className="es-map-bg-num"
            type="number"
            min={4}
            max={30}
            value={rows}
            onChange={(e) => onSetMapSize(cols, clampMap(Number(e.target.value)))}
          />
        </div>
      </div>
      <div className="es-map-bg-dlg-foot">
        <button
          className={"es-map-bg-btn" + (calib ? " primary" : "")}
          onClick={calib ? onCancelCalib : onStartCalib}
          title="在地图上框选印刷网格的一个方格，自动校准缩放与位置"
        >
          {calib ? "取消框选" : "框选校准"}
        </button>
        <button className="es-map-bg-btn danger" onClick={onRemove} title="删除本地缓存并移除背景">
          移除背景
        </button>
        <span className="es-map-bg-spacer" />
        <button className="es-map-bg-btn primary" onClick={onClose}>
          完成
        </button>
      </div>
    </div>
  );
}
