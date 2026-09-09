/**
 * 磁力物理模型（纯函数，无运行时依赖，本地/AI/未来服务端共用同一份逻辑）
 *
 * 两玩法对"磁吸"的处理完全不同（规则对齐实体桌游，见 quick-specs/classic-reclaim-rule-2026-09-08.md）：
 *  - classic 经典踩雷：落点半径内有任意棋子 = 触磁（foul）。
 *      粘连的【整组磁珠（跨归属，含新落的这颗）】从场上移除、收回【放置者】手中，回合推进。
 *      场上棋子被吸走会腾出空间 → 不会死锁；最先把手牌放完者胜。
 *  - loot 磁吸夺宝：落子总是合法；若【己方连通磁力团】比相邻的某块【对方磁力团】更大，
 *      则吃掉那块（含链式合并后仍更大者）。己方棋子抱团=安全且更强，落单=易被吃。
 */
import { CONFIG } from './config.js';

export function dist(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

export function wouldSnap(boardPiece, px, py, radius = CONFIG.SNAP_RADIUS) {
  return dist(boardPiece.x, boardPiece.y, px, py) < radius;
}

/** classic：该空格是否为雷区（半径内存在任意棋子） */
export function isMineCell(board, x, y, radius = CONFIG.SNAP_RADIUS) {
  return board.some((p) => dist(p.x, p.y, x, y) < radius);
}

/** 与 seed 同 owner 且按 radius 连通的棋子集合（含 seed 自身） */
function clusterOf(pieces, seed, radius) {
  const group = [seed];
  const seen = new Set([seed.id]);
  const stack = [seed];
  while (stack.length) {
    const cur = stack.pop();
    for (const p of pieces) {
      if (seen.has(p.id) || p.owner !== seed.owner) continue;
      if (dist(cur.x, cur.y, p.x, p.y) < radius) {
        seen.add(p.id);
        group.push(p);
        stack.push(p);
      }
    }
  }
  return group;
}

/** classic 粘连组：与新子按 radius 连通的所有场上棋子（【跨归属】——实体玩具磁铁不分颜色） */
function clusterOfAll(pieces, seed, radius) {
  const group = [];
  const seen = new Set([seed.id]);
  const stack = [seed];
  while (stack.length) {
    const cur = stack.pop();
    for (const p of pieces) {
      if (seen.has(p.id)) continue;
      if (dist(cur.x, cur.y, p.x, p.y) < radius) {
        seen.add(p.id);
        group.push(p);
        stack.push(p);
      }
    }
  }
  return group;
}

/**
 * 核心：结算一次落子。纯数据，不修改外部对象。
 * @param {Array<{x,y,owner,id}>} board 现有棋盘
 * @param {object} piece 新落子 { x, y, owner, id }
 * @param {number} radius
 * @param {'classic'|'loot'} mode
 * @returns {object}
 *   classic: { landed, mine, board, hitIds }
 *     —— mine=true 表示触磁：hitIds = 粘连整组（跨归属、含链式）；board = 移除整组后的盘面
 *       （新子不落盘，与整组一起收回放置者手中，由 rules.js 结算手牌）
 *   loot:    { landed, board, snapIds, snappedCount } —— board 含新子、移除被吃子
 */
export function simulateMagnet(board, piece, radius = CONFIG.SNAP_RADIUS, mode = 'classic', immuneId = -1) {
  if (!isValidCell(piece.x, piece.y)) return { landed: false, board, mine: false, snapIds: [], snappedCount: 0, hitIds: [] };
  if (board.some((p) => p.x === piece.x && p.y === piece.y)) return { landed: false, board, mine: false, snapIds: [], snappedCount: 0, hitIds: [] };

  if (mode === 'classic') {
    const cluster = clusterOfAll(board, piece, radius);
    const mine = cluster.length > 0;
    if (!mine) {
      return { landed: true, mine: false, hitIds: [], board: [...board.map((p) => ({ ...p })), { ...piece }], snapIds: [], snappedCount: 0 };
    }
    const hitIds = cluster.map((p) => p.id);
    const removed = new Set(hitIds);
    return {
      landed: true,
      mine: true,
      hitIds,
      board: board.filter((p) => !removed.has(p.id)).map((p) => ({ ...p })),
      snapIds: [],
      snappedCount: hitIds.length,
    };
  }

  // ── loot：磁力团强度捕获（immuneId 为对手刚落的那颗，本手不可被吃，破除即时tempo）──
  const work = board.map((p) => ({ ...p }));
  work.push({ ...piece });
  const myCluster = clusterOf(work, piece, radius);
  const mySize = myCluster.length;

  const capturedIds = new Set();
  const visitedOpp = new Set();
  for (const m of myCluster) {
    for (const p of work) {
      if (p.owner === piece.owner || visitedOpp.has(p.id) || capturedIds.has(p.id)) continue;
      if (dist(m.x, m.y, p.x, p.y) >= radius) continue;
      const oppCluster = clusterOf(work, p, radius);
      oppCluster.forEach((q) => visitedOpp.add(q.id));
      if (oppCluster.some((q) => q.id === immuneId)) continue; // 含免疫子→整团本手不吃
      const win = CONFIG.LOOT_CAPTURE === 'gte' ? mySize >= oppCluster.length : mySize > oppCluster.length;
      if (win) {
        oppCluster.forEach((q) => capturedIds.add(q.id));
      }
    }
  }
  const snapIds = [...capturedIds];
  const finalBoard = work.filter((p) => !capturedIds.has(p.id));
  return { landed: true, mine: false, hitIds: snapIds, board: finalBoard, snapIds, snappedCount: snapIds.length };
}

/** 棋盘边界：默认 2 人，对局开始前用 setBoardBounds 切换 */
let _bounds = makeBoardBounds(11, 13);
export function makeBoardBounds(cols, rows) {
  return (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < cols && y < rows;
}
export function setBoardBounds(boundsFn) {
  _bounds = boundsFn;
}
export function isValidCell(x, y) {
  return _bounds(x, y);
}

/** 棋子 id 生成（对局开始时 resetIdSeq 归零，保证可复现） */
let _idSeq = 0;
export function newPieceId() {
  _idSeq += 1;
  return _idSeq;
}
export function resetIdSeq() {
  _idSeq = 0;
}