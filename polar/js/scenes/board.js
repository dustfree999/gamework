/**
 * 对局场景：Canvas 输入 + 渲染整合（主题化）
 *  - 拖拽棋子（手牌区→棋盘）
 *  - 磁力预警（拖拽时实时光圈，主题化预警色）
 *  - 回合过场（轮到 Px 提示）
 *  - 吸附反馈三重奏：飞行动画 + 主题特效 + 震动/音效（经 main 注入）
 * 主题系统见 design/gdd/systems/theme-system.md
 */
import { COLORS, CONFIG } from '../core/config.js';
import { getTheme } from '../core/themes.js';
import { countSafeCells } from '../core/rules.js';
import { computeBoardGeom, gridToPx, pxToGrid, inBoard } from '../render/geometry.js';
import { drawBoardBase, drawPiece, drawMagnetField, drawSnapFx, resetShadow, roundRectPath } from '../render/board.js';
import { drawBackground } from '../render/button.js';
import {
  drawDashPath, drawMagnetWaves, drawAvatarBadge, drawShapeLegend, drawCountBadge, isLight,
} from '../render/decor.js';
import { SnapAnimator } from '../render/animation.js';
import { chooseMove } from '../ai/evaluator.js';

export default class BoardScene {
  constructor(ctx, gameState, { onExit, onFx, themeId, aiDifficulty = 'normal', onRules, session, onGameOver } = {}) {
    this.ctx = ctx;
    this.session = session || null;
    this.onGameOver = onGameOver || null; // 联机模式：RoomSession（主机权威/云端同步），gs 换成代理
    if (this.session) {
      const self = this;
      const sess = this.session;
      this._remoteGame = sess.game;
      this.gs = {
        get game() { return self._remoteGame; },
        place: (x, y) => sess.requestMove(x, y),
      };
      sess.onUpdate = (game) => self.applySnapshot(game);
      sess.onOver = (game) => { self.applySnapshot(game); if (self.onGameOver) self.onGameOver(game); };
    } else {
      this.gs = gameState;
    }
    this.onExit = onExit || (() => {});
    this.onRules = onRules || null;
    this.onFx = onFx || (() => {});
    this.themeId = themeId || getTheme().id;

    this.geom = null;
    this.dragging = false;
    this.drag = null;
    this.anim = new SnapAnimator(() => {});
    this.overlay = null;
    this.overlayUntil = 0;
    this.lastBoardSnapshot = [];
    this.shake = 0;
    this.time = 0;
    this.snapFx = null; // {x, y, t} 主题吸附特效
    this.foulMarks = []; // G14：致雷珠红描边 [{x,y}]
    this.foulMarkUntil = 0;
    this.aiThink = null; // AI 思考剩余时间（秒）
    this.aiAction = null; // { move, from, t } AI 落子飞行动画
    this.aiDifficulty = aiDifficulty;
    this._adoptedGame();
  }

  get theme() {
    return getTheme(this.themeId);
  }

  /** 联机：收到权威快照 → 更新渲染源，并对新变化播演出（落子/触磁动画统一走这里，touchEnd 不再重复播） */
  applySnapshot(game) {
    const prev = this._remoteGame;
    this._remoteGame = game;
    // 棋盘尺寸以权威快照为准：本地占位对局（开局瞬间）与云端压缩座位后的规格可能不同
    // （如 4 人占位 → 2 人正式局），几何不重算会把同一坐标画到不同格网上、边缘幻影格落点出界
    if (game && this.geom && (game.cols !== this.geom.cols || game.rows !== this.geom.rows)) {
      this.geom = computeBoardGeom(canvas.width, canvas.height, game.cols, game.rows);
      this.lastBoardSnapshot = (game.board || []).map((p) => ({ ...p })); // 旧像素位置作废，防跨网格误播动画
    }
    if (!prev || prev.version === game.version) return;
    const lm = game.lastMove;
    const target = lm ? { gx: lm.x, gy: lm.y } : null;
    this.lastBoardSnapshot = (prev.board || []).map((p) => ({ ...p })); // 动画飞行起点 = 变化前盘面
    if (lm && lm.type === 'foul') {
      this._onFoul(target, { hitIds: lm.hitIds });
      return;
    }
    // 云端权威：人类触磁后 AI 在同一次写库续手，lastMove 已被 AI 落子覆盖 →
    // 从盘面 diff 复原触磁演出（classic 中棋子离开盘面只可能是触磁回手）
    if (game.mode === 'classic') {
      const nowIds = new Set(game.board.map((p) => p.id));
      const gone = (prev.board || []).filter((p) => !nowIds.has(p.id));
      if (gone.length) {
        if (!target) { this.lastBoardSnapshot = game.board.map((p) => ({ ...p })); return; } // 无 lastMove 无法定位，静默同步盘面
        this._onFoul(target, { hitIds: gone.map((p) => p.id) });
        return;
      }
    }
    if (lm) this._onPlaced({ snapIds: lm.snapIds || [], hitIds: lm.hitIds || [] }, target);
  }

  /** 接住 game change 事件，更新拖拽后吸附动画源 */
  _adoptedGame() {
    this.geom = computeBoardGeom(canvas.width, canvas.height, this.gs.game.cols, this.gs.game.rows);
    this.lastBoardSnapshot = this.gs.game.board.map((p) => ({ ...p }));
  }

  /** 进入场景：布局 + 回合过场 */
  enter() {
    this._adoptedGame();
    this.overlay = this.gs.game.mode === 'solo' ? '安全落子得分 · 触磁即止' : this._turnLabel();
    this.overlayUntil = this.time + 1200;
  }

  /** 回合提示：联机按座位显示"你的回合/等待XX"，本地显示"轮到PX" */
  _turnLabel() {
    const g = this.gs.game;
    if (this.session) {
      const mine = g.turn + 1 === this.session.room.seat;
      const aiTurn = g.playerTypes[g.turn] === 'ai';
      if (mine) return '你的回合';
      if (aiTurn) return 'AI 思考中…';
      return `等待 P${g.turn + 1}`;
    }
    return '轮到 ' + this.playerLabel(g.turn);
  }

  playerLabel(idx) {
    const c = this.theme.playerColors[idx % 4];
    return c === COLORS.PLAYERS[idx % 4]
      ? c.name + ' · ' + this.ownerCn(idx)
      : 'P' + (idx + 1);
  }

  ownerCn(idx) {
    return ['红方', '青方', '绿方', '黄方'][idx % 4];
  }

  /** 触摸开始：返回键 → AI 回合封锁 → 手牌区/棋盘起拖 */
  touchStart(px, py) {
    // 返回键（屏幕左上圆形按钮）
    const u = this._u();
    const bx = 34 * u;
    const by = 34 * u;
    const br = 24 * u;
    if (Math.hypot(px - bx, py - by) <= br + 6 * u) {
      this.onExit();
      return;
    }
    // 右上"玩法"按钮：对局中查看规则
    const rx = canvas.width - 44 * u;
    const ry = 34 * u;
    if (Math.hypot(px - rx, py - ry) <= 26 * u) {
      if (this.onRules) this.onRules();
      return;
    }
    if (this.gs.game.over) return;
    // AI 回合禁止真人拖拽
    if (this.gs.game.playerTypes && this.gs.game.playerTypes[this.gs.game.turn] === 'ai') return;
    // 联机：非当前回合座位禁拖
    if (this.session && this.gs.game.turn + 1 !== this.session.room.seat) return;
    // 联机：上一手未确认（pending）禁起拖，松手才报 busy 手感割裂
    if (this.session && this.session.pending) return;
    const inHand = this.inHandArea(this.gs.game.turn, px, py);
    if (inHand || inBoard(this.geom, px, py)) {
      this.dragging = true;
      this.drag = { from: pxToGrid(this.geom, px, py), cur: { x: px, y: py } };
    }
  }

  touchMove(px, py) {
    if (!this.dragging) return;
    this.drag.cur = { x: px, y: py };
  }

  /** 系统打断（来电/touchcancel）：清拖拽状态，不落子、不触发动画 */
  cancelDrag() {
    this.dragging = false;
    this.drag = null;
    this.aiAction = null;
  }

  touchEnd(px, py) {
    if (!this.dragging) return;
    this.dragging = false;
    const target = pxToGrid(this.geom, px, py);
    const res = this.gs.place(target.gx, target.gy);
    if (this.session) {
      // 联机：表现统一由权威快照驱动（onUpdate→applySnapshot 播落子/触磁动画）。
      // requestMove 的返回没有 result 字段，这里绝不能再调 _onPlaced/_onFoul（会崩+双播）；
      // 只处理被拒的即时反馈。
      if (!res.ok && res.error === 'not-your-turn') {
        this.overlay = '还没轮到你'; this.overlayUntil = this.time + 800;
      } else if (!res.ok && res.error === 'busy') {
        this.overlay = '等待上一步确认…'; this.overlayUntil = this.time + 800;
      } else if (!res.ok && res.error === 'over') {
        this.overlay = '对局已结束'; this.overlayUntil = this.time + 800;
      }
    } else if (res.ok && res.foul) {
      this._onFoul(target, res.result);
    } else if (res.ok) {
      this._onPlaced(res.result, target);
    }
    this.drag = null;
  }

  /**
   * 触磁演出（收回规则）：粘连整组磁珠（跨归属）逐颗飞向手牌托盘 + 啪声 + 红描边脉冲。
   * result.hitIds = 被吸走的场上棋子；新子不落盘（由 rules 回手）。
   */
  _onFoul(target, result) {
    const hits = (result && result.hitIds) || [];
    const tray = { x: canvas.width / 2, y: this.trayY() + 28 * this._u() };
    const from = this.lastBoardSnapshot.map((p) => {
      const g = gridToPx(this.geom, p.x, p.y);
      return { ...p, px: g.x, py: g.y };
    });
    if (hits.length) {
      this.anim.start({ snapIds: hits }, from, tray, this.geom);
    }
    this.foulMarks = hits
      .map((id) => from.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({ x: p.px, y: p.py }));
    this.foulMarkUntil = this.time + 1500;
    this.shake = 5 * this.theme.snapIntensity;
    const toPx = gridToPx(this.geom, target.gx, target.gy);
    this.snapFx = { x: toPx.x, y: toPx.y, t: 0 };
    this.onFx('foul', null);
    this.overlay = hits.length > 1 ? `触磁！${hits.length + 1} 颗回手` : '触磁！回手重放';
    this.overlayUntil = this.time + 1100;
    this.lastBoardSnapshot = this.gs.game.board.map((p) => ({ ...p }));
  }

  _onPlaced(result, placedAt) {
    const lm = this.gs.game.lastMove || {};
    const type = lm.type || (result.snapIds && result.snapIds.length > 0 ? 'snap' : 'land');
    // 快照吸附前棋盘 → 供动画源（loot 捕获时旧子飞走）
    const fromSnapshot = this.lastBoardSnapshot.map((p) => {
      const g = gridToPx(this.geom, p.x, p.y);
      return { ...p, px: g.x, py: g.y };
    });
    const toPx = gridToPx(this.geom, placedAt.gx, placedAt.gy);
    this.lastBoardSnapshot = this.gs.game.board.map((p) => ({ ...p }));
    const captured = type === 'loot' && result.snapIds && result.snapIds.length > 0;
    if (captured) {
      this.anim.start(result, fromSnapshot, toPx, this.geom);
      this.snapFx = { x: toPx.x, y: toPx.y, t: 0 };
      this.shake = 4 * this.theme.snapIntensity;
    } else {
      this.shake = 0;
    }
    this.onFx(type, result);
    // 回合过场
    if (!this.gs.game.over) {
      this.overlay = this.gs.game.mode === 'solo' ? '' : this._turnLabel();
      this.overlayUntil = this.time + 1200;
    }
  }

  /** 手牌区：屏幕底部整条 */
  inHandArea(playerIdx, px, py) {
    const y0 = this.trayY();
    return py >= y0 - 20 * this._u();
  }

  _u() {
    return canvas.width / 375;
  }

  trayY() {
    return canvas.height - Math.max(60 * this._u(), canvas.height * 0.09);
  }

  update(dt) {
    if (!this.geom) return;
    this.time += dt * 1000;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 6);
    this.anim.update(dt, CONFIG.SNAP_SPEED);
    if (this.snapFx) {
      this.snapFx.t += dt * 2.4;
      if (this.snapFx.t >= 1) this.snapFx = null;
    }
    this.updateAI(dt);
  }

  /** AI 回合调度：思考延迟 → 选点 → 幽灵飞行动画 → 提交落子（联机模式跳过，AI 由主机/云端驱动） */
  updateAI(dt) {
    if (this.session) return;
    const g = this.gs.game;
    if (g.over) { this.aiThink = null; this.aiAction = null; return; }
    const aiTurn = g.playerTypes && g.playerTypes[g.turn] === 'ai';
    if (!aiTurn) { this.aiThink = null; return; }

    if (this.aiAction) {
      // 幽灵棋子飞行中
      this.aiAction.t += dt / CONFIG.AI_TWEEN;
      if (this.aiAction.t >= 1) {
        const mv = this.aiAction.move;
        this.aiAction = null;
        const ok = this.gs.place(mv.x, mv.y);
        if (ok.ok && ok.foul) this._onFoul({ gx: mv.x, gy: mv.y }, ok.result);
        else if (ok.ok) this._onPlaced(ok.result, { gx: mv.x, gy: mv.y });
      }
      return;
    }

    if (this.aiThink == null) {
      this.aiThink = CONFIG.AI_THINK_MIN + Math.random() * CONFIG.AI_THINK_JITTER;
      this.overlay = 'P' + (g.turn + 1) + ' (AI) 思考中…';
      this.overlayUntil = this.time + (this.aiThink + CONFIG.AI_TWEEN) * 1000;
    }
    this.aiThink -= dt;
    if (this.aiThink <= 0) {
      const mv = chooseMove(g, this.aiDifficulty);
      if (!mv) { this.aiThink = null; return; } // 棋盘无空格的理论兜底（触磁回手会腾空间，正常不会发生）
      const u = this._u();
      this.aiAction = {
        move: mv,
        from: { x: this.geom.originX + this.geom.bw * 0.5, y: this.trayY() + 28 * u },
        t: 0,
      };
    }
  }

  /** 绘制 AI 落子幽灵棋子 */
  renderAiGhost(ctx) {
    if (!this.aiAction) return;
    const a = this.aiAction;
    const to = gridToPx(this.geom, a.move.x, a.move.y);
    const e = 1 - Math.pow(1 - Math.min(1, a.t), 3); // easeOutCubic
    const x = a.from.x + (to.x - a.from.x) * e;
    const y = a.from.y + (to.y - a.from.y) * e;
    drawPiece(ctx, x, y, this.geom.cell * 0.34, this.gs.game.turn, this.theme);
  }

  render() {
    if (!this.geom) return;
    const ctx = this.ctx;
    const t = this.theme;
    const u = this._u();
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    resetShadow(ctx);
    drawBackground(ctx, t); // 主题背景
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    drawBoardBase(ctx, this.geom, t);

    // 磁力预警（拖拽中）+ 拖拽演出（虚线轨迹/同心磁力波）+ 被拖棋子本体（G8：捏珠跟手）
    if (this.dragging) {
      // 托盘 → 手指虚线轨迹（对照设计图金色虚线）
      const sx = this.geom.originX + 30 * u;
      const sy = this.trayY() + this.trayH() / 2;
      drawDashPath(ctx, sx, sy, this.drag.cur.x, this.drag.cur.y, t, u);
      drawMagnetField(ctx, this.geom, this.gs.game.board, this.drag.cur, CONFIG.SNAP_RADIUS, t, this.gs.game.mode);
      // 同心圆磁力波（2-3 圈扩散环）
      drawMagnetWaves(ctx, this.drag.cur.x, this.drag.cur.y, this.geom.cell * 0.36, this.time, t);
      ctx.save();
      ctx.globalAlpha = 0.95;
      drawPiece(ctx, this.drag.cur.x, this.drag.cur.y, this.geom.cell * 0.36, this.gs.game.turn, t);
      ctx.restore();
    }

    // 棋盘棋子
    const r = this.geom.cell * 0.34;
    for (const p of this.gs.game.board) {
      const px = gridToPx(this.geom, p.x, p.y);
      drawPiece(ctx, px.x, px.y, r, p.owner, t);
    }

    // 飞行吸附动画
    this.anim.render(ctx, (c, x, y, rr, owner) => drawPiece(c, x, y, rr, owner, t), r);

    // 主题吸附特效
    if (this.snapFx) {
      drawSnapFx(ctx, t, this.snapFx.x, this.snapFx.y, this.snapFx.t);
    }
    // G14：致雷珠红描边（1.5s 持续）
    if (this.foulMarks.length && this.time < this.foulMarkUntil) {
      ctx.save();
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 3 * this._u();
      const pulse = 1 + 0.08 * Math.sin(this.time / 90);
      for (const m of this.foulMarks) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, this.geom.cell * 0.42 * pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 当前玩家手牌托盘
    this.renderHand(ctx, r);

    // 玩家带（顶部）
    this.renderPlayers(ctx);

    // 返回键（左上）+ 玩法按钮（右上）
    this.renderBack(ctx, u);
    this.renderRulesBtn(ctx, u);
    // AI 落子幽灵
    this.renderAiGhost(ctx);

    // 回合过场：居中圆角药丸（不遮挡棋盘）
    if (this.overlay && this.time < this.overlayUntil) {
      const u = this._u();
      ctx.font = `bold ${Math.round(24 * u)}px sans-serif`;
      const tw = typeof ctx.measureText === 'function' ? ctx.measureText(this.overlay).width : this.overlay.length * 24 * u;
      const pw = tw + 44 * u;
      const ph = 52 * u;
      const px = (canvas.width - pw) / 2;
      const py = canvas.height * 0.32;
      ctx.save();
      roundRectPath(ctx, px, py, pw, ph, ph / 2);
      ctx.fillStyle = t.bgDark ? 'rgba(13,27,42,0.88)' : 'rgba(62,39,35,0.82)';
      ctx.fill();
      ctx.fillStyle = t.bgDark ? '#E6F5FF' : '#FFF8EC';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.overlay, canvas.width / 2, py + ph / 2 + 1);
      ctx.restore();
      ctx.textBaseline = 'alphabetic';
    }

    ctx.restore();
  }

  renderHand(ctx, r) {
    const geom = this.geom;
    const t = this.theme;
    const u = this._u();
    const solo = this.gs.game.mode === 'solo';
    const turn = this.gs.game.turn;
    const remain = solo ? this.gs.game.stats[turn].placed : this.gs.game.hands[turn];
    const y = this.trayY();
    const x0 = geom.originX + 6 * u;
    const w = geom.bw - 12 * u;
    const h = this.trayH() - 6 * u;
    const pc = t.playerColors[turn % 4];
    // 托盘条：浅色圆角卡（对照设计图底部白托盘）
    ctx.save();
    ctx.globalAlpha = 0.14;
    roundRectPath(ctx, x0, y + 4 * u, w, h, h / 2);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.restore();
    roundRectPath(ctx, x0, y, w, h, h / 2);
    ctx.fillStyle = t.cardBg || (t.bgDark ? 'rgba(13,40,64,0.88)' : 'rgba(255,252,244,0.94)');
    ctx.fill();
    ctx.lineWidth = 1.5 * u;
    ctx.strokeStyle = t.bgDark ? 'rgba(51,224,255,0.35)' : 'rgba(62,39,35,0.12)';
    ctx.stroke();
    const midY = y + h / 2;
    // 左：「你（红）」小标签（浅底上亮色字自动切深 accent 保对比）
    const cn = ['红', '青', '绿', '黄'][turn % 4];
    const labelCol = !t.bgDark && isLight(pc.color) ? pc.accent : pc.color;
    ctx.fillStyle = labelCol;
    ctx.font = `bold ${Math.round(15 * u)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`你（${cn}）`, x0 + 16 * u, midY + 5 * u);
    // 中：四形状图例（圆/方/三角/菱，当前玩家色）
    drawShapeLegend(ctx, x0 + w * 0.52, midY, 9 * u, pc.color, pc.accent);
    // 右：数量圆徽章
    drawCountBadge(ctx, x0 + w - 24 * u, midY, 13 * u, remain, t, u);
  }

  trayH() {
    return canvas.height - this.trayY();
  }

  /** 顶部玩家带：圆形头像徽章横排（主题色底+白色数字），当前回合金环高亮 */
  renderPlayers(ctx) {
    const geom = this.geom;
    const t = this.theme;
    const u = this._u();
    const g = this.gs.game;
    const n = g.playerCount;
    const y = geom.originY - 34 * u;
    const slotW = geom.bw / n;
    const r = Math.min(16 * u, slotW * 0.3);
    ctx.font = `bold ${Math.round(10 * u)}px sans-serif`;
    for (let i = 0; i < n; i += 1) {
      const x = geom.originX + slotW * i + slotW / 2;
      const active = i === g.turn && !g.over;
      const pc = t.playerColors[i % 4];
      const num = g.mode === 'solo' ? g.stats[i].placed : g.hands[i];
      drawAvatarBadge(ctx, x, y, r, pc, { mode: 'text', label: num, active });
      // 当前回合：金色高亮环
      if (active) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5 * u, 0, Math.PI * 2);
        ctx.strokeStyle = t.warnColor;
        ctx.lineWidth = 2 * u;
        ctx.stroke();
        ctx.restore();
      }
      // P 标签（AI 标注）
      ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.55)' : 'rgba(62,39,35,0.55)';
      ctx.textAlign = 'center';
      ctx.fillText('P' + (i + 1) + (g.playerTypes[i] === 'ai' ? '·AI' : ''), x, y + r + 14 * u);
    }
    // G9：安全格数 HUD（盘面磁力密度直观化：越少越容易触磁回手）
    if (g.mode === 'classic') {
      const safeN = countSafeCells(g);
      ctx.textAlign = 'center';
      ctx.fillStyle = safeN <= 4 ? '#FF3B30' : safeN <= 8 ? '#FFB300' : (t.bgDark ? 'rgba(230,245,255,0.55)' : 'rgba(62,39,35,0.55)');
      ctx.font = `bold ${Math.round(13 * u)}px sans-serif`;
      ctx.fillText('安全格 ' + safeN, geom.originX + geom.bw / 2, y - r - 10 * u);
    }
  }

  /** 玩法按钮：右上圆形"?"，对局中随时查规则 */
  renderRulesBtn(ctx, u) {
    const t = this.theme;
    const x = canvas.width - 44 * u;
    const y = 34 * u;
    const r = 22 * u;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = t.bgDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.75)';
    ctx.fill();
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = t.playerColors[0].color;
    ctx.stroke();
    ctx.fillStyle = t.playerColors[0].color;
    ctx.font = `bold ${Math.round(22 * u)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x, y + 1 * u);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /** 返回键：左上圆形按钮，主题描边 + 左箭头 */
  renderBack(ctx, u) {
    const t = this.theme;
    const x = 34 * u;
    const y = 34 * u;
    const r = 22 * u;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = t.bgDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.75)';
    ctx.fill();
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = t.playerColors[0].color;
    ctx.stroke();
    // 左箭头
    ctx.beginPath();
    ctx.moveTo(x + r * 0.35, y - r * 0.42);
    ctx.lineTo(x - r * 0.35, y);
    ctx.lineTo(x + r * 0.35, y + r * 0.42);
    ctx.closePath();
    ctx.fillStyle = t.playerColors[0].color;
    ctx.fill();
    ctx.restore();
  }
}