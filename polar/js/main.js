/**
 * 主入口：场景状态机 + 主循环 + 触摸分发 + 音效/震动
 * 取代原打飞机 main.js。
 */
import './render.js'; // 初始化 Canvas（物理像素）+ 导出 DPR
import { DPR } from './render.js';
import { GameState } from './core/state.js';
import HomeScene from './scenes/home.js';
import BoardScene from './scenes/board.js';
import ResultScene from './scenes/result.js';
import { AboutScene, AgreementOverlay, RulesScene } from './scenes/legal.js';
import LobbyScene from './scenes/lobby.js';
import RankScene, { reportScore } from './scenes/rank.js';
import { uploadProfile } from './net/profilesync.js';
import { extractChallenge, encodeChallenge } from './net/challenge.js';
import { RoomSync } from './net/roomsync.js';
import { CloudSync, CLOUDBASE_ENV_ID } from './net/cloudsync.js';
import { PgSync } from './net/pgsync.js';
import { RoomSession } from './net/roomsess.js';

const CLOUD_READY = typeof wx !== 'undefined' && !!wx.cloud && CLOUDBASE_ENV_ID && CLOUDBASE_ENV_ID !== 'CLOUDBASE_ENV_ID';

const ctx = canvas.getContext('2d');

// 全局可复用音频（短音效，主包内）
const AUDIO = {
  snap: wx.createInnerAudioContext(),
  land: wx.createInnerAudioContext(),
};
try {
  AUDIO.snap.src = 'audio/snap.wav';
  AUDIO.land.src = 'audio/land.wav';
  AUDIO.snap.volume = 0.8;
  AUDIO.land.volume = 0.5;
} catch (e) {
  // 模拟器无音频文件时静默降级
}

/** G10：本地战绩（胜场/连胜/单人最佳）——纯本地零成本，云开发后可上传合并 */
function loadStats() {
  try {
    const raw = wx.getStorageSync('polar_stats');
    return raw ? JSON.parse(raw) : { wins: 0, losses: 0, streak: 0, bestStreak: 0, soloBest: 0, plays: 0 };
  } catch (e) {
    return { wins: 0, losses: 0, streak: 0, bestStreak: 0, soloBest: 0, plays: 0 };
  }
}
function saveStats(st) {
  try { wx.setStorageSync('polar_stats', JSON.stringify(st)); } catch (e) { /* 忽略 */ }
}

export default class Main {
  constructor() {
    this.scene = null;
    this.sceneName = '';
    this.aniId = 0;
    this.last = Date.now();
    this.gameState = null;
    this.lastOpts = { vsAI: false, difficulty: 'normal' };
    this.shareCode = null; // 最近一次生成的挑战码（分享 query 用）
    this.agreement = null; // 首次启动用户协议弹窗（未同意前拦截输入）
    this.homeScene = null; // 关于页返回目标

    if (!this._agreedBefore()) this.agreement = new AgreementOverlay(ctx, { onAgree: () => this._onAgree() });
    this._consumeTransportQuery();
    this.goHome();
    this._consumeLaunchChallenge();
    this.bindTouch();
    this.aniId = requestAnimationFrame(this.loop.bind(this));
    // 调试钩子：自动化测试用（automator evaluate 驱动/读状态），不影响游戏逻辑
    GameGlobal.__polar = {
      main: this,
      dispatchTouch: (type, x, y) => {
        // 与 bindTouch 同路径：协议弹窗优先拦截
        if (this.agreement) {
          if (type === 'start') this.agreement.touchStart(x, y);
          return;
        }
        const scene = this.scene;
        if (type === 'start') scene.touchStart(x, y);
        else if (type === 'move') scene.touchMove(x, y);
        else scene.touchEnd(x, y);
      },
      state: () => this.gameState && this.gameState.game,
      sceneName: () => this.sceneName,
    };
  }

  goHome() {
    this.scene = new HomeScene(ctx, {
      onStart: (players, mode, opts) => this.startGame(players, mode, opts),
      onAbout: () => this.showAbout(),
      onRules: () => this.showRules(),
      getStats: () => this.getStats(),
      onRank: () => this.showRank(),
      onJoin: (code) => { if (code) this._joinRoom(String(code).toUpperCase()); },
    });
    this.scene.onJoin = (code) => { if (code) this._joinRoom(String(code).toUpperCase()); };
    this.homeScene = this.scene;
    this.sceneName = 'home';
    if (this._pendingChallenge) {
      this.scene.applyChallenge(this._pendingChallenge);
      this._pendingChallenge = null;
    }
    this._registerShare();
  }

  showAbout() {
    this.scene = new AboutScene(ctx, { onBack: () => this.goHome() });
    this.sceneName = 'about';
  }

  showRules() {
    this.scene = new RulesScene(ctx, { onBack: () => this.goHome() });
    this.sceneName = 'rules';
  }

  /** 对局中查看规则：看完返回对局（gameState 保留） */
  showRulesBack() {
    const board = this.scene;
    this.scene = new RulesScene(ctx, { onBack: () => { this.scene = board; this.sceneName = 'board'; } });
    this.sceneName = 'rules';
  }

  _agreedBefore() {
    try { return !!wx.getStorageSync('polar_agreed'); } catch (e) { return false; }
  }

  _onAgree() {
    try { wx.setStorageSync('polar_agreed', '1'); } catch (e) { /* 忽略 */ }
    this.agreement = null;
  }

  /** 启动参数解析：好友经分享卡片/口令进入挑战（微信 query 或 H5 ?c=） */
  _consumeLaunchChallenge() {
    let query = null;
    try {
      if (typeof wx !== 'undefined' && wx.getLaunchOptionsSync) {
        query = wx.getLaunchOptionsSync().query || null;
      }
    } catch (e) { /* 忽略 */ }
    if (!query && typeof location !== 'undefined') {
      const m = /[?&]c=([^&]+)/.exec(location.search || '');
      if (m) query = { c: decodeURIComponent(m[1]) };
    }
    const ch = extractChallenge(query);
    if (ch) this._pendingChallenge = ch;
    // 房间邀请：?r=房号 → 自动进大厅加入
    try {
      const rm = query && query.r ? query.r : (typeof location !== 'undefined' && /[?&]r=([A-Z0-9]+)/.exec(location.search || ''));
      const roomId = typeof rm === 'string' ? rm : (rm && rm[1] ? rm[1] : null);
      if (roomId) setTimeout(() => this._joinRoom(String(roomId).toUpperCase()), 800);
    } catch (e) { /* 忽略 */ }
  }

  /** 分享：带最近挑战码，好友点开即应战 */
  _registerShare() {
    try {
      if (typeof wx !== 'undefined' && wx.onShareAppMessage) {
        wx.onShareAppMessage(() => ({
          title: this.shareCode
            ? '我在磁极对决留了个局，来打破我的纪录！'
            : '磁极对决——放完手中磁珠且不触发磁吸者胜',
          query: this.shareCode ? 'c=' + this.shareCode : '',
        }));
        wx.showShareMenu && wx.showShareMenu({ withShareTicket: false });
      }
    } catch (e) { /* 开发者工具/无分享能力时忽略 */ }
  }

  /** 挑战好友：编码本局成绩 → 复制口令 + 触发分享 */
  onChallenge(game, myIndex = 0) {
    const hi = myIndex;
    const code = encodeChallenge({
      mode: game.mode,
      players: game.playerCount,
      difficulty: game.mode === 'solo' ? 'normal' : (this.lastOpts.difficulty || 'normal'),
      steps: game.stats[hi].placed, // solo 语义=得分
      fouls: game.stats[hi].fouls,
      looted: game.scored[hi],
      seed: game.seed, // G6：同盘比拼——好友打开打同一张图
    });
    this.shareCode = code;
    try {
      if (typeof wx !== 'undefined' && wx.setClipboardData) {
        wx.setClipboardData({ data: `磁极对决挑战码 ${code}` });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(`磁极对决挑战码 ${code}`).catch(() => {});
      }
      wx.shareAppMessage && wx.shareAppMessage({ query: 'c=' + code });
    } catch (e) { /* 静默 */ }
  }

  startGame(players, mode, opts = {}) {
    this.lastOpts = { vsAI: !!opts.vsAI, difficulty: opts.difficulty || 'normal' };
    if (opts.roomMode) { this.enterRoom(mode); return; }
    const playerTypes = mode === 'solo'
      ? ['human']
      : opts.vsAI
        ? Array.from({ length: players }, (_, i) => (i === 0 ? 'human' : 'ai'))
        : null;
    this.gameState = new GameState({
      playerCount: players,
      mode,
      seed: opts.seed, // G6：挑战码/同盘重试携带种子（undefined 则随机）
      playerTypes,
      onUpdate: (game, result) => this.onGameUpdate(game, result),
      onOver: (game) => this.showResult(game),
    });
    this.scene = new BoardScene(ctx, this.gameState, {
      onExit: () => this.goHome(),
      onFx: (type) => this.playFx(type),
      aiDifficulty: opts.difficulty || 'normal',
      onRules: () => this.showRulesBack(),
    });
    this.sceneName = 'board';
    this.scene.enter();
  }

  /**
   * 传输强制开关（跨端同房必备）：H5 无法调用云函数（仅微信内可达），
   * 微信端与 H5 端要进同一房间，必须都走自托管 PgSync（同一后端）。
   * 启动参数或存储：t=pg|cloud（强制传输）、pgrelay=host:port（自托管地址）、pgtoken=口令。
   * 开发者工具用法：编译模式启动参数填 t=pg&pgrelay=127.0.0.1:8911；真机预览可先 console 执行
   *   wx.setStorageSync('polar_transport','pg')。不设置则维持「云函数优先」默认策略。
   */
  _consumeTransportQuery() {
    let query = null;
    try {
      if (typeof wx !== 'undefined' && wx.getLaunchOptionsSync) query = wx.getLaunchOptionsSync().query || null;
    } catch (e) { /* 忽略 */ }
    const get = (k) => {
      if (query && query[k]) return String(query[k]);
      try {
        if (typeof location !== 'undefined' && location.search) {
          const m = new RegExp('[?&]' + k + '=([^&]+)').exec(location.search);
          if (m) return decodeURIComponent(m[1]);
        }
      } catch (e) { /* 非 H5 */ }
      return '';
    };
    try {
      if (typeof wx !== 'undefined' && wx.setStorageSync) {
        const t = get('t'); if (t === 'pg' || t === 'cloud' || t === 'relay') wx.setStorageSync('polar_transport', t);
        const pr = get('pgrelay'); if (pr) wx.setStorageSync('polar_pgrelay', pr);
        const pt = get('pgtoken'); if (pt) wx.setStorageSync('polar_pgtoken', pt);
      }
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 传输选择（按可用性依次回退，接口三者完全一致）：
   *  0. 强制开关 polar_transport=t（见 _consumeTransportQuery；跨端同房时微信端设 pg）
   *  1. CloudSync —— 云函数权威（默认主通道，仅微信内）
   *  2. PgSync —— 自托管服务器权威（PostgreSQL，H5 唯一在线通道）
   *  3. RoomSync —— 本地 ws relay（开发机/局域网测试最后兜底）
   * 返回 Promise<sync>；全部失败时 reject，调用方回单机。
   */
  _makeRoomTransport(name) {
    const pgThenLocal = (why) => {
      console.warn('[room] ' + why);
      let pg;
      try { pg = new PgSync({ name }); } catch (e) { return Promise.reject(e); } // 静态托管无中继时构造即抛（_roomFail 负责提示）
      return pg.connect()
        .then(() => { console.log('[room] 传输 = PgSync（自托管权威）'); return pg; })
        .catch(() => this._localTransport(name).then((s) => { console.log('[room] 传输 = RoomSync（本地 relay）'); return s; }));
    };
    let forced = '';
    try { if (typeof wx !== 'undefined' && wx.getStorageSync) forced = wx.getStorageSync('polar_transport') || ''; } catch (e) { /* 忽略 */ }
    if (forced === 'pg') return pgThenLocal('强制 PgSync（跨端同房）');
    if (forced === 'relay') return this._localTransport(name).then((s) => { console.log('[room] 传输 = RoomSync（强制 relay）'); return s; });
    if (CLOUD_READY) {
      const cloudRoom = new CloudSync({ name });
      return cloudRoom.connect()
        .then(() => { console.log('[room] 传输 = CloudSync（云函数权威）'); return cloudRoom; })
        .catch((e) => pgThenLocal('云开发不可用（环境未关联/配额/未部署），回退自托管：' + (e && e.message ? e.message : e)));
    }
    return pgThenLocal('非微信环境，跳过云开发');
  }

  _localTransport(name) {
    const local = new RoomSync({ name });
    return local.connect().then(() => local);
  }

  /** 联机：创建房间 → 大厅 */
  enterRoom(mode) {
    this.roomMode = mode || 'classic';
    this._makeRoomTransport('我').then((sync) => {
      this.roomSync = sync;
      sync.onEvent = (type, p) => this._roomEvent(type, p);
      sync.hostRoom(this.roomMode);
      this._openLobby(sync);
    }).catch((e) => this._roomFail(e));
  }

  /** 联机：输入房号加入 */
  promptJoin() {
    let code = '';
    try {
      if (typeof wx !== 'undefined' && wx.showKeyboard) {
        wx.showKeyboard({ defaultValue: '', maxLength: 6, multiple: false, confirmHold: false, confirmType: 'done' });
        wx.onKeyboardComplete && wx.onKeyboardComplete((res) => { if (res.value) this._joinRoom(String(res.value).toUpperCase()); });
        return;
      }
    } catch (e) { /* 走 H5 分支 */ }
    if (typeof window !== 'undefined' && window.prompt) {
      code = window.prompt('输入好友给的房间号（6 位）', '');
      if (code) this._joinRoom(code.trim().toUpperCase());
    }
  }

  _joinRoom(roomId) {
    this._makeRoomTransport('我').then((sync) => {
      this.roomSync = sync;
      sync.onEvent = (type, p) => this._roomEvent(type, p);
      sync.joinRoom(roomId);
      this._openLobby(sync);
    }).catch((e) => this._roomFail(e));
  }

  _openLobby(sync) {
    this.scene = new LobbyScene(ctx, {
      room: sync,
      onLeave: () => { sync.leave(); this.roomSync = null; this.goHome(); },
      onInvite: (roomId) => this._inviteFriend(roomId),
      onStart: () => this._startRoomBattle(),
    });
    this.sceneName = 'lobby';
  }

  _roomEvent(type, p) {
    if (type === 'error') {
      if (this.sceneName === 'lobby') {
        // 加入失败（房间已满/不存在/连接断开）：阻塞式提示，点"回首页"退出
        if (this.scene.showFatal) this.scene.showFatal(p.msg || '连接失败');
        else { this.roomSync = null; this.goHome(); }
      } else if (this.sceneName === 'board' && this.roomSync && this.roomSync.isHost === true && this.roomSync._started === false) {
        // 云端开局被拒（竞态：唯一同伴在 RPC 前离开）且已进 board → 回大厅提示，防幽灵局。
        // 仅 CloudSync/PgSync 有此信号（失败恢复 isHost=true、_started=false）；relay 主机权威不会走到这。
        const msg = p.msg || '开局失败';
        if (this.roomSession.dispose) this.roomSession.dispose();
        this.roomSession = null;
        this._openLobby(this.roomSync);
        if (this.scene.showToast) this.scene.showToast(msg);
      }
    }
    // 大厅阶段收到房主 started → 非主机自动进入房间对局（同盘面）
    if (type === 'peer' && p.ev === 'started' && !this.roomSession && this.sceneName === 'lobby') {
      const session = new RoomSession({ room: this.roomSync, aiDifficulty: this.lastOpts.difficulty });
      this.roomSession = session;
      session._begin(p.data);
      this._switchToRoomBoard(session);
    }
    // 已在对局中：move/moveAck 由 RoomSession 处理（链式 onEvent 双播）
  }

  _roomFail(e) {
    this.roomSync = null;
    this.goHome();
    const msg = (e && e.message) ? e.message : String((e && e.errMsg) || e || '联机连接失败');
    console.warn('[room] 连接失败：', msg);
    try { wx.showToast({ title: msg, icon: 'none', duration: 3500 }); } catch (err) { /* 无 toast 能力则仅 console */ }
  }

  /** 分享邀请：H5 复制链接带 ?r=房号；微信走分享卡片 query */
  _inviteFriend(roomId) {
    try {
      if (typeof wx !== 'undefined' && wx.setClipboardData) {
        wx.setClipboardData({ data: `磁极对决房间号：${roomId}（打开小游戏输入房号加入）` });
        wx.shareAppMessage && wx.shareAppMessage({ query: `r=${roomId}` });
      } else if (typeof window !== 'undefined' && window.location && navigator.clipboard) {
        const link = `${window.location.origin}${window.location.pathname}?r=${roomId}`;
        navigator.clipboard.writeText(link).catch(() => {});
      }
    } catch (e) { /* 静默 */ }
    if (this.scene.showToast) this.scene.showToast(`房号 ${roomId} 已复制，发给好友吧`);
  }

  /** 大厅"开始对战" → 房间对局 */
  _startRoomBattle() {
    const sync = this.roomSync;
    const session = new RoomSession({
      room: sync,
      aiDifficulty: this.lastOpts.difficulty,
    });
    this.roomSession = session;
    if (sync.isHost) session.start(sync.roster, this.roomMode);
    // 非主机等 started 事件（RoomSession 内处理）→ 统一切 board 场景
    this._switchToRoomBoard(session);
  }

  _switchToRoomBoard(session) {
    this.gameState = { game: session.game }; // 占位，board 用 session 代理
    this.scene = new BoardScene(ctx, null, {
      onExit: () => { if (this.roomSync) this.roomSync.leave(); this.roomSync = null; this.roomSession = null; this.goHome(); },
      onFx: (type) => this.playFx(type),
      aiDifficulty: this.lastOpts.difficulty,
      onRules: () => this.showRulesBack(),
      session,
      onGameOver: () => this.showResult(session.game),
    });
    this.sceneName = 'board';
    this.scene.enter();
  }

  showRank() {
    this.scene = new RankScene(ctx, { onBack: () => this.goHome() });
    this.sceneName = 'rank';
  }

  showResult(game) {
    // 联机时本地座位 = roomSession.room.seat-1（可能 2-4 号位）；本地局人类恒 0 号位
    const myIndex = this.roomSession && this.roomSession.room
      ? (this.roomSession.room.seat || 1) - 1
      : 0;
    this._recordStats(game, myIndex);
    reportScore(game, myIndex); // 好友排行榜上报（微信 KV，未同意协议/H5 静默跳过）
    uploadProfile(game, { myIndex }); // 后端档案落库（云函数 profile → 自托管 PG，未同意协议静默跳过；双端共用同一份）
    this.scene = new ResultScene(ctx, game, {
      myIndex, // 结算页「你的排名」按真实座位展示
      onReplay: () => this.startGame(game.playerCount, game.mode, {
        vsAI: game.playerTypes && game.playerTypes.includes('ai'),
        difficulty: this.lastOpts.difficulty,
        seed: game.seed, // G10：同盘重试（solo 复仇不换图）
      }),
      onHome: () => this.goHome(),
      onChallenge: (g) => this.onChallenge(g, myIndex),
    });
    this.sceneName = 'result';
  }

  /** G10：终局记战绩（solo=最佳分；对战=本地座位胜/连胜。myIndex=联机真实座位，本地局 0） */
  _recordStats(game, myIndex = 0) {
    const st = loadStats();
    st.plays += 1;
    if (game.mode === 'solo') {
      const score = (game.stats[myIndex] || game.stats[0]).placed;
      if (score > st.soloBest) { st.soloBest = score; st._newRecord = true; }
    } else if (game.winner >= 0) {
      if (game.winner === myIndex) { st.wins += 1; st.streak += 1; if (st.streak > st.bestStreak) st.bestStreak = st.streak; }
      else { st.losses += 1; st.streak = 0; }
    }
    saveStats(st);
    this.lastRecord = st._newRecord || false;
  }

  getStats() { return loadStats(); }

  onGameUpdate() {
    // 由 BoardScene 内部处理动画触发；此处预留状态同步钩子（未来 NetSync）
  }

  playFx(type) {
    try {
      if (type === 'snap' || type === 'loot' || type === 'foul') {
        AUDIO.snap.stop();
        AUDIO.snap.play();
        wx.vibrateShort({ type: type === 'foul' ? 'heavy' : 'medium' });
      } else if (type === 'land') {
        AUDIO.land.stop();
        AUDIO.land.play();
      }
    } catch (e) {
      // 静默降级（开发者工具/无音频权限）
    }
  }

  bindTouch() {
    // 触摸坐标为逻辑 px，画布为物理 px（× DPR），统一映射后分发
    // 用户协议弹窗优先：未同意前拦截一切输入
    wx.onTouchStart((e) => {
      if (this.agreement) {
        if (e.touches && e.touches.length > 0) this.agreement.touchStart(e.touches[0].clientX * DPR, e.touches[0].clientY * DPR);
        return;
      }
      if (e.touches && e.touches.length > 0) {
        this.scene.touchStart(e.touches[0].clientX * DPR, e.touches[0].clientY * DPR);
      }
    });
    wx.onTouchMove((e) => {
      if (e.touches && e.touches.length > 0) {
        this.scene.touchMove(e.touches[0].clientX * DPR, e.touches[0].clientY * DPR);
      }
    });
    wx.onTouchEnd((e) => {
      if (e.changedTouches && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        this.scene.touchEnd(t.clientX * DPR, t.clientY * DPR);
      } else {
        this.scene.touchEnd(0, 0);
      }
    });
    // 系统手势/来电打断：清拖拽状态，防恢复后一次轻点被当落子（touchcancel 语义）
    if (typeof wx.onTouchCancel === 'function') {
      wx.onTouchCancel(() => {
        if (this.scene && this.scene.cancelDrag) this.scene.cancelDrag();
      });
    }
  }

  loop() {
    const now = Date.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    try {
      if (this.roomSession) this.roomSession.update(dt); // 联机：驱动主机 AI 座位落子
      this.scene.update(dt);
      this.scene.render();
      if (this.agreement) this.agreement.render();
    } catch (err) {
      // 单帧渲染异常不杀死主循环（错误仍上报 console 供 E2E 捕获）
      console.error('[loop] render error:', err && err.message ? err.message : err);
    }

    this.aniId = requestAnimationFrame(this.loop.bind(this));
  }
}