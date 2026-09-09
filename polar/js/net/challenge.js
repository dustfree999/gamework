/**
 * 挑战码（好友异步约战，零后端）——quick-specs/magnet-semantics-fix-2026-09-07.md
 *
 * 设计：本游戏空盘开局、完全确定性，无需传棋谱。挑战 = "我用 X 步放完 / 踩雷 Y 次，
 * 你以同样配置（玩法/人数/AI难度）来打破"。挑战码只携带配置+成绩。
 *
 * 编码：JSON → UTF-8 → base64url（小游戏无 btoa，自带实现）。
 * 传递：微信分享 query / H5 URL ?c= / 剪贴板口令。
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
    else if (c < 0xd800 || c >= 0xe000) { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    else {
      i += 1;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return out;
}

function utf8Decode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) { s += String.fromCharCode(b); i += 1; }
    else if (b < 0xe0) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; }
    else if (b < 0xf0) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; }
    else {
      const c = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
      const u = c - 0x10000;
      s += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      i += 4;
    }
  }
  return s;
}

function b64urlEncode(str) {
  const bytes = utf8Encode(str);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
    if (b1 !== undefined) out += B64[((b1 & 15) << 2) | ((b2 || 0) >> 6)];
    if (b2 !== undefined) out += B64[b2 & 63];
  }
  return out;
}

function b64urlDecode(s) {
  const rev = {};
  for (let i = 0; i < 64; i += 1) rev[B64[i]] = i;
  const bytes = [];
  for (let i = 0; i < s.length; i += 4) {
    const n0 = rev[s[i]] ?? 0;
    const n1 = rev[s[i + 1]] ?? 0;
    const n2 = rev[s[i + 2]];
    const n3 = rev[s[i + 3]];
    bytes.push((n0 << 2) | (n1 >> 4));
    if (n2 !== undefined) bytes.push(((n1 & 15) << 4) | (n2 >> 2));
    if (n3 !== undefined) bytes.push(((n2 & 3) << 6) | n3);
  }
  return utf8Decode(bytes);
}

/**
 * 编码挑战
 * @param {{mode:string, players:number, difficulty:string, steps:number, fouls:number, looted?:number}} data
 * @returns {string} base64url 挑战码
 */
export function encodeChallenge(data) {
  const compact = {
    v: 1,
    m: { classic: 0, loot: 1, solo: 2 }[data.mode] ?? 0,
    p: data.players,
    d: { easy: 0, normal: 1, hard: 2 }[data.difficulty] ?? 1,
    s: data.steps,
    f: data.fouls,
  };
  if (compact.m === 1) compact.l = data.looted || 0;
  if (data.seed != null) compact.z = data.seed; // G6：同盘比拼——携带种子
  return b64urlEncode(JSON.stringify(compact));
}

/**
 * 解码挑战（非法/损坏返回 null）
 */
export function decodeChallenge(code) {
  try {
    const o = JSON.parse(b64urlDecode(String(code)));
    if (!o || o.v !== 1 || !o.p || o.s == null) return null;
    return {
      mode: o.m === 1 ? 'loot' : o.m === 2 ? 'solo' : 'classic',
      players: Math.max(2, Math.min(4, o.p)),
      difficulty: ['easy', 'normal', 'hard'][o.d] || 'normal',
      steps: o.s,
      fouls: o.f || 0,
      looted: o.l || 0,
      seed: o.z != null ? o.z : null,
    };
  } catch (e) {
    return null;
  }
}

/** 从启动参数里提取挑战码（微信 query / H5 search 通用） */
export function extractChallenge(query) {
  if (!query) return null;
  const raw = query.c || query.challenge;
  return raw ? decodeChallenge(raw) : null;
}