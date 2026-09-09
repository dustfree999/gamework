/**
 * 主题化按钮与背景渲染（GDD: design/gdd/systems/theme-system.md §3/§5）
 * 三种按钮质感：jelly（果冻弹压）/ neon（霓虹描边）/ metal（金属拨片）
 * 一种主题化全屏背景渲染。
 */
import { roundRectPath, resetShadow } from './board.js';
import { getTheme } from '../core/themes.js';
import { drawBgDeco } from './decor.js';

/**
 * 绘制主题化按钮
 * @returns 无返回；调用方自行管理点击热区
 */
export function drawButton(ctx, theme, { x, y, w, h, label, primary = false, pressed = false }) {
  const t = theme || getTheme();
  resetShadow(ctx); // 真机防御：进按钮前清掉遗留阴影
  ctx.save();
  if (t.btnStyle === 'neon') {
    drawNeonButton(ctx, x, y, w, h, label, t, primary, pressed);
  } else if (t.btnStyle === 'metal') {
    drawMetalButton(ctx, x, y, w, h, label, t, primary, pressed);
  } else {
    drawJellyButton(ctx, x, y, w, h, label, t, primary, pressed);
  }
  ctx.restore();
}

function drawJellyButton(ctx, x, y, w, h, label, t, primary, pressed) {
  const squash = pressed ? 0.92 : 1;
  const bh = h * squash;
  const by = y + (h - bh);
  const rad = bh / 2; // 胶囊体（设计图开战/再来一局为大圆角果冻胶囊）
  // 主题主色渐变（糖果=粉红果冻，见 themes.btnPrimary）
  const prim = t.btnPrimary || null;
  const base = primary ? (prim ? prim[1] : '#FF6B35') : '#F4A259';
  const top = primary && prim ? prim[0] : lighten(base, 40);
  // 底部深色投影（果冻厚度感）
  ctx.beginPath();
  roundRectPath(ctx, x, y + h - 7, w, 12, rad);
  ctx.fillStyle = 'rgba(62,39,35,0.22)';
  ctx.fill();
  // 主体（按压缩扁 = 果冻感）
  roundRectPath(ctx, x, by, w, bh, rad);
  const g = ctx.createLinearGradient(x, by, x, by + bh);
  g.addColorStop(0, top);
  g.addColorStop(1, base);
  ctx.fillStyle = g;
  ctx.fill();
  // 顶部高光条（设计图按钮上半透明白条）
  ctx.globalAlpha = 0.55;
  roundRectPath(ctx, x + w * 0.08, by + bh * 0.1, w * 0.84, bh * 0.3, bh * 0.15);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${Math.round(bh * 0.42)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, by + bh / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawNeonButton(ctx, x, y, w, h, label, t, primary, pressed) {
  const col = primary ? '#33E0FF' : '#7FD8E8';
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = pressed ? 4 : 16;
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(8,24,40,0.92)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = col;
  ctx.stroke();
  ctx.restore();
  resetShadow(ctx);
  // 顶部内高光（霓虹管反光）
  ctx.globalAlpha = 0.22;
  roundRectPath(ctx, x + w * 0.1, y + h * 0.12, w * 0.8, h * 0.22, h * 0.11);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#E6F5FF';
  ctx.font = `bold ${Math.round(h * 0.42)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawMetalButton(ctx, x, y, w, h, label, t, primary, pressed) {
  const off = pressed ? 2 : 0;
  // 主题金属主色（实验室=银灰，见 themes.btnPrimary）
  const prim = t.btnPrimary || null;
  const base = primary ? (prim ? prim[1] : '#8C8272') : '#8C8272';
  const top = primary && prim ? prim[0] : lighten(base, 35);
  // 硬投影
  roundRectPath(ctx, x, y + 4, w, h, h * 0.3);
  ctx.fillStyle = 'rgba(62,39,35,0.3)';
  ctx.fill();
  roundRectPath(ctx, x, y + off, w, h, h * 0.3);
  const g = ctx.createLinearGradient(x, y + off, x, y + off + h);
  g.addColorStop(0, top);
  g.addColorStop(0.5, base);
  g.addColorStop(1, darken(base, 25));
  ctx.fillStyle = g;
  ctx.fill();
  // 斜向高光条（金属拉丝反光）
  ctx.save();
  roundRectPath(ctx, x, y + off, w, h, h * 0.3);
  ctx.clip();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x, y + off);
  ctx.lineTo(x + w * 0.22, y + off);
  ctx.lineTo(x + w * 0.08, y + off + h);
  ctx.lineTo(x, y + off + h);
  ctx.closePath();
  ctx.fill();
  // 底缘暗线（金属厚度）
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y + off + h - 3 * (h / 60), w, 3 * (h / 60));
  ctx.restore();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${Math.round(h * 0.42)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + off + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

/** 全屏主题化背景 */
export function drawBackground(ctx, theme) {
  const t = theme || getTheme();
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  if (t.background.type === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, t.background.colors[0]);
    g.addColorStop(1, t.background.colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = t.background.colors[0];
    ctx.fillRect(0, 0, w, h);
  }
  // quantum：霓虹细网格氛围
  if (t.background.grid === true || t.pieceStyle === 'neon') {
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = t.boardEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 36;
    for (let x = 0; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // 设计图还原：主题背景漂浮物（糖果果冻珠 / 量子发光粒子 / 牛皮纸工具剪影）
  drawBgDeco(ctx, t, w, h);
}

// —— 颜色工具 ——
function parseRGB(hex) {
  if (hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g);
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 0xff, n & 0xff];
}
function toHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) + (c(r) << 16) + (c(g) << 8) + c(b)).toString(16).slice(1)}`;
}
function lighten(hex, amt) {
  return toHex(parseRGB(hex).map((v) => v + amt));
}
function darken(hex, amt) {
  return toHex(parseRGB(hex).map((v) => v - amt));
}