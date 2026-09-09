/**
 * Canvas 渲染：棋盘、棋子、磁力预警（主题化）
 * 全部矢量自绘（防侵权指南 §2）。支持三主题：(candy|quantum|lab)。
 * 函数均接受 theme，默认 candy，向后兼容。
 */
import { CONFIG } from '../core/config.js';
import { getTheme } from '../core/themes.js';
import { computeBoardGeom, gridToPx, pxToGrid, inBoard } from './geometry.js';

const SHAPES = ['circle', 'hex', 'triangle', 'diamond']; // P1-P4 形状（色盲友好）

export function playerShape(owner) {
  return SHAPES[owner % SHAPES.length];
}

/** 显式清除阴影状态（部分真机 Canvas 的 save/restore 不隔离 shadow，防泄漏成全局光晕） */
export function resetShadow(ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/** 兼容性圆角矩形路径（部分运行时无 ctx.roundRect） */
export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** 绘制棋盘底（按主题：外框投影 + 逐格柔和底纹 + 木纹蚀刻 + 网格线） */
export function drawBoardBase(ctx, geom, theme) {
  const t = theme || getTheme();
  ctx.save();
  const r = 14;
  // 立体落影（设计图棋盘微立体）
  ctx.save();
  ctx.globalAlpha = 0.16;
  roundRectPath(ctx, geom.originX + 2, geom.originY + 5, geom.bw, geom.bh, r);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.restore();
  roundRectPath(ctx, geom.originX, geom.originY, geom.bw, geom.bh, r);
  ctx.fillStyle = t.boardBg;
  ctx.fill();
  // 逐格柔和底纹：糖果=浅粉/浅黄/浅蓝/浅绿随机 tint；
  // 量子=深蓝格交替；实验室=木色交替（tint 色板见 themes.cellTints）
  const tints = t.cellTints || [];
  if (tints.length) {
    ctx.save();
    roundRectPath(ctx, geom.originX, geom.originY, geom.bw, geom.bh, r);
    ctx.clip();
    for (let gy = 0; gy < geom.rows; gy += 1) {
      for (let gx = 0; gx < geom.cols; gx += 1) {
        const idx = (gx * 3 + gy * 5 + ((gx * gy) % 7)) % tints.length;
        ctx.fillStyle = tints[idx];
        ctx.fillRect(
          geom.originX + gx * geom.cell,
          geom.originY + gy * geom.cell,
          geom.cell + 0.5,
          geom.cell + 0.5,
        );
      }
    }
    // 实验室：横向木纹波纹 + 交叉蚀刻刻度（对照设计图木桌棋盘）
    if (t.id === 'lab') {
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = '#5C4526';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 7; i += 1) {
        const gy = geom.originY + (geom.bh / 7) * i + 4;
        ctx.moveTo(geom.originX, gy);
        for (let sx = 0; sx <= geom.bw; sx += geom.cell) {
          ctx.lineTo(geom.originX + sx, gy + Math.sin(sx / 19 + i) * 2.2);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      for (let gx = 1; gx < geom.cols; gx += 1) {
        for (let gy = 1; gy < geom.rows; gy += 1) {
          const x = geom.originX + gx * geom.cell;
          const y = geom.originY + gy * geom.cell;
          ctx.moveTo(x - 4, y + 4);
          ctx.lineTo(x + 4, y - 4);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  // 外框
  ctx.strokeStyle = t.boardEdge;
  ctx.lineWidth = 3;
  roundRectPath(ctx, geom.originX, geom.originY, geom.bw, geom.bh, r);
  ctx.stroke();

  // 网格线（quantum：青色网格；其余：主题格线）
  ctx.strokeStyle = t.cellLine || t.boardLine;
  ctx.lineWidth = t.pieceStyle === 'neon' ? 1.2 : 1;
  ctx.beginPath();
  for (let gx = 1; gx < geom.cols; gx += 1) {
    const x = geom.originX + gx * geom.cell;
    ctx.moveTo(x, geom.originY);
    ctx.lineTo(x, geom.originY + geom.bh);
  }
  for (let gy = 1; gy < geom.rows; gy += 1) {
    const y = geom.originY + gy * geom.cell;
    ctx.moveTo(geom.originX, y);
    ctx.lineTo(geom.originX + geom.bw, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制诚实的磁力预警（quick-specs/magnet-semantics-fix）：
 *  - 以光标格为圆心画【真实吸附半径】虚线圈（呼吸动画），视觉范围 = 物理范围
 *  - 圈内每个场上棋子描边高亮：classic=红（踩雷危险）/ loot=金（可捕获机会）
 *  - 圈内无棋子：classic 安全（中性圈）
 */
export function drawMagnetField(ctx, geom, board, cursorPx, gridRadius, theme, mode = 'classic') {
  const t = theme || getTheme();
  const { gx, gy } = pxToGrid(geom, cursorPx.x, cursorPx.y);
  // 光标必须落在棋盘内（inBoard 接受像素坐标，此前误传格坐标致预警圈从不显示）
  if (gx < 0 || gy < 0 || gx >= geom.cols || gy >= geom.rows) return;
  const center = gridToPx(geom, gx, gy);
  const rPx = gridRadius * geom.cell;
  const hits = board.filter((p) => dist2(center.x, center.y, gridToPx(geom, p.x, p.y)) < rPx);
  const danger = mode !== 'loot' && hits.length > 0;
  const opportunity = mode === 'loot' && hits.length > 0;
  const ringColor = danger ? '#FF3B30' : opportunity ? t.warnColor : (t.bgDark ? 'rgba(255,255,255,0.3)' : 'rgba(62,39,35,0.22)');

  ctx.save();
  const breathe = 0.5 + 0.5 * Math.sin(Date.now() / 300);
  // 真实吸附范围虚线圈
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = ringColor;
  ctx.globalAlpha = 0.45 + 0.4 * breathe;
  ctx.beginPath();
  ctx.arc(center.x, center.y, rPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // 光标格填充
  ctx.globalAlpha = 0.16 + 0.12 * breathe;
  ctx.fillStyle = danger ? '#FF3B30' : t.warnColor;
  ctx.beginPath();
  ctx.arc(center.x, center.y, geom.cell * 0.42, 0, Math.PI * 2);
  ctx.fill();
  // 命中棋子高亮描边
  for (const p of hits) {
    const pp = gridToPx(geom, p.x, p.y);
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 3;
    ctx.strokeStyle = danger ? '#FF3B30' : '#FFD600';
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, geom.cell * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// 像素距离（接受 geom 对象转换）
function dist2(ax, ay, pt) {
  const dx = ax - pt.x;
  const dy = ay - pt.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 绘制一颗磁珠（3D 球体质感，按主题：candy 果冻球 / neon 发光宝石 / metal 金属球，附色盲友好形状）
 * 画法升级（对照 design/design.png）：落影 → 径向渐变球体 → 底部反光弧 → 顶部大椭圆高光 + 次高光点 → 外缘细描边
 */
export function drawPiece(ctx, x, y, r, owner, theme, opt = {}) {
  const t = theme || getTheme();
  // owner=-1：solo 模式的固定障碍（中性深灰"地雷"，与玩家磁珠明显区分）
  const pc = owner < 0 ? { color: '#6B6156', accent: '#463E35' } : t.playerColors[owner % t.playerColors.length];
  const color = pc.color;
  const accent = pc.accent;

  ctx.save();
  // 落影
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(x + r * 0.08, y + r * 0.18, r * 0.98, 0, Math.PI * 2);
  ctx.fillStyle = '#3E2723';
  ctx.fill();
  ctx.globalAlpha = 1;

  if (t.pieceStyle === 'neon') {
    // 量子发光宝石：先带光晕填充，画完立刻 resetShadow
    ctx.shadowColor = color;
    ctx.shadowBlur = r * 0.9;
    drawBeadBody(ctx, x, y, r, color, accent);
    resetShadow(ctx);
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (t.pieceStyle === 'metal') {
    drawBeadBody(ctx, x, y, r, color, accent, 'metal');
  } else {
    drawBeadBody(ctx, x, y, r, color, accent);
  }
  if (owner < 0) {
    // 障碍画 X 标记
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(1.5, r * 0.16);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.4, y - r * 0.4);
    ctx.lineTo(x + r * 0.4, y + r * 0.4);
    ctx.moveTo(x + r * 0.4, y - r * 0.4);
    ctx.lineTo(x - r * 0.4, y + r * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

/** 3D 球体磁珠本体（candy/metal 共用；neon 由 drawPiece 外包发光） */
function drawBeadBody(ctx, x, y, r, color, accent, style = 'candy') {
  // 球体：左上受光径向渐变
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.08, x, y, r * 1.02);
  g.addColorStop(0, offset(color, 70));
  g.addColorStop(0.42, color);
  g.addColorStop(1, accent);
  ctx.fillStyle = g;
  ctx.fill();
  // 底部反光弧（圆头弧线，裁进球体）
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(x, y + r * 0.28, r * 0.78, Math.PI * 0.12, Math.PI * 0.88);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = r * 0.16;
  ctx.lineCap = 'round';
  ctx.stroke();
  if (style === 'metal') {
    // 拉丝斜高光
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - r, y - r * 1.1, r * 2, r * 0.55);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // 顶部大椭圆高光（设计图珠体最强高光）
  ctx.beginPath();
  ctx.ellipse(x - r * 0.28, y - r * 0.4, r * 0.4, r * 0.2, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  // 次高光点
  ctx.beginPath();
  ctx.arc(x + r * 0.18, y - r * 0.52, r * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
  // 外缘细描边
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.strokeStyle = style === 'candy' ? 'rgba(255,255,255,0.4)' : accent;
  ctx.stroke();
}

/** 简单颜色提亮（hex → 加 brightness） */
function offset(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + amt);
  const g = Math.min(255, ((n >> 8) & 0xff) + amt);
  const b = Math.min(255, (n & 0xff) + amt);
  return `rgb(${r},${g},${b})`;
}

/** 主题吸附特效：画在落点（变化状），随动画推进淡出 */
export function drawSnapFx(ctx, theme, x, y, t01) {
  const tp = theme || getTheme();
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - t01) * (tp.snapIntensity ?? 1);
  if (tp.snapFx === 'ripple') {
    for (let i = 1; i <= 3; i += 1) {
      const rad = (t01 + i * 0.15) * 40;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.strokeStyle = tp.warnColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  } else if (tp.snapFx === 'glow') {
    ctx.beginPath();
    ctx.arc(x, y, 26 * (1 - t01) + 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = (1 - t01) * 0.5;
    ctx.fill();
  } else {
    // juice: 主题色点飞散
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8 + t01;
      const d = t01 * 34;
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = tp.playerColors[i % 4].color;
      ctx.fill();
    }
  }
  ctx.restore();
}

// 复导出 geometry 便于场景统一引用
export { computeBoardGeom, gridToPx, pxToGrid, inBoard } from './geometry.js';
export { CONFIG };