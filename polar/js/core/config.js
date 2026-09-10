/**
 * 《磁极对决》全局配置
 * 所有可调数值集中于此，M1 真机实测后走 quick-design 流程调参（design/quick-specs/ 留档）
 * 本文件不依赖任何运行时环境，可被单元测试直接引用
 */
export const COLORS = {
  BOARD_BG: '#F4E9D8',
  BOARD_LINE: '#D8C7A8',
  BOARD_EDGE: '#3E2723',
  WARN: '#FFB300',
  TEXT: '#3E2723',
  PLAYERS: [
    { name: 'P1', color: '#FF5A5F', accent: '#C93B40' }, // 珊瑚红
    { name: 'P2', color: '#00B8D4', accent: '#008FA8' }, // 青蓝
    { name: 'P3', color: '#2ECC71', accent: '#1FA85A' }, // 翠绿
    { name: 'P4', color: '#F1C40F', accent: '#C9A10A' }, // 明黄
  ],
};

/** 所有对局数值：按人数缩放 */
export const CONFIG = {
  MODES: ['classic', 'loot'], // 玩法1 经典踩雷 / 玩法2 磁吸夺宝
  // 按玩法分设棋盘（收回规则对齐实体桌游，体验曲线/难度仿真见 test/sim-experience.mjs）：
  //  - classic：触磁=粘连整组回放置者手。棋盘/手牌按「新手直觉(spread)玩家」密度调参：
  //    2人 8×9×15颗（=实体玩具规格，触磁7次/局、后期50%被迫面对危险区、局长30手）
  //    3人 9×11×12 / 4人 11×13×12（局长34/45手，3-5分钟）；前期触磁率恒 0%（开局不劝退）
  //  - loot：捕获机制存在固有先手优势（8+ 规则组合仿真均退化），v1 暂下线，入口置灰
  BOARD: {
    classic: { cols: [8, 9, 11], rows: [9, 11, 13], pieces: [15, 12, 12] }, // [2,3,4人] 密度仿真定稿
    loot: { cols: [11, 12, 13], rows: [13, 14, 15], pieces: [12, 10, 9] },
    solo: { cols: [10], rows: [12], pieces: [999], obstacles: [10] }, // 单人挑战：随机雷场+生存计分
  },
  SNAP_RADIUS: 1.65, // 格，吸附触发距离（棋心间距 < 该值则吸附）
  CLASSIC_STALL: 8, // classic 防停滞：盘面高水位连续 (该值×人数) 手未刷新 → 僵局终局（剩余手牌少者胜）。3人+围堵AI实测会手牌振荡死循环，需此兜底；正常对局盘面持续增长永不触发
  // classic 防死循环（精确）：记录最近 N 手局面指纹，同一局面复现即判零进展僵局并立即终局。
  // 与 CLASSIC_STALL 的「盘面高水位」代理判定互补——后者对偶数人数会误伤（实测 2 人 easy 42.5%），
  // 故偶数豁免；本判定是精确的（局面 = 盘面+手牌+回合，完全决定后续），不误伤，且对 2/3/4 人一律生效。
  CLASSIC_CYCLE_WINDOW: 16,
  LOOT_CAPTURE: 'gt', // 夺宝捕获规则：'gt' 磁力团严格大于才吃 / 'gte' 大于等于即可吃（待仿真定）
  SNAP_SPEED: 10, // 吸附动画速度系数
  CHAIN_DEPTH: 8, // 链式吸附最深层数（防御死循环）
  MAX_PLAYERS: 4,
  AI_THINK_MIN: 0.7, // AI 最短思考时长（秒）
  AI_THINK_JITTER: 0.6, // 思考时长随机增量
  AI_TWEEN: 0.4, // AI 落子飞行动画时长（秒）
};

/** 手牌区单颗棋子像素尺寸——渲染层自行按实机缩放，这里仅作基准 */
export const PIECE_VISUAL = { base: 44, maxScale: 1.0 };