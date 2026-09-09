/**
 * AI 落点评估（纯函数，可 node 单测）——双模式，经模拟验证平衡
 *  classic 收回规则（对齐实体桌游）：触磁=粘连整组（跨归属）回【放置者】手——吸谁的子都亏手牌。
 *    策略：有安全格绝不触磁；安全格里选"对手剩余安全格最少"（围堵，仿真 vs 随机 73%/vs 躲远 79%）；
 *    被迫触磁（无安全格）时选吸走最少的一颗。easy 以 30% 概率随机落子（可感知地触磁回手）。
 *  loot 捕获：最大化本步吃子数（磁力团强度规则下由 simulateMagnet 给出真实捕获）
 */
import { simulateMagnet, isMineCell, setBoardBounds, makeBoardBounds, dist } from '../core/magnet.js';
import { CONFIG } from '../core/config.js';

const NOISE = { easy: 60, normal: 15, hard: 3 };
const RANDOM_P = { easy: 0.3, normal: 0, hard: 0 };

function emptyCells(board, cols, rows) {
  const occ = new Set(board.map((p) => p.x + ',' + p.y));
  const out = [];
  for (let x = 0; x < cols; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      if (!occ.has(x + ',' + y)) out.push({ x, y });
    }
  }
  return out;
}

/** 落子后全盘剩余安全格数（classic 围堵度量的核心） */
function safeCountAfter(board, cols, rows, cell) {
  const nb = [...board, { x: cell.x, y: cell.y, owner: -9 }];
  let c = 0;
  for (let x = 0; x < cols; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      if (nb.some((p) => p.x === x && p.y === y)) continue;
      if (!isMineCell(nb, x, y, CONFIG.SNAP_RADIUS)) c += 1;
    }
  }
  return c;
}

/**
 * @param {object} game 规则状态
 * @param {'easy'|'normal'|'hard'} difficulty
 * @returns {{x,y}|null} null 仅在棋盘无空格时（理论兜底）
 */
export function chooseMove(game, difficulty = 'normal') {
  const { cols, rows, board } = game;
  const mode = game.mode === 'solo' ? 'classic' : game.mode; // solo 复用 classic 安全格逻辑
  setBoardBounds(makeBoardBounds(cols, rows));
  const empties = emptyCells(board, cols, rows);
  if (empties.length === 0) return null;

  const noise = NOISE[difficulty] ?? NOISE.normal;
  const randomP = RANDOM_P[difficulty] ?? 0;

  if (mode === 'loot') {
    // 捕获收益最大；无捕获时倾向与自己棋子抱团（磁力团越大越安全越强）
    let best = null; let bestScore = -Infinity;
    for (const c of empties) {
      const sim = simulateMagnet(board, { x: c.x, y: c.y, owner: game.turn, id: -1 }, CONFIG.SNAP_RADIUS, 'loot', game.lastPlacedId ?? -1);
      if (!sim.landed) continue;
      const captures = sim.snapIds.length;
      const ownAdj = board.filter((p) => p.owner === game.turn && dist(p.x, p.y, c.x, c.y) < CONFIG.SNAP_RADIUS).length;
      let score = captures * 100 + ownAdj * 8 + Math.random() * noise;
      if (captures === 0 && ownAdj === 0) score -= 20; // 别乱落孤子
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (randomP > 0 && Math.random() < randomP) return empties[Math.floor(Math.random() * empties.length)];
    return best;
  }

  // classic（收回规则）
  const safe = empties.filter((c) => !isMineCell(board, c.x, c.y, CONFIG.SNAP_RADIUS));
  // easy=新手行为：部分随机落在【任意空格】（可能触磁回手一大串，玩家可感知其犯错）
  if (randomP > 0 && Math.random() < randomP) return empties[Math.floor(Math.random() * empties.length)];
  // 被迫触磁（无安全格）：选吸附整组最小的落点，把手牌损失压到最低
  if (safe.length === 0) {
    let best = empties[0]; let bn = 1e9;
    for (const c of empties) {
      const sim = simulateMagnet(board, { x: c.x, y: c.y, owner: game.turn, id: -2 }, CONFIG.SNAP_RADIUS, 'classic', -1);
      const n = sim.mine ? sim.hitIds.length : 0;
      if (n < bn) { bn = n; best = c; }
    }
    return best;
  }
  // 安全格内围堵：落子后全盘剩余安全格最少（对手更早被迫触磁）
  // hard 加一层前瞻：remain=0 立即逼对手触磁（+大胜）；若对手回手能把剩余清零则我被迫触磁（大劣）
  let best = null; let bestScore = -Infinity;
  const deep = difficulty === 'hard' && game.mode === 'classic';
  const scored = safe.map((c) => ({ c, remain: safeCountAfter(board, cols, rows, c) }));
  if (!deep) {
    for (const { c, remain } of scored) {
      const s = -remain * 10 + Math.random() * noise;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }
  scored.sort((a, b) => a.remain - b.remain);
  const cands = scored.slice(0, 10);
  for (const { c, remain } of cands) {
    if (remain === 0) { best = c; bestScore = 1e9; break; } // 一步封死：对手必触磁
    const b1 = [...board, { x: c.x, y: c.y, owner: game.turn, id: -2 }];
    const oppSafe = [];
    for (let x = 0; x < cols; x += 1) for (let y = 0; y < rows; y += 1) {
      if (b1.some((p) => p.x === x && p.y === y)) continue;
      if (!isMineCell(b1, x, y, CONFIG.SNAP_RADIUS)) oppSafe.push({ x, y });
    }
    let oppCanKill = false;
    if (oppSafe.length) {
      // 对手任一围堵手能把剩余清零 → 我下一手被迫触磁
      for (const o of oppSafe) {
        if (safeCountAfter(b1, cols, rows, o) === 0) { oppCanKill = true; break; }
      }
    }
    let s = -remain * 10 + (oppCanKill ? -300 : 0) + Math.random() * noise;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}
