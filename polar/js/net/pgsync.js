/**
 * PgSync：联机房间客户端（自托管服务器权威版，PostgreSQL 持久化）
 *
 * 与 CloudSync 的关系：直接继承，**事件翻译/快照去重/兜底轮询全部复用**，
 * 只替换传输层三个方法：
 *   _call(action,data)  : wx.cloud.callFunction → ws JSON-RPC {id,action,...} → {id,result}
 *   _startWatch/_stopWatch : db.collection.watch → {t:'watch'}/{t:'unwatch'} + 服务端推送 {t:'doc'}
 *   connect()           : wx.cloud.init+ping → ws 连接 + hello 握手 + ping
 *
 * 身份：设备 pid（本地存储持久化的 16 位随机串，替代 openid）。
 * 上层（RoomSession / lobby / board）零改动——接口与 RoomSync/CloudSync 完全一致。
 *
 * 服务器地址解析（优先级）：
 *   1. H5 URL 参数 ?pgrelay=host:port（或完整 ws://…）
 *   2. https 页面自动连同源 wss://location.host（域名反代场景，免配置）
 *   3. 本地存储 polar_pgrelay
 *   4. 默认 DEFAULT_URL（自托管 CVM 上的 pgserver.js）
 * 可选连接口令 ?pgtoken= / 存储 polar_pgtoken（服务端 PGRELAY_GUARD 启用时必填）。
 *
 * 降级：环境无 WebSocket / 连接失败 → connect() reject，main.js 自动回退
 * CloudSync（微信+云配额可用时）或 RoomSync（本地 relay）。
 */
import { CloudSync, CLOUDBASE_ENV_ID } from './cloudsync.js';
import { createWebSocket } from './wscompat.js';

const DEFAULT_URL = 'ws://43.138.126.226:8911';

function readStore(key) {
  try { if (typeof wx !== 'undefined' && wx.getStorageSync) { const v = wx.getStorageSync(key); if (v) return String(v); } } catch (e) { /* 忽略 */ }
  try { if (typeof localStorage !== 'undefined') { const v = localStorage.getItem(key); if (v) return v; } } catch (e) { /* 忽略 */ }
  return '';
}
function writeStore(key, val) {
  try { if (typeof wx !== 'undefined' && wx.setStorageSync) { wx.setStorageSync(key, val); return; } } catch (e) { /* 忽略 */ }
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, val); } catch (e) { /* 忽略 */ }
}

/** 查询参数/H5 与 wx 启动参数统一读取 */
function readParam(name) {
  try {
    if (typeof location !== 'undefined' && location.search) {
      const m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search);
      if (m) return decodeURIComponent(m[1]);
    }
  } catch (e) { /* 非 H5 */ }
  return readStore('polar_' + name);
}

export function resolvePgUrl() {
  const forced = readParam('pgrelay');
  // https 页面（域名+TLS 反代场景）：浏览器禁止 mixed content，只能连同源 wss；
  // 路径取站点 base（如 /polar/web/index.html → /polar/），保证走 nginx 的 location 前缀
  if (!forced && typeof location !== 'undefined' && location.protocol === 'https:' && location.host) {
    // 静态托管（GitHub Pages / is-a.dev 指向 Pages）没有 ws 后端，同源 wss 必然 405——
    // 明确报错引导配置中继，而不是让回退链在 127.0.0.1 上撞墙
    if (/(^|\.)github\.io$|(^|\.)is-a\.dev$/.test(location.hostname)) {
      throw new Error('此静态托管页无联机后端：请用 ?pgrelay=wss://<中继地址> 指定 wss 中继，或改用 http://43.138.126.226:8911/ 入口联机');
    }
    const base = location.pathname.replace(/\/web\/.*$/, '/') || '/';
    return `wss://${location.host}${base}`;
  }
  const raw = forced || DEFAULT_URL;
  return /^wss?:\/\//.test(raw) ? raw : `ws://${raw}`;
}

/** 设备身份：首启生成 16 位 pid 并持久化（服务端以它当 openid 使用）。
 *  测试可用 ?pgpid=xxx 显式指定（同浏览器多标签页模拟多用户）。 */
export function loadPid() {
  const forced = readParam('pgpid');
  if (forced && /^[A-Za-z0-9_-]{6,32}$/.test(forced)) return forced;
  let v = readStore('polar_pid');
  if (v && /^[A-Za-z0-9_-]{6,32}$/.test(v)) return v;
  const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 16; i += 1) s += CH[Math.floor(Math.random() * CH.length)];
  writeStore('polar_pid', s);
  return s;
}

export class PgSync extends CloudSync {
  constructor({ url, token, pid, onEvent, name } = {}) {
    super({ env: CLOUDBASE_ENV_ID, onEvent, name }); // env 无意义，仅为满足基类字段
    this.url = url || resolvePgUrl();
    this.token = token || readParam('pgtoken') || '';
    this.pid = pid || loadPid();
    this._ws = null;
    this._helloOk = false;
    this._opening = null;
    this._reqId = 0;
    this._pending = new Map(); // id -> {resolve,reject}
    this._reconnectTimer = 0;
    this._reconnectDelay = 1000;
    // 活性检测（半开连接自愈，见 _startHeartbeat）
    this._lastRx = 0; // 最近一次收到任何服务端帧的时刻
    this._hbTimer = 0;
    this._staleCalls = 0; // 连续 RPC 超时次数（连接看似活着但全丢帧的旁证）
  }

  // ───────────────────────────── 连接 ─────────────────────────────

  connect() {
    // 基类构造即 _closed=true（云开发语义：入房才开）；ws 会话在 connect 即可收发，先解除
    this._closed = false;
    return this._open()
      .then(() => this._call('ping'))
      .then((r) => {
        if (r && r.ok && r.proto === 1) return;
        throw new Error('协议版本不兼容（请更新 server/pgserver.js）');
      });
  }

  _open() {
    if (this._closed) return Promise.reject(new Error('已关闭'));
    if (this._helloOk && this._ws && this._ws.readyState === 1) return Promise.resolve();
    if (this._opening) return this._opening;
    this._opening = new Promise((resolve, reject) => {
      const ws = createWebSocket(this.url);
      if (!ws) { this._opening = null; reject(new Error('当前环境不支持 WebSocket（请改用本地联机或单机模式）')); return; }
      this._ws = ws;
      const to = setTimeout(() => {
        try { ws.close(); } catch (e) { /* 忽略 */ }
        this._opening = null;
        reject(new Error('连接超时：' + this.url));
      }, 8000);
      this._helloResolve = () => {
        clearTimeout(to); this._opening = null; this._reconnectDelay = 1000;
        this._lastRx = Date.now(); this._staleCalls = 0;
        this._startHeartbeat();
        resolve();
      };
      this._helloReject = (msg) => { clearTimeout(to); this._opening = null; reject(new Error(msg)); };
      ws.onmessage = (ev) => this._onFrame(ev);
      ws.onerror = () => { /* onclose 统一处理 */ };
      ws.onclose = () => {
        const wasOpen = this._helloOk;
        this._helloOk = false;
        for (const { reject } of this._pending.values()) reject(new Error('连接已断开'));
        this._pending.clear();
        if (this._opening) this._helloReject('连接失败：' + this.url);
        if (!this._closed && wasOpen) {
          this._emit('disconnected', {});
          this._scheduleReconnect();
        }
      };
      ws.onopen = () => {
        this._wsSend({ t: 'hello', pid: this.pid, token: this.token });
      };
    });
    return this._opening;
  }

  _onFrame(ev) {
    this._lastRx = Date.now();
    this._staleCalls = 0;
    let m;
    try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (m.ok) { this._helloOk = true; if (this._helloResolve) this._helloResolve(); }
      else if (this._helloReject) this._helloReject(m.reason || '握手被拒绝');
      return;
    }
    if (m.id != null && this._pending.has(m.id)) {
      const p = this._pending.get(m.id);
      this._pending.delete(m.id);
      p.resolve(m.result);
      return;
    }
    if (m.t === 'doc' && m.roomId && m.roomId === this.roomId) {
      this._reconnectDelay = 1000;
      if (m.doc) this._applyDoc(m.doc);
    }
  }

  _wsSend(obj) {
    if (this._ws && this._ws.readyState === 1) { try { this._ws.send(JSON.stringify(obj)); } catch (e) { /* 忽略 */ } }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || this._closed) return;
    const delay = this._reconnectDelay;
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, 15000);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = 0;
      if (this._closed) return;
      this._open().then(() => {
        if (this.roomId) { this._startWatch(); this._pullState(); }
      }).catch(() => this._scheduleReconnect());
    }, delay);
  }

  // ───────────────────────── 活性（半开连接自愈）─────────────────────────
  /**
   * 移动网络（4G/WiFi 切换、NAT 超时）下 TCP 会「静默死亡」：onclose 不触发、
   * readyState 恒为 1，watch 推送与 RPC 全部石沉大海 → 对端盘面冻结（不同步）、
   * 落子无响应（不能放置），且只能等 OS 层 TCP 超时（可达数分钟）才能恢复。
   * 对策：每 4s 发一个 {t:'ping'}（服务端同帧回 pong，不查库）；12s 收不到任何帧
   * 即判半开 → 主动 close 走既有「onclose→重连→重挂 watch+拉平」自愈链路。
   */
  _startHeartbeat() {
    if (this._hbTimer || this._closed) return;
    this._hbTimer = setInterval(() => {
      if (this._closed) { this._stopHeartbeat(); return; }
      if (!this._helloOk) return; // 重连中：_helloResolve 会重新计时
      if (this._lastRx && Date.now() - this._lastRx > 12000) {
        this._killDeadSocket('心跳超时：连接半开');
        return;
      }
      this._wsSend({ t: 'ping' });
    }, 4000);
    if (this._hbTimer.unref) this._hbTimer.unref();
  }

  _stopHeartbeat() {
    if (this._hbTimer) { clearInterval(this._hbTimer); this._hbTimer = 0; }
  }

  /** 强制拆掉看似活着实则半开的连接，手动走 onclose 同款收尾（不等库的 close 事件） */
  _killDeadSocket(why) {
    if (!this._helloOk && !this._ws) return;
    console.warn('[pgsync] ' + why + '，强制重连');
    const ws = this._ws;
    this._ws = null;
    this._helloOk = false;
    if (this._opening) this._helloReject('连接半开，重连中');
    for (const { reject } of this._pending.values()) reject(new Error('连接半开'));
    this._pending.clear();
    if (ws) {
      try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); } catch (e) { /* 忽略 */ }
    }
    if (!this._closed) {
      this._emit('disconnected', {});
      this._scheduleReconnect();
    }
  }

  // ───────────────────────── RPC（覆盖 _call）─────────────────────────

  _call(action, data) {
    return new Promise((resolve, reject) => {
      this._open().then(() => {
        const id = ++this._reqId;
        const timer = setTimeout(() => {
          this._pending.delete(id);
          // 连接看似 OPEN 但 RPC 连续两次全超时（心跳也收不到帧时由 _startHeartbeat 兜底）：
          // 主动判死触发重连，覆盖「服务端挂起只回 pong 不回 RPC」的场景
          this._staleCalls += 1;
          if (this._staleCalls >= 2 && this._helloOk && this._ws && this._ws.readyState === 1) {
            this._killDeadSocket('RPC 连续超时');
          }
          reject(new Error('云调用超时：' + action));
        }, 10000);
        this._pending.set(id, {
          resolve: (r) => { clearTimeout(timer); resolve(r); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
        this._wsSend(Object.assign({ id, action }, data || {}));
      }).catch(reject);
    });
  }

  // ───────────────────────── watch（覆盖）─────────────────────────

  _startWatch() {
    if (!this.roomId) return;
    this._open().then(() => this._wsSend({ t: 'watch', roomId: this.roomId })).catch(() => {});
  }

  _stopWatch() {
    if (this.roomId) this._wsSend({ t: 'unwatch', roomId: this.roomId });
  }

  // ───────────────────────── 生命周期 ─────────────────────────

  /**
   * 离房：直接在 ws 上发 leave 帧（同步发送，不等响应），随后断连。
   * 不能走 _call——它是异步 _open，_teardown 同步置 _closed 后微任务里必然 reject。
   */
  leave() {
    const roomId = this.roomId;
    if (roomId && this._helloOk) {
      this._reqId += 1;
      this._wsSend({ id: this._reqId, action: 'leave', roomId });
    }
    this._teardown();
    this.roomId = null;
    this.seat = 0;
    this.roster = [];
    this.isHost = false;
  }

  /**
   * 覆盖基类 _reset：hostRoom/joinRoom 前清房间态，但**保持连接与 _closed=false**
   * （ws 传输是常驻会话，不像云调用无状态；若置 _closed 则后续 _call 全部被拒）。
   */
  _reset() {
    this._stopWatch();
    this._stopPoll();
    if (this._rewatchTimer) { clearTimeout(this._rewatchTimer); this._rewatchTimer = 0; }
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

  /** 彻底关闭（leave/销毁）：停推送与轮询、断开 ws、拒绝在途请求 */
  _teardown() {
    this._closed = true;
    this._stopHeartbeat();
    this._stopWatch();
    this._stopPoll();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = 0; }
    for (const { reject } of this._pending.values()) reject(new Error('已断开'));
    this._pending.clear();
    if (this._ws) {
      try { this._ws.onclose = null; this._ws.onerror = null; this._ws.onmessage = null; this._ws.close(); } catch (e) { /* 忽略 */ }
      this._ws = null;
    }
    this._helloOk = false;
  }
}
