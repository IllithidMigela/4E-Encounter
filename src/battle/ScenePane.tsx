// 场景面板（布置桌面·场景）：地图尺寸调整 + 画笔工具分组
// 分组：基础工具（选择/擦除）· 地形工具（墙体/困难/水域/坠落/迷雾等 8 类）· 涂色工具（涂色 + 颜色选择）
import { useEffect, useState } from "react";
import type { TerrainTool } from "../types";
import { TERRAIN_TOOLS } from "../types";

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
}

/** 棋盘尺寸钳制在 4–30（非法输入回退 20） */
function clampMap(n: number): number {
  if (Number.isNaN(n)) return 20;
  return Math.max(4, Math.min(30, n));
}

/** 地形工具（基础工具与涂色工具之外的 8 类地形） */
const TERRAIN_KEYS: Exclude<TerrainTool, null>[] = ["wall", "difficult", "water", "chasm", "lightFog", "heavyFog", "dark", "dim"];

export default function ScenePane({ sceneTool, onSetSceneTool, mapCols, mapRows, onSetMapSize, mapColor, onSetMapColor, colorHistory }: Props) {
  // 取色器草稿色：拖动滑块时 onChange 高频触发，只更新本地状态（避免每次触发全局重渲染 + localStorage 写入导致卡顿）；
  // 松开/关闭取色器（blur）时才一次性提交到全局并记入历史
  const [draftColor, setDraftColor] = useState(mapColor);
  useEffect(() => setDraftColor(mapColor), [mapColor]);
  /** 单个工具按钮（swatchBg 可覆盖样块底色，涂色工具显示当前颜色） */
  const toolBtn = (key: Exclude<TerrainTool, null>, swatchBg?: string) => {
    const t = TERRAIN_TOOLS.find((x) => x.key === key);
    if (!t) return null;
    return (
      <button
        key={key}
        className={"es-scene-tool" + (sceneTool === key ? " on" : "")}
        onClick={() => onSetSceneTool(sceneTool === key ? null : key)}
        title={t.desc}
      >
        <span className={"es-scene-swatch es-sw-" + key} style={swatchBg ? { background: swatchBg } : undefined} />
        <span>{t.label}</span>
      </button>
    );
  };

  return (
    <div className="es-scene">
      {/* 地图尺寸（自顶部操作栏迁入场景栏） */}
      <div className="es-scene-size">
        <span>地图尺寸</span>
        <input type="number" min={4} max={30} value={mapCols} onChange={(e) => onSetMapSize(clampMap(Number(e.target.value)), mapRows)} />
        <span>×</span>
        <input type="number" min={4} max={30} value={mapRows} onChange={(e) => onSetMapSize(mapCols, clampMap(Number(e.target.value)))} />
      </div>

      {/* 基础工具：选择（退出绘制）/ 擦除 */}
      <div className="es-scene-group">基础工具</div>
      <div className="es-scene-tools">
        <button
          key="select"
          className={"es-scene-tool" + (sceneTool === null ? " on active-none" : "")}
          onClick={() => onSetSceneTool(null)}
          title="退出绘制模式"
        >
          <span className="es-scene-swatch es-sw-plain" />
          <span>选择棋子</span>
        </button>
        {toolBtn("erase")}
      </div>

      {/* 地形工具：8 类地形 */}
      <div className="es-scene-group">地形工具</div>
      <div className="es-scene-tools">{TERRAIN_KEYS.map((k) => toolBtn(k))}</div>

      {/* 涂色工具：涂色按钮 + 颜色选择器（样块/按钮实时显示当前颜色） */}
      <div className="es-scene-group">涂色工具</div>
      <div className="es-scene-tools">
        {toolBtn("color", mapColor)}
        <label
          className={"es-scene-tool es-scene-color" + (sceneTool === "color" ? " on" : "")}
          title="涂色颜色（点击色块选取，涂色模式下按住左键拖动连续涂色）"
        >
          <input
            type="color"
            value={draftColor}
            onChange={(e) => setDraftColor(e.target.value)}
            onBlur={() => onSetMapColor(draftColor)}
          />
          <span>{draftColor}</span>
        </label>
      </div>
      {/* 历史涂色：最近 16 个使用过的颜色，点击即设为当前画笔色 */}
      <div className="es-scene-history">
        {colorHistory.length === 0 ? (
          <span className="es-scene-history-empty">暂无历史颜色</span>
        ) : (
          colorHistory.map((c) => (
            <button
              key={c}
              className={"es-scene-history-swatch" + (c === mapColor ? " on" : "")}
              style={{ background: c }}
              title={"使用颜色 " + c}
              onClick={() => onSetMapColor(c)}
            />
          ))
        )}
      </div>

      {sceneTool && (
        <div className="es-scene-desc">{TERRAIN_TOOLS.find((t) => t.key === sceneTool)?.desc}</div>
      )}
    </div>
  );
}
