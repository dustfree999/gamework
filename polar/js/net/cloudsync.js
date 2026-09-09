/**
 * CloudSync：联机房间客户端（微信云开发实现）——与 RoomSync（js/net/roomsync.js）完全同接口，
 * 上层（lobby / RoomSession）零改动切换：把 `new RoomSync({...})` 换成 `new CloudSync({...})` 即可。
 *
 * 与 ws relay 的关键差异——权威模型：
 *  - relay：主机客户端权威（房主本地跑 rules.js 校验并广播快照）
 *  - CloudSync：云函数权威（room 云函数服务端校验落子/驱动 AI，客户端只渲染快照）
 *    因此开局瞬间 isHost 一律翻转为 false：requestMove 走云函数 move，
 *    AI 座位由云函数代走（合并进同一次写库，不产生额外写次数）。
 *    lobby 阶段房主仍保持 isHost=true（开始对战 / 切 AI 位按钮）。
 *
 * onEvent(type, payload) 契约与 RoomSync 完全一致：
 *  room        { roomId, seat, roster, isHost }        进入房间（host/join 成功）
 *  roster      { roster }                              座位变化（roster: [{seat,type,name,host}]）
 *  left        { seat }                                有人离开 / 座位转 AI
 *  rehomed     { seat }                                房主移交（大厅阶段）
 *  peer        { from, ev, data }                      房间事件流（RoomSession 消费）：
 *                ev='started'  data={seed,mode,players,playerTypes}
 *                ev='moveAck'  data={game, lastMove}   （game = 云端权威完整快照）
 *  error       { msg }
 *  disconnected {}
 *
 * 传输：wx.cloud.callFunction({ name:'room' }) + db.collection('rooms').doc(roomId).watch
 * 断线自愈：watch onError → 退避重挂 + 立即 sync 拉平；对局中另有 20s 兜底轮询。
 * 降级：H5 / 未配置环境 ID → connect() reject，调用方回退本地 relay（RoomSync）或单机。
 */
export const CLOUDBASE_ENV_ID = ''; // ← 正式小游戏 wx-REDACTED 关联的云开发环境（个人主体，全新无配额问题；见 design/gdd/systems/cloudsync-deploy.md §9/§11）

import { tr } from '../i18n.js';

const PROTOCOL_VERSION = 1;   // 对齐 room 云函数 / js/net/protocol.js
const POLL_INTERVAL_MS = 20000;   // 对局中 sync 兜底轮询（停滞恢复 + watch 断线自愈）
const REWATCH_MAX_MS = 15000;     // watch 重挂退避上限

export class CloudSync {
  constructor({ env, onEvent, name } = {}) {
    this.env = env || CLOUDBASE_ENV_ID;
    this.onEvent = onEvent || (() => {}); // (type, payload)；注意 RoomSession 构造时会整体替换它
    this.name = name || tr('rank.player-default');
    this.db = null;
    this.openid = '';
    this.roomId = null;
    this.seat = 0; // 我的座位（1-4；0=未入房）
    this.roster = []; // [{seat,type:'human'|'ai'|'empty',name,host}]
    this.isHost = false;
    this._watcher = null;
    this._poll = 0;
    this._docVersion = 0;   // 文档级去重
    this._gameVersion = 0;  // moveAck 去重
    this._lastGame = null;
    this._started = false;
    this._closed = true;    // teardown 后置 true；_afterEnter 置 false
    this._rewatchTimer = 0;
    this._rewatchDelay = 1000;
  }

  // ───────────────────────────── 连接 ─────────────────────────────

  /**
   * 初始化 wx.cloud 并探活。失败场景（均 reject，调用方负责回退本地联机/单机）：
   *  - H5 / 非微信环境：'云开发未启用：当前环境不支持云开发…'
   *  - 未配置环境 ID：提示去 cloudsync.js 顶部改 CLOUDBASE_ENV_ID
   *  - 环境 ID 错误 / 云函数未部署：ping 超时或失败
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (typeof wx === 'undefined' || !wx.cloud) {
        reject(new Error(tr('net.cloud-disabled')));
        return;
      }
      if (!this.env || this.env === 'CLOUDBASE_ENV_ID') {
        reject(new Error(tr('net.cloud-env-missing')));
        return;
      }
      try {
        wx.cloud.init({ env: this.env, traceUser: true }); // 重复 init 同一 env 无害
      } catch (e) { /* 已初始化过则忽略 */ }
      this.db = wx.cloud.database();
      const timeout = setTimeout(() => reject(new Error(tr('net.cloud-timeout-env'))), 6000);
      this._call('ping')
        .then((r) => {
          clearTimeout(timeout);
          if (r && r.ok && r.proto === PROTOCOL_VERSION) resolve();
          else reject(new Error(tr('net.cloud-proto-mismatch', { p: (r && r.proto) })));
        })
        .catch((e) => {
          clearTimeout(timeout);
          reject(new Error(tr('net.cloud-connect-fail', { e: this._err(e) })));
        });
    });
  }

  // ───────────────────────────── 大厅 ─────────────────────────────

  /** 开房（对应 C2S.HOST）。结果经 onEvent('room') 通知，与 RoomSync 一致为 fire-and-forget */
  hostRoom(mode) {
    this._reset();
    this._call('host', { mode, name: this.name })
      .then((r) => this._afterEnter(r))
      .catch((e) => this._fail(tr('net.create-room-fail', { e: this._err(e) })));
  }

  /** 加入房间（对应 C2S.JOIN）。已在座时幂等重连（含对局中，云端自动回放 started/moveAck） */
  joinRoom(roomId) {
    this._reset();
    this._call('join', { roomId, name: this.name })
      .then((r) => this._afterEnter(r))
      .catch((e) => this._fail(tr('net.join-room-fail', { e: this._err(e) })));
  }

  /** 房主切换 AI 位（对应 C2S.SET_AI）。结果经 watch/响应 → roster 事件 */
  setSeatAi(seat, on) {
    if (!this.roomId) return;
    this._call('setAi', { roomId: this.roomId, seat, on })
      .then((r) => {
        if (r && r.ok) this._applyDoc(r);
        else this._fail((r && r.reason) || tr('net.set-ai-fail'));
      })
      .catch((e) => this._fail(tr('net.set-ai-fail-err', { e: this._err(e) })));
  }

  /** 离房（对应 C2S.LEAVE）。对局中云端会把该座位转为 AI 接管 */
  leave() {
    const roomId = this.roomId;
    this._teardown();
    if (roomId) {
      this._call('leave', { roomId }).catch(() => {}); // 尽力而为；状态由其他端 watch 感知
    }
    this.roomId = null;
    this.seat = 0;
    this.roster = [];
    this.isHost = false;
  }

  // ─────────────────────── 对局（RoomSession 消费）───────────────────────

  /**
   * 房间事件广播（对应 C2S 语义，RoomSession 调用）：
   *  - 'started'：云函数权威开局。传客户端提案 seed 保证与房主本地 createGame 同盘面；
   *    成功后 isHost 翻转为 false（此后所有人都是"非主机"路径，AI 由云端驱动）。
   *    开局被云端拒绝时恢复 isHost 并发 error 事件（上层应回到大厅）。
   *  - 'move'：转云函数 move（服务端校验）；任何响应（ok/foul/reject）都会回快照，
   *    强制发 moveAck 以清 RoomSession 的 pending 乐观锁。
   *  - 'moveAck'（relay 主机本地路径的残留调用）与其他自定义事件：云端模式下忽略。
   */
  broadcast(ev, data) {
    if (!this.roomId) return;
    if (ev === 'started') {
      this.isHost = false;
      this._call('start', {
        roomId: this.roomId,
        seed: data && data.seed,
        mode: data && data.mode,
        difficulty: data && data.difficulty, // 房主选择的 AI 难度透传（服务端 handleStart 支持 easy/normal/hard）
      })
        .then((r) => {
          if (r && r.ok) this._applyDoc(r);
          else {
            this.isHost = true; // 开局失败回大厅态
            this._started = false;
            this._fail((r && r.reason) || tr('net.start-fail'));
          }
        })
        .catch((e) => {
          this.isHost = true;
          this._started = false;
          this._fail(tr('net.start-fail-err', { e: this._err(e) }));
        });
      return;
    }
    if (ev === 'move') {
      const x = data && data.x;
      const y = data && data.y;
      this._call('move', { roomId: this.roomId, x, y })
        .then((r) => {
          if (r && r.game) this._emitMoveAck(r.game, !r.ok); // reject/foul 也发（清 pending）
          else { this._pullState(); this._unblockPendingSoon(); } // 服务端繁忙等无快照响应：拉平+兜底解锁
        })
        .catch(() => {
          this._pullState();
          this._unblockPendingSoon();
        });
      return;
    }
    // 其他事件：云端权威下无对等语义，忽略
  }

  /** 请求落子（接口对齐 RoomSync）。开局后 isHost 恒为 false → 都走云端 */
  requestMove(x, y) {
    if (this.isHost) return { local: true }; // 仅大厅阶段可能为 true；对齐 RoomSync 语义
    this.broadcast('move', { x, y, from: this.seat });
    return { local: false };
  }

  /** 拉平也无新版本时，用最后已知快照强制发 moveAck，解 RoomSession.pending 阻塞（防永久禁拖） */
  _unblockPendingSoon() {
    setTimeout(() => {
      if (this._started && this._lastGame) this._emitMoveAck(this._lastGame, true);
    }, 1500);
  }

  // ───────────────────────────── watch ─────────────────────────────

  _startWatch() {
    this._stopWatch();
    if (!this.db || !this.roomId) return;
    try {
      this._watcher = this.db.collection('rooms').doc(this.roomId).watch({
        onChange: (snap) => {
          const doc = (snap && snap.docs && snap.docs[0]) || (snap && snap.doc) || null;
          if (doc) {
            this._rewatchDelay = 1000;
            this._applyDoc(doc);
          }
        },
        onError: () => {
          this._stopWatch();
          if (this._closed || !this.roomId) return;
          this._emit('disconnected', {}); // 对齐 RoomSync 的 ws close 语义
          this._pullState();              // 断连期间先拉平一次
          this._scheduleRewatch();
        },
      });
    } catch (e) {
      this._scheduleRewatch();
    }
  }

  _stopWatch() {
    if (this._watcher) {
      try { this._watcher.close(); } catch (e) { /* 忽略 */ }
      this._watcher = null;
    }
  }

  _scheduleRewatch() {
    if (this._rewatchTimer || this._closed || !this.roomId) return;
    const delay = this._rewatchDelay;
    this._rewatchDelay = Math.min(this._rewatchDelay * 2, REWATCH_MAX_MS);
    this._rewatchTimer = setTimeout(() => {
      this._rewatchTimer = 0;
      if (this.roomId && !this._closed) this._startWatch();
    }, delay);
  }

  /** 兜底轮询：watch 断线自愈 + 触发云端停滞恢复（AFK 座位 45s 转 AI） */
  _startPoll() {
    this._stopPoll();
    this._poll = setInterval(() => {
      if (!this.roomId || this._closed) { this._stopPoll(); return; }
      this._pullState();
    }, POLL_INTERVAL_MS);
  }

  _stopPoll() {
    if (this._poll) {
      clearInterval(this._poll);
      this._poll = 0;
    }
  }

  _pullState() {
    if (!this.roomId || this._closed) return;
    this._call('sync', { roomId: this.roomId })
      .then((r) => {
        if (r && r.ok) this._applyDoc(r);
        // ⚠️ 硬耦合：服务端 reason 的「不存在|过期」中文为此解散判定依赖，
        //    本行正则不可翻译成英文（服务端 reason 保持中文原文，见 i18n 设计约束）。
        else if (r && /不存在|过期/.test((r && r.reason) || '')) {
          this._fail(r.reason);
          this._teardown(); // 房间已解散：停止 watch/轮询
        }
      })
      .catch(() => {});
  }

  // ───────────────────── 文档 → roomsync 事件流翻译 ─────────────────────

  _afterEnter(r) {
    if (!r || !r.ok) {
      this._fail((r && r.reason) || tr('net.enter-room-fail'));
      return;
    }
    this._closed = false;
    this.roomId = r.roomId;
    this.openid = r.openid || '';
    this.seat = r.seat || 0;
    this.roster = r.roster || [];
    this.isHost = !!(r.hostOpenid && r.hostOpenid === this.openid) && r.status === 'lobby';
    this._docVersion = r.version || 0;
    this._gameVersion = 0;
    this._lastGame = null;
    this._started = false;
    this._rewatchDelay = 1000;
    this._emit('room', { roomId: this.roomId, seat: this.seat, roster: this.roster, isHost: this.isHost });
    this._startWatch();
    this._startPoll();
    // 对局中重入（rejoin）：入房响应与 watch 首包同版本，会被 _applyDoc 的 doc.version
    // 去重吞掉 → 重入者卡大厅直到下一次写库。主动回放一次（started/moveAck 照常翻译）。
    this._docVersion = Math.max(0, (r.version || 1) - 1);
    this._applyDoc(r);
  }

  /** 文档（watch 推送 / 云函数响应）→ room/roster/left/rehomed/peer 事件流 */
  _applyDoc(doc) {
    if (!doc || this._closed) return;
    // 服务端 game 以 JSON 字符串存库（规避云数据库点展开写失败），watch 推送的是原始文档 → 这里还原
    if (typeof doc.game === 'string') { try { doc.game = JSON.parse(doc.game); } catch (e) { doc.game = null; } }
    const v = doc.version != null ? doc.version : this._docVersion;
    if (v && v <= this._docVersion) return; // 旧推送去重
    this._docVersion = v || this._docVersion;

    // 座位变化 → roster / left（开局压缩座位后服务端会重排，此处同步 my seat）
    const prev = this.roster;
    const roster = this._rosterFrom(doc);
    const prevOcc = new Map(prev.filter((s) => s.type !== 'empty').map((s) => [s.seat, s]));
    for (const s of roster) {
      const before = prevOcc.get(s.seat);
      if (before && (s.type === 'empty' || before.type !== s.type)) {
        this._emit('left', { seat: s.seat }); // 离开或对局中转 AI
      }
    }
    const sameRoster = prev.length === roster.length && prev.every((s, i) =>
      s.type === roster[i].type && s.name === roster[i].name && s.host === roster[i].host);
    this.roster = roster;
    const myIdx = (doc.seats || []).findIndex((s) => s && s.openid === this.openid);
    if (myIdx >= 0) this.seat = myIdx + 1;
    const wasHost = this.isHost;
    this.isHost = !!(doc.hostOpenid && doc.hostOpenid === this.openid) && doc.status === 'lobby';
    if (wasHost && !this.isHost && doc.status === 'lobby') {
      this._emit('rehomed', { seat: this._hostSeat(doc) }); // 房主移交（大厅阶段）
    }
    if (!sameRoster) this._emit('roster', { roster });

    // started / moveAck（RoomSession 消费的 peer 流）
    if (doc.status === 'playing' || doc.status === 'finished') {
      if (!this._started && doc.game) {
        this._started = true;
        this.isHost = false; // 云函数权威：开局后房主降级为普通客户端
        this._emit('peer', {
          from: this._hostSeat(doc),
          ev: 'started',
          data: {
            seed: doc.game.seed,
            mode: doc.game.mode,
            players: doc.game.playerCount,
            playerTypes: doc.game.playerTypes,
          },
        });
      }
      // force=true：doc.version 已推进（上面去重保证），即使 game.version 未变也要下发——
      // 离场转 AI/接管改写 playerTypes 不涨 game.version，若按版本去重会吞掉，
      // 对端 RoomSession.game 永远停在"该座位是人类"，死等一个不会动的人
      if (doc.game) this._emitMoveAck(doc.game, true);
    }
  }

  /** moveAck 翻译（版本去重；force=true 用于拒绝/超时后强制清 RoomSession.pending，但永不回退旧版本） */
  _emitMoveAck(game, force) {
    if (!game || this._closed) return;
    const v = game.version != null ? game.version : 0;
    if (v < this._gameVersion) return;
    if (!force && v === this._gameVersion) return;
    this._gameVersion = v;
    this._lastGame = game;
    this._emit('peer', {
      from: game.lastMove ? game.lastMove.owner + 1 : 0,
      ev: 'moveAck',
      data: { game, lastMove: game.lastMove },
    });
  }

  // ───────────────────────────── 内部 ─────────────────────────────

  _call(action, data) {
    return new Promise((resolve, reject) => {
      if (typeof wx === 'undefined' || !wx.cloud) {
        reject(new Error(tr('net.cloud-disabled')));
        return;
      }
      wx.cloud.callFunction({ name: 'room', data: Object.assign({ action }, data || {}) })
        .then((r) => resolve(r.result))
        .catch(reject);
    });
  }

  _rosterFrom(doc) {
    return (doc.seats || []).map((s, i) => {
      if (!s) return { seat: i + 1, type: 'empty', name: '', host: false };
      return {
        seat: i + 1,
        type: s.type,
        name: s.nick || (s.type === 'ai' ? tr('lobby.seat.ai') + '·' + (i + 1) : tr('rank.player-default') + (i + 1)),
        host: !!(s.openid && s.openid === doc.hostOpenid),
      };
    });
  }

  _hostSeat(doc) {
    const i = (doc.seats || []).findIndex((s) => s && s.openid === doc.hostOpenid);
    return i >= 0 ? i + 1 : 1;
  }

  _reset() {
    this._teardown();
    this.roomId = null;
    this.seat = 0;
    this.roster = [];
    this.isHost = false;
    this.openid = '';
    this._docVersion = 0;
    this._gameVersion = 0;
    this._lastGame = null;
    this._started = false;
  }

  _teardown() {
    this._closed = true;
    this._stopWatch();
    this._stopPoll();
    if (this._rewatchTimer) {
      clearTimeout(this._rewatchTimer);
      this._rewatchTimer = 0;
    }
  }

  _fail(msg) {
    this._emit('error', { msg });
  }

  _err(e) {
    return (e && (e.errMsg || e.message)) || String(e);
  }

  _emit(type, payload) {
    try {
      this.onEvent(type, payload);
    } catch (e) { /* 上层回调异常不阻断同步 */ }
  }
}
