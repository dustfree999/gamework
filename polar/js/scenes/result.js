/**
 * 结算场景（主题化 + 比例自适应布局）
 * 视觉还原 design/design.png：金冠+缎带横幅「结算」→ 奖牌排名行（金/银/铜/灰圆牌 +
 * 头像徽章 + 玩家N（色名）+ 右对齐分数）→「本局数据」圆角面板（4 行键值对）
 * → 底部双按钮「再来一局」「分享」+ 小字「回首页」。
 * 交互契约保持：onReplay / onChallenge(分享复用) / onHome 三个回调均接线。
 */
import { getTheme } from '../core/themes.js';
import { roundRectPath, resetShadow } from '../render/board.js';
import { drawButton, drawBackground } from '../render/button.js';
import { rankOf } from '../core/rules.js';
import { drawRibbonBanner, drawMedal, drawAvatarBadge } from '../render/decor.js';

const CN = ['红', '青', '绿', '黄']; // 玩家色名（对应 P1-P4）

export default class ResultScene {
  constructor(ctx, game, { onReplay, onHome, onChallenge, themeId, myIndex = 0 } = {}) {
    this.ctx = ctx;
    this.game = game;
    this.myIndex = myIndex; // 本地玩家座位角标（联机 seat-1，本地局 0）：排名/数据面板按它取行
    this.onReplay = onReplay || (() => {});
    this.onHome = onHome || (() => {});
    this.onChallenge = onChallenge || (() => {});
    this.themeId = themeId || getTheme().id;
    this.press = null;
  }

  get theme() {
    return getTheme(this.themeId);
  }

  _u() {
    return canvas.width / 375;
  }

  /** 按钮几何（render 与 touch 共用，杜绝坐标漂移） */
  _layout() {
    const W = canvas.width;
    const H = canvas.height;
    const u = this._u();
    const cx = W / 2;
    const rank = this.game.ranking || [];
    const bannerH = 52 * u;
    const bannerY = H * 0.098; // 金冠顶部需留在画布内（小屏 568 高验证）
    const rowsTop = bannerY + bannerH / 2 + 34 * u;
    const cardH = Math.min(46 * u, H * 0.06);
    const gapY = cardH + 10 * u;
    const rowW = Math.min(W * 0.86, 330 * u);
    const panelY = rowsTop + rank.length * gapY + 16 * u;
    const panelH = 40 * u + 4 * 26 * u + 8 * u;
    const btnY = panelY + panelH + 22 * u;
    const btnW = 150 * u;
    const btnH = 56 * u;
    return {
      W, H, u, cx, bannerH, bannerY, rowsTop, cardH, gapY, rowW, panelY, panelH,
      bannerW: Math.min(210 * u, W * 0.62),
      replay: { x: cx - btnW - 8 * u, y: btnY, w: btnW, h: btnH },
      share: { x: cx + 8 * u, y: btnY, w: btnW, h: btnH },
      home: { x: cx - 70 * u, y: btnY + btnH + 12 * u, w: 140 * u, h: 30 * u },
    };
  }

  touchStart(px, py) {
    const L = this._layout();
    if (this.hit(px, py, L.replay)) { this.press = 'replay'; this.onReplay(); }
    else if (this.hit(px, py, L.share)) { this.press = 'share'; this.onChallenge(this.game, this.myIndex); }
    else if (this.hit(px, py, L.home)) { this.press = 'home'; this.onHome(); }
  }

  hit(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  touchMove() {}
  touchEnd() { this.press = null; }

  update() {}

  /** 每位玩家展示分数（solo=得分 / loot=战利品 / classic=已放置数），全部取自现有字段 */
  _scoreOf(pi) {
    const g = this.game;
    if (g.mode === 'solo') return g.stats[pi].placed;
    if (g.mode === 'loot') return g.scored[pi];
    return Math.max(0, (g.piecesEach || 0) - g.hands[pi]);
  }

  render() {
    const ctx = this.ctx;
    const t = this.theme;
    const L = this._layout();
    const { W, H, u, cx } = L;
    const solo = this.game.mode === 'solo';
    const loot = this.game.mode === 'loot';
    ctx.clearRect(0, 0, W, H);
    resetShadow(ctx);
    drawBackground(ctx, t);

    // ── 顶部：金冠 + 缎带横幅「结算」 ──
    drawRibbonBanner(ctx, cx, L.bannerY, L.bannerW, L.bannerH, '结算', t, u);

    // 结束原因 + 胜者（小字，保留原信息量）
    const reasonText = {
      empty: '棋子全部放完',
      stall: '磁力僵局 · 剩余手牌定名次',
      full: solo ? '棋盘放满 · 完美收官！' : '棋盘放满 · 剩余手牌定名次',
      nomove: '无处安全落子 · 完美收官！',
      foul: '触磁 · 挑战结束',
    }[this.game.endReason] || '';
    const winName = this.game.winner >= 0 ? `P${this.game.winner + 1}` : '';
    ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.7)' : 'rgba(62,39,35,0.6)';
    ctx.font = `${Math.round(13 * u)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText([reasonText, winName && `${winName} 胜`].filter(Boolean).join(' · '), cx, L.rowsTop - 22 * u);

    // ── 排名行：奖牌 + 头像徽章 + 玩家N（色名）+ 右对齐分数（浅色圆角卡）──
    const rank = this.game.ranking || [];
    const ranks = rankOf(this.game);
    let y = L.rowsTop;
    rank.forEach((pi) => {
      const pc = t.playerColors[pi % 4];
      const rankNo = ranks[pi] != null ? ranks[pi] : 1;
      // 行卡
      roundRectPath(ctx, cx - L.rowW / 2, y, L.rowW, L.cardH, L.cardH / 2);
      ctx.fillStyle = t.cardBg || (t.bgDark ? 'rgba(13,40,64,0.85)' : 'rgba(255,252,244,0.92)');
      ctx.fill();
      ctx.lineWidth = 1.2 * u;
      ctx.strokeStyle = t.bgDark ? 'rgba(51,224,255,0.3)' : 'rgba(62,39,35,0.1)';
      ctx.stroke();
      // 左侧奖牌
      drawMedal(ctx, cx - L.rowW / 2 + 26 * u, y + L.cardH / 2, 15 * u, rankNo, u);
      // 头像徽章（笑脸）
      drawAvatarBadge(ctx, cx - L.rowW / 2 + 62 * u, y + L.cardH / 2, 14 * u, pc, { mode: 'face' });
      // 名字
      const aiTag = this.game.playerTypes && this.game.playerTypes[pi] === 'ai' ? ' · AI' : '';
      ctx.fillStyle = t.bgDark ? '#E6F5FF' : '#4A3123';
      ctx.font = `bold ${Math.round(15 * u)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`玩家${pi + 1}（${CN[pi % 4]}）${aiTag}`, cx - L.rowW / 2 + 82 * u, y + L.cardH / 2 + 5 * u);
      // 右对齐分数
      ctx.font = `900 ${Math.round(20 * u)}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(String(this._scoreOf(pi)), cx + L.rowW / 2 - 18 * u, y + L.cardH / 2 + 7 * u);
      y += L.gapY;
    });

    // ── 本局数据面板（4 行键值对；字段全部来自现有 game 状态，不新增状态）──
    roundRectPath(ctx, cx - L.rowW / 2, L.panelY, L.rowW, L.panelH, 14 * u);
    ctx.fillStyle = t.cardBg || (t.bgDark ? 'rgba(13,40,64,0.85)' : 'rgba(255,252,244,0.92)');
    ctx.fill();
    ctx.lineWidth = 1.2 * u;
    ctx.strokeStyle = t.bgDark ? 'rgba(51,224,255,0.3)' : 'rgba(62,39,35,0.1)';
    ctx.stroke();
    ctx.fillStyle = t.bgDark ? '#E6F5FF' : '#4A3123';
    ctx.font = `bold ${Math.round(16 * u)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('本局数据', cx - L.rowW / 2 + 18 * u, L.panelY + 27 * u);
    const sum = (key) => this.game.stats.reduce((acc, s) => acc + (s[key] || 0), 0);
    const rows = [
      // 无耗时字段 → 用「总落子」替代；无连锁统计 → 用「触磁次数」替代（不新增状态字段）
      ['总落子', this.game.totalPlaced || 0],
      ['吸附次数', sum('snappedAway') + sum('looted')],
      ['触磁次数', sum('fouls')],
      ['你的排名', ranks[this.myIndex] != null ? `第 ${ranks[this.myIndex]} 名` : '—'],
    ];
    rows.forEach(([k, v], i) => {
      const ry = L.panelY + 46 * u + i * 26 * u;
      // 行分隔线
      if (i > 0) {
        ctx.strokeStyle = t.bgDark ? 'rgba(230,245,255,0.12)' : 'rgba(62,39,35,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - L.rowW / 2 + 14 * u, ry - 12 * u);
        ctx.lineTo(cx + L.rowW / 2 - 14 * u, ry - 12 * u);
        ctx.stroke();
      }
      ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.6)' : '#8C8272';
      ctx.font = `${Math.round(13 * u)}px sans-serif`;
      ctx.fillText(k, cx - L.rowW / 2 + 18 * u, ry);
      ctx.fillStyle = t.bgDark ? '#E6F5FF' : '#4A3123';
      ctx.font = `bold ${Math.round(14 * u)}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(String(v), cx + L.rowW / 2 - 18 * u, ry);
      ctx.textAlign = 'left';
    });

    // ── 底部双按钮：再来一局（主）+ 分享（复用 onChallenge 回调）──
    drawButton(ctx, t, { ...L.replay, label: '再来一局', primary: true, pressed: this.press === 'replay' });
    drawButton(ctx, t, { ...L.share, label: '分享', pressed: this.press === 'share' });
    // 小字回首页（保留 onHome 回调接线；设计图未画，弱化呈现）
    ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.55)' : 'rgba(62,39,35,0.55)';
    ctx.font = `bold ${Math.round(14 * u)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('回 首 页', cx, L.home.y + 20 * u);
  }
}
