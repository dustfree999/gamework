/**
 * RoomSession：联机对局编排（大厅"开始对战"后接管 board 场景）
 *
 * 主机权威：
 *  - 房主（seat1）持有 rules.js 权威 game，校验所有 move、跑 AI 位、广播 moveAck{game 快照}
 *  - 非主机：本地只渲染收到的快照；自己的落子发 move 给主机
 *  - started：广播 {seed,mode,players}，各端 createGame 同盘面（确定性）
 *  - 座位映射：seat i ↔ player i-1（playerTypes 按 roster 生成）
 */
import { GameState } from '../core/state.js';
import { createGame, placePiece } from '../core/rules.js';
import { chooseMove } from '../ai/evaluator.js';
import { CONFIG } from '../core/config.js';

export class RoomSession {
  constructor({ room, aiDifficulty = 'normal', onUpdate, onOver }) {
    this.room = room;
    this.aiDifficulty = aiDifficulty;
    this.onUpdate = onUpdate || (() => {});
    this.onOver = onOver || (() => {});
    this.game = null;
    this.aiThink = 0;
    this.pending = null; // 非主机：已发 move 等待 ack（乐观锁）
    this._prevOnEvent = room.onEvent; // 链式：保留 main 的监听（left/rehomed/大厅期 started）
    room.onEvent = (type, payload) => {
      this._net(type, payload);
      if (this._prevOnEvent) this._prevOnEvent(type, payload);
    };
  }

  /** 房主开局：按 roster 生成 playerTypes，广播 started。
   *  relay（主机权威）：空位自动转 AI 补位（防无人控制死锁）。
   *  cloud/pg（服务端权威）：服务端开局会压缩空位（player i ↔ seat i+1），
   *  本地占位必须同口径——否则房主先按 4 人建盘，权威快照修正人数后棋盘几何滞后一拍（用户实测格子不一致根因之一）。 */
  start(roster, mode) {
    const filled = this.room.transport === 'relay' ? roster : roster.filter((s) => s.type !== 'empty');
    const playerTypes = filled.map((s) => (s.type === 'human' ? 'human' : 'ai'));
    const seed = Math.floor(Math.random() * 1e9);
    const players = playerTypes.length;
    this._begin({ seed, mode, players, playerTypes });
    this.room.broadcast('started', { seed, mode, players, playerTypes, difficulty: this.aiDifficulty });
  }

  /** 废弃会话：清掉链式监听后旧实例不再处理任何事件（开局失败回大厅时调用） */
  dispose() { this._disposed = true; this._clearPendingWatchdog(); }

  _begin({ seed, mode, players, playerTypes }) {
    this.game = createGame(players, mode, seed, playerTypes);
    this._clearPendingWatchdog();
    this.pending = null;
    this._overFired = false;
    this.onUpdate(this.game);
  }

  _net(type, p) {
    if (this._disposed) return;
    // 断线/离开：主机把已离场的【人类】座位转 AI 接管（relay 无服务端停滞兜底，防回合卡死）
    if (type === 'left' && this.room.isHost && this.game && !this.game.over && p && p.seat) {
      const idx = p.seat - 1;
      if (idx >= 0 && idx < this.game.playerTypes.length && this.game.playerTypes[idx] === 'human' && p.seat !== this.room.seat) {
        this.game.playerTypes[idx] = 'ai';
      }
      return;
    }
    if (type !== 'peer') return;
    const { from, ev, data } = p;
    if (ev === 'move' && this.room.isHost) {
      // 主机校验：只有当前回合座位的请求有效
      if (!this.game || this.game.over) return;
      if (data.from !== this.game.turn + 1) return; // 非其回合，忽略
      this._applyAndBroadcast(data.x, data.y);
    } else if (ev === 'moveAck' && !this.room.isHost) {
      // relay 下 moveAck 只认当前房主座位（防任意成员伪造快照）；云端 from=落子者，不校验
      if (this.room.transport === 'relay' && from !== this.room.hostSeat) return;
      if (data.game) {
        this.game = data.game;
        this._clearPendingWatchdog();
        this.pending = null;
        this.onUpdate(this.game);
        // onOver 一次性：终局后每次 watch 推送都会强制重发 moveAck（playerTypes 同步需要），
        // 不加守卫会每 20s 重弹结算页
        if (this.game.over && !this._overFired) { this._overFired = true; this.onOver(this.game); }
      }
    } else if (ev === 'started' && !this.room.isHost) {
      this._begin(data);
    }
  }

  /** 人类玩家请求落子（board 场景调用） */
  requestMove(x, y) {
    if (!this.game || this.game.over) return { ok: false, error: 'over' };
    if (this.room.isHost) {
      if (this.game.turn + 1 !== this.room.seat) return { ok: false, error: 'not-your-turn' };
      return this._applyAndBroadcast(x, y);
    }
    if (this.game.turn + 1 !== this.room.seat) return { ok: false, error: 'not-your-turn' };
    if (this.pending) return { ok: false, error: 'busy' };
    this.pending = { x, y };
    this._armPendingWatchdog();
    this.room.broadcast('move', { x, y, from: this.room.seat });
    return { ok: true, pending: true };
  }

  /**
   * pending 看门狗（传输无关的最后兜底）：ack 链路整体失败时 pending 会永久禁拖
   * （用户报「偶发不能放置棋子」的卡死面）。12s 后解锁并请求传输层拉平；
   * 若那一手其实已生效，拉平快照会正常推进回合。
   */
  _armPendingWatchdog() {
    this._clearPendingWatchdog();
    this._pendTimer = setTimeout(() => {
      this._pendTimer = 0;
      if (!this.pending || this._disposed) return;
      this.pending = null;
      if (this.room._pullState) this.room._pullState();
    }, 12000);
    if (this._pendTimer.unref) this._pendTimer.unref();
  }

  _clearPendingWatchdog() {
    if (this._pendTimer) { clearTimeout(this._pendTimer); this._pendTimer = 0; }
  }

  /** 主机：跑权威规则 + 广播 */
  _applyAndBroadcast(x, y) {
    const ret = placePiece(this.game, x, y);
    if (!ret.ok) {
      this._broadcastAck(); // 非法落点：回快照纠偏（清 pending）
      return ret;
    }
    // foul（classic 触磁）也是正常一手：整组回手 + 回合推进，统一走快照广播
    this.game = ret.game;
    this._broadcastAck();
    this.onUpdate(this.game);
    if (this.game.over) this.onOver(this.game);
    return { ok: true, foul: !!ret.foul, game: this.game };
  }

  _broadcastAck() {
    this.room.broadcast('moveAck', { game: this.game });
  }

  /** 每帧：主机驱动 AI 座位 */
  update(dt) {
    if (!this.room.isHost || !this.game || this.game.over) return;
    const g = this.game;
    if (g.playerTypes[g.turn] !== 'ai') { this.aiThink = 0; return; }
    this.aiThink += dt;
    if (this.aiThink < CONFIG.AI_THINK_MIN + Math.random() * 0.3) return;
    this.aiThink = 0;
    const mv = chooseMove(g, this.aiDifficulty);
    if (!mv) return; // 棋盘无空格的理论兜底（触磁回手会腾空间，正常不会发生）
    this._applyAndBroadcast(mv.x, mv.y);
  }
}