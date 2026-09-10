/**
 * AI 落点评估（纯函数，可 node 单测）——双模式，经模拟验证平衡
 *  classic 收回规则（对齐实体桌游）：触磁=粘连整组（跨归属）回【放置者】手——吸谁的子都亏手牌。
 *    策略：有安全格绝不触磁；安全格里选"对手剩余安全格最少"（围堵，仿真 vs 随机 73%/vs 躲远 79%）；
 *    被迫触磁（无安全格）时最大化「落子后我方互不相邻的安全落子组」（见 safePacking 与下方注释），
 *    不再单纯「吸最少」——那会把自己锁进零进展死循环；并列时随机取点。easy 以 30% 概率随机落子。
 *  loot 捕获：最大化本步吃子数（磁力团强度规则下由 simulateMagnet 给出真实捕获）
 *  loot 捕获：最大化本步吃子数（磁力团强度规则下由 simulateMagnet 给出真实捕获）
 */
import { simulateMagnet, isMineCell, setBoardBounds, makeBoardBounds, dist } from '../core/magnet.js';
import { CONFIG } from '../core/config.js';

/**
 * 安全格分支的评分噪声（越大越容易选错，用于分档）。
 * 2026-09-10 随「触磁策略修复」重调：修复前 AI 在收官阶段会自锁（反复触磁同一格、手牌无限膨胀），
 * 相当于白送玩家胜利，故当时 15/3 的噪声已能给出文档里的难度矩阵；修好后 AI 真正会打收官，
 * 原噪声显得过强（实测 9×10 手牌15 二人局：spread vs normal 65%→18%、congest vs normal 51%→20%）。
 * 重调后实测（test/sim-experience.mjs ②，200 局/格，交替先手）：
 *   spread  easy 95% / normal 34% / hard 7%；congest easy 93% / normal 49% / hard 17%
 *   —— easy 人人可赢、normal 有来有回、hard 是天花板，且各档「会玩(congest) > 新手直觉(spread)」次序正确
 *   （旧矩阵 spread 反而高于 congest，是自锁 AI 造成的假象）。
 */
const NOISE = { easy: 60, normal: 40, hard: 12 };
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
 * 盘面上「互不相邻的安全落子」最大组（贪心）：在某个安全格落子后，半径内的其它安全格会被一并封掉。
 * 用于判定一次触磁是否真能解锁——组数 ≥2 时对手一手最多封掉其中一个（半径 1.65 内覆盖不到另一个），
 * 故它是「我下一手仍有安全落子」的严格下界。
 */
function safePacking(board, cols, rows) {
  const cells = [];
  const occ = new Set(board.map((p) => p.x + ',' + p.y));
  for (let x = 0; x < cols; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      if (occ.has(x + ',' + y)) continue;
      if (!isMineCell(board, x, y, CONFIG.SNAP_RADIUS)) cells.push({ x, y });
    }
  }
  const used = new Array(cells.length).fill(false);
  let n = 0;
  for (let i = 0; i < cells.length; i += 1) {
    if (used[i]) continue;
    n += 1;
    for (let j = i; j < cells.length; j += 1) {
      if (!used[j] && dist(cells[i].x, cells[i].y, cells[j].x, cells[j].y) < CONFIG.SNAP_RADIUS) used[j] = true;
    }
  }
  return n;
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
  // 被迫触磁（无安全格）：只挑「吸走最少」会把自己锁死——
  // k=1 的触磁只开出一个洞，对手下一手正好补回原处，局面精确复现 → 双方零进展死循环，
  // 被锁方手牌无限膨胀（2026-09-10 审计 + H5 真机复现：AI 连 3 手落在同一格，手牌 12:6 且永不自止）。
  // 改为最大化「落子后我方互不相邻的安全落子组」：组数越大，对手一手能封掉的比例越小、我能续的安全手越多，
  // 僵局与座位锁定即被打破（组数 ≥2 时对手一手封不完，是「我下一手仍有安全落子」的严格下界）。
  // 同档再比手牌代价（吸附组越小越省），最后在并列中随机——避免每手都锁定同一格（玩家看到的「AI 总下同一个地方」）。
  // 选型实测（150 局/组，座位胜率，基线 3 人 33.3% / 4 人 25%）：
  //   旧「吸最少」3人 84.7/9.3/6.0、4人 52.7/47.3/0.0/0.0（三/四号位永远赢不了）
  //   「组数封顶 2」3人 84.7/9.3/6.0（无效，同档仍取最小吸附数）
  //   「最大化组数」3人 47.3/30.0/22.7 + 40/150 局自然打完、4人 36.0/23.3/24.0/16.7 ✅
  //   「吸最多」接近但更慢（3人 44.7/28.7/26.7 均步 49.8 vs 41.1），故不采用
  if (safe.length === 0) {
    const scored = empties.map((c) => {
      const sim = simulateMagnet(board, { x: c.x, y: c.y, owner: game.turn, id: -2 }, CONFIG.SNAP_RADIUS, 'classic', -1);
      const k = sim.mine ? sim.hitIds.length : 0;
      return { c, k, pack: safePacking(sim.board, cols, rows) };
    });
    let best = scored[0];
    for (const s of scored) {
      if (s.pack > best.pack || (s.pack === best.pack && s.k < best.k)) best = s;
    }
    const tied = scored.filter((s) => s.pack === best.pack && s.k === best.k);
    return tied[Math.floor(Math.random() * tied.length)].c;
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
