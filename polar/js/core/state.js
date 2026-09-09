/**
 * 对局状态容器：创建并持有 game 状态，暴露给上层（渲染/输入/网络）
 * 剥离 wx/eas 依赖：只做状态管理，渲染由 render/ 完成。
 */
import { createGame, placePiece } from './rules.js';

export class GameState {
  constructor({ playerCount = 2, mode = 'classic', seed, playerTypes, onUpdate, onOver } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.onOver = onOver || (() => {});
    this.game = createGame(playerCount, mode, seed, playerTypes);
    this.selecting = 0; // 当前选择的玩家本地角标（多点触控本机只用1）
  }

  /**
   * 落子入口。classic 触磁返回 {ok:true, foul:true}——粘连整组收回放置者手中、
   * 回合推进（正常一手，需走 onUpdate 同步快照）；trapped 语义已废除（触磁腾空间，无死锁）。
   */
  place(x, y) {
    const ret = placePiece(this.game, x, y);
    if (!ret.ok) return ret;
    this.game = ret.game;
    this.onUpdate(ret.game, ret.result);
    if (ret.game.over) this.onOver(ret.game, ret.result);
    return ret;
  }

  get board() {
    return this.game.board;
  }

  get turn() {
    return this.game.turn;
  }
}