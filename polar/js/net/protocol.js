/**
 * 联机协议（纯数据定义，客户端/中转服务器/未来云函数共用）
 * 权威模型：主机权威（host-authority）——房主本地跑 rules.js 校验并广播快照；
 * simulateMagnet 是确定性纯函数，各端重放结果一致。
 * 传输可替换：H5/开发期走本地 ws 中转（server/relay.js）；微信上线换 CloudSync（云函数+watch）。
 */

// 客户端 → 服务器
export const C2S = {
  HOST: 'host', // { mode, players } 开房
  JOIN: 'join', // { roomId } 加入
  LEAVE: 'leave',
  SET_AI: 'setAi', // { seat, on } 房主切换 AI 位
  KICK: 'kick', // { seat } 房主移除座位（预留）
  START: 'start', // 房主开局 → 广播 started{game 初始快照}
  MOVE: 'move', // { x, y } 当前回合座位的落子请求（发给主机）
  SYNC_REQ: 'syncReq', // 请求全量状态（重连）
};

// 服务器 → 客户端
export const S2C = {
  HOSTED: 'hosted', // { roomId }
  JOINED: 'joined', // { roomId, seat, roster }
  ROSTER: 'roster', // { roster: [{seat,type:'human'|'ai'|'empty',name,host}] }
  STARTED: 'started', // { game 初始快照（含 seed，各端本地 createGame 同盘面） }
  MOVE_ACK: 'moveAck', // { game 新快照, lastMove }（主机→全体；非主机纯接收）
  REJECT: 'reject', // { reason } 非法落子等
  LEFT: 'left', // { seat } 有人离开
  ERROR: 'error', // { msg }
};

/** 生成 6 位房间码（大写字母数字，去掉易混 0O1I） */
export function makeRoomId(rand = Math.random) {
  const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += CH[Math.floor(rand() * CH.length)];
  return s;
}

/** 协议版本（云函数迁移时校验兼容） */
export const PROTOCOL_VERSION = 1;
