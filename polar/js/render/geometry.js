/**
 * 渲染几何：统一「棋盘格坐标 ↔ 像素坐标」换算
 * 棋盘被约束在画布中央的矩形内，各个格子等分。
 * 纯计算，无 wx 依赖。
 */
export function computeBoardGeom(cw, ch, cols, rows, margin = 0.06) {
  const mw = Math.min(cw, ch) * margin;
  const availW = cw - mw * 2;
  const availH = ch - mw * 2;
  // 棋盘按格数等比缩放，适配画布剩余空间
  const scale = Math.min(availW / cols, availH / rows);
  const cell = scale;
  const bw = cols * cell;
  const bh = rows * cell;
  const originX = (cw - bw) / 2;
  const originY = (ch - bh) / 2;
  return { cell, originX, originY, bw, bh, cols, rows };
}

/** 格坐标 → 像素（单元格中心） */
export function gridToPx(geom, gx, gy) {
  return {
    x: geom.originX + gx * geom.cell + geom.cell / 2,
    y: geom.originY + gy * geom.cell + geom.cell / 2,
  };
}

/** 像素 → 格坐标（取整） */
export function pxToGrid(geom, px, py) {
  const gx = Math.floor((px - geom.originX) / geom.cell);
  const gy = Math.floor((py - geom.originY) / geom.cell);
  return { gx, gy };
}

/** 判断像素点是否落在棋盘矩形内 */
export function inBoard(geom, px, py) {
  return (
    px >= geom.originX &&
    px <= geom.originX + geom.bw &&
    py >= geom.originY &&
    py <= geom.originY + geom.bh
  );
}