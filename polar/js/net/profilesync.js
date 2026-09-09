/**
 * ProfileSync：档案/战绩的后端落库通道 —— 「数据都落到后端数据库，小程序和 H5 自然同步」的接线层。
 *
 * 传输解析（与对战通道同口径，但独立短连接、用完即走）：
 *  1. 微信 + 云环境已配置 → wx.cloud.callFunction('profile')（云函数，暂为主通道；
 *     profiles 集合，doc 结构与自托管一致）
 *  2. 自托管 → PgSync 短连接 `profile:*`（PostgreSQL polarclash.profiles 表，43.138.126.226；
 *     H5 开发环境用 ?pgrelay=127.0.0.1:8911 指到本机 pgserver）
 *  3. 都不可用 → resolve(null) 静默（本地 polar_stats 与微信 KV 上报不受影响）
 *
 * 身份：loadPid() 设备号（H5）/ 云函数内 openid（微信）。正式 appid + code2session
 * 就绪后同一张表按 openid 合并 pid，跨端账号即自然归一（数据模型不变）。
 *
 * 字段口径（与 cloudfunctions/profile + pgserver profiles 表一致）：
 *  report { win, score, mode, nick }  终局上报：games+1，win 时 wins+1，bestScore 取大
 *  rank   { top }                     全服榜：me + board（wins desc, bestScore desc）
 */
import { CLOUDBASE_ENV_ID } from './cloudsync.js';
import { PgSync, loadPid } from './pgsync.js';
import { tr } from '../i18n.js';

let cloudInited = false;

function cloudReady() {
  try {
    return typeof wx !== 'undefined' && !!wx.cloud && !!CLOUDBASE_ENV_ID && CLOUDBASE_ENV_ID !== 'CLOUDBASE_ENV_ID';
  } catch (e) { return false; }
}

function callCloud(action, data) {
  return new Promise((resolve, reject) => {
    try {
      if (!cloudInited) { wx.cloud.init({ env: CLOUDBASE_ENV_ID, traceUser: true }); cloudInited = true; }
      wx.cloud.callFunction({ name: 'profile', data: Object.assign({ action }, data || {}) })
        .then((r) => resolve(r && r.result))
        .catch(reject);
    } catch (e) { reject(e); }
  });
}

async function callPg(action, data, pid) {
  const s = new PgSync({ name: '档案', pid });
  try {
    await s.connect();
    return await s._call('profile:' + action, data || {});
  } finally {
    try { s.leave(); } catch (e) { /* 忽略 */ }
  }
}

/**
 * 统一档案调用：云函数优先（微信内），失败/不可用 → 自托管 → null。
 * 永不 reject（调用方 fire-and-forget 安全）。
 */
export async function callProfile(action, data, { pid } = {}) {
  if (cloudReady()) {
    try {
      const r = await callCloud(action, data);
      if (r && r.ok) return r;
      console.warn('[profile] 云函数未就绪，回退自托管：', (r && r.reason) || 'unknown');
    } catch (e) {
      console.warn('[profile] 云函数调用失败，回退自托管：', e && e.errMsg ? e.errMsg : e);
    }
  }
  try {
    return await callPg(action, data, pid || loadPid());
  } catch (e) {
    console.warn('[profile] 后端不可达（静默降级为纯本地战绩）：', e && e.message ? e.message : e);
    return null;
  }
}

/** 从终局 game 折算上报载荷（myIndex=本地座位角标，联机 seat-1 / 本地局 0）；无效时返回 null（不报） */
function payloadOf(game, myIndex = 0) {
  if (!game || !game.stats || game.over !== true) return null;
  if (game.mode === 'solo') {
    const s = game.stats[myIndex] || game.stats[0];
    return { mode: 'solo', win: false, score: (s && s.placed) || 0 };
  }
  const mine = game.stats[myIndex] || game.stats[0];
  if (!mine) return null;
  return { mode: game.mode === 'loot' ? 'loot' : 'classic', win: game.winner === myIndex, score: 0 };
}

/** 用户是否已同意协议（合规红线：未同意前一律不落后端，与 core/stats.js 同口径） */
function agreed() {
  try { if (typeof wx !== 'undefined' && wx.getStorageSync) return !!wx.getStorageSync('polar_agreed'); } catch (e) { /* 忽略 */ }
  return false;
}

/**
 * 终局档案上报（main.showResult 中与 reportScore 并列调用；fire-and-forget）。
 * myIndex=本地座位角标（联机 seat-1，本地局 0）。nick 默认「玩家+pid 尾号」。
 * @returns {Promise<boolean>} true = 后端已确认落库
 */
export function uploadProfile(game, { pid, nick, myIndex } = {}) {
  if (!agreed()) return Promise.resolve(false);
  const payload = payloadOf(game, myIndex || 0);
  if (!payload) return Promise.resolve(false);
  const id = pid || loadPid();
  return callProfile('report', Object.assign({ nick: nick || tr('rank.player-default') + id.slice(-4) }, payload), { pid: id })
    .then((r) => !!(r && r.ok))
    .catch(() => false);
}

/**
 * 全服榜（H5 / 小程序共用后端数据，两端天然同步）。
 * @returns {Promise<{me:object,board:array}|null>} 不可达时 null（UI 自行兜底）
 */
export function fetchGlobalRank(top = 20, { pid } = {}) {
  return callProfile('rank', { top }, { pid })
    .then((r) => (r && r.ok ? { me: r.me, board: r.board || [] } : null));
}
