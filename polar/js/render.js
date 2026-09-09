GameGlobal.canvas = wx.createCanvas();

const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
let DPR = windowInfo.pixelRatio || 1;

// 真机高分屏保护：canvas 像素 = 屏幕像素×DPR²，1440p 旗舰机(DPR3)可达 160MB+，
// 导致真机渲染缓慢甚至调试超时。限制总像素 ≤ ~830 万（≈2560×3200），等比降 DPR。
const MAX_PIXELS = 8.3e6;
const px = windowInfo.screenWidth * windowInfo.screenHeight * DPR * DPR;
if (px > MAX_PIXELS) DPR = Math.sqrt(MAX_PIXELS / (windowInfo.screenWidth * windowInfo.screenHeight));
DPR = Math.max(1, Math.round(DPR * 100) / 100);

// 画布按物理像素渲染（高清），布局一律使用 canvas.width/height 自适应
canvas.width = windowInfo.screenWidth * DPR;
canvas.height = windowInfo.screenHeight * DPR;

export const SCREEN_WIDTH = windowInfo.screenWidth;
export const SCREEN_HEIGHT = windowInfo.screenHeight;
export { DPR };