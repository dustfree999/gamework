/**
 * H5 启动入口：等价于小游戏 game.js 的职责（实例化 Main）
 * 暴露 window.__main 便于浏览器控制台调试。
 */
import Main from '../js/main.js';
import { tr } from '../js/i18n.js';

// 浏览器标签页标题随界面语言（html <title> 为静态中文位，此处运行时覆盖）
try { if (typeof document !== 'undefined') document.title = tr('game.title'); } catch (e) { /* 忽略 */ }

window.__main = new Main();