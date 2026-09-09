/**
 * 首页：标题「磁极对决」、主题选择器（三主题即时预览+持久化）、人数选择、开战
 * 布局全程比例自适应（任意分辨率/DPR 不溢出、不错位）。
 * 视觉还原 design/design.png：双珠 logo + 渐变大字/副标题 + 图文主题小卡（✓角标）
 * + 图标玩法胶囊 + 人数小胶囊 + 星芒果冻开战钮 + 背景漂浮物。
 * 主题系统见 design/gdd/systems/theme-system.md
 */
import { getTheme, saveTheme, THEMES, THEME_IDS } from '../core/themes.js';
import { drawButton, drawBackground } from '../render/button.js';
import { roundRectPath, resetShadow } from '../render/board.js';
import { tr, getLang, setLang } from '../i18n.js';
import {
  drawLogo, drawTitle, drawSubtitle, drawThemeCard,
  drawModeCapsule, drawSparkle, themeName,
} from '../render/decor.js';

export default class HomeScene {
  constructor(ctx, { onStart, onAbout, onRules, getStats, onRank } = {}) {
    this.ctx = ctx;
    this.onStart = onStart || (() => {});
    this.onAbout = onAbout || null;
    this.onRules = onRules || null;
    this.getStats = getStats || null;
    this.onRank = onRank || null;
    this.onJoin = null; // main 注入（加入房间，参数=6位房号）
    this.joinOpen = false; // 画布内房号输入面板
    this.joinCode = '';
    this.joinErr = '';
    this.joinErrUntil = 0;
    this.time = 0;
    this.players = 2;
    this.gameMode = 'classic'; // classic 经典踩雷 / loot 磁吸夺宝
    this.vsAI = true; // 对战玩法默认人机（同屏已升级为联机房间）
    this.battleMode = 'ai'; // ai=人机对战 room=创建房间邀请好友
    this.difficulty = 'normal';
    this.challenge = null; // 好友挑战 {mode,players,difficulty,steps,fouls}
    this.themeId = getTheme().id;
    this.lang = getLang(); // 当前界面语言（右上按钮切换）
    this.tapRects = [];
    this.pressRect = null;
  }

  /** 切换界面语言（写 storage；渲染帧自动刷新） */
  _toggleLang() {
    this.lang = this.lang === 'en' ? 'zh' : 'en';
    setLang(this.lang);
  }

  get theme() {
    return THEMES[this.themeId];
  }

  /** 载入好友挑战：锁定其配置（玩法/人数/难度），真人接手应战 */
  applyChallenge(ch) {
    if (!ch) return;
    this.challenge = ch;
    this.seed = ch.seed != null ? ch.seed : null; // G6：同盘比拼
    this.gameMode = ch.mode;
    this.players = ch.mode === 'solo' ? 1 : ch.players;
    if (ch.mode !== 'solo') this.vsAI = true;
    this.difficulty = ch.difficulty;
  }

  /** 布局单值：以 375 逻辑宽为基准的缩放系数（物理像素下自动×DPR） */
  _u() {
    return canvas.width / 375;
  }

  _panelTap(r) {
    if (r.id === 'jkey') { if (this.joinCode.length < 6) this.joinCode += r.value; }
    else if (r.id === 'jdel') { this.joinCode = this.joinCode.slice(0, -1); }
    else if (r.id === 'jcancel') { this.joinOpen = false; }
    else if (r.id === 'jok') {
      if (this.joinCode.length === 6 && this.onJoin) { this.onJoin(this.joinCode.toUpperCase()); this.joinOpen = false; }
      else { this.joinErr = tr('home.join.err-incomplete'); this.joinErrUntil = this.time + 1600; }
    }
  }

  touchStart(px, py) {
    // 面板打开：只响应面板热区
    if (this.joinOpen) {
      for (let i = this.tapRects.length - 1; i >= 0; i -= 1) {
        const r = this.tapRects[i];
        if (!String(r.id).startsWith('j')) continue;
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) { this._panelTap(r); return; }
      }
      return;
    }
    for (const r of this.tapRects) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        if (r.id === 'players') this.players = r.value;
        else if (r.id === 'gamemode') this.gameMode = r.value;
        else if (r.id === 'mode') { this.battleMode = r.value; this.vsAI = r.value === 'ai'; }
        else if (r.id === 'difficulty') this.difficulty = r.value;
        else if (r.id === 'join') { this.joinOpen = true; this.joinCode = ''; }
        else if (r.id === 'rank') { if (this.onRank) this.onRank(); }
        else if (r.id === 'start') {
          this.pressRect = r;
          const players = this.gameMode === 'solo' ? 1 : this.players;
          this.onStart(players, this.gameMode, {
            vsAI: this.vsAI, difficulty: this.difficulty, challenge: this.challenge, seed: this.seed,
            roomMode: this.battleMode === 'room',
          });
          return;
        } else if (r.id === 'about') {
          if (this.onAbout) this.onAbout();
        } else if (r.id === 'rules') {
          if (this.onRules) this.onRules();
        } else if (r.id === 'theme') {
          this.themeId = r.value;
          saveTheme(this.themeId);
        } else if (r.id === 'lang') {
          this._toggleLang();
        }
        break;
      }
    }
  }

  touchMove() {}

  touchEnd() {
    this.pressRect = null;
  }

  /** 系统打断：清按压态（与 touchEnd 同效） */
  cancelDrag() {
    this.pressRect = null;
  }

  update(dt) { this.time += dt * 1000; }

  render() {
    const ctx = this.ctx;
    const t = this.theme;
    const W = canvas.width;
    const H = canvas.height;
    const u = this._u();
    const cx = W / 2;
    ctx.clearRect(0, 0, W, H);
    resetShadow(ctx);
    drawBackground(ctx, t);

    // ═══ 纵向流式布局：自上而下排列，杜绝重叠 ═══
    // 内容总高估算 → 纵向自适应缩放 vs（小屏整体压缩，杜绝溢出）
    const solo = this.gameMode === 'solo';
    const base = {
      titleH: 104 * u, secGap: 34 * u, labelH: 30 * u, cardH: 84 * u,
      segH: 46 * u, optH: 62 * u, diffH: 42 * u, hintH: 26 * u, btnH: 76 * u, chH: 44 * u,
    };
    const diffBlock0 = (!solo && this.vsAI) ? base.labelH + base.diffH + base.secGap * 0.7 : 0;
    const gmBlock0 = base.labelH + base.segH + base.secGap;
    const vsBlock0 = solo ? 0 : base.labelH + base.segH + base.secGap;
    const playersBlock0 = solo ? 0 : base.labelH + base.optH + base.secGap;
    const chBlock0 = this.challenge ? base.chH + base.secGap * 0.5 : 0;
    const totalH0 = base.titleH + base.secGap + base.labelH + base.cardH + base.secGap
      + chBlock0 + gmBlock0
      + vsBlock0
      + playersBlock0
      + diffBlock0
      + base.hintH + base.secGap * 0.7 + base.btnH + 30 * u;
    const availH = H - base.titleH; // 上下各留半标题高
    const vs = Math.min(1, availH / totalH0);
    const titleH = base.titleH * vs, secGap = base.secGap * vs, labelH = base.labelH * vs;
    const cardH = base.cardH * vs, segH = base.segH * vs, optH = base.optH * vs;
    const diffH = base.diffH * vs, hintH = base.hintH * vs, btnH = base.btnH * vs, chH = base.chH * vs;
    const uv = u * vs; // 标题区内部尺寸随 vs 压缩，避免小屏溢出
    let y = Math.max(titleH * 0.9, (H - totalH0 * vs) / 2);

    // ── 标题区：3D 双珠 logo + 渐变大字 + 副标题（对照设计图首页顶部）──
    drawLogo(ctx, cx, y + titleH * 0.22, 44 * uv, t);
    drawTitle(ctx, cx, y + titleH * 0.76, t, uv);
    drawSubtitle(ctx, cx, y + titleH * 0.99, t, uv);
    // G10：战绩速览条（胜场/连胜/单人最佳）
    if (this.getStats) {
      const st = this.getStats();
      if (st && (st.plays > 0)) {
        const statText = tr('home.stats', { w: st.wins, s: st.streak, b: st.soloBest });
        ctx.save();
        ctx.font = `bold ${Math.round(13 * uv)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.55)' : 'rgba(62,39,35,0.5)';
        ctx.fillText(statText, cx, y + titleH * 0.99 + 22 * uv);
        ctx.restore();
      }
    }
    y += titleH + secGap;

    const mGap = 16 * u;
    // ── 主题选择（三张图文小卡：缩略画面 + 名称 + 选中✓角标）──
    ctx.font = `bold ${Math.round(19 * u)}px sans-serif`;
    ctx.fillStyle = t.textColor;
    ctx.fillText(tr('home.theme-title'), cx, y + labelH * 0.8);
    y += labelH;
    const sidePad = 24 * u;
    const gap = 12 * u;
    const cardW = (W - sidePad * 2 - gap * (THEME_IDS.length - 1)) / THEME_IDS.length;
    let tx = sidePad;
    this.tapRects = [];
    // ── 右上角语言切换按钮（EN/中；标题区右上 void，不占流式布局；tapRects 重置后注册）──
    const lw = 46 * uv;
    const lh2 = 24 * uv;
    const lx = W - lw - 10 * uv;
    const ly = 12 * uv;
    roundRectPath(ctx, lx, ly, lw, lh2, lh2 / 2);
    ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.92)' : 'rgba(62,39,35,0.9)';
    ctx.fill();
    ctx.fillStyle = t.bgDark ? '#12314F' : '#FFFFFF';
    ctx.font = `bold ${Math.round(15 * uv)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(tr('legal.lang-en'), lx + lw / 2, ly + lh2 / 2 + 5 * uv);
    this.tapRects.push({ id: 'lang', x: lx, y: ly, w: lw, h: lh2 });
    THEME_IDS.forEach((id) => {
      const sel = this.themeId === id;
      drawThemeCard(ctx, tx, y, cardW, cardH, id, sel, t, u);
      this.tapRects.push({ id: 'theme', value: id, x: tx, y, w: cardW, h: cardH });
      tx += cardW + gap;
    });
    y += cardH + secGap;

    // ── 好友挑战横幅 ──
    if (this.challenge) {
      const ch = this.challenge;
      roundRectPath(ctx, sidePad, y, W - sidePad * 2, chH, 10 * u);
      ctx.fillStyle = t.bgDark ? 'rgba(255,214,0,0.15)' : 'rgba(255,179,0,0.18)';
      ctx.fill();
      ctx.strokeStyle = '#FFB300';
      ctx.lineWidth = 1.5 * u;
      ctx.stroke();
      ctx.fillStyle = t.textColor;
      ctx.font = `bold ${Math.round(15 * u)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(
        ch.mode === 'solo'
          ? tr('home.challenge-solo', { n: ch.steps })
          : tr('home.challenge-multi', { p: ch.players, n: ch.steps, f: ch.fouls }),
        cx, y + chH * 0.63);
      y += chH + secGap * 0.5;
    }

    // ── 玩法选择（两胶囊 + 圆形图标徽章：交叉剑 / 机器人头）──
    ctx.font = `bold ${Math.round(19 * u)}px sans-serif`;
    ctx.fillStyle = t.textColor;
    ctx.fillText(tr('home.gamemode-title'), cx, y + labelH * 0.8);
    y += labelH;
    const gW = 150 * u;
    let gx2 = cx - (2 * gW + mGap) / 2;
    [
      { v: 'classic', label: tr('home.mode.duel'), icon: 'swords' },
      { v: 'solo', label: tr('home.mode.solo'), icon: 'robot' },
    ].forEach((gm) => {
      const sel = this.gameMode === gm.v;
      drawModeCapsule(ctx, gx2, y, gW, segH, gm.label, gm.icon, sel, t, u);
      this.tapRects.push({ id: 'gamemode', value: gm.v, x: gx2, y, w: gW, h: segH });
      gx2 += gW + mGap;
    });
    y += segH + secGap;

    // ── 对战方式（仅对战玩法）：人机 or 创建房间邀请好友 ──
    if (!solo) {
      ctx.font = `bold ${Math.round(19 * u)}px sans-serif`;
      ctx.fillStyle = t.textColor;
      ctx.fillText(tr('home.battlemode-title'), cx, y + labelH * 0.8);
      y += labelH;
      const mSegW = 150 * u;
      let mx = cx - (2 * mSegW + mGap) / 2;
      [{ v: 'ai', label: tr('home.mode.vsai'), icon: 'robot' }, { v: 'room', label: tr('home.mode.room'), icon: 'swords' }].forEach((m) => {
        const sel = this.battleMode === m.v;
        drawModeCapsule(ctx, mx, y, mSegW, segH, m.label, m.icon, sel, t, u);
        this.tapRects.push({ id: 'mode', value: m.v, x: mx, y, w: mSegW, h: segH });
        mx += mSegW + mGap;
      });
      y += segH + secGap;

      // ── 玩家人数（横排三小胶囊，选中橙底白字，对照设计图）──
      ctx.font = `bold ${Math.round(19 * u)}px sans-serif`;
      ctx.fillStyle = t.textColor;
      ctx.fillText(tr('home.players-title'), cx, y + labelH * 0.8);
      y += labelH;
      const optW = 72 * u;
      const optGap = 20 * u;
      const totalW = 3 * optW + 2 * optGap;
      [2, 3, 4].forEach((n, i) => {
        const x = cx - totalW / 2 + i * (optW + optGap);
        const sel = this.players === n;
        roundRectPath(ctx, x, y, optW, optH, optH / 2);
        ctx.fillStyle = sel ? (t.accentColor || '#FF9F2E') : (t.bgDark ? 'rgba(230,245,255,0.92)' : (t.cardBg || '#FFFDF4'));
        ctx.fill();
        if (!sel) {
          ctx.lineWidth = 1.5 * u;
          ctx.strokeStyle = t.bgDark ? 'rgba(51,224,255,0.4)' : 'rgba(62,39,35,0.16)';
          ctx.stroke();
        }
        ctx.fillStyle = sel ? '#FFFFFF' : (t.bgDark ? '#12314F' : '#4A3123');
        // 英文「2P/3P/4P」比「2人」更短，兼容同布局
        ctx.font = `bold ${Math.round(25 * u)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(tr('home.players-count', { n }), x + optW / 2, y + optH / 2 + 9 * u);
        this.tapRects.push({ id: 'players', value: n, x, y, w: optW, h: optH });
      });
      y += optH + secGap;
    }

    // ── AI 难度（人机模式才显示）──
    if (!solo && this.vsAI) {
      ctx.font = `bold ${Math.round(19 * u)}px sans-serif`;
      ctx.fillStyle = t.textColor;
      ctx.fillText(tr('home.ai-difficulty'), cx, y + labelH * 0.8);
      y += labelH + secGap * 0.15;
      const dW = 96 * u;
      const dGap = 14 * u;
      let dx = cx - (3 * dW + 2 * dGap) / 2;
      [['easy', tr('home.difficulty.easy')], ['normal', tr('home.difficulty.normal')], ['hard', tr('home.difficulty.hard')]].forEach(([key, label]) => {
        const sel = this.difficulty === key;
        roundRectPath(ctx, dx, y, dW, diffH, diffH / 2);
        ctx.fillStyle = sel ? (t.accentColor || '#FF9F2E') : (t.bgDark ? 'rgba(230,245,255,0.92)' : (t.cardBg || '#FFFDF4'));
        ctx.fill();
        ctx.fillStyle = sel ? '#FFFFFF' : (t.bgDark ? '#12314F' : '#4A3123');
        ctx.font = `bold ${Math.round(17 * u)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(label, dx + dW / 2, y + diffH / 2 + 6 * u);
        this.tapRects.push({ id: 'difficulty', value: key, x: dx, y, w: dW, h: diffH });
        dx += dW + dGap;
      });
      y += diffH + secGap * 0.6;
    }

    // ── 玩法说明 ──
    ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.6)' : '#8C8272';
    ctx.font = `${Math.round(15 * u)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(
      solo ? tr('home.hint.solo') : tr('home.hint.multi'),
      cx, y + hintH * 0.7);
    y += hintH + secGap * 0.7;

    // ── 开战按钮（大果冻胶囊 + 两侧星芒，对照设计图）──
    const bw = 236 * u;
    const pressed = this.pressRect && this.pressRect.id === 'start';
    drawButton(ctx, t, { x: cx - bw / 2, y, w: bw, h: btnH, label: solo ? tr('home.mode.solo') : tr('home.start'), primary: true, pressed });
    const sc = t.accentColor || '#FF9F2E';
    drawSparkle(ctx, cx - bw / 2 - 18 * u, y + btnH * 0.28, 9 * u, sc, 0.9);
    drawSparkle(ctx, cx - bw / 2 - 32 * u, y + btnH * 0.66, 5 * u, sc, 0.65);
    drawSparkle(ctx, cx + bw / 2 + 18 * u, y + btnH * 0.28, 9 * u, sc, 0.9);
    drawSparkle(ctx, cx + bw / 2 + 32 * u, y + btnH * 0.66, 5 * u, sc, 0.65);
    this.tapRects.push({ id: 'start', x: cx - bw / 2, y, w: bw, h: btnH });

    // ── 底部入口：玩法说明 / 关于（合规：原创声明）──
    ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.55)' : 'rgba(62,39,35,0.55)';
    ctx.font = `bold ${Math.round(14 * u)}px sans-serif`;
    ctx.fillText(tr('home.btn.rules'), cx - 138 * u, y + btnH + 26 * u);
    ctx.fillText(tr('home.btn.rank'), cx - 46 * u, y + btnH + 26 * u);
    ctx.fillText(tr('home.btn.join'), cx + 46 * u, y + btnH + 26 * u);
    ctx.fillText(tr('home.btn.about'), cx + 138 * u, y + btnH + 26 * u);
    this.tapRects.push({ id: 'rules', x: cx - 186 * u, y: y + btnH + 10 * u, w: 90 * u, h: 26 * u });
    this.tapRects.push({ id: 'rank', x: cx - 92 * u, y: y + btnH + 10 * u, w: 90 * u, h: 26 * u });
    this.tapRects.push({ id: 'join', x: cx + 2 * u, y: y + btnH + 10 * u, w: 90 * u, h: 26 * u });
    this.tapRects.push({ id: 'about', x: cx + 92 * u, y: y + btnH + 10 * u, w: 90 * u, h: 26 * u });

    // ═══ 加入房间：画布内房号输入面板（微信/H5 通用，替代被拦截的 prompt）═══
    if (this.joinOpen) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      const pw = W * 0.92;
      const ph = 470 * u;
      const px = (W - pw) / 2;
      const py = (H - ph) / 2;
      roundRectPath(ctx, px, py, pw, ph, 18 * u);
      ctx.fillStyle = t.bgDark ? '#12314F' : '#FFFDF4';
      ctx.fill();
      ctx.strokeStyle = t.accentColor || '#FF9F2E';
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      ctx.fillStyle = t.textColor;
      ctx.font = `bold ${Math.round(22 * u)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tr('home.join.title'), cx, py + 36 * u);
      // 6 格房号
      const slotW = (pw - 60 * u - 5 * 8 * u) / 6;
      const slotH = 46 * u;
      let sx = px + 30 * u;
      const sy = py + 54 * u;
      for (let i = 0; i < 6; i += 1) {
        roundRectPath(ctx, sx, sy, slotW, slotH, 8 * u);
        ctx.fillStyle = t.bgDark ? 'rgba(255,255,255,0.08)' : '#F3EBDA';
        ctx.fill();
        if (i === this.joinCode.length) {
          ctx.strokeStyle = t.accentColor || '#FF9F2E';
          ctx.lineWidth = 2 * u;
          ctx.stroke();
        }
        ctx.fillStyle = t.textColor;
        ctx.font = `bold ${Math.round(24 * u)}px monospace`;
        ctx.fillText(this.joinCode[i] || '', sx + slotW / 2, sy + 31 * u);
        sx += slotW + 8 * u;
      }
      // 键盘（去易混 32 字符，8×4 行）
      const KEYS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const kCols = 8;
      const kgap = 5 * u;
      const kw = (pw - 24 * u - (kCols - 1) * kgap) / kCols;
      const kh = 46 * u;
      for (let i = 0; i < KEYS.length; i += 1) {
        const col = i % kCols;
        const row = Math.floor(i / kCols);
        const kx = px + 12 * u + col * (kw + kgap);
        const ky = sy + slotH + 16 * u + row * (kh + 7 * u);
        roundRectPath(ctx, kx, ky, kw, kh, 8 * u);
        ctx.fillStyle = t.bgDark ? 'rgba(255,255,255,0.12)' : '#EEE5D4';
        ctx.fill();
        ctx.fillStyle = t.textColor;
        ctx.font = `bold ${Math.round(18 * u)}px sans-serif`;
        ctx.fillText(KEYS[i], kx + kw / 2, ky + kh / 2 + 6 * u);
        this.tapRects.push({ id: 'jkey', value: KEYS[i], x: kx, y: ky, w: kw, h: kh });
      }
      // 功能行：删除 / 取消 / 加入
      const fy = sy + slotH + 16 * u + 4 * (kh + 7 * u) + 4 * u;
      const fw = (pw - 24 * u - 2 * 10 * u) / 3;
      const fh = 52 * u;
      roundRectPath(ctx, px + 12 * u, fy, fw, fh, 10 * u);
      ctx.fillStyle = t.bgDark ? 'rgba(255,255,255,0.12)' : '#EEE5D4';
      ctx.fill();
      ctx.fillStyle = t.textColor;
      ctx.font = `bold ${Math.round(17 * u)}px sans-serif`;
      ctx.fillText(tr('home.join.backspace'), px + 12 * u + fw / 2, fy + fh / 2 + 6 * u);
      this.tapRects.push({ id: 'jdel', x: px + 12 * u, y: fy, w: fw, h: fh });
      const cxx = px + 12 * u + fw + 10 * u;
      ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.55)' : '#8C8272';
      ctx.fillText(tr('home.join.cancel'), cxx + fw / 2, fy + fh / 2 + 6 * u);
      this.tapRects.push({ id: 'jcancel', x: cxx, y: fy, w: fw, h: fh });
      const okx = cxx + fw + 10 * u;
      roundRectPath(ctx, okx, fy, fw, fh, 10 * u);
      ctx.fillStyle = t.accentColor || '#FF9F2E';
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(tr('home.join.ok'), okx + fw / 2, fy + fh / 2 + 6 * u);
      this.tapRects.push({ id: 'jok', x: okx, y: fy, w: fw, h: fh });
      if (this.joinErr && this.time < this.joinErrUntil) {
        ctx.fillStyle = '#FF3B30';
        ctx.font = `bold ${Math.round(14 * u)}px sans-serif`;
        ctx.fillText(this.joinErr, cx, py + ph - 10 * u);
      }
    }
  }
}
