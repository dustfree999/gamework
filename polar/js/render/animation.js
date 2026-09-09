/**
 * 吸附动画：被吸棋子飞向吸附中心（落子位置），逐颗延迟，链式级联
 * 纯逻辑维护一个在飞棋子的列表，渲染层播放。
 */
export class SnapAnimator {
  constructor(onDone) {
    this.flying = []; // {piece, fromX, fromY, toX, toY, t, delay}
    this.onDone = onDone || (() => {});
  }

  /** 开始一段吸附动画 */
  start(result, fromPx, toPx, geom) {
    const list = [];
    const ids = result.snapIds || [];
    // 逐颗延迟：链式越长，间隔越小（级联加速感）
    const baseDelay = 70; // ms
    ids.forEach((id, i) => {
      // 找到被吸棋子原位置
      // 从 fromPx（吸附前快照）取原坐标
      const src = fromPx.find((p) => p.id === id);
      if (!src) return;
      list.push({
        piece: src,
        fromX: src.px,
        fromY: src.py,
        toX: toPx.x,
        toY: toPx.y,
        t: 0,
        delay: i * baseDelay,
      });
    });
    this.flying = list;
    if (this.flying.length === 0) {
      this.onDone();
    }
  }

  /** 逐帧推移（dt 秒） */
  update(dt, snapSpeed) {
    if (this.flying.length === 0) return false;
    let done = 0;
    for (const f of this.flying) {
      f.delay -= dt * 1000;
      if (f.delay > 0) continue;
      f.t += dt * snapSpeed;
      if (f.t > 1) f.t = 1;
      if (f.t >= 1) done += 1;
    }
    if (done === this.flying.length) {
      this.flying = [];
      this.onDone();
      return true;
    }
    return false;
  }

  /** 绘制飞行中棋子（每颗画在插值位置） */
  render(ctx, drawPieceFn, radius) {
    for (const f of this.flying) {
      if (f.delay > 0) {
        // 等待期：淡出原位置
        drawPieceFn(ctx, f.fromX, f.fromY, radius * (1 - Math.min(0.4, f.delay / 200)), f.piece.owner);
        continue;
      }
      // 缓动
      const e = easeOutCubic(f.t);
      const x = f.fromX + (f.toX - f.fromX) * e;
      const y = f.fromY + (f.toY - f.fromY) * e;
      drawPieceFn(ctx, x, y, radius * (1 - 0.25 * f.t), f.piece.owner);
    }
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}