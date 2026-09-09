/**
 * 大厅场景：房间码 + 4 座位（人类/AI 补位/空位）+ 邀请好友 + 开始对战
 * 仅房主可切 AI 位与开局；加入者等待。
 */
import { getTheme } from '../core/themes.js';
import { roundRectPath, resetShadow } from '../render/board.js';
import { drawButton, drawBackground } from '../render/button.js';
import { drawAvatarBadge } from '../render/decor.js';

const SEAT_LABEL = { human: '玩家', ai: 'AI', empty: '空位' };

export default class LobbyScene {
  constructor(ctx, { room, onLeave, onStart, onInvite } = {}) {
    this.ctx = ctx;
    this.room = room; // RoomSync 实例
    this.onLeave = onLeave || (() => {});
    this.onStart = onStart || (() => {});
    this.onInvite = onInvite || (() => {});
    this.tapRects = [];
    this.toast = null;
    this.toastUntil = 0;
    this.fatalError = null; // 阻塞式错误（房间已满/不存在）：点按钮才消失
    this.time = 0;
  }

  /** 显示阻塞错误（加入失败等致命问题）。onClose：点按钮后的自定义收尾（默认=离房回首页） */
  showFatal(msg, onClose) {
    this.fatalError = msg || '连接失败';
    this._fatalClose = onClose || null;
  }

  get theme() { return getTheme(); }
  _u() { return canvas.width / 375; }

  touchStart(px, py) {
    // 阻塞错误卡片：只响应"回首页"（开局失败场景=回大厅继续等；默认=离房回首页）
    if (this.fatalError) {
      for (const r of this.tapRects) {
        if (r.id === 'fatalOk' && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
          const cb = this._fatalClose;
          this.fatalError = null;
          this._fatalClose = null;
          if (cb) cb();
          else { this.room.leave(); this.onLeave(); }
          return;
        }
      }
      return;
    }
    for (const r of this.tapRects) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        if (r.id === 'back') { this.room.leave(); this.onLeave(); }
        else if (r.id === 'invite') this.onInvite(this.room.roomId);
        else if (r.id === 'start') {
          // 已入座（human+ai）不足 2 人时禁止开局：云端会拒、relay 会变幽灵局
          if (this.room.isHost && this._seatedCount() >= 2) this.onStart();
          else this.showToast('至少需要 2 个已入座座位（可点空位的「补 AI」）');
        }
        else if (r.id === 'ai' && this.room.isHost) this.room.setSeatAi(r.seat, this._seatAt(r.seat) === 'empty'); // 空位→补AI；AI位→移除
        break;
      }
    }
  }
  _seatedCount() {
    return (this.room.roster || []).filter((s) => s.type === 'human' || s.type === 'ai').length;
  }
  _seatAt(seat) {
    const row = (this.room.roster || []).find((s) => s.seat === seat);
    return row ? row.type : 'empty';
  }
  touchMove() {}
  touchEnd() {}
  update(dt) { this.time += dt * 1000; }

  render() {
    const ctx = this.ctx;
    const t = this.theme;
    const W = canvas.width;
    const H = canvas.height;
    const u = this._u();
    const cx = W / 2;
    ctx.clearRect(0, 0, W, H);
    resetShadow(ctx);
    drawBackground(ctx, t);
    this.tapRects = [];

    // 标题
    ctx.fillStyle = t.textColor;
    ctx.font = `bold ${Math.round(34 * u)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('对战大厅', cx, 90 * u);

    // 房间码卡
    const rcY = 120 * u;
    roundRectPath(ctx, cx - 130 * u, rcY, 260 * u, 64 * u, 14 * u);
    ctx.fillStyle = t.bgDark ? 'rgba(255,255,255,0.08)' : '#FFFDF4';
    ctx.fill();
    ctx.strokeStyle = t.accentColor || '#FF9F2E';
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.6)' : '#8C8272';
    ctx.font = `${Math.round(13 * u)}px sans-serif`;
    ctx.fillText('房间号（好友输入或点邀请加入）', cx, rcY + 24 * u);
    ctx.fillStyle = t.textColor;
    ctx.font = `bold ${Math.round(28 * u)}px monospace`;
    ctx.fillText(this.room.roomId || '······', cx, rcY + 52 * u);

    // 邀请按钮
    const iw = 200 * u;
    drawButton(ctx, t, { x: cx - iw / 2, y: rcY + 80 * u, w: iw, h: 50 * u, label: '邀请好友', primary: true });
    this.tapRects.push({ id: 'invite', x: cx - iw / 2, y: rcY + 80 * u, w: iw, h: 50 * u });

    // 4 座位（2×2 网格）
    const seatW = 150 * u;
    const seatH = 110 * u;
    const gx = 18 * u;
    const gy = 16 * u;
    const totalW = 2 * seatW + gx;
    const sx0 = cx - totalW / 2;
    const sy0 = rcY + 150 * u;
    for (let i = 1; i <= 4; i += 1) {
      const col = (i - 1) % 2;
      const row = Math.floor((i - 1) / 2);
      const x = sx0 + col * (seatW + gx);
      const y = sy0 + row * (seatH + gy);
      const type = this._seatAt(i);
      const pc = t.playerColors[(i - 1) % 4];
      roundRectPath(ctx, x, y, seatW, seatH, 14 * u);
      ctx.fillStyle = type === 'empty' ? (t.bgDark ? 'rgba(255,255,255,0.05)' : '#F3EBDA') : (t.bgDark ? 'rgba(255,255,255,0.1)' : '#FFFDF4');
      ctx.fill();
      if (type !== 'empty') { ctx.strokeStyle = pc.color; ctx.lineWidth = 2.5 * u; ctx.stroke(); }
      // 头像徽章
      drawAvatarBadge(ctx, x + 34 * u, y + 38 * u, 20 * u, pc, { mode: 'text', label: String(i), active: type !== 'empty' });
      ctx.textAlign = 'left';
      ctx.fillStyle = t.textColor;
      ctx.font = `bold ${Math.round(17 * u)}px sans-serif`;
      const name = type === 'human' ? ((this.room.roster.find((s) => s.seat === i) || {}).name || `玩家${i}`) : type === 'ai' ? 'AI 补位' : '空位';
      ctx.fillText(name, x + 62 * u, y + 44 * u);
      ctx.font = `${Math.round(13 * u)}px sans-serif`;
      ctx.fillStyle = type === 'human' && i === this.room.seat ? pc.color : (t.bgDark ? 'rgba(230,245,255,0.5)' : '#8C8272');
      ctx.fillText(type === 'human' && i === this.room.seat ? '（我）' : SEAT_LABEL[type], x + 62 * u, y + 66 * u);
      // 房主可补/移除 AI：空位显示"补AI"，AI 位显示"移除AI"；真人位不可动
      if (this.room.isHost && (type === 'ai' || type === 'empty')) {
        const tw = 76 * u;
        const th = 30 * u;
        const tx = x + seatW - tw - 10 * u;
        const ty = y + seatH - th - 10 * u;
        roundRectPath(ctx, tx, ty, tw, th, th / 2);
        ctx.fillStyle = type === 'ai' ? (t.accentColor || '#FF9F2E') : (t.bgDark ? 'rgba(255,255,255,0.12)' : '#EADFCB');
        ctx.fill();
        ctx.fillStyle = type === 'ai' ? '#FFFFFF' : t.textColor;
        ctx.font = `bold ${Math.round(13 * u)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(type === 'ai' ? '移除AI' : '补 AI', tx + tw / 2, ty + th / 2 + 5 * u);
        this.tapRects.push({ id: 'ai', seat: i, x: tx, y: ty, w: tw, h: th });
      }
    }

    // 底部：返回 / 开始
    const by = sy0 + 2 * seatH + gy + 24 * u;
    const rowW = W - 48 * u;
    const backW = rowW * 0.32;
    const startW = rowW * 0.60;
    drawButton(ctx, t, { x: 24 * u, y: by, w: backW, h: 56 * u, label: '返回' });
    this.tapRects.push({ id: 'back', x: 24 * u, y: by, w: backW, h: 56 * u });
    if (this.room.isHost) {
      drawButton(ctx, t, { x: W - 24 * u - startW, y: by, w: startW, h: 56 * u, label: '开始对战', primary: true });
      this.tapRects.push({ id: 'start', x: W - 24 * u - startW, y: by, w: startW, h: 56 * u });
    } else {
      ctx.fillStyle = t.bgDark ? 'rgba(230,245,255,0.5)' : '#8C8272';
      ctx.font = `bold ${Math.round(16 * u)}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText('等待房主开始…', W - 24 * u, by + 34 * u);
    }

    // 阻塞错误卡片（房间已满/不存在）
    if (this.fatalError) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      const pw = W * 0.78;
      const ph = 210 * u;
      const px = (W - pw) / 2;
      const py = (H - ph) / 2;
      roundRectPath(ctx, px, py, pw, ph, 18 * u);
      ctx.fillStyle = t.bgDark ? '#12314F' : '#FFFDF4';
      ctx.fill();
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      ctx.fillStyle = t.textColor;
      ctx.font = `bold ${Math.round(26 * u)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('无法加入房间', cx, py + 52 * u);
      ctx.font = `bold ${Math.round(18 * u)}px sans-serif`;
      ctx.fillStyle = '#FF3B30';
      ctx.fillText(this.fatalError, cx, py + 92 * u);
      const bw2 = 180 * u;
      drawButton(ctx, t, { x: cx - bw2 / 2, y: py + 126 * u, w: bw2, h: 54 * u, label: '回 首 页', primary: true });
      this.tapRects.push({ id: 'fatalOk', x: cx - bw2 / 2, y: py + 126 * u, w: bw2, h: 54 * u });
      return; // 卡片态不画 toast
    }

    // toast
    if (this.toast && this.time < this.toastUntil) {
      ctx.font = `bold ${Math.round(16 * u)}px sans-serif`;
      const tw = ctx.measureText ? ctx.measureText(this.toast).width + 40 * u : this.toast.length * 16 * u;
      roundRectPath(ctx, cx - tw / 2, H - 120 * u, tw, 44 * u, 22 * u);
      ctx.fillStyle = 'rgba(62,39,35,0.85)';
      ctx.fill();
      ctx.fillStyle = '#FFF8EC';
      ctx.textAlign = 'center';
      ctx.fillText(this.toast, cx, H - 120 * u + 28 * u);
    }
  }

  showToast(msg) {
    this.toast = msg;
    this.toastUntil = this.time + 1800;
  }
}