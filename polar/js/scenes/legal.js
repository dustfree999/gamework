/**
 * 合规界面（文本取自 design/compliance.md §5 模板，勿改写以免弱化免责）
 *  - AboutScene：「关于」页，常驻原创声明
 *  - AgreementOverlay：首次启动用户协议弹窗（同意前拦截输入）
 * 双语：正文按语言取文（中文为权威文本，EN 标注以中文版为准）；换行按像素测量+空格断词。
 */
import { getTheme } from '../core/themes.js';
import { roundRectPath } from '../render/board.js';
import { drawButton, drawBackground } from '../render/button.js';
import { tr, getLang, setLang } from '../i18n.js';

const DECLARATION_ZH = `【原创声明】

本小程序是一款基于公开物理规则独立开发的益智对战游戏。

1. 游戏玩法属于通用策略机制，与任何实体商品、品牌、App无关。
2. 所有代码由开发团队自主编写，未引用任何第三方同类项目的源码。
3. 所有美术资源（配色、图形、动画）均为原创设计，未使用任何外部素材。
4. 本小程序为独立原创作品，如有雷同，纯属玩法机制上的巧合。

如有侵权争议，请联系开发者协商处理。`;

const DECLARATION_EN = `[Original Work]

This mini-game is an original puzzle battle game built on public physical rules.

1. The gameplay is a general strategic mechanic, unrelated to any product, brand or app.
2. All code was written by the dev team; no third-party source was used.
3. All art (colors, shapes, animations) is original; no external assets.
4. This is an independent original work. Any similarity is coincidence of mechanics.

For disputes, contact the developer. The Chinese text is authoritative.`;

const AGREEMENT_ZH = `【用户协议】

欢迎使用本小程序！

本游戏为原创独立作品，基于公开的磁力物理益智玩法开发。
游戏内所有内容（代码、美术、文案）均为原创设计。

点击「同意」即表示您接受本协议并确认知晓上述声明。`;

const AGREEMENT_EN = `[User Agreement]

Welcome!

This game is an original work based on public magnet-physics puzzle rules.
All content (code, art, text) is original.

Tapping "Agree" accepts this agreement and the notice above.`;

const RULES_ZH = `每颗磁珠都有磁力，放得太近就会被吸在一起。

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

const RULES_EN = `Every piece has a magnet field — placing too close pulls pieces together.

◆ Duel (2-4 players)
· Take turns, place 1 piece each
· Landing on a magnet range = SNAP: the whole touching group
  (any color) returns to your hand; next player goes
· First to safely place all their pieces wins
· Pulling opponents' pieces back with you is the fun part

◆ Solo Challenge
· Obstacle pieces appear randomly (dark gray X)
· Each safe placement = 1 point; a snap ends it
· Same challenge code = same layout — compare scores with friends

◆ Reading the magnet range
While dragging, a dashed ring appears:
· No pieces inside = safe spot
· Pieces inside = danger zone (red warning)

◆ Colors & shapes
Red / Cyan / Green / Yellow mark the 4 players.
Pieces differ in shape so you can tell them apart.`;

/** 按语言取正文（中英对照，英文标注以中文版为准） */
function texts() {
  return getLang() === 'en'
    ? { declaration: DECLARATION_EN, agreement: AGREEMENT_EN, rules: RULES_EN }
    : { declaration: DECLARATION_ZH, agreement: AGREEMENT_ZH, rules: RULES_ZH };
}

/**
 * 像素换行：按可显示宽度断行。
 * - 中文/无空格字符：按字切（近似等宽）
 * - 英文/含空格：按单词边界断行，容不下超长单词时硬切
 * 返回行数组。
 */
function wrapLines(ctx, text, maxWidthPx) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    // 无空格（中文串）：逐字符累积
    if (!/\s/.test(para)) {
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        const w = typeof ctx.measureText === 'function' ? ctx.measureText(test).width : test.length * 8;
        if (w > maxWidthPx && line) { out.push(line); line = ch; }
        else line = test;
      }
      out.push(line);
      continue;
    }
    // 含空格：单词断行
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      const w = typeof ctx.measureText === 'function' ? ctx.measureText(test).width : test.length * 8;
      if (w > maxWidthPx && line) { out.push(line); line = word; }
      else line = test;
      // 单词本身超宽：硬切
      while (typeof ctx.measureText === 'function' && ctx.measureText(line).width > maxWidthPx && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidthPx) cut -= 1;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
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
  const maxWidth = w - 52 * u;
  const lines = wrapLines(ctx, body, maxWidth);
  // 行距自适应：默认 24u；行数超出面板容量则压缩，但不小于字号×1.15（防叠字）
  const bodyTop = 76 * u;
  const capacity = Math.max(1, (h - bodyTop - 12 * u));
  let lh = Math.min(24 * u, capacity / lines.length);
  lh = Math.max(lh, fs * 1.15);
  const startY = y + bodyTop;
  lines.forEach((ln, i) => ctx.fillText(ln, x + 26 * u, startY + i * lh));
  ctx.restore();
  return lines.length;
}

/** 按文本行数计算面板应有高度（About/Rules 页共用：内容先行，面板随行数） */
function panelHeightFor(ctx, text, pw, u, H) {
  const fs = Math.round(15 * u);
  ctx.font = `${fs}px sans-serif`;
  const maxWidth = pw - 52 * u;
  const lines = wrapLines(ctx, text, maxWidth).length;
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
    const body = texts().declaration;
    const ph = panelHeightFor(ctx, body, pw, u, H); // 内容自适应：文本行数定面板高（防溢出）
    const py = Math.max(14 * u, (H - ph) / 2 - 30 * u);
    drawTextPanel(ctx, t, (W - pw) / 2, py, pw, ph, tr('legal.about-title'), body);
    this.tapRects = [];
    const bw = 200 * u;
    const bh = 60 * u;
    const by = Math.min(py + ph + 24 * u, H - bh - 14 * u); // 按钮跟随面板且不越出屏幕
    drawButton(ctx, t, { x: W / 2 - bw / 2, y: by, w: bw, h: bh, label: tr('legal.back'), primary: true });
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
    this.langRect = null;
  }

  _u() { return canvas.width / 375; }

  /** 弹窗右上角语言切换：与「同意」rect 并列命中，切换不触发同意 */
  touchStart(px, py) {
    const lr = this.langRect;
    if (lr && px >= lr.x && px <= lr.x + lr.w && py >= lr.y && py <= lr.y + lr.h) {
      setLang(getLang() === 'en' ? 'zh' : 'en');
      return true;
    }
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
    const body = texts().agreement;
    // 面板高度随内容（BODY + 顶部标题 + 底部按钮区），修复文本被按钮压住问题
    const fs = Math.round(15 * u);
    ctx.font = `${fs}px sans-serif`;
    const pw = W * 0.86;
    const maxWidth = pw - 52 * u;
    const lineCount = wrapLines(ctx, body, maxWidth).length;
    const bodyH = 76 * u + lineCount * 24 * u + 16 * u;
    const btnPlane = 58 * u + 40 * u; // 按钮 + 上下留白
    const ph = Math.max(300 * u, Math.min(H * 0.84, bodyH + btnPlane));
    const px = (W - pw) / 2;
    const py = Math.max(10 * u, (H - ph) / 2 - 30 * u);
    drawTextPanel(ctx, t, px, py, pw, ph, tr('legal.agreement-title'), body);
    const bw = 200 * u;
    const bh = 58 * u;
    const by = py + ph - bh - 26 * u;
    drawButton(ctx, t, { x: W / 2 - bw / 2, y: by, w: bw, h: bh, label: tr('legal.agree'), primary: true });
    this.rect = { x: W / 2 - bw / 2, y: by, w: bw, h: bh };
    // 右上角语言切换胶囊（在标题行右侧）
    const lw = 46 * u;
    const lh = 24 * u;
    const lx = px + pw - lw - 12 * u;
    const ly = py + 12 * u;
    roundRectPath(ctx, lx, ly, lw, lh, lh / 2);
    ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.92)' : 'rgba(62,39,35,0.9)';
    ctx.fill();
    ctx.fillStyle = t.bgDark ? '#12314F' : '#FFFFFF';
    ctx.font = `bold ${Math.round(15 * u)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(tr('legal.lang-en'), lx + lw / 2, ly + lh / 2 + 5 * u);
    this.langRect = { x: lx, y: ly, w: lw, h: lh };
  }
}

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
    const maxWidth = pw - 44 * u;
    const body = texts().rules;
    ctx.font = `${fs}px sans-serif`;
    const lines = wrapLines(ctx, body, maxWidth);
    // 行距自适应：默认 24u，容量不足时压缩但不小于字号×1.15（防叠字）；面板随内容增高
    const headH = 70 * u;
    let lh = Math.min(24 * u, (H * 0.8 - headH - 20 * u) / lines.length);
    lh = Math.max(lh, fs * 1.15);
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
    ctx.fillText(tr('legal.rules-title'), px + pw / 2, py + 42 * u);
    ctx.font = `${fs}px sans-serif`;
    ctx.textAlign = 'left';
    const startY = py + headH;
    lines.forEach((ln, i) => ctx.fillText(ln, px + 22 * u, startY + i * lh));

    this.tapRects = [];
    const bw = 200 * u;
    const bh = 58 * u;
    const by = Math.min(py + ph + 20 * u, H - bh - 12 * u); // 按钮跟随面板且不越出屏幕
    drawButton(ctx, t, { x: W / 2 - bw / 2, y: by, w: bw, h: bh, label: tr('legal.back'), primary: true });
    this.tapRects.push({ x: W / 2 - bw / 2, y: by, w: bw, h: bh });
  }
}