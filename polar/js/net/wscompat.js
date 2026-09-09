/**
 * WebSocket 跨端适配：浏览器/H5 用原生 WebSocket；微信小游戏用 wx.connectSocket（任务式 API）
 * 包成浏览器风格对象（onopen/onmessage/onerror/onclose/send/close/readyState），
 * 上层（RoomSync/PgSync）零改动跨端。
 *
 * 小游戏端注意：正式环境需在 mp 后台配置 socket 合法域名（wss://），
 * 开发工具/真机调试可在 project.config.json urlCheck:false 下连 ws://（当前已关校验）。
 */

export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSED = 3;

class WxTaskSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WS_CONNECTING;
    this.onopen = null;
    this.onmessage = null; // (ev:{data}) —— 与浏览器同形
    this.onerror = null;
    this.onclose = null;
    this._task = null;
    this._closedByUs = false;
    const task = wx.connectSocket({ url, fail: () => {
      this.readyState = WS_CLOSED;
      if (this.onerror) this.onerror({});
      if (this.onclose) this.onclose({});
    } });
    // 基础库 ≥2.x 同步返回 SocketTask；无返回（极老版本）时上层靠连接超时 reject 兜底
    this._task = task;
    if (!task) return;
    task.onOpen(() => {
      this.readyState = WS_OPEN;
      if (this.onopen) this.onopen({});
    });
    task.onMessage((res) => {
      if (this.onmessage) this.onmessage({ data: res.data });
    });
    task.onError(() => {
      if (this.onerror) this.onerror({});
    });
    task.onClose(() => {
      this.readyState = WS_CLOSED;
      if (this.onclose) this.onclose({});
    });
  }

  send(data) {
    if (!this._task || this.readyState !== WS_OPEN) return;
    this._task.send({ data: typeof data === 'string' ? data : String(data) });
  }

  close() {
    this._closedByUs = true;
    if (this._task && this.readyState !== WS_CLOSED) {
      try { this._task.close({}); } catch (e) { /* 忽略 */ }
    }
    this.readyState = WS_CLOSED;
  }
}

/** 创建连接（优先原生 WebSocket，其次 wx.connectSocket），失败返回 null */
export function createWebSocket(url) {
  if (typeof WebSocket !== 'undefined') {
    try { return new WebSocket(url); } catch (e) { return null; }
  }
  if (typeof wx !== 'undefined' && wx.connectSocket) {
    try { return new WxTaskSocket(url); } catch (e) { return null; }
  }
  return null;
}
