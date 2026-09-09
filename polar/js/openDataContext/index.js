/**
 * 开放数据域入口：好友排行榜（独立 bundle，game.json 的 openDataContext 指向本目录）
 *
 * ⚠️ 独立沙箱约束（官方规范）：
 *  - 本文件运行在独立 bundle，不能 require/import 主域任何模块
 *    （themes/decor/board 等一概不可），圆角矩形、配色等依赖全部内联；
 *  - 主域只能通过 sharedCanvas 看到本域的绘制结果，不能直接读好友数据；
 *  - 主域 → 本域通信只有 wx.onMessage 一个通道。
 *
 * 指令协议（与 js/scenes/rank.js 对应）：
 *  - { cmd:'width', w, h, dpr, theme }  榜单内区物理像素尺寸 + 主题色板（重设画布并重绘）
 *  - { cmd:'sync',  kind, selfName }    kind='soloBest'|'wins'，拉取对应好友榜单
 *
 * 绘制流程：wx.getFriendCloudStorage（仅开放数据域可用）→ 按分数排序取前 20 →
 * 自己一行高亮（selfOpenId 昵称/openid 匹配，失败时用主域传入的 selfName 兜底）→
 * 画到 sharedCanvas（wx.getSharedCanvas），主域每帧 drawImage 显示。
 */

// ───────────────────────── 共享画布 ─────────────────────────
// 开放数据域没有全局 canvas，必须显式获取；主域 drawImage 的就是它
let canvas = null;
try { canvas = wx.getSharedCanvas(); } catch (e) { canvas = null; }
const ctx = canvas ? canvas.getContext('2d') : null;

// ───────────────────────── 状态 ─────────────────────────
const MAX_ROWS = 20; // 榜单最多展示前 20 名

/** 榜单白名单（kind 即云存储 KV key，防主域传入未知值） */
const KINDS = { soloBest: 'soloBest', wins: 'wins' };

/** 主题色板兜底（糖果主题子集；主域每次都会 postMessage 下发真实值） */
const FALLBACK_THEME = {
  id: 'candy',
  bgDark: false,
  textColor: '#4A3123',
  primaryColor: '#FF6B35',
  accentColor: '#FF9F2E',
  warnColor: '#FFB300',
};

/** 名次圆徽配色（金/银/铜，内联自主域 render/decor.js MEDALS；第 4 名起用灰） */
const MEDALS = [
  ['#F5A623', '#C97F12'],
  ['#C3CAD6', '#98A2B3'],
  ['#DE9350', '#B26B2E'],
];
const MEDAL_PLAIN = ['#BDB6A8', '#948D7D'];

let layout = { w: 300, h: 150, dpr: 1 }; // sharedCanvas 物理像素尺寸（由主域下发）
let theme = FALLBACK_THEME;
let kind = 'soloBest'; // 当前榜单 KV key
let selfName = ''; // 自己昵称（selfOpenId 获取，主域 selfName 兜底）
let selfOpenid = ''; // 自己 openid（getUserInfo selfOpenId 返回，优先按 openid 匹配）
let selfInfoReady = false; // 是否已尝试过识别自己
let rows = []; // [{ openid, nickname, score, isSelf }]
let status = 'idle'; // idle（待主域 sync）| loading | ready | empty | error
let lang = 'zh'; // 界面语言（主域 width 消息下发，独立域不能 require 主域 i18n）

/** 开放数据域内联小字典（独立 bundle 不可跨域引用，语言由主域下发） */
const DICT = {
  'odc.loading': { zh: '加载中…', en: 'Loading…' },
  'odc.empty': { zh: '还没有战绩，快去玩一局', en: 'No records yet — play a game' },
  'odc.fail': { zh: '加载失败，请稍后再试', en: 'Failed to load, try later' },
  'odc.col.rank': { zh: '排名', en: 'Rank' },
  'odc.col.name': { zh: '昵称', en: 'Name' },
  'odc.col.wins': { zh: '胜场', en: 'Wins' },
  'odc.col.score': { zh: '分数', en: 'Score' },
  'odc.wins': { zh: '{n} 胜', en: '{n} wins' },
  'odc.score': { zh: '{n} 分', en: '{n} pts' },
  'odc.player': { zh: '玩家', en: 'Player' },
};
function tt(key, vars) {
  const e = DICT[key] || {};
  let s = vars ? e[lang] || '' : (e[lang] || e.zh || key);
  if (vars) {
    for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', String(vars[k]));
  }
  return s;
}

// ───────────────────────── 主域消息通道 ─────────────────────────

wx.onMessage((msg) => {
  if (!msg || typeof msg.cmd !== 'string') return;
  if (msg.cmd === 'width') {
    // 主域下发榜单内区尺寸：重设画布（重设即清屏）后按新布局重绘
    layout = {
      w: Math.max(1, Math.round(msg.w) || 1),
      h: Math.max(1, Math.round(msg.h) || 1),
      dpr: msg.dpr || 1,
    };
    if (canvas) {
      canvas.width = layout.w;
      canvas.height = layout.h;
    }
    if (msg.theme && typeof msg.theme === 'object') theme = msg.theme;
    if (msg.lang === 'en' || msg.lang === 'zh') lang = msg.lang; // 语言随布局下发
    draw();
  } else if (msg.cmd === 'sync') {
    kind = KINDS[msg.kind] ? msg.kind : 'soloBest';
    if (typeof msg.selfName === 'string' && msg.selfName) selfName = msg.selfName;
    fetchRank();
  }
});

// ───────────────────────── 好友数据拉取 ─────────────────────────

/** 拉取当前榜单的好友云存储 KV 数据（此 API 仅开放数据域可用） */
function fetchRank() {
  if (!ctx) return;
  status = 'loading';
  rows = [];
  draw();
  try {
    wx.getFriendCloudStorage({
      keyList: [kind], // 只拉当前榜单对应的 key
      success: (res) => {
        rows = normalize(res);
        status = rows.length ? 'ready' : 'empty';
        markSelf();
        draw();
        if (!selfInfoReady) detectSelf(); // 异步补齐自己信息后重绘高亮
      },
      fail: () => {
        status = 'error';
        draw();
      },
    });
  } catch (e) {
    status = 'error';
    draw();
  }
}

/** 云端返回数据 → 昵称/分数行列表（按分数降序，取前 MAX_ROWS） */
function normalize(res) {
  const list = ((res && res.data) || []).map((u) => ({
    openid: u.openid || '',
    nickname: u.nickname || tt('odc.player'),
    score: kvScore(u.KVDataList, kind),
    isSelf: false,
  }));
  list.sort((a, b) => (b.score - a.score) || a.nickname.localeCompare(b.nickname));
  return list.slice(0, MAX_ROWS);
}

/** 从 KVDataList 里取指定 key 的非负整数分值 */
function kvScore(kvList, key) {
  if (!kvList) return 0;
  for (let i = 0; i < kvList.length; i += 1) {
    if (kvList[i].key === key) {
      const n = parseInt(kvList[i].value, 10);
      return isNaN(n) || n < 0 ? 0 : n;
    }
  }
  return 0;
}

/**
 * 识别「自己」：开放数据域官方能力 openIdList:['selfOpenId'] 取自己的昵称/openid，
 * 失败（不可用/未授权）时保留主域 postMessage 传入的 selfName 兜底。
 */
function detectSelf() {
  selfInfoReady = true;
  try {
    if (typeof wx.getUserInfo !== 'function') return;
    wx.getUserInfo({
      openIdList: ['selfOpenId'],
      success: (res) => {
        const me = (res && res.data && res.data[0]) || null;
        if (me && me.nickname) {
          selfName = me.nickname;
          selfOpenid = me.openid || '';
          markSelf();
          draw();
        }
      },
      fail: () => { /* 无兜底时不高亮自己 */ },
    });
  } catch (e) { /* 忽略 */ }
}

/** 命中自己：openid 精确匹配优先，昵称匹配兜底 */
function markSelf() {
  rows.forEach((r) => {
    r.isSelf = (!!selfOpenid && r.openid === selfOpenid)
      || (!!selfName && r.nickname === selfName);
  });
}

// ───────────────────────── 绘制（依赖全部内联，不可跨域引用） ─────────────────────────

/** 兼容写法圆角矩形路径（内联自主域 render/board.js，部分运行时无 ctx.roundRect） */
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

/** hex → rgba（自己行高亮底色用；解析失败回退强调橙） */
function rgba(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (isNaN(n)) return `rgba(255,159,46,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 超宽文本截断加省略号（昵称列宽自适应） */
function fitText(c, text, maxW) {
  if (typeof c.measureText !== 'function' || c.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && c.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/** 居中提示文案（加载中/空态/失败态） */
function centerText(text, u) {
  ctx.save();
  ctx.fillStyle = theme.bgDark ? 'rgba(230,245,255,0.6)' : 'rgba(62,39,35,0.5)';
  ctx.font = `${Math.round(15 * u)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  ctx.restore();
}

/** 整幅重绘（事件驱动：主域 width/sync、数据到达、自己信息补齐时各一次） */
function draw() {
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const u = W / 375; // 与主域同口径的 375 逻辑宽缩放
  ctx.clearRect(0, 0, W, H); // 透明底：主域面板底色透出
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  if (status === 'loading') { centerText(tt('odc.loading'), u); return; }
  if (status === 'empty') { centerText(tt('odc.empty'), u); return; }
  if (status === 'error') { centerText(tt('odc.fail'), u); return; }
  if (status !== 'ready' || !rows.length) return; // idle：等主域 sync

  // ── 表头：排名 / 昵称 / 分数（右列随榜单类型切换单位）──
  const headY = 22 * u;
  const rankX = 26 * u; // 名次圆徽圆心 x
  const nickX = 54 * u; // 昵称起点 x
  const scoreR = W - 14 * u; // 分数右对齐 x
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = theme.textColor;
  ctx.font = `bold ${Math.round(12 * u)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(tt('odc.col.rank'), rankX, headY);
  ctx.textAlign = 'left';
  ctx.fillText(tt('odc.col.name'), nickX, headY);
  ctx.textAlign = 'right';
  ctx.fillText(kind === 'wins' ? tt('odc.col.wins') : tt('odc.col.score'), scoreR, headY);
  ctx.restore();

  // ── 数据行：行高自适应面板高度（20 行尽量全放下，最小 24u 后截断）──
  const top = 34 * u;
  const avail = H - top;
  const rowH = Math.max(24 * u, Math.min(56 * u, avail / rows.length));
  const visible = Math.min(rows.length, Math.floor(avail / rowH));
  const nameFont = Math.min(14 * u, rowH * 0.4);
  const scoreFont = Math.min(16 * u, rowH * 0.44);
  const rankR = Math.min(13 * u, rowH * 0.32);

  for (let i = 0; i < visible; i += 1) {
    const r = rows[i];
    const y = top + i * rowH;
    const cy = y + rowH / 2;

    // 自己一行：强调色淡底 + 左侧色条（自我定位）
    if (r.isSelf) {
      roundRect(ctx, 4 * u, y + 2 * u, W - 10 * u, rowH - 4 * u, rowH * 0.22);
      ctx.fillStyle = rgba(theme.accentColor, 0.16);
      ctx.fill();
      ctx.fillStyle = theme.accentColor || '#FF9F2E';
      ctx.fillRect(4 * u, y + 4 * u, 3 * u, rowH - 8 * u);
    }

    // 名次圆徽（前三金/银/铜，其余灰；内写白名次）
    const med = i < MEDALS.length ? MEDALS[i] : MEDAL_PLAIN;
    ctx.beginPath();
    ctx.arc(rankX, cy, rankR, 0, Math.PI * 2);
    ctx.fillStyle = i < 3 ? med[0] : (theme.bgDark ? 'rgba(255,255,255,0.1)' : 'rgba(62,39,35,0.08)');
    ctx.fill();
    ctx.lineWidth = Math.max(1, u);
    ctx.strokeStyle = i < 3 ? med[1] : (theme.bgDark ? 'rgba(255,255,255,0.16)' : 'rgba(62,39,35,0.14)');
    ctx.stroke();
    ctx.fillStyle = i < 3 ? '#FFFFFF' : theme.textColor;
    ctx.font = `900 ${Math.round(rankR * 1.15)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), rankX, cy + rankR * 0.42);

    // 昵称（超宽截断）
    ctx.fillStyle = r.isSelf ? (theme.accentColor || '#FF9F2E') : theme.textColor;
    ctx.font = `${r.isSelf ? 'bold ' : ''}${Math.round(nameFont)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, r.nickname, scoreR - nickX - 12 * u), nickX, cy + nameFont * 0.36);

    // 分数（右对齐；solo=分 / wins=胜）
    ctx.font = `bold ${Math.round(scoreFont)}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(kind === 'wins' ? tt('odc.wins', { n: r.score }) : tt('odc.score', { n: r.score }), scoreR, cy + scoreFont * 0.36);

    // 行间细分隔线
    if (i < visible - 1) {
      ctx.strokeStyle = theme.bgDark ? 'rgba(255,255,255,0.08)' : 'rgba(62,39,35,0.08)';
      ctx.lineWidth = Math.max(1, u * 0.5);
      ctx.beginPath();
      ctx.moveTo(14 * u, y + rowH);
      ctx.lineTo(W - 14 * u, y + rowH);
      ctx.stroke();
    }
  }
}
