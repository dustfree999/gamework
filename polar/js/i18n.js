/**
 * 中英双语字典（H5/小游戏共用）
 * - tr(key, vars)：取当前语言文案，`{name}` 插值
 * - setLang(lang)：'zh' | 'en'，写入 polar_lang 持久化
 * - GameGlobal.__i18n：暴露给测试/H5 调试
 * 设计约束：
 *   · 本模块不属于 js/core（云函数副本 sync-core 不覆盖），服务端零依赖。
 *   · 服务端 reason 字符串不在此翻译（cloudfn.e2e / e2e-pg 断言依赖），客户端只透传。
 *   · 显示层按 key 取文案；切语言后渲染帧自动刷新（各场景 render 时调用 tr()）。
 *   · 函数名用 tr 而非 t：场景代码惯例把局部主题对象命名为 t（const t = this.theme），避免遮蔽。
 */

export const LANGS = ['zh', 'en'];

let currentLang = null;

function detectLang() {
  let tag = '';
  try {
    if (typeof wx !== 'undefined' && wx.getSystemInfoSync) {
      tag = String(wx.getSystemInfoSync().language || '');
    } else if (typeof navigator !== 'undefined') {
      tag = String(navigator.language || navigator.userLanguage || '');
    }
  } catch (e) { /* 环境无法读取时回退中文 */ }
  return /^en\b/i.test(tag) ? 'en' : 'zh';
}

function savedLang() {
  try {
    const v = wx.getStorageSync('polar_lang');
    if (LANGS.includes(v)) return v;
  } catch (e) { /* 存储不可用 */ }
  return '';
}

export function getLang() {
  if (currentLang && LANGS.includes(currentLang)) return currentLang;
  const saved = savedLang();
  return saved || detectLang();
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) return false;
  currentLang = lang;
  try { wx.setStorageSync('polar_lang', lang); } catch (e) { /* 写失败不致命 */ }
  return true;
}

/** 文案查找：未命中 key 时原样返回（防止漏译直接崩 UI） */
export function tr(key, vars) {
  const lang = getLang();
  const entry = DICT[key];
  let text = entry ? (entry[lang] || entry.zh || key) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

/**
 * 首页/对局对玩家代号「红/青/绿/黄」色名（按语言）
 */
export function colorName(idx) {
  return tr(['color.red', 'color.cyan', 'color.green', 'color.yellow'][idx % 4]);
}

// ───────────────────────── 字典 ─────────────────────────

const DICT = {
  // 品牌
  'game.title': { zh: '磁极对决', en: 'Polar Clash' },
  'game.subtitle': { zh: '— 磁吸对战棋 —', en: '— Magnet Duel —' },
  'game.challenge-prefix': { zh: '磁极对决挑战码 ', en: 'Polar Clash code ' },

  // 颜色
  'color.red': { zh: '红', en: 'Red' },
  'color.cyan': { zh: '青', en: 'Cyan' },
  'color.green': { zh: '绿', en: 'Green' },
  'color.yellow': { zh: '黄', en: 'Yellow' },
  'color.red-side': { zh: '红方', en: 'Red' },
  'color.cyan-side': { zh: '青方', en: 'Cyan' },
  'color.green-side': { zh: '绿方', en: 'Green' },
  'color.yellow-side': { zh: '黄方', en: 'Yellow' },

  // 主题名
  'theme.candy': { zh: '糖果风暴', en: 'Candy Storm' },
  'theme.quantum': { zh: '量子棋盘格', en: 'Quantum Grid' },
  'theme.lab': { zh: '实验室桌面', en: 'Lab Desk' },

  // 首页
  'home.theme-title': { zh: '主题选择', en: 'Theme' },
  'home.gamemode-title': { zh: '玩法选择', en: 'Game Mode' },
  'home.battlemode-title': { zh: '对战方式', en: 'Battle Mode' },
  'home.players-title': { zh: '选择人数', en: 'Players' },
  'home.ai-difficulty': { zh: 'AI 难度', en: 'AI Difficulty' },
  'home.mode.duel': { zh: '对战', en: 'Duel' },
  'home.mode.vsai': { zh: '人机对战', en: 'vs AI' },
  'home.mode.room': { zh: '创建房间', en: 'New Room' },
  'home.mode.solo': { zh: '单人挑战', en: 'Solo' },
  'home.players-count': { zh: '{n}人', en: '{n}P' },
  'home.difficulty.easy': { zh: '简单', en: 'Easy' },
  'home.difficulty.normal': { zh: '普通', en: 'Normal' },
  'home.difficulty.hard': { zh: '困难', en: 'Hard' },
  'home.start': { zh: '开 战', en: 'Play' },
  'home.challenge-solo': { zh: '好友挑战：单人挑战 · 对方得分 {n}', en: 'Challenge · Solo · Opponent {n}' },
  'home.challenge-multi': { zh: '好友挑战：{p}人 · 对方 {n} 步 · 触磁 {f} 次', en: 'Challenge · {p}P · {n} moves · {f} snaps' },
  'home.hint.solo': { zh: '在磁珠间腾挪，每颗安全落子得 1 分，触磁即止', en: 'Move between magnets. Safe drop = 1pt. Snap ends.' },
  'home.hint.multi': { zh: '轮流放磁珠，吸在一起的整组收回手中——先放完者胜', en: 'Take turns. A snap pulls the whole group back.' },
  'home.btn.rules': { zh: '玩法说明', en: 'Rules' },
  'home.btn.rank': { zh: '好友排行', en: 'Rank' },
  'home.btn.join': { zh: '加入房间', en: 'Join' },
  'home.btn.about': { zh: '关于', en: 'About' },
  'home.stats': { zh: '胜 {w} · 连胜 {s} · 最佳 {b}', en: 'Wins {w} · Streak {s} · Best {b}' },

  // 首页加入房间面板
  'home.join.title': { zh: '输入好友房号', en: 'Enter Room Code' },
  'home.join.backspace': { zh: '退格', en: 'Del' },
  'home.join.cancel': { zh: '取消', en: 'Cancel' },
  'home.join.ok': { zh: '加 入', en: 'Join' },
  'home.join.err-incomplete': { zh: '请输入完整 6 位房号', en: 'Enter a full 6-digit code' },

  // 对局 board
  'board.enter-solo-hint': { zh: '安全落子得分 · 触磁即止', en: 'Safe drop = 1pt · Snap ends' },
  'board.your-turn': { zh: '你的回合', en: 'Your turn' },
  'board.ai-thinking': { zh: 'AI 思考中…', en: 'AI thinking…' },
  'board.wait-p': { zh: '等待 P{n}', en: 'Waiting for P{n}' },
  'board.turn-prefix': { zh: '轮到 ', en: '' },
  'board.ai-tag': { zh: '·AI', en: '·AI' },
  'board.not-your-turn': { zh: '还没轮到你', en: 'Not your turn' },
  'board.busy': { zh: '等待上一步确认…', en: 'Waiting for confirm…' },
  'board.game-over': { zh: '对局已结束', en: 'Game over' },
  'board.foul-multi': { zh: '触磁！{n} 颗回手', en: 'Snap! {n} back to hand' },
  'board.foul-replay': { zh: '触磁！回手重放', en: 'Snap! Reclaim replay' },
  'board.you': { zh: '你（{c}）', en: 'You ({c})' },
  'board.safe-cells': { zh: '安全格 {n}', en: 'Safe {n}' },
  'board.ai-thinking-p': { zh: 'P{n} (AI) 思考中…', en: 'P{n} (AI) thinking…' },

  // 结算 result
  'result.title': { zh: '结算', en: 'Result' },
  'result.reason.empty': { zh: '棋子全部放完', en: 'All pieces placed' },
  'result.reason.stall': { zh: '磁力僵局 · 剩余手牌定名次', en: 'Stalemate · Fewer pieces left wins' },
  'result.reason.full': { zh: '棋盘放满 · 剩余手牌定名次', en: 'Board full · Fewer pieces left wins' },
  'result.reason.full-solo': { zh: '棋盘放满 · 完美收官！', en: 'Board full · Perfect!' },
  'result.reason.nomove': { zh: '无处安全落子 · 完美收官！', en: 'No safe move · Perfect!' },
  'result.reason.foul': { zh: '触磁 · 挑战结束', en: 'Snap · Challenge over' },
  'result.winner': { zh: '{name} 胜', en: '{name} wins' },
  'result.player-name': { zh: '玩家{n}（{c}）{ai}', en: 'Player {n} ({c}){ai}' },
  'result.panel-title': { zh: '本局数据', en: 'Game Data' },
  'result.row.placed': { zh: '总落子', en: 'Total placed' },
  'result.row.snapped': { zh: '吸附次数', en: 'Snaps' },
  'result.row.fouls': { zh: '触磁次数', en: 'Snap count' },
  'result.row.rank': { zh: '你的排名', en: 'Your rank' },
  'result.rank-n': { zh: '第 {n} 名', en: '#{n}' },
  'result.replay': { zh: '再来一局', en: 'Play Again' },
  'result.share': { zh: '分享', en: 'Share' },
  'result.home': { zh: '回 首 页', en: 'Home' },

  // 大厅 lobby
  'lobby.title': { zh: '对战大厅', en: 'Battle Lobby' },
  'lobby.room-hint': { zh: '房间号（好友输入或点邀请加入）', en: 'Room code (friends enter or invite)' },
  'lobby.invite': { zh: '邀请好友', en: 'Invite' },
  'lobby.back': { zh: '返回', en: 'Back' },
  'lobby.start': { zh: '开始对战', en: 'Start' },
  'lobby.wait-host': { zh: '等待房主开始…', en: 'Waiting for host…' },
  'lobby.fatal-title': { zh: '无法加入房间', en: 'Cannot Join' },
  'lobby.fatal-ok': { zh: '回 首 页', en: 'Home' },
  'lobby.seat.human': { zh: '玩家', en: 'Player' },
  'lobby.seat.ai': { zh: 'AI', en: 'AI' },
  'lobby.seat.empty': { zh: '空位', en: 'Empty' },
  'lobby.seat.me': { zh: '（我）', en: ' (Me)' },
  'lobby.ai-fill': { zh: '补 AI', en: 'Add AI' },
  'lobby.ai-remove': { zh: '移除AI', en: 'Remove AI' },
  'lobby.need-two': { zh: '至少需要 2 个已入座座位（可点空位的「补 AI」）', en: 'Need 2 seated players (tap Empty → Add AI)' },
  'lobby.connect-fail': { zh: '连接失败', en: 'Connection failed' },

  // 排行榜 rank
  'rank.tab.solo': { zh: '单人最佳', en: 'Solo Best' },
  'rank.tab.wins': { zh: '对战胜场', en: 'Duel Wins' },
  'rank.tab.global': { zh: '全服榜', en: 'Global' },
  'rank.back': { zh: '‹ 返回', en: '‹ Back' },
  'rank.title.global': { zh: '全服排行', en: 'Global Ranking' },
  'rank.title.friend': { zh: '好友排行', en: 'Friend Ranking' },
  'rank.browser-no-friend': { zh: '当前环境不支持好友排行', en: 'Friend rank unavailable here' },
  'rank.browser-use-global': { zh: '可切「全服榜」看后端战绩（两端同步）', en: 'Switch to Global for synced scores' },
  'rank.loading': { zh: '正在加载全服榜…', en: 'Loading…' },
  'rank.fail': { zh: '后端暂不可达，稍后再试', en: 'Server unreachable, try later' },
  'rank.empty': { zh: '还没有战绩——完成一局即可上榜', en: 'No records yet — finish a game to rank' },
  'rank.row': { zh: '{w} 胜 · 最佳 {b}', en: '{w} wins · Best {b}' },
  'rank.mine': { zh: '我的战绩：{w} 胜 · 最佳 {b}', en: 'Mine: {w} wins · Best {b}' },
  'rank.player-default': { zh: '玩家', en: 'Player' },

  // 规则/协议/关于
  'legal.about-title': { zh: '关于 · 磁极对决', en: 'About · Polar Clash' },
  'legal.agreement-title': { zh: '用户协议', en: 'User Agreement' },
  'legal.agree': { zh: '同 意', en: 'Agree' },
  'legal.rules-title': { zh: '玩法说明', en: 'How to Play' },
  'legal.back': { zh: '返 回', en: 'Back' },
  'legal.lang-en': { zh: 'EN', en: '中' }, // 切换按钮：当前中文时显示"EN"，英文时显示"中"

  // 主流程/分享
  'main.share.has-challenge': { zh: '我在磁极对决留了个局，来打破我的纪录！', en: 'I left a match in Polar Clash — beat my record!' },
  'main.share.no-challenge': { zh: '磁极对决——放完手中磁珠且不触发磁吸者胜', en: 'Polar Clash — empty your hand without snapping to win' },
  'main.room-invite': { zh: '磁极对决房间号：{id}（打开小游戏输入房号加入）', en: 'Polar Clash room {id} — enter the code to join' },
  'main.room-copied': { zh: '房号 {id} 已复制，发给好友吧', en: 'Room {id} copied — share it!' },
  'main.prompt-room': { zh: '输入好友给的房间号（6 位）', en: 'Enter 6-digit room code' },
  'main.error.connect': { zh: '连接失败', en: 'Connection failed' },
  'main.error.start': { zh: '开局失败', en: 'Failed to start' },
  'main.error.net': { zh: '联机连接失败', en: 'Network error' },
  'main.me': { zh: '我', en: 'Me' },

  // 网络层（客户端拼的串；服务端 reason 只透传）
  'net.h5-no-online': { zh: '此网页版暂仅提供单机/挑战；联机对战请访问 http://43.138.126.226:8911/（或加 ?pgrelay=wss://… 指定中继）', en: 'This web build is single-player only. For online play visit http://43.138.126.226:8911/' },
  'net.proto-mismatch': { zh: '协议版本不兼容（请更新 server/pgserver.js）', en: 'Protocol version mismatch (update pgserver)' },
  'net.closed': { zh: '已关闭', en: 'Closed' },
  'net.no-websocket': { zh: '当前环境不支持 WebSocket（请改用本地联机或单机模式）', en: 'WebSocket unsupported (use local or single-player)' },
  'net.timeout': { zh: '连接超时：{url}', en: 'Connection timeout: {url}' },
  'net.disconnected': { zh: '连接已断开', en: 'Disconnected' },
  'net.connect-fail-url': { zh: '连接失败：{url}', en: 'Connection failed: {url}' },
  'net.handshake-reject': { zh: '握手被拒绝', en: 'Handshake rejected' },
  'net.half-open': { zh: '连接半开，重连中', en: 'Half-open, reconnecting' },
  'net.half-open-short': { zh: '连接半开', en: 'Half-open' },
  'net.cloud-timeout': { zh: '云调用超时：{a}', en: 'Cloud call timeout: {a}' },
  'net.gone': { zh: '已断开', en: 'Disconnected' },
  'net.cloud-disabled': { zh: '云开发未启用：当前环境不支持云开发（H5 请使用本地联机或单机模式）', en: 'Cloud disabled: unsupported here (use local or single-player)' },
  'net.cloud-env-missing': { zh: '云开发未启用：请先在 js/net/cloudsync.js 顶部把 CLOUDBASE_ENV_ID 改为真实环境 ID', en: 'Cloud disabled: set CLOUDBASE_ENV_ID in cloudsync.js' },
  'net.cloud-timeout-env': { zh: '云开发连接超时：请检查环境 ID 与 room 云函数是否已部署', en: 'Cloud timeout: check env ID and room function' },
  'net.cloud-proto-mismatch': { zh: '云开发协议版本不兼容（proto={p}），请重新部署 room 云函数', en: 'Cloud protocol mismatch (proto={p}), redeploy room' },
  'net.cloud-connect-fail': { zh: '云开发连接失败：{e}', en: 'Cloud connection failed: {e}' },
  'net.create-room-fail': { zh: '创建房间失败：{e}', en: 'Create room failed: {e}' },
  'net.join-room-fail': { zh: '加入房间失败：{e}', en: 'Join room failed: {e}' },
  'net.set-ai-fail': { zh: '切换 AI 失败', en: 'Switch AI failed' },
  'net.set-ai-fail-err': { zh: '切换 AI 失败：{e}', en: 'Switch AI failed: {e}' },
  'net.start-fail': { zh: '开局失败', en: 'Failed to start' },
  'net.start-fail-err': { zh: '开局失败：{e}', en: 'Failed to start: {e}' },
  'net.enter-room-fail': { zh: '进入房间失败', en: 'Enter room failed' },
  'net.no-ws-roomsync': { zh: '当前环境不支持 WebSocket', en: 'WebSocket unsupported' },
  'net.timeout-roomsync': { zh: '连接超时', en: 'Connection timeout' },
};

// 开放数据域（微信好友榜）内联小字典：主域 i18n 不可 require，由 rank 页面 postMessage 下发 lang
export const ODC_DICT = {
  'odc.loading': { zh: '加载中…', en: 'Loading…' },
  'odc.empty': { zh: '还没有战绩，快去玩一局', en: 'No records yet — play a game' },
  'odc.fail': { zh: '加载失败，请稍后再试', en: 'Failed to load, try later' },
  'odc.col.rank': { zh: '排名', en: 'Rank' },
  'odc.col.name': { zh: '昵称', en: 'Name' },
  'odc.col.score': { zh: '胜场', en: 'Wins' },
  'odc.col.score-frac': { zh: '分数', en: 'Score' },
  'odc.score-wins': { zh: '{n} 胜', en: '{n} wins' },
  'odc.score-points': { zh: '{n} 分', en: '{n} pts' },
  'odc.player-default': { zh: '玩家', en: 'Player' },
};

if (typeof window !== 'undefined') {
  window.GameGlobal = window.GameGlobal || {};
  window.GameGlobal.__i18n = { lang: getLang, setLang, t: tr };
}