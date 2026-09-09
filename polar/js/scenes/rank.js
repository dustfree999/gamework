/**
 * 好友排行榜（微信开放数据域方案，零后端零套餐成本）
 *
 * 职责分工（官方开放数据域规范）：
 *  - 主域（本文件）：标题/返回按钮/榜单 tab 布局；每帧把开放数据域 sharedCanvas
 *    drawImage 到榜单面板区域；postMessage 下发布局尺寸与主题色板。
 *    主域受沙箱限制**不能**直接读好友数据，只能通过 sharedCanvas 展示。
 *  - 开放数据域（js/openDataContext/index.js，独立 bundle）：wx.onMessage 收指令，
 *    wx.getFriendCloudStorage 拉好友 KV 数据，排序取前 20 后自绘到 sharedCanvas。
 *
 * 指令协议（主域 → 开放数据域 postMessage，与开放数据域 index.js 对应）：
 *  - { cmd:'width', w, h, dpr, theme }  榜单面板内区物理像素尺寸 + 主题色板（只发一次）
 *  - { cmd:'sync',  kind, selfName }    kind='soloBest'|'wins'，触发开放数据域拉取/刷新
 *
 * 战绩上报见 ../core/stats.js（reportScore，需用户协议同意），此处 re-export 方便主域统一引入。
 *
 * ── main.js 接入说明（本次按约定不动 main.js，后续接入三步）──────────────────
 * 1) 引入：
 *      import RankScene, { reportScore } from './scenes/rank.js';
 * 2) 增加方法（与 showAbout 同款式）：
 *      showRank() {
 *        this.scene = new RankScene(ctx, { onBack: () => this.goHome() });
 *        this.sceneName = 'rank';
 *      }
 * 3) showResult(game) 中 this._recordStats(game); 之后调用：
 *      reportScore(game);   // 未同意用户协议时内部静默跳过
 * 4)（可选入口）HomeScene 构造回调增加 onRank 并在底部文字入口旁加「好友排行」，
 *    goHome() 里传 onRank: () => this.showRank()。注意：开放数据域目录
 *    js/openDataContext 下的代码主域不可 require/import，只能走 postMessage。
 * ──────────────────────────────────────────────────────────────────────────
 */
import { DPR } from '../render.js';
import { getTheme } from '../core/themes.js';
import { drawButton, drawBackground } from '../render/button.js';
import { roundRectPath, resetShadow } from '../render/board.js';
import { reportScore } from '../core/stats.js';
import { fetchGlobalRank } from '../net/profilesync.js';

export { reportScore }; // 主域可从本文件或 core/stats.js 引入战绩上报

/** 榜单 tab 定义：好友榜走开放数据域（微信 KV），全服榜走后端档案（小程序/H5 数据同源天然同步） */
const TABS = [
  { kind: 'soloBest', label: '单人最佳' },
  { kind: 'wins', label: '对战胜场' },
  { kind: 'global', label: '全服榜' },
];

export default class RankScene {
  constructor(ctx, { onBack } = {}) {
    this.ctx = ctx;
    this.onBack = onBack || (() => {});
    this.tapRects = [];
    this.pressRect = null;
    this.kind = TABS[0].kind; // 当前榜单
    this.global = null; // 全服榜数据 { me, board } | 'loading' | 'unavailable'
    // 开放数据域句柄与 sharedCanvas（H5/异常环境降级为占位文案）
    this.odc = null;
    this.shared = null;
    try {
      if (typeof wx !== 'undefined' && wx.getOpenDataContext) {
        this.odc = wx.getOpenDataContext();
        this.shared = this.odc && this.odc.canvas ? this.odc.canvas : null;
      }
    } catch (e) {
      this.odc = null;
      this.shared = null;
    }
    this._posted = false; // 首帧 render（布局尺寸确定）后才 postMessage 一次
  }

  /** 全服榜懒加载：首次切到该 tab 才请求（后端 profile:rank → 云函数/PG 统一） */
  _loadGlobal() {
    if (this.global && this.global !== 'unavailable') return;
    this.global = 'loading';
    fetchGlobalRank(20)
      .then((r) => { this.global = r || 'unavailable'; })
      .catch(() => { this.global = 'unavailable'; });
  }

  get theme() {
    return getTheme();
  }

  /** 布局单值：以 375 逻辑宽为基准的缩放系数（物理像素下自动×DPR），与 home.js 同口径 */
  _u() {
    return canvas.width / 375;
  }

  /**
   * 榜单面板布局（单处定义，render 与 postLayout 共用，防两处漂移）
   * @returns tabs 区与面板区坐标；x/y/w/h 为 sharedCanvas 目标内区（物理像素取整）
   */
  _panelInner(W, H, u) {
    const sidePad = 20 * u;
    const tabsY = 22 * u + 46 * u + 18 * u; // 顶栏高 46u + 间距
    const tabsH = 54 * u;
    const panelY = tabsY + tabsH + 18 * u;
    const panelH = H - panelY - 22 * u;
    const pad = 12 * u;
    return {
      tabsY, tabsH,
      panelX: sidePad, panelY, panelW: W - sidePad * 2, panelH,
      x: Math.round(sidePad + pad),
      y: Math.round(panelY + pad),
      w: Math.max(1, Math.round(W - (sidePad + pad) * 2)),
      h: Math.max(1, Math.round(panelH - pad * 2)),
    };
  }

  /** 下发布局尺寸 + 主题色板（sharedCanvas 尺寸由开放数据域自行设置） */
  _postLayout() {
    if (!this.odc) return;
    const inner = this._panelInner(canvas.width, canvas.height, this._u());
    const t = this.theme;
    try {
      this.odc.postMessage({
        cmd: 'width',
        w: inner.w,
        h: inner.h,
        dpr: DPR,
        theme: { // 只传色板子集（全部可 JSON 序列化），完整主题不必跨域传输
          id: t.id,
          bgDark: !!t.bgDark,
          textColor: t.textColor || '#4A3123',
          primaryColor: t.primaryColor || '#FF6B35',
          accentColor: t.accentColor || '#FF9F2E',
          warnColor: t.warnColor || '#FFB300',
        },
      });
    } catch (e) { /* 开发者工具异常时静默 */ }
  }

  /** 触发开放数据域拉取当前榜单 */
  _postSync() {
    if (!this.odc) return;
    try {
      this.odc.postMessage({ cmd: 'sync', kind: this.kind, selfName: '' }); // selfName 兜底位
    } catch (e) { /* 静默 */ }
  }

  touchStart(px, py) {
    for (const r of this.tapRects) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        if (r.id === 'back') {
          this.pressRect = r;
          this.onBack();
        } else if (r.id === 'tab') {
          this.pressRect = r;
          if (r.value !== this.kind) {
            this.kind = r.value;
            if (r.value === 'global') this._loadGlobal(); // 全服榜：懒加载后端
            else this._postSync(); // 好友榜：切换 → 通知开放数据域重新拉取
          }
        }
        return;
      }
    }
  }

  touchMove() {}

  touchEnd() {
    this.pressRect = null;
  }

  update() {}

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

    const L = this._panelInner(W, H, u);

    // ── 顶部：返回按钮 + 居中标题 ──
    const backW = 96 * u;
    const backH = 46 * u;
    const backY = 22 * u;
    const backPressed = this.pressRect && this.pressRect.id === 'back';
    drawButton(ctx, t, { x: 16 * u, y: backY, w: backW, h: backH, label: '‹ 返回', pressed: backPressed });
    ctx.fillStyle = t.textColor;
    ctx.font = `bold ${Math.round(23 * u)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(this.kind === 'global' ? '全服排行' : '好友排行', cx, backY + backH * 0.64);

    // ── 榜单切换 tab（选中橙底白字，样式对齐首页分段胶囊）──
    const gap = 10 * u;
    const tabW = (W - 16 * u * 2 - gap * (TABS.length - 1)) / TABS.length;
    this.tapRects = [{ id: 'back', x: 16 * u, y: backY, w: backW, h: backH }];
    TABS.forEach((tab, i) => {
      const x = 16 * u + i * (tabW + gap);
      const sel = tab.kind === this.kind;
      roundRectPath(ctx, x, L.tabsY, tabW, L.tabsH, L.tabsH / 2);
      ctx.fillStyle = sel
        ? (t.accentColor || '#FF9F2E')
        : (t.bgDark ? 'rgba(230,245,255,0.92)' : (t.cardBg || '#FFFDF4'));
      ctx.fill();
      if (!sel) {
        ctx.lineWidth = 1.5 * u;
        ctx.strokeStyle = t.bgDark ? 'rgba(51,224,255,0.4)' : 'rgba(62,39,35,0.16)';
        ctx.stroke();
      }
      ctx.fillStyle = sel ? '#FFFFFF' : (t.bgDark ? '#12314F' : '#4A3123');
      ctx.font = `bold ${Math.round(18 * u)}px sans-serif`;
      ctx.fillText(tab.label, x + tabW / 2, L.tabsY + L.tabsH / 2 + 6 * u);
      this.tapRects.push({ id: 'tab', value: tab.kind, x, y: L.tabsY, w: tabW, h: L.tabsH });
    });

    // ── 榜单面板底框（好友榜=开放数据域叠加；全服榜=后端数据主域自绘）──
    roundRectPath(ctx, L.panelX, L.panelY, L.panelW, L.panelH, 16 * u);
    ctx.fillStyle = t.bgDark ? 'rgba(13,40,64,0.55)' : 'rgba(255,252,244,0.72)';
    ctx.fill();
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = t.bgDark ? 'rgba(51,224,255,0.35)' : 'rgba(62,39,35,0.18)';
    ctx.stroke();

    if (this.kind === 'global') {
      this._renderGlobal(ctx, t, L, u, cx);
      return;
    }

    // 首帧布局就绪后下发布局与首次同步（只发一次；切 tab 时另发 sync）
    if (!this._posted) {
      this._posted = true;
      this._postLayout();
      this._postSync();
    }

    // ── 开放数据域 sharedCanvas 逐帧绘制（官方标准做法）──
    if (this.shared && this.shared.width === L.w && this.shared.height === L.h) {
      ctx.drawImage(this.shared, L.x, L.y, L.w, L.h);
    } else if (!this.shared) {
      // H5 / 无开放数据域环境兜底文案
      ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.6)' : '#8C8272';
      ctx.font = `${Math.round(15 * u)}px sans-serif`;
      ctx.fillText('当前环境不支持好友排行', cx, L.panelY + L.panelH / 2);
      ctx.fillText('可切「全服榜」看后端战绩（两端同步）', cx, L.panelY + L.panelH / 2 + 24 * u);
    }
  }

  /** 全服榜：后端 profiles（wins desc / bestScore desc），小程序与 H5 数据同源 */
  _renderGlobal(ctx, t, L, u, cx) {
    const g = this.global;
    ctx.save();
    ctx.textAlign = 'center';
    if (g === 'loading' || !g) {
      ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.6)' : '#8C8272';
      ctx.font = `${Math.round(15 * u)}px sans-serif`;
      ctx.fillText('正在加载全服榜…', cx, L.panelY + L.panelH / 2);
      ctx.restore();
      return;
    }
    if (g === 'unavailable') {
      ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.6)' : '#8C8272';
      ctx.font = `${Math.round(15 * u)}px sans-serif`;
      ctx.fillText('后端暂不可达，稍后再试', cx, L.panelY + L.panelH / 2);
      ctx.restore();
      return;
    }
    const rows = (g.board || []).slice(0, 12);
    if (!rows.length) {
      ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.6)' : '#8C8272';
      ctx.font = `${Math.round(15 * u)}px sans-serif`;
      ctx.fillText('还没有战绩——完成一局即可上榜', cx, L.panelY + L.panelH / 2);
      ctx.restore();
      return;
    }
    const rowH = Math.min(56 * u, (L.panelH - 24 * u) / (rows.length + (g.me ? 1 : 0)));
    const fmt = (row) => `${row.wins || 0} 胜 · 最佳 ${row.bestScore || 0}`;
    let y = L.y + rowH * 0.8;
    rows.forEach((row, i) => {
      ctx.font = `bold ${Math.round(16 * u)}px sans-serif`;
      ctx.fillStyle = t.bgDark ? 'rgba(51,224,255,0.8)' : (t.primaryColor || '#FF6B35');
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}`, L.x + 6 * u, y);
      ctx.fillStyle = t.textColor || '#4A3123';
      const nick = row.nick || '玩家' + String(row.openid || row.pid || '').slice(-4);
      ctx.fillText(nick.length > 10 ? nick.slice(0, 10) + '…' : nick, L.x + 34 * u, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.65)' : '#8C8272';
      ctx.fillText(fmt(row), L.x + L.w - 6 * u, y);
      y += rowH;
    });
    if (g.me) {
      y += 6 * u;
      ctx.font = `bold ${Math.round(14 * u)}px sans-serif`;
      ctx.fillStyle = t.accentColor || '#FF9F2E';
      ctx.fillText(`我的战绩：${g.me.wins || 0} 胜 · 最佳 ${g.me.bestScore || 0}`, cx, y);
    }
    ctx.restore();
  }
}
