/**
 * RoomSync：联机房间客户端（当前实现 = ws 连本地 relay；微信上线换 CloudSync，接口不变）
 *
 * 主机权威模型：
 *  - 房主（seat 1）持有 rules.js 权威状态机，校验所有落子并广播 game 快照
 *  - 非主机只发 move 请求 + 收 moveAck 快照渲染
 *  - AI 座位由主机代驱动（思考+落子）
 *  - started 只广播 seed/mode/players，各端本地 createGame 同盘面（确定性物理）
 */
import { C2S, S2C } from './protocol.js';
import { createWebSocket } from './wscompat.js';
import { tr } from '../i18n.js';

/**
 * 中转地址解析（局域网免费对战）：
 *  1. H5 URL 查询参数 ?relay=192.168.x.x:8910（分享给同一 WiFi 的好友）
 *  2. 本地存储 polar_relay（微信端可在首页"加入房间"旁输入，或调试预设）
 *  3. 默认 ws://127.0.0.1:8910（本机开发）
 */
export function resolveRelayUrl() {
  try {
    if (typeof location !== 'undefined' && location.search) {
      const m = /[?&]relay=([^&]+)/.exec(location.search);
      if (m) {
        const host = decodeURIComponent(m[1]);
        return /^wss?:\/\//.test(host) ? host : `ws://${host}`;
      }
    }
  } catch (e) { /* 非 H5 */ }
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      const saved = wx.getStorageSync('polar_relay');
      if (saved) return /^wss?:\/\//.test(saved) ? saved : `ws://${saved}`;
    }
  } catch (e) { /* 忽略 */ }
  return 'ws://127.0.0.1:8910';
}

export class RoomSync {
  constructor({ url, onEvent, name } = {}) {
    this.transport = 'relay'; // RoomSession 据此区分 moveAck 来源校验（relay 只认房主座位）
    this.url = url || resolveRelayUrl();
    this.onEvent = onEvent || (() => {}); // (type, payload)
    this.name = name || tr('rank.player-default');
    this.ws = null;
    this.roomId = null;
    this.seat = 0; // 我的座位（1-4；0=未入房）
    this.roster = []; // [{seat,type,name}]
    this.isHost = false;
    this.hostSeat = 1; // 当前房主座位（rehomed 时更新；moveAck 来源校验用）
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === 1) return resolve();
      const ws = createWebSocket(this.url); // H5 原生 / 小游戏 wx.connectSocket（wscompat）
      if (!ws) { reject(new Error(tr('net.no-ws-roomsync'))); return; }
      this.ws = ws;
      const to = setTimeout(() => reject(new Error(tr('net.timeout-roomsync'))), 5000);
      this.ws.onopen = () => { clearTimeout(to); resolve(); };
      this.ws.onerror = (e) => { clearTimeout(to); reject((e && e.error) || new Error('ws error')); };
      this.ws.onclose = () => this._emit('disconnected', {});
      this.ws.onmessage = (ev) => this._handle(ev);
    });
  }

  /** 事件分发统一 try 包裹：上层回调异常不阻断 ws 消息处理（与 CloudSync._emit 对齐） */
  _emit(type, payload) {
    try { this.onEvent(type, payload); } catch (e) { console.warn('[roomsync] onEvent error:', e && e.message); }
  }

  _handle(ev) {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === S2C.HOSTED) {
      this.roomId = m.roomId; this.seat = m.seat; this.isHost = true; this.hostSeat = 1;
      this.roster = m.roster;
      this._emit('room', { roomId: m.roomId, seat: m.seat, roster: m.roster, isHost: true });
    } else if (m.t === S2C.JOINED) {
      this.roomId = m.roomId; this.seat = m.seat; this.isHost = false; this.hostSeat = m.hostSeat || 1;
      this.roster = m.roster;
      this._emit('room', { roomId: m.roomId, seat: m.seat, roster: m.roster, isHost: false });
    } else if (m.t === S2C.ROSTER) {
      this.roster = m.roster;
      this._emit('roster', { roster: m.roster });
    } else if (m.t === S2C.LEFT) {
      this._emit('left', { seat: m.seat });
    } else if (m.t === S2C.REHOMED) {
      this.isHost = m.seat === this.seat;
      this.hostSeat = m.seat;
      this._emit('rehomed', { seat: m.seat });
    } else if (m.t === 'peer') {
      // 房间广播事件（含自己发的，按 from 过滤）
      this._emit('peer', { from: m.from, ev: m.ev, data: m.data });
    } else if (m.t === S2C.ERROR) {
      this._emit('error', { msg: m.msg });
    }
  }

  _send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  /** 广播房间事件（move/moveAck/started 等） */
  broadcast(ev, data) { this._send({ t: 'room', ev, data }); }

  hostRoom(mode) { this._send({ t: C2S.HOST, mode, name: this.name }); }
  joinRoom(roomId) { this._send({ t: C2S.JOIN, roomId, name: this.name }); }
  setSeatAi(seat, on) { this._send({ t: C2S.SET_AI, roomId: this.roomId, seat, on }); }
  leave() {
    this._send({ t: C2S.LEAVE });
    const ws = this.ws; this.ws = null;
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { /* 忽略 */ } } // 主动离房即关连接，防 socket 泄漏
  }

  /** 请求落子：主机本地校验权威；非主机发给主机 */
  requestMove(x, y) {
    if (this.isHost) return { local: true }; // 主机直接走本地 rules 校验
    this.broadcast('move', { x, y, from: this.seat });
    return { local: false };
  }
}