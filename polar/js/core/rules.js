/**
 * 玩法规则：玩法1 经典踩雷 + 玩法2 磁吸夺宝（2-4 人，排名制）
 * 规则对齐实体桌游，见 quick-specs/classic-reclaim-rule-2026-09-08.md
 *  - classic：触磁（foul）= 粘连的整组磁珠（跨归属）收回【放置者】手中，回合推进；
 *             最先放完手牌者胜（empty）；盘满（理论罕见）按剩余手牌排名。
 *  - loot：落子总合法；己方磁力团 > 相邻对方磁力团 → 吃掉对方；终局按战利品数排名。
 * 纯逻辑，无运行时依赖，可单测。
 */
import { simulateMagnet, isMineCell, setBoardBounds, resetIdSeq, newPieceId } from './magnet.js';
import { CONFIG } from './config.js';

/** 确定性种子随机（mulberry32）：solo 障碍布局可复现，供挑战码 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 贪心可达分：从该局面出发，每步选一个安全格，能放多少颗（solo 难度度量） */
function greedyReachableScore(cols, rows, startBoard) {
  const R = CONFIG.SNAP_RADIUS;
  const board = startBoard.map((p) => ({ x: p.x, y: p.y }));
  const occ = new Set(board.map((p) => p.x + ',' + p.y));
  const isSafe = (x, y) => board.every((p) => Math.hypot(p.x - x, p.y - y) >= R);
  let score = 0;
  let guard = 0;
  while (guard++ < 400) {
    let pick = null;
    for (let x = 0; x < cols && !pick; x += 1) {
      for (let y = 0; y < rows && !pick; y += 1) {
        if (!occ.has(x + ',' + y) && isSafe(x, y)) { pick = { x, y }; break; }
      }
    }
    if (!pick) break;
    board.push(pick);
    occ.add(pick.x + ',' + pick.y);
    score += 1;
  }
  return score;
}

/**
 * 生成 solo 障碍布局：随机撒 N 颗中性雷（owner=-1）+ 可玩性校验（拒绝采样）
 * 退化布局过滤（balance-check）：障碍聚堆→太简单；铺太开→开局即死。
 * 接受条件：贪心可达分 ∈ [11, 16]（技巧空间均匀，挑战码公平可复现）
 */
function makeObstacles(cols, rows, count, rand) {
  let best = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const obs = [];
    const used = new Set();
    let guard = 0;
    while (obs.length < count && guard++ < 500) {
      const x = Math.floor(rand() * cols);
      const y = Math.floor(rand() * rows);
      const k = x + ',' + y;
      if (used.has(k)) continue;
      used.add(k);
      obs.push({ x, y, owner: -1, id: newPieceId() });
    }
    const reach = greedyReachableScore(cols, rows, obs);
    if (reach >= 11 && reach <= 16) return obs;
    if (!best || Math.abs(reach - 13.5) < Math.abs(best.reach - 13.5)) best = { obs, reach };
  }
  return best ? best.obs : null;
}

/**
 * 创建一局
 * @param {number} playerCount 1-4（1=solo 单人挑战）
 * @param {string} mode 'classic' | 'loot' | 'solo'
 * @param {number} seed
 * @param {Array<'human'|'ai'>} playerTypes
 */
export function createGame(playerCount, mode = 'classic', seed = Date.now(), playerTypes = null) {
  const solo = mode === 'solo';
  const n = solo ? 1 : Math.max(2, Math.min(4, playerCount));
  const idx = solo ? 0 : n - 2;
  const boardCfg = CONFIG.BOARD[mode] || CONFIG.BOARD.classic;
  const cols = boardCfg.cols[idx];
  const rows = boardCfg.rows[idx];
  const piecesEach = boardCfg.pieces[idx];

  resetIdSeq();
  setBoardBoundsFor(cols, rows);

  const obstacles = solo ? (makeObstacles(cols, rows, boardCfg.obstacles[idx], mulberry32(seed)) || []) : [];

  return {
    mode,
    playerCount: n,
    cols,
    rows,
    piecesEach,
    seed,
    playerTypes: playerTypes && playerTypes.length === n
      ? playerTypes.slice(0, n)
      : Array.from({ length: n }, () => 'human'),
    turn: 0,
    board: obstacles,
    hands: Array.from({ length: n }, () => piecesEach),
    scored: Array.from({ length: n }, () => 0), // loot 战利品
    totalPlaced: 0,
    over: false,
    endReason: null, // 'empty' | 'full' | 'foul'(solo 触磁即止)
    winner: -1,
    ranking: [],
    stats: Array.from({ length: n }, () => ({ placed: 0, snappedAway: 0, fouls: 0, looted: 0 })),
    lastMove: null,
    lastPlacedId: -1, // 最近落子 id（loot 免疫：对手下一手不能吃它）
    boardMax: obstacles.length, // classic 防停滞：盘面棋子历史最高（每次安全落子刷新）
    stall: 0, // 距上次刷新 boardMax 的连续手牌数；达 CLASSIC_STALL_LIMIT 判终局
    history: [],
    version: 1,
  };
}

export function setBoardBoundsFor(cols, rows) {
  setBoardBounds((x, y) =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < cols && y < rows
  );
}

/** 判断某座位是否 AI */
export function isAI(game, idx) {
  return game.playerTypes ? game.playerTypes[idx] === 'ai' : false;
}

/**
 * 当前玩家落子
 * @returns {{ok:boolean, game, foul?:boolean, error?:string, result?:object}}
 *  classic 触磁：ok=true, foul=true——粘连整组（含新子）收回放置者手中，回合推进（正常一手）
 */
export function placePiece(game, x, y) {
  if (game.over) return { ok: false, game, error: 'game over' };
  // 多局并发安全：magnet._bounds 是模块级全局。服务端（云函数实例/pgserver）单进程承载多房间，
  // 其他房间的 createGame/chooseMove 会把边界改写成自己的尺寸，若沿用则本局落子按错误棋盘判
  // 「非法落点」（3/4 人局右侧/底部列偶发不能放置）。每手落子前按本局 cols/rows 重置。
  setBoardBoundsFor(game.cols, game.rows);
  const owner = game.turn;
  if (game.hands[owner] <= 0) return { ok: false, game, error: 'no pieces left' };

  const piece = { x, y, owner, id: newPieceId() };
  // solo 复用 classic 的雷区判定（障碍+己方子皆为雷）
  const physMode = game.mode === 'solo' ? 'classic' : game.mode;
  const result = simulateMagnet(game.board, piece, CONFIG.SNAP_RADIUS, physMode, game.lastPlacedId ?? -1);
  if (!result.landed) return { ok: false, game, error: 'illegal cell' };

  // solo 踩雷 → 游戏立即结束（生存玩法：分数=已放子数）
  if (result.mine && game.mode === 'solo') {
    const g2 = {
      ...game,
      board: [...game.board],
      over: true,
      endReason: 'foul',
      winner: 0,
      ranking: [0],
      stats: game.stats.map((s, i) => (i === owner ? { ...s, fouls: s.fouls + 1 } : s)),
      lastMove: { type: 'foul', x, y, owner, snapIds: [], hitIds: result.hitIds, lootCount: 0 },
      version: game.version + 1,
    };
    return { ok: true, game: g2, result, soloEnd: true };
  }
  // classic 触磁（实体规则）：新子 + 粘连整组（跨归属）全部收回放置者手中，回合推进。
  // result.board 已由 simulateMagnet 移除被吸子；手牌 = -1(新子离手) +1(新子回手) +N(整组回手) = +N
  if (result.mine && game.mode === 'classic') {
    const n = result.hitIds.length; // 被吸走的场上磁珠数（新子不落盘，与它们一起回手）
    const g = {
      ...game,
      board: result.board,
      hands: game.hands.map((h, i) => (i === owner ? h + n : h)),
      totalPlaced: game.totalPlaced, // 新子未留在盘上，不计入
      stats: game.stats.map((s, i) => ({
        placed: s.placed,
        snappedAway: s.snappedAway + (i !== owner ? countRemoved(result.board, game.board, i) : 0),
        fouls: s.fouls + (i === owner ? 1 : 0),
        looted: s.looted,
      })),
      lastMove: { type: 'foul', x, y, owner, snapIds: [], hitIds: result.hitIds, lootCount: 0 },
      lastPlacedId: -1, // 触磁无"刚落的安全子"
      stall: (game.stall || 0) + 1, // 盘面缩水，不可能刷新高水位
      history: [...game.history, { owner, x, y, type: 'foul' }],
      version: game.version + 1,
    };
    g.turn = nextTurn(g);
    const verdict = judge(g, owner);
    if (verdict.over) {
      g.over = true;
      g.endReason = verdict.reason;
      g.winner = verdict.winner;
      g.ranking = computeRanking(g);
    }
    return { ok: true, foul: true, game: g, result };
  }

  const lootCount = game.mode === 'loot' ? result.snapIds.length : 0;
  const type = game.mode === 'loot' && lootCount > 0 ? 'loot' : 'land';

  const g = {
    ...game,
    board: result.board,
    hands: game.hands.map((h, i) => (i === owner ? h - 1 : h)),
    scored: game.scored.map((s, i) => (i === owner ? s + lootCount : s)),
    totalPlaced: game.totalPlaced + 1,
    stats: game.stats.map((s, i) => ({
      placed: s.placed + (i === owner ? 1 : 0),
      snappedAway: s.snappedAway + (game.mode === 'loot' && i !== owner ? countRemoved(result.board, game.board, i) : 0),
      fouls: s.fouls,
      looted: s.looted + (i === owner ? lootCount : 0),
    })),
    lastMove: { type, x, y, owner, snapIds: result.snapIds, hitIds: result.hitIds, lootCount },
    lastPlacedId: piece.id,
    history: [...game.history, { owner, x, y, type }],
    version: game.version + 1,
  };
  // classic 防停滞：安全落子刷新盘面高水位则清零计数，否则累计（触磁回手必然不刷新）
  if (game.mode === 'classic') {
    const bmax = game.boardMax != null ? game.boardMax : game.board.length;
    const st = game.stall || 0;
    if (g.board.length > bmax) { g.boardMax = g.board.length; g.stall = 0; }
    else { g.boardMax = bmax; g.stall = st + 1; }
  }

  g.turn = nextTurn(g);

  // 胜负判定
  const verdict = judge(g, owner);
  if (verdict.over) {
    g.over = true;
    g.endReason = verdict.reason;
    g.winner = verdict.winner;
    g.ranking = computeRanking(g);
  }

  return { ok: true, game: g, result };
}

/** 统计某 owner 本回合从盘上消失的棋子数（classic 被吸走 / loot 被吃） */
function countRemoved(newBoard, oldBoard, owner) {
  const now = new Set(newBoard.filter((p) => p.owner === owner).map((p) => p.id));
  return oldBoard.filter((p) => p.owner === owner && !now.has(p.id)).length;
}

/** 下一位仍有手牌的玩家；都放完返回 -1 */
function nextTurn(g) {
  const n = g.playerCount;
  let t = (g.turn + 1) % n;
  for (let i = 0; i < n; i += 1) {
    if (g.hands[t] > 0) return t;
    t = (t + 1) % n;
  }
  return -1;
}

/**
 * 胜负裁决：
 *  classic：owner 安全落子放完手牌→owner 赢(empty)；
 *           盘面高水位连续 CLASSIC_STALL×人数 手未刷新→僵局终局(stall，剩余手牌少者胜)；
 *           盘满（理论罕见）按剩余手牌排名。
 *           触磁不再判负——粘连组回手会腾出空间；僵局由 stall 计数兜底（3人+实测会振荡）。
 *  loot：必须打到手牌全空或棋盘满，再按战利品数决胜负（否则退化成先手赛跑）。
 */
function judge(g, owner) {
  if (g.mode === 'solo') {
    // solo：踩雷即时结束（在 placePiece 处理）；无安全格=完美生存收官（与"棋盘放满"区分文案）
    if (isBoardFull(g)) return { over: true, reason: 'full', winner: 0 };
    if (!hasSafeCell(g)) return { over: true, reason: 'nomove', winner: 0 };
    return { over: false };
  }
  if (g.mode === 'classic') {
    if (g.hands[owner] <= 0) return { over: true, reason: 'empty', winner: owner };
    if ((g.stall || 0) >= CONFIG.CLASSIC_STALL * g.playerCount) return { over: true, reason: 'stall', winner: fewestHands(g) };
    if (isBoardFull(g)) return { over: true, reason: 'full', winner: fewestHands(g) };
    return { over: false };
  }
  // loot：必须打到手牌全空或棋盘满，再按战利品数决胜负（否则退化成先手赛跑）
  if (g.hands.every((h) => h === 0) || isBoardFull(g)) {
    return { over: true, reason: 'full', winner: bestLooter(g) };
  }
  return { over: false };
}

/** 剩余手牌最少的玩家（classic 盘满终局的赢家兜底） */
function fewestHands(g) {
  let bi = 0;
  g.hands.forEach((h, i) => { if (h < g.hands[bi]) bi = i; });
  return bi;
}

function bestLooter(g) {
  let bi = 0;
  g.scored.forEach((s, i) => { if (s > g.scored[bi]) bi = i; });
  return bi;
}

/** 棋盘是否已无空格 */
export function isBoardFull(g) {
  return g.board.length >= g.cols * g.rows;
}

/** 全盘剩余安全格数（G9 HUD：核心策略变量可见化） */
export function countSafeCells(g) {
  const occupied = new Set(g.board.map((p) => p.x + ',' + p.y));
  let c = 0;
  for (let x = 0; x < g.cols; x += 1) {
    for (let y = 0; y < g.rows; y += 1) {
      if (occupied.has(x + ',' + y)) continue;
      if (!isMineCell(g.board, x, y, CONFIG.SNAP_RADIUS)) c += 1;
    }
  }
  return c;
}

/** 盘上是否还存在安全格（半径内无棋子）。solo 用于"完美生存收官"判定 */
export function hasSafeCell(g) {
  const occupied = new Set(g.board.map((p) => p.x + ',' + p.y));
  for (let x = 0; x < g.cols; x += 1) {
    for (let y = 0; y < g.rows; y += 1) {
      if (occupied.has(x + ',' + y)) continue;
      if (!isMineCell(g.board, x, y, CONFIG.SNAP_RADIUS)) return true;
    }
  }
  return false;
}

/** 兼容旧调用：手牌全空或棋盘满 */
export function isGameOver(g) {
  return g.hands.every((h) => h === 0) || isBoardFull(g);
}

/**
 * 终局排名（从胜到败）：
 *  classic → 剩余手牌升序（放完者第一；触磁回手会加回手牌，天然惩罚）
 *  loot    → 战利品降序
 */
export function computeRanking(g) {
  if (g.mode === 'loot') {
    return g.hands.map((h, i) => ({ i, key: -g.scored[i] })).sort((a, b) => a.key - b.key).map((r) => r.i);
  }
  // classic：按剩余手牌升序（winner 手牌 0 自然第一；empty/full 两种终局同口径）
  return g.hands.map((h, i) => ({ i, key: h })).sort((a, b) => a.key - b.key).map((r) => r.i);
}

/** 竞赛排名：同分并列同名次 */
export function rankOf(g) {
  const ranking = g.ranking && g.ranking.length ? g.ranking : computeRanking(g);
  const out = {};
  let prevKey = null;
  let prevRank = 0;
  ranking.forEach((pi, idx) => {
    const key = g.mode === 'loot' ? g.scored[pi] : g.hands[pi];
    if (prevKey !== null && key === prevKey) out[pi] = prevRank;
    else { out[pi] = idx + 1; prevRank = idx + 1; prevKey = key; }
  });
  return out;
}
