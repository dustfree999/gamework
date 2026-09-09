/**
 * 装饰元素库：design/design.png 矢量还原（零图片资源，全部 Canvas 自绘）
 * 设计图元素 → 函数对照：
 *  - 背景漂浮磁珠 / 发光粒子 / 牛皮纸+工具剪影   → drawBgDeco
 *  - 首页顶部 3D 双磁珠 logo（红蓝珠+磁力线弧）  → drawLogo
 *  - 「磁极对决」大标题 / 「— 磁吸对战棋 —」副标题 → drawTitle / drawSubtitle
 *  - 主题图文小卡（缩略画+名称）+ 选中✓圆角标    → drawThemeCard / drawCheckBadge
 *  - 玩法胶囊（圆形图标徽章：交叉剑 / 机器人头） → drawModeCapsule / drawModeIcon
 *  - 开战按钮两侧星芒                            → drawSparkle
 *  - 结算顶部金冠+缎带横幅「结算」               → drawRibbonBanner
 *  - 名次奖牌（金/银/铜/灰）                     → drawMedal
 *  - 玩家头像徽章（主题色底+笑脸/白数字）        → drawAvatarBadge
 *  - 托盘四形状图例 / 数量圆徽章                 → drawShapeLegend / drawCountBadge
 *  - 拖拽同心圆磁力波 / 托盘→手指虚线轨迹        → drawMagnetWaves / drawDashPath
 *
 * 纪律：所有 shadowColor/shadowBlur 用完立即 resetShadow（真机阴影泄漏教训）。
 */
import { roundRectPath, resetShadow } from './board.js';
import { THEMES } from '../core/themes.js';

const PI2 = Math.PI * 2;

// ───────────────────────── 小工具 ─────────────────────────

/** 确定性伪随机（背景漂浮物逐帧稳定，不闪跳） */
function rnd(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function parseRGB(hex) {
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

/** 亮度判断（浅底上选深色字/描边） */
export function isLight(hex) {
  const [r, g, b] = parseRGB(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 168;
}

// ───────────────────── 背景漂浮物（三主题） ─────────────────────

/**
 * 主题背景装饰（叠加在 drawBackground 渐变之上）：
 *  - candy：半透明彩色果冻磁珠铺满漂浮
 *  - quantum：深空星点 + 霓虹发光粒子球（青蓝系，合规禁紫）
 *  - lab：牛皮纸淡格线 + 四角工具剪影（扳手/直尺/螺丝）
 */
export function drawBgDeco(ctx, t, W, H) {
  const u = W / 375;
  ctx.save();
  if (t.bgDeco === 'particles') {
    // 远景星点
    for (let i = 0; i < 26; i += 1) {
      const x = rnd(i) * W;
      const y = rnd(i + 57) * H;
      const r = (0.8 + rnd(i + 11) * 1.6) * u;
      ctx.globalAlpha = 0.2 + rnd(i + 23) * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, PI2);
      ctx.fillStyle = '#BFEFFF';
      ctx.fill();
    }
    // 发光粒子球（缓慢漂移）
    const orbs = t.bgOrbs && t.bgOrbs.length ? t.bgOrbs : ['#33E0FF', '#4FC3F7', '#2EFF8F'];
    for (let i = 0; i < 7; i += 1) {
      const x = rnd(i + 91) * W;
      const y = rnd(i + 133) * H;
      const r = (9 + rnd(i + 7) * 13) * u;
      const drift = Math.sin(Date.now() / 1500 + i * 1.7) * 6 * u;
      const col = orbs[i % orbs.length];
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 16 * u;
      ctx.globalAlpha = 0.24;
      ctx.beginPath();
      ctx.arc(x, y + drift, r, 0, PI2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(x, y + drift, r * 0.42, 0, PI2);
      ctx.fill();
      ctx.restore();
    }
    resetShadow(ctx);
  } else if (t.bgDeco === 'kraft') {
    // 牛皮纸：淡方格线（图纸感）
    ctx.strokeStyle = 'rgba(110,86,52,0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 26 * u;
    for (let x = step; x < W; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = step; y < H; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    // 四角工具剪影（对照设计图：扳手/直尺/螺丝）
    drawWrench(ctx, 30 * u, 52 * u, 34 * u, -0.65, 0.32);
    drawRuler(ctx, W - 20 * u, H * 0.52, 120 * u, Math.PI / 2 + 0.12, 0.26);
    drawScrew(ctx, 40 * u, H - 90 * u, 9 * u, 0.3);
    drawWrench(ctx, W - 34 * u, H - 60 * u, 26 * u, Math.PI + 0.5, 0.24);
  } else {
    // candy：半透明果冻珠铺满背景
    const orbs = t.bgOrbs && t.bgOrbs.length ? t.bgOrbs : ['#FF5A5F', '#FFC93C', '#4FC3F7'];
    for (let i = 0; i < 16; i += 1) {
      const x = rnd(i + 5) * W;
      const y = (rnd(i + 41) * 1.06 - 0.03) * H;
      const r = (7 + rnd(i + 17) * 17) * u;
      const drift = Math.sin(Date.now() / 1800 + i * 1.3) * 5 * u;
      const col = orbs[i % orbs.length];
      ctx.globalAlpha = 0.16 + rnd(i + 29) * 0.2;
      ctx.beginPath();
      ctx.arc(x, y + drift, r, 0, PI2);
      ctx.fillStyle = col;
      ctx.fill();
      // 珠体小高光
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y + drift - r * 0.35, r * 0.24, 0, PI2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    }
  }
  ctx.restore();
  resetShadow(ctx);
}

// ───────────────────── 顶部双磁珠 logo ─────────────────────

/**
 * 3D 双磁珠 logo：红珠 + 青蓝珠 + 外圈磁力线弧（对照设计图首页顶部）
 * @param s 尺寸基准（≈logo 高度）
 */
export function drawLogo(ctx, cx, cy, s, t) {
  ctx.save();
  // 磁力线弧（两道，绕双珠中心）
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = t && t.bgDark ? '#9FF3FF' : '#FFFFFF';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, s * 0.045);
  ctx.beginPath();
  ctx.arc(cx + s * 0.04, cy, s * 0.5, Math.PI * 0.85, Math.PI * 1.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + s * 0.04, cy, s * 0.6, Math.PI * 1.02, Math.PI * 1.72);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // 红珠（左上，稍大）
  drawMiniBead(ctx, cx - s * 0.28, cy - s * 0.1, s * 0.3, '#FF5A5F', '#C93B40');
  // 青蓝珠（右下）
  drawMiniBead(ctx, cx + s * 0.32, cy + s * 0.16, s * 0.26, '#00B8D4', '#008FA8');
  ctx.restore();
  resetShadow(ctx);
}

/** 迷你 3D 磁珠（logo/缩略画用：径向渐变 + 椭圆高光 + 白描边） */
export function drawMiniBead(ctx, x, y, r, color, accent) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.arc(x + r * 0.1, y + r * 0.2, r, 0, PI2);
  ctx.fillStyle = '#3E2723';
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, PI2);
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, color);
  g.addColorStop(1, accent);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - r * 0.28, y - r * 0.38, r * 0.36, r * 0.18, -0.6, 0, PI2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, PI2);
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.stroke();
  ctx.restore();
}

// ───────────────────── 大标题 / 副标题 ─────────────────────

/**
 * 「磁极对决」大标题（三主题质感）：
 *  - candy：橙红渐变 + 白描边 + 深色落影（设计图糖果页）
 *  - quantum：青色霓虹发光
 *  - lab：深棕渐变 + 白描边（牛皮纸金属感）
 * @param uu 字号缩放基准（46*uu = 字号）
 */
export function drawTitle(ctx, cx, cy, t, uu) {
  const fs = Math.round(46 * uu);
  ctx.save();
  ctx.font = `900 ${fs}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  if (t.pieceStyle === 'neon') {
    // 量子：霓虹发光（外圈青光描边 + 内芯浅色渐变）
    ctx.save();
    ctx.shadowColor = '#33E0FF';
    ctx.shadowBlur = 18 * uu;
    ctx.lineWidth = 6 * uu;
    ctx.strokeStyle = 'rgba(51,224,255,0.9)';
    ctx.strokeText('磁极对决', cx, cy);
    ctx.restore();
    resetShadow(ctx);
    const g = ctx.createLinearGradient(0, cy - fs * 0.85, 0, cy + fs * 0.05);
    g.addColorStop(0, (t.titleGrad && t.titleGrad[0]) || '#EAFDFF');
    g.addColorStop(1, (t.titleGrad && t.titleGrad[1]) || '#7CEBFF');
    ctx.fillStyle = g;
    ctx.fillText('磁极对决', cx, cy);
  } else {
    // 深色落影（右下偏移拷贝）
    ctx.fillStyle = 'rgba(90,40,10,0.22)';
    ctx.fillText('磁极对决', cx + 2.5 * uu, cy + 3.5 * uu);
    // 白描边
    ctx.lineWidth = 8 * uu;
    ctx.strokeStyle = t.titleEdge || '#FFFFFF';
    ctx.strokeText('磁极对决', cx, cy);
    // 渐变芯
    const g = ctx.createLinearGradient(0, cy - fs * 0.85, 0, cy + fs * 0.1);
    g.addColorStop(0, (t.titleGrad && t.titleGrad[0]) || '#FFB13B');
    g.addColorStop(1, (t.titleGrad && t.titleGrad[1]) || '#FF5A4E');
    ctx.fillStyle = g;
    ctx.fillText('磁极对决', cx, cy);
  }
  ctx.restore();
  resetShadow(ctx);
}

/** 副标题「— 磁吸对战棋 —」 */
export function drawSubtitle(ctx, cx, cy, t, uu) {
  ctx.save();
  ctx.fillStyle = t.subtitleColor || '#FFFFFF';
  ctx.font = `bold ${Math.round(15 * uu)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('— 磁吸对战棋 —', cx, cy);
  ctx.restore();
}

// ───────────────────── 主题图文小卡 ─────────────────────

/**
 * 主题选择小卡：投影 + 卡底 + 缩略画面（糖果珠堆/霓虹眼/木纹工具）+ 名称 + 选中✓角标
 * 热区由调用方按 (x,y,w,h) 注册，本函数只画。
 */
export function drawThemeCard(ctx, x, y, w, h, id, selected, t, u) {
  const th = THEMES[id] || t;
  const r = 12 * u;
  // 卡片投影
  ctx.save();
  ctx.globalAlpha = 0.15;
  roundRectPath(ctx, x + 2 * u, y + 5 * u, w, h, r);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.restore();
  // 卡底
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = th.cardBg || '#FFF6E8';
  ctx.fill();
  // 描边（选中 = 主色加粗 + 霓虹发光）
  if (selected && th.pieceStyle === 'neon') {
    ctx.save();
    ctx.shadowColor = th.primaryColor || '#33E0FF';
    ctx.shadowBlur = 12 * u;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = th.primaryColor || '#33E0FF';
    ctx.stroke();
    ctx.restore();
    resetShadow(ctx);
  } else {
    roundRectPath(ctx, x, y, w, h, r);
    ctx.lineWidth = (selected ? 3 : 1.5) * u;
    ctx.strokeStyle = selected
      ? (th.primaryColor || th.playerColors[0].color)
      : (t.bgDark ? 'rgba(255,255,255,0.28)' : 'rgba(62,39,35,0.22)');
    ctx.stroke();
  }
  // 缩略画面（卡内上部）
  const pad = 7 * u;
  drawThumb(ctx, x + pad, y + pad, w - pad * 2, h * 0.56, id, u);
  // 名称
  ctx.fillStyle = th.bgDark ? '#E6F5FF' : '#3E2723';
  ctx.font = `bold ${Math.round(w * 0.145)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(th.name, x + w / 2, y + h * 0.85);
  // 选中 ✓ 圆形角标（右上）
  if (selected) drawCheckBadge(ctx, x + w - 5 * u, y + 5 * u, 10.5 * u, t);
}

/** 主题小卡缩略画面（圆角裁剪内的迷你场景） */
function drawThumb(ctx, x, y, w, h, id, u) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 8 * u);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  if (id === 'quantum') {
    // 深空 + 霓虹「眼」：发光椭圆 + 外环 + 迷你霓虹珠
    g.addColorStop(0, '#0A2338');
    g.addColorStop(1, '#123B5C');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const ex = x + w / 2;
    const ey = y + h / 2;
    ctx.save();
    ctx.shadowColor = '#33E0FF';
    ctx.shadowBlur = 10 * u;
    ctx.beginPath();
    ctx.ellipse(ex, ey, w * 0.28, h * 0.22, 0, 0, PI2);
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = '#7CEBFF';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, w * 0.085, 0, PI2);
    ctx.fillStyle = '#DFF9FF';
    ctx.fill();
    ctx.restore();
    resetShadow(ctx);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(ex, ey, w * 0.4, 0, PI2);
    ctx.strokeStyle = 'rgba(51,224,255,0.6)';
    ctx.lineWidth = 1.2 * u;
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawMiniBead(ctx, x + w * 0.2, y + h * 0.8, w * 0.09, '#FF5A5F', '#C93B40');
    drawMiniBead(ctx, x + w * 0.82, y + h * 0.24, w * 0.08, '#2EFF8F', '#1FA85A');
  } else if (id === 'lab') {
    // 木纹底 + 迷你工具 + 金属珠
    g.addColorStop(0, '#E8D5AC');
    g.addColorStop(1, '#CDB684');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#7A5C34';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i += 1) {
      const yy = y + (h / 4) * i;
      ctx.moveTo(x, yy);
      ctx.lineTo(x + w, yy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawWrench(ctx, x + w * 0.24, y + h * 0.3, w * 0.17, -0.5, 0.5);
    drawRuler(ctx, x + w * 0.8, y + h * 0.62, h * 0.36, Math.PI / 2 + 0.35, 0.5);
    drawScrew(ctx, x + w * 0.68, y + h * 0.26, w * 0.05, 0.5);
    drawMiniBead(ctx, x + w * 0.44, y + h * 0.74, w * 0.1, '#D6A42B', '#A87E1C');
  } else {
    // 糖果珠堆（粉奶油底 + 五彩迷你珠）
    g.addColorStop(0, '#FFF3DC');
    g.addColorStop(1, '#FFD9E0');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const beads = [
      ['#FF5A5F', '#C93B40', 0.3, 0.7, 0.16],
      ['#F1C40F', '#C9A10A', 0.52, 0.76, 0.15],
      ['#00B8D4', '#008FA8', 0.72, 0.68, 0.15],
      ['#2ECC71', '#1FA85A', 0.44, 0.46, 0.13],
      ['#FF8A65', '#C9553B', 0.66, 0.36, 0.11],
    ];
    for (const [c, a, px, py, pr] of beads) {
      drawMiniBead(ctx, x + w * px, y + h * py, w * pr, c, a);
    }
  }
  ctx.restore();
}

/** ✓ 圆形角标（选中态右上角：橙底 + 白勾 + 白描边） */
export function drawCheckBadge(ctx, x, y, r, t) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 4 * (r / 10);
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, PI2);
  ctx.fillStyle = (t && t.accentColor) || '#FF8A3D';
  ctx.fill();
  ctx.restore();
  resetShadow(ctx);
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  ctx.strokeStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, PI2);
  ctx.stroke();
  // 白勾（圆头折线）
  ctx.lineWidth = Math.max(2, r * 0.38);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.42, y + r * 0.02);
  ctx.lineTo(x - r * 0.08, y + r * 0.38);
  ctx.lineTo(x + r * 0.46, y - r * 0.34);
  ctx.stroke();
}

// ───────────────────── 玩法胶囊与图标 ─────────────────────

/**
 * 玩法选择胶囊：果冻圆角胶囊 + 圆形图标徽章（对战=交叉剑 / 单人=机器人头）
 * 选中 = 橙渐变底白字白圆徽；未选中 = 浅卡底深字深圆徽。
 */
export function drawModeCapsule(ctx, x, y, w, h, label, icon, selected, t, u) {
  const r = h / 2;
  const accent = t.accentColor || '#FF9F2E';
  // 投影
  ctx.save();
  ctx.globalAlpha = selected ? 0.2 : 0.1;
  roundRectPath(ctx, x + 2 * u, y + 3 * u, w, h, r);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.restore();
  // 胶囊体
  roundRectPath(ctx, x, y, w, h, r);
  if (selected) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, lighten(accent, 36));
    g.addColorStop(1, accent);
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.94)' : (t.cardBg || '#FFFDF4');
    ctx.fill();
    ctx.lineWidth = 1.2 * u;
    ctx.strokeStyle = t.bgDark ? 'rgba(51,224,255,0.4)' : 'rgba(62,39,35,0.14)';
    ctx.stroke();
  }
  // 图标圆徽
  const ir = h * 0.3;
  const ix = x + h * 0.44;
  const iy = y + h / 2;
  ctx.beginPath();
  ctx.arc(ix, iy, ir, 0, PI2);
  ctx.fillStyle = selected ? '#FFFFFF' : (t.bgDark ? '#12314F' : '#4A3123');
  ctx.fill();
  drawModeIcon(ctx, icon, ix, iy, ir * 0.6, selected ? accent : '#FFFFFF');
  // 文本（save/restore 收口，防 textAlign 泄漏；按剩余宽度自适应字号防裁切）
  ctx.save();
  const textX = ix + ir + 8 * u;
  const avail = x + w - textX - 10 * u;
  let fs = h * 0.34;
  ctx.font = `bold ${Math.round(fs)}px sans-serif`;
  // measureText 防御（部分测试 mock / 老运行时可能缺失）
  if (typeof ctx.measureText === 'function') {
    while (ctx.measureText(label).width > avail && fs > h * 0.22) {
      fs -= 1;
      ctx.font = `bold ${Math.round(fs)}px sans-serif`;
    }
  }
  ctx.fillStyle = selected ? '#FFFFFF' : (t.bgDark ? '#12314F' : '#4A3123');
  ctx.textAlign = 'left';
  ctx.fillText(label, textX, iy + h * 0.12);
  ctx.restore();
}

/** 圆徽内简笔图标：'swords' 交叉双剑 / 'robot' 机器人头 */
export function drawModeIcon(ctx, kind, x, y, r, col) {
  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineCap = 'round';
  if (kind === 'swords') {
    for (const a of [-Math.PI / 4, Math.PI / 4]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      // 剑身
      ctx.lineWidth = r * 0.28;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r * 0.5);
      ctx.stroke();
      // 护手
      ctx.lineWidth = r * 0.2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.22);
      ctx.lineTo(r * 0.4, r * 0.22);
      ctx.stroke();
      // 柄尾
      ctx.beginPath();
      ctx.arc(0, r * 0.68, r * 0.16, 0, PI2);
      ctx.fill();
      ctx.restore();
    }
  } else {
    // 机器人头：天线 + 圆角头 + 双眼 + 嘴
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.55);
    ctx.lineTo(x, y - r * 1.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - r * 1.15, r * 0.16, 0, PI2);
    ctx.fill();
    roundRectPath(ctx, x - r * 0.85, y - r * 0.6, r * 1.7, r * 1.34, r * 0.42);
    ctx.fill();
    const eye = 'rgba(20,30,45,0.65)';
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.05, r * 0.16, 0, PI2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.3, y - r * 0.05, r * 0.16, 0, PI2);
    ctx.fill();
    ctx.strokeStyle = eye;
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.2, y + r * 0.36);
    ctx.lineTo(x + r * 0.2, y + r * 0.36);
    ctx.stroke();
  }
  ctx.restore();
}

// ───────────────────── 星芒 ─────────────────────

/** 四角星芒（开战按钮两侧装饰） */
export function drawSparkle(ctx, x, y, r, col, alpha = 0.9) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = col || '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ───────────────────── 结算缎带 + 皇冠 ─────────────────────

/**
 * 结算顶部横幅：金冠 + 缎带主体 + 左右尾翼（V 形缺口）+ 顶部高光条
 * @param label 恒为「结算」（对照设计图）
 */
export function drawRibbonBanner(ctx, cx, cy, w, h, label, t, u) {
  const grad = t.bannerGrad || ['#FF7668', '#E8403F'];
  // 左右尾翼（先画，压在主体后面）
  const tailW = w * 0.17;
  const tailH = h * 0.78;
  const tailDrop = h * 0.22;
  for (const side of [-1, 1]) {
    const tx = cx + side * (w / 2 - 3 * u);
    const ty = cy + tailDrop;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + side * tailW, ty - tailDrop * 0.45);
    ctx.lineTo(tx + side * tailW, ty - tailDrop * 0.45 + tailH);
    ctx.lineTo(tx, ty + tailH * 0.66);
    ctx.closePath();
    ctx.fillStyle = darken(grad[1], 22);
    ctx.fill();
  }
  // 缎带主体
  ctx.save();
  if (t.pieceStyle === 'neon') {
    ctx.shadowColor = t.bannerGlow || '#33E0FF';
    ctx.shadowBlur = 16 * u;
  }
  roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, h * 0.3);
  const g = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  g.addColorStop(0, grad[0]);
  g.addColorStop(1, grad[1]);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  resetShadow(ctx);
  // 顶部高光条
  ctx.globalAlpha = 0.32;
  roundRectPath(ctx, cx - w / 2 + 9 * u, cy - h / 2 + 5 * u, w - 18 * u, h * 0.3, h * 0.15);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.globalAlpha = 1;
  // 文字
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 ${Math.round(h * 0.5)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + h * 0.17);
  // 金冠（尺寸随横幅宽收缩，确保小屏不出画布顶）
  drawCrown(ctx, cx, cy - h / 2 - 8 * u, w * 0.105, u);
}

/** 金色皇冠（三尖 + 底座 + 顶尖珠 + 宝石） */
function drawCrown(ctx, cx, cy, s, u) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(-s * 0.85, 0);
  ctx.lineTo(-s * 0.95, -s * 0.9);
  ctx.lineTo(-s * 0.42, -s * 0.38);
  ctx.lineTo(0, -s * 1.05);
  ctx.lineTo(s * 0.42, -s * 0.38);
  ctx.lineTo(s * 0.95, -s * 0.9);
  ctx.lineTo(s * 0.85, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -s * 1.05, 0, 0);
  g.addColorStop(0, '#FFE08A');
  g.addColorStop(1, '#F5A623');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.strokeStyle = '#D4881C';
  ctx.stroke();
  // 底座条
  roundRectPath(ctx, -s * 0.88, 0, s * 1.76, s * 0.4, s * 0.2);
  ctx.fillStyle = '#F5A623';
  ctx.fill();
  ctx.strokeStyle = '#D4881C';
  ctx.stroke();
  // 顶尖珠
  for (const [px, py] of [[-0.95, -0.95], [0, -1.12], [0.95, -0.95]]) {
    ctx.beginPath();
    ctx.arc(px * s, py * s, s * 0.14, 0, PI2);
    ctx.fillStyle = '#FFE08A';
    ctx.fill();
  }
  // 宝石
  ctx.beginPath();
  ctx.arc(0, s * 0.2, s * 0.11, 0, PI2);
  ctx.fillStyle = '#E8403F';
  ctx.fill();
  ctx.restore();
}

// ───────────────────── 奖牌 / 头像徽章 ─────────────────────

const MEDALS = [
  ['#FFE08A', '#F0A72E', '#C97F12'], // 1 金
  ['#F3F5F8', '#C3CAD6', '#98A2B3'], // 2 银
  ['#FFD1A6', '#DE9350', '#B26B2E'], // 3 铜
  ['#E4E0D8', '#BDB6A8', '#948D7D'], // 4 灰
];

/** 名次圆形奖牌（rank 1金/2银/3铜/4灰，内写白色数字） */
export function drawMedal(ctx, x, y, r, rank, u) {
  const [hi, mid, lo] = MEDALS[Math.max(0, Math.min(3, (rank || 1) - 1))];
  ctx.save();
  // 投影
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.14, r, 0, PI2);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.globalAlpha = 1;
  // 主体
  ctx.beginPath();
  ctx.arc(x, y, r, 0, PI2);
  const g = ctx.createLinearGradient(x, y - r, x, y + r);
  g.addColorStop(0, hi);
  g.addColorStop(1, mid);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.13);
  ctx.strokeStyle = lo;
  ctx.stroke();
  // 内圈白环
  ctx.beginPath();
  ctx.arc(x, y, r * 0.72, 0, PI2);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.stroke();
  // 数字
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 ${Math.round(r * 1.05)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), x, y + r * 0.06);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

/**
 * 玩家圆形头像徽章（主题色渐变底 + 白环 + 笑脸或白色数字）
 * @param pc {color, accent}
 * @param opts {mode:'face'|'text', label, active, ring}
 */
export function drawAvatarBadge(ctx, x, y, r, pc, opts = {}) {
  const dim = opts.active === false;
  ctx.save();
  ctx.globalAlpha = dim ? 0.5 : 1;
  // 投影
  ctx.globalAlpha = dim ? 0.28 : 0.9;
  ctx.beginPath();
  ctx.arc(x + r * 0.06, y + r * 0.14, r, 0, PI2);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fill();
  ctx.globalAlpha = dim ? 0.5 : 1;
  // 底色（径向渐变球面）
  ctx.beginPath();
  ctx.arc(x, y, r, 0, PI2);
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, lighten(pc.color, 60));
  g.addColorStop(0.5, pc.color);
  g.addColorStop(1, pc.accent);
  ctx.fillStyle = g;
  ctx.fill();
  // 白环
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.strokeStyle = opts.ring || 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, PI2);
  ctx.stroke();
  if (opts.mode === 'text' && opts.label != null) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 ${Math.round(r * 1.02)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(opts.label), x, y + r * 0.08);
    ctx.textBaseline = 'alphabetic';
  } else {
    // 笑脸（结算行头像）
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.12, r * 0.13, 0, PI2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.3, y - r * 0.12, r * 0.13, 0, PI2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = r * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y + r * 0.02, r * 0.42, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

// ───────────────────── 托盘图例 / 计数徽章 ─────────────────────

/** 四形状图例：圆 / 方 / 三角 / 菱（当前玩家色，对照设计图托盘中部） */
export function drawShapeLegend(ctx, cx, cy, size, color, accent) {
  const gap = size * 2.5;
  for (let i = 0; i < 4; i += 1) {
    drawMiniShape(ctx, i, cx - gap * 1.5 + i * gap, cy, size, color, accent);
  }
}

/** 单个迷你形状（kind: 0圆 1方 2三角 3菱） */
export function drawMiniShape(ctx, kind, x, y, s, color, accent) {
  ctx.save();
  ctx.beginPath();
  if (kind === 0) {
    ctx.arc(x, y, s, 0, PI2);
  } else if (kind === 1) {
    roundRectPath(ctx, x - s * 0.9, y - s * 0.9, s * 1.8, s * 1.8, s * 0.42);
  } else if (kind === 2) {
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.95, y + s * 0.72);
    ctx.lineTo(x - s * 0.95, y + s * 0.72);
    ctx.closePath();
  } else {
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.82, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s * 0.82, y);
    ctx.closePath();
  }
  const g = ctx.createLinearGradient(x, y - s, x, y + s);
  g.addColorStop(0, lighten(color, 48));
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.15);
  ctx.strokeStyle = accent || darken(color, 30);
  ctx.stroke();
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.arc(x - s * 0.28, y - s * 0.34, s * 0.2, 0, PI2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();
}

/** 数量圆徽章（托盘右侧金色圆 + 白数字，对照设计图） */
export function drawCountBadge(ctx, x, y, r, n, t, u) {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.16, r, 0, PI2);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, PI2);
  const g = ctx.createLinearGradient(x, y - r, x, y + r);
  g.addColorStop(0, '#FFD54F');
  g.addColorStop(1, '#F5A623');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.strokeStyle = '#C97F12';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 ${Math.round(r * 1.1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + r * 0.08);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

// ───────────────────── 拖拽磁力反馈 ─────────────────────

/**
 * 拖拽磁珠的同心圆磁力波：3 圈由内向外扩散 + 贴珠实线环（金/主题预警色）
 * @param time 场景累计毫秒（驱动相位流动）
 */
export function drawMagnetWaves(ctx, x, y, r, time, t) {
  ctx.save();
  const col = t.warnColor || '#FFB300';
  for (let i = 0; i < 3; i += 1) {
    const ph = ((time / 900) + i / 3) % 1;
    const rr = r * (1.3 + ph * 1.5);
    ctx.globalAlpha = (1 - ph) * 0.55;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, PI2);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.18, 0, PI2);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** 托盘 → 手指的虚线轨迹（金色、圆头、轻微弧线） */
export function drawDashPath(ctx, x0, y0, x1, y1, t, u) {
  ctx.save();
  ctx.strokeStyle = t.warnColor || '#FFB300';
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2.5 * u;
  ctx.lineCap = 'round';
  ctx.setLineDash([7 * u, 7 * u]);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (x0 + x1) / 2 - (dy / len) * 24 * u;
  const my = (y0 + y1) / 2 + (dx / len) * 24 * u;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ───────────────────── 实验室工具剪影 ─────────────────────

/** 扳手剪影（开口 C 形头 + 圆头手柄） */
export function drawWrench(ctx, x, y, s, rot, alpha = 0.4) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = `rgba(90,70,44,${alpha})`;
  ctx.strokeStyle = `rgba(90,70,44,${alpha})`;
  roundRectPath(ctx, -s * 0.12, 0, s * 0.24, s * 1.15, s * 0.12);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.22;
  ctx.beginPath();
  ctx.arc(0, -s * 0.1, s * 0.3, Math.PI * 0.35, Math.PI * 1.65);
  ctx.stroke();
  ctx.restore();
}

/** 直尺剪影（带刻度） */
export function drawRuler(ctx, x, y, s, rot, alpha = 0.3) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  roundRectPath(ctx, -s * 0.09, -s * 0.5, s * 0.18, s, s * 0.05);
  ctx.fillStyle = `rgba(90,70,44,${alpha})`;
  ctx.fill();
  ctx.strokeStyle = 'rgba(250,243,224,0.7)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 1; i <= 6; i += 1) {
    const yy = -s * 0.5 + (i * s) / 7;
    ctx.moveTo(s * 0.09, yy);
    ctx.lineTo(s * 0.01, yy);
  }
  ctx.stroke();
  ctx.restore();
}

/** 螺丝剪影（圆帽 + 一字槽） */
export function drawScrew(ctx, x, y, s, alpha = 0.35) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, s, 0, PI2);
  ctx.fillStyle = `rgba(90,70,44,${alpha})`;
  ctx.fill();
  ctx.strokeStyle = 'rgba(250,243,224,0.6)';
  ctx.lineWidth = Math.max(1, s * 0.28);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.45, y - s * 0.45);
  ctx.lineTo(x + s * 0.45, y + s * 0.45);
  ctx.stroke();
  ctx.restore();
}
