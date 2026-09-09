/**
 * H5 启动入口：等价于小游戏 game.js 的职责（实例化 Main）
 * 暴露 window.__main 便于浏览器控制台调试。
 */
import Main from '../js/main.js';

window.__main = new Main();