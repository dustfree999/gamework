/**
 * 合规界面（文本取自 design/compliance.md §5 模板，勿改写以免弱化免责）
 *  - AboutScene：「关于」页，常驻原创声明
 *  - AgreementOverlay：首次启动用户协议弹窗（同意前拦截输入）
 */
import { getTheme } from '../core/themes.js';
import { roundRectPath } from '../render/board.js';
import { drawButton, drawBackground } from '../render/button.js';

const DECLARATION = `【原创声明】

本小程序是一款基于公开物理规则独立开发的益智对战游戏。

1. 游戏玩法属于通用策略机制，与任何实体商品、品牌、App无关。
2. 所有代码由开发团队自主编写，未引用任何第三方同类项目的源码。
3. 所有美术资源（配色、图形、动画）均为原创设计，未使用任何外部素材。
4. 本小程序为独立原创作品，如有雷同，纯属玩法机制上的巧合。

如有侵权争议，请联系开发者协商处理。`;

const AGREEMENT = `【用户协议】

欢迎使用本小程序！

本游戏为原创独立作品，基于公开的磁力物理益智玩法开发。
游戏内所有内容（代码、美术、文案）均为原创设计。

点击「同意」即表示您接受本协议并确认知晓上述声明。`;

/** 文本自动换行（按最大字符数粗略断行，中文等宽适用） */
function wrapLines(text, maxChars) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    for (let i = 0; i < para.length; i += maxChars) out.push(para.slice(i, i + maxChars));
  }
  return out;
}

function drawTextPanel(ctx, t, x, y, w, h, title, body) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 16 * (w / 375) * (375 / w) || 16);
  ctx.fillStyle = t.bgDark ? 'rgba(20,30,45,0.97)' : 'rgba(255,252,244,0.98)';
  ctx.fill();
  ctx.strokeStyle = t.playerColors[0].color;
  ctx.lineWidth = 2;
  ctx.stroke();
  const u = w / 375;
  ctx.fillStyle = t.textColor;
  ctx.font = `bold ${Math.round(24 * u)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(title, x + w / 2, y + 44 * u);
  const fs = Math.round(15 * u);
  ctx.font = `${fs}px sans-serif`;
  ctx.textAlign = 'left';
  const maxChars = Math.max(10, Math.floor((w - 52 * u) / fs));
  const lines = wrapLines(body, maxChars);
  // 行距自适应：默认 24u；行数超出面板容量则压缩，但不小于字号×1.3（防叠字）
  const bodyTop = 76 * u;
  const capacity = Math.max(1, (h - bodyTop - 12 * u));
  let lh = Math.min(24 * u, capacity / lines.length);
  lh = Math.max(lh, fs * 1.3);
  const startY = y + bodyTop;
  lines.forEach((ln, i) => ctx.fillText(ln, x + 26 * u, startY + i * lh));
  ctx.restore();
  return lines.length;
}

/** 按文本行数计算面板应有高度（About/Rules 页共用：内容先行，面板随行数） */
function panelHeightFor(text, pw, u, H) {
  const fs = Math.round(15 * u);
  const maxChars = Math.max(10, Math.floor((pw - 52 * u) / fs));
  const lines = wrapLines(text, maxChars).length;
  const content = 76 * u + lines * 24 * u + 24 * u;
  return Math.max(220 * u, Math.min(H * 0.8, content));
}

/** 关于页 */
export class AboutScene {
  constructor(ctx, { onBack } = {}) {
    this.ctx = ctx;
    this.onBack = onBack || (() => {});
    this.tapRects = [];
  }

  _u() { return canvas.width / 375; }

  touchStart(px, py) {
    for (const r of this.tapRects) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) { this.onBack(); return; }
    }
  }
  touchMove() {}
  touchEnd() {}
  update() {}

  render() {
    const ctx = this.ctx;
    const t = getTheme();
    const W = canvas.width;
    const H = canvas.height;
    const u = this._u();
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx, t);
    const pw = W * 0.88;
    const ph = panelHeightFor(DECLARATION, pw, u, H); // 内容自适应：文本行数定面板高（防溢出）
    const py = Math.max(14 * u, (H - ph) / 2 - 30 * u);
    drawTextPanel(ctx, t, (W - pw) / 2, py, pw, ph, '关于 · 磁极对决', DECLARATION);
    this.tapRects = [];
    const bw = 200 * u;
    const bh = 60 * u;
    const by = Math.min(py + ph + 24 * u, H - bh - 14 * u); // 按钮跟随面板且不越出屏幕
    drawButton(ctx, t, { x: W / 2 - bw / 2, y: by, w: bw, h: bh, label: '返 回', primary: true });
    this.tapRects.push({ x: W / 2 - bw / 2, y: by, w: bw, h: bh });
  }
}

/** 首次启动用户协议弹窗（覆盖在其他场景之上，同意前拦截一切输入） */
export class AgreementOverlay {
  constructor(ctx, { onAgree } = {}) {
    this.ctx = ctx;
    this.onAgree = onAgree || (() => {});
    this.agreed = false;
    this.rect = null;
  }

  _u() { return canvas.width / 375; }

  touchStart(px, py) {
    const r = this.rect;
    if (r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      this.agreed = true;
      this.onAgree();
    }
    return true; // 拦截（弹窗期间不透传）
  }
  touchMove() {}
  touchEnd() {}
  update() {}

  render() {
    const ctx = this.ctx;
    const t = getTheme();
    const W = canvas.width;
    const H = canvas.height;
    const u = this._u();
    // 遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    const pw = W * 0.86;
    const ph = 360 * u;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2 - 30 * u;
    drawTextPanel(ctx, t, px, py, pw, ph, '用户协议', AGREEMENT);
    const bw = 200 * u;
    const bh = 58 * u;
    const by = py + ph - bh - 26 * u;
    drawButton(ctx, t, { x: W / 2 - bw / 2, y: by, w: bw, h: bh, label: '同 意', primary: true });
    this.rect = { x: W / 2 - bw / 2, y: by, w: bw, h: bh };
  }
}

const RULES = `每颗磁珠都有磁力，放得太近就会被吸在一起。

◆ 对战（2-4 人）
· 轮流放子，每回合放 1 颗
· 落点碰到磁力范围 = 触磁：吸在一起的整组磁珠
  （不分颜色）全部收回你手中，换下一位
· 谁先把手中磁珠全部安全放完，谁获胜
· 被对手"借磁"连坐回手，是这盘棋最刺激的地方

◆ 单人挑战
· 盘面有随机障碍磁珠（深灰 X 标记）
· 每安全放 1 颗得 1 分，触磁立即结束
· 同一挑战码布局相同，可与好友比拼分数

◆ 怎么看磁力范围
拖拽时棋子周围出现虚线圈：
· 圈内没有磁珠 = 安全落点
· 圈内已有磁珠 = 危险区（红色警告）

◆ 颜色与形状
红/青/绿/黄 代表 4 位玩家，
棋子形状各不相同，方便辨认。`;

/** 玩法说明页（面板高度随文本自适应） */
export class RulesScene {
  constructor(ctx, { onBack } = {}) {
    this.ctx = ctx;
    this.onBack = onBack || (() => {});
    this.tapRects = [];
  }

  _u() { return canvas.width / 375; }

  touchStart(px, py) {
    for (const r of this.tapRects) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) { this.onBack(); return; }
    }
  }
  touchMove() {}
  touchEnd() {}
  update() {}

  render() {
    const ctx = this.ctx;
    const t = getTheme();
    const W = canvas.width;
    const H = canvas.height;
    const u = this._u();
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx, t);

    const pw = W * 0.9;
    const fs = Math.round(15 * u);
    const maxChars = Math.max(10, Math.floor((pw - 44 * u) / fs));
    const lines = wrapLines(RULES, maxChars);
    // 行距自适应：默认 24u，容量不足时压缩但不小于字号×1.3（防叠字）；面板随内容增高
    const headH = 70 * u;
    let lh = Math.min(24 * u, (H * 0.8 - headH - 20 * u) / lines.length);
    lh = Math.max(lh, fs * 1.3);
    const ph = Math.min(H * 0.84, headH + lines.length * lh + 20 * u);
    const px = (W - pw) / 2;
    const py = Math.max(10 * u, (H - ph) / 2 - 40 * u);

    roundRectPath(ctx, px, py, pw, ph, 16 * u);
    ctx.fillStyle = t.bgDark ? 'rgba(20,30,45,0.97)' : 'rgba(255,252,244,0.98)';
    ctx.fill();
    ctx.strokeStyle = t.playerColors[0].color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = t.textColor;
    ctx.font = `bold ${Math.round(24 * u)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('玩法说明', px + pw / 2, py + 42 * u);
    ctx.font = `${fs}px sans-serif`;
    ctx.textAlign = 'left';
    const startY = py + headH;
    lines.forEach((ln, i) => ctx.fillText(ln, px + 22 * u, startY + i * lh));

    this.tapRects = [];
    const bw = 200 * u;
    const bh = 58 * u;
    const by = Math.min(py + ph + 20 * u, H - bh - 12 * u); // 按钮跟随面板且不越出屏幕
    drawButton(ctx, t, { x: W / 2 - bw / 2, y: by, w: bw, h: bh, label: '返 回', primary: true });
    this.tapRects.push({ x: W / 2 - bw / 2, y: by, w: bw, h: bh });
  }
}
