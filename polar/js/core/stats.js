/**
 * 战绩上报（好友排行榜数据源：微信云存储 KV，零后端零套餐成本）
 *
 * KV 约定（wx.setUserCloudStorage 写入，好友可见；开放数据域经 wx.getFriendCloudStorage 读取）：
 *  - soloBest 单人挑战最佳得分（只增不减，取大）
 *  - wins     对战胜场累计（只增不减）
 *  - streak   历史最高连胜（本地 polar_stats.streak 为「当前连胜」，上报时折算为最高值）
 *
 * 上报纪律：
 *  1. 未同意用户协议（polar_agreed）前一律不上报（合规红线，见 design/compliance.md）
 *  2. 数值取大不取小：先读本地缓存比较，再与云端旧值 max 合并（跨设备/重装保护）
 *  3. H5 / 无 wx.setUserCloudStorage 能力的环境静默跳过（与 js/net 各模块守卫口径一致）
 *  4. 与上次上报值一致时跳过网络调用（polar_cloud_mirror 去重；失败不记镜像，下次终局重试）
 *
 * 调用时机：终局本地战绩落库之后（main.showResult 中 _recordStats(game) 之后）调用
 * reportScore(game)。polar_stats 存储键与 main.js G10 的本地战绩共用同一份数据。
 */

const STATS_KEY = 'polar_stats'; // 本地战绩缓存（与 main.js loadStats 共用）
const MIRROR_KEY = 'polar_cloud_mirror'; // 上次成功上报的云端值镜像（去重用）
const CLOUD_KEYS = ['soloBest', 'wins', 'streak']; // 云存储 KV 键（顺序即上报顺序）

/** 读取本地战绩缓存（结构与 main.js 一致；H5/存储不可用时回退全零） */
export function loadStats() {
  try {
    const raw = wx.getStorageSync(STATS_KEY);
    return raw
      ? JSON.parse(raw)
      : { wins: 0, losses: 0, streak: 0, bestStreak: 0, soloBest: 0, plays: 0 };
  } catch (e) {
    return { wins: 0, losses: 0, streak: 0, bestStreak: 0, soloBest: 0, plays: 0 };
  }
}

/** 写本地战绩缓存 */
export function saveStats(st) {
  try { wx.setStorageSync(STATS_KEY, JSON.stringify(st)); } catch (e) { /* 忽略 */ }
}

/** 用户是否已同意用户协议（未同意前不上报，合规） */
function agreed() {
  try { return !!wx.getStorageSync('polar_agreed'); } catch (e) { return false; }
}

/** 当前局单人得分（solo 模式安全落子计数，见 main._recordStats 同口径；本地玩家恒 0 号位） */
function soloScoreOf(game, myIndex = 0) {
  if (game && game.mode === 'solo' && game.stats) {
    const s = game.stats[myIndex] || game.stats[0];
    return s ? s.placed || 0 : 0;
  }
  return 0;
}

function readMirror() {
  try { return JSON.parse(wx.getStorageSync(MIRROR_KEY)) || {}; } catch (e) { return {}; }
}

function saveMirror(values) {
  try { wx.setStorageSync(MIRROR_KEY, JSON.stringify(values)); } catch (e) { /* 忽略 */ }
}

/** KV value 为字符串，统一转非负整数 */
function toInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

/**
 * 终局上报战绩到微信云存储（好友排行榜数据源，reportScore 由主域在 showResult 中调用）
 *
 * 流程：环境/合规守卫 → 本地缓存 + 当前局取大得到目标值 → 镜像去重 →
 *       异步读云端旧值 max 合并（跨设备保护）→ setUserCloudStorage 写入 → 成功记镜像。
 * @param {object} game 终局 GameState.game（solo 取本人 stats.placed；对战依赖本地已累计 wins/streak）
 * @param {number} myIndex 本地玩家座位角标（联机=room.seat-1，本地局 0）
 * @returns {boolean} true=已发起/完成上报，false=环境或合规原因静默跳过
 */
export function reportScore(game, myIndex = 0) {
  // H5 / 无云存储能力环境：静默跳过
  if (typeof wx === 'undefined' || !wx || typeof wx.setUserCloudStorage !== 'function') return false;
  // 未同意用户协议前不上报（合规红线）
  if (!agreed()) return false;

  const st = loadStats();
  const target = {
    soloBest: Math.max(st.soloBest || 0, soloScoreOf(game, myIndex)), // 取大不取小
    wins: st.wins || 0,
    streak: Math.max(st.bestStreak || 0, st.streak || 0), // 折算为历史最高连胜
  };

  // 与上次上报值完全一致 → 无新战绩，省一次网络调用
  const mirror = readMirror();
  const unchanged = CLOUD_KEYS.every((k) => toInt(mirror[k]) === target[k]);
  if (unchanged) return true;

  // 先读云端旧值做 max 合并（防新设备小值覆盖旧纪录），读取失败则直接以本地值上报
  wx.getUserCloudStorage({
    keyList: CLOUD_KEYS,
    success: (res) => {
      const cloud = {};
      ((res && res.KVDataList) || []).forEach((kv) => { cloud[kv.key] = toInt(kv.value); });
      const merged = {};
      CLOUD_KEYS.forEach((k) => { merged[k] = Math.max(target[k], cloud[k] || 0); });
      upload(merged);
    },
    fail: () => upload(target),
  });
  return true;
}

/** 写入云存储（KV value 必须为字符串），成功才更新镜像 */
function upload(values) {
  try {
    wx.setUserCloudStorage({
      KVDataList: CLOUD_KEYS.map((k) => ({ key: k, value: String(values[k] || 0) })),
      success: () => saveMirror(values),
      fail: () => { /* 静默：下次终局重试 */ },
    });
  } catch (e) { /* 静默 */ }
}
