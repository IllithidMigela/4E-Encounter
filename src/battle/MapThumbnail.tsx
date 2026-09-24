// 遭遇地图缩略图：只读缩小版地图（管理遭遇阶段的总览预览），点击进入进行阶段
import type { CSSProperties, ReactNode } from "react";
import type { Combatant, FogLevel } from "../types";

/** 缩略图基础格尺寸（px），整体在固定容器内等比缩放居中 */
const CELL = 20;

interface Props {
  cols: number;
  rows: number;
  combatants: Combatant[];
  obstacles: Set<string>;
  difficult: Set<string>;
  fog: Record<string, FogLevel>;
  water: Set<string>;
  chasm: Set<string>;
  traps: Set<string>;
  /** 固定容器宽高（px），地图在其内等比缩放居中 */
  width: number;
  height: number;
  /** 点击缩略图（通常进入进行阶段） */
  onClick?: () => void;
}

/** 一组 "x,y" 格渲染为指定 class 的覆盖层（复用主地图地形样式，均为绝对定位） */
function overlays(set: Set<string>, cls: string, prefix: string) {
  return [...set].map((k) => {
    const [x, y] = k.split(",").map((n) => parseInt(n, 10));
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
    return <div key={prefix + k} className={cls} style={{ left: x * CELL, top: y * CELL, width: CELL, height: CELL }} />;
  });
}

export default function MapThumbnail({ cols, rows, combatants, obstacles, difficult, fog, water, chasm, traps, width, height, onClick }: Props) {
  // 在固定容器内等比缩放（仅缩小，不放大），transform-origin 居中
  const scale = Math.min(1, width / (cols * CELL), height / (rows * CELL));
  const w = cols * CELL;
  const h = rows * CELL;

  const cells: ReactNode[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) cells.push(<div key={`${x}-${y}`} className="es-tn-cell" style={{ gridColumn: x + 1, gridRow: y + 1 }} />);

  const fogCells = Object.entries(fog).map(([k, level]) => {
    const [x, y] = k.split(",").map((n) => parseInt(n, 10));
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
    return <div key={"f" + k} className={"es-fog es-fog-" + level} style={{ left: x * CELL, top: y * CELL, width: CELL, height: CELL }} />;
  });

  return (
    <div className="es-tn" style={{ width, height }} onClick={onClick}>
      <div
        className="es-tn-grid"
        style={{
          width: w,
          height: h,
          transform: `scale(${scale})`,
          transformOrigin: "center",
          gridTemplateColumns: `repeat(${cols}, ${CELL}px)`,
          gridTemplateRows: `repeat(${rows}, ${CELL}px)`,
        }}
      >
        {cells}
        {overlays(obstacles, "es-obstacle", "o")}
        {overlays(difficult, "es-difficult", "d")}
        {fogCells}
        {overlays(water, "es-water", "w")}
        {overlays(chasm, "es-chasm", "c")}
        {overlays(traps, "es-trap", "t")}
        {combatants.map((c) =>
          c.pos ? (
            <div
              key={c.cid}
              className={
                "es-tn-token" +
                (c.kind === "pc" ? " pc" : " monster") +
                (c.hp <= 0 ? " dead" : c.hp <= c.bloodied ? " bloodied" : "")
              }
              style={{
                left: c.pos.x * CELL,
                top: c.pos.y * CELL,
                width: c.size * CELL,
                height: c.size * CELL,
                ...(c.color ? ({ "--tok-color": c.color } as CSSProperties) : {}),
              }}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}
