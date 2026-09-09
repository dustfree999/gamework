/**
 * H5/浏览器 wx 兼容层（开发调试用，不参与小游戏包体）
 * 覆盖游戏用到的全部 wx.* 面：canvas / 触摸 / 音频 / 震动 / 存储 / 系统信息
 * 在 web/index.html 中先于 game 模块加载。
 */
(function () {
  if (typeof window === 'undefined') return;

  // 小游戏把 GameGlobal 当全局命名空间；H5 直接复用 window
  window.GameGlobal = window;

  const touchHandlers = { touchstart: [], touchmove: [], touchend: [], touchcancel: [] };
  let gameCanvas = null;

  // 横屏窗口（如 DevTools 设备模拟 1280×720）自动锁竖屏比例并居中 letterbox，
  // 竖屏（真机/正常调试）保持满窗不变。游戏只在启动读一次尺寸，resize 需刷新页面。
  // ?h5free=1 可关闭锁定做真·全窗自适应实验（生产小游戏锁竖屏，此形态仅调试参考）。
  const FREE = /[?&]h5free=1/.test(window.location.search || '');
  function viewport() {
    const iw = window.innerWidth, ih = window.innerHeight;
    if (FREE || iw <= ih) return { w: iw, h: ih, left: 0 };
    const w = Math.min(iw, Math.round(ih * (430 / 932)));
    return { w, h: ih, left: Math.round((iw - w) / 2) };
  }

  function sysInfo() {
    const vp = viewport();
    return {
      screenWidth: vp.w,
      screenHeight: vp.h,
      pixelRatio: window.devicePixelRatio || 1,
    };
  }

  window.wx = {
    createCanvas() {
      const c = document.createElement('canvas');
      const vp = viewport();
      c.style.position = 'fixed';
      c.style.left = vp.left + 'px';
      c.style.top = '0';
      c.style.width = vp.w + 'px';
      c.style.height = vp.h + 'px';
      c.style.display = 'block';
      c.style.touchAction = 'none';
      document.body.appendChild(c);
      gameCanvas = c;
      return c;
    },
    getWindowInfo() { return sysInfo(); },
    getSystemInfoSync() { return sysInfo(); },
    onTouchStart(f) { touchHandlers.touchstart.push(f); },
    onTouchMove(f) { touchHandlers.touchmove.push(f); },
    onTouchEnd(f) { touchHandlers.touchend.push(f); },
    onTouchCancel(f) { touchHandlers.touchcancel.push(f); },
    createInnerAudioContext() {
      const a = new Audio();
      // 站点 base：去掉路径里的 /web/xxx 部分，兼容子路径部署（如 /polar/web/index.html → /polar/）
      const BASE = location.pathname.replace(/\/web\/.*$/, '/') || '/';
      const ctx = {
        set src(v) { a.src = BASE + String(v).replace(/^\//, ''); },
        set volume(v) { a.volume = Math.max(0, Math.min(1, v)); },
        play() { a.currentTime = 0; a.play().catch(() => {}); },
        stop() { a.pause(); try { a.currentTime = 0; } catch (e) { /* 忽略 */ } },
      };
      return ctx;
    },
    vibrateShort() { if (navigator.vibrate) navigator.vibrate(30); },
    showToast({ title = '', duration = 2000 } = {}) {
      // 极简 DOM toast：底部居中圆角条，自动消失（对齐小游戏 wx.showToast 的 icon:'none' 形态）
      const el = document.createElement('div');
      el.textContent = String(title);
      el.style.cssText = 'position:fixed;left:50%;bottom:18%;transform:translateX(-50%);z-index:9999;'
        + 'max-width:80vw;padding:10px 18px;border-radius:10px;background:rgba(0,0,0,0.78);'
        + 'color:#fff;font-size:14px;line-height:1.5;text-align:center;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(el);
      setTimeout(() => { el.remove(); }, Math.max(500, duration));
    },
    getStorageSync(k) { try { return window.localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    setStorageSync(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 忽略 */ } },
  };

  // 统一触摸/鼠标 → 小游戏事件结构（映射到 canvas 本地坐标：横屏 letterbox 时减去居中偏移）
  function fire(type, e) {
    const list = touchHandlers[type];
    if (!list.length) return;
    const src = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]) || e;
    const off = gameCanvas ? gameCanvas.getBoundingClientRect().left : 0;
    const point = { clientX: src.clientX - off, clientY: src.clientY };
    const ev = { touches: [point], changedTouches: [point] };
    for (const f of list) f(ev);
    if (type === 'touchstart' || type === 'touchmove') e.preventDefault();
  }

  for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    window.addEventListener(t, (e) => fire(t, e), { passive: false });
  }
  // 桌面鼠标映射（开发调试友好）；窗口失焦等价 touchcancel
  window.addEventListener('mousedown', (e) => fire('touchstart', e));
  window.addEventListener('mousemove', (e) => { if (e.buttons > 0) fire('touchmove', e); });
  window.addEventListener('mouseup', (e) => fire('touchend', e));
  window.addEventListener('blur', () => fire('touchcancel', {}));

  console.log('[wx-shim] H5 兼容层就绪');
})();