/**
 * 视觉主题系统：三主题数据 + 持久化读写
 * 数据驱动渲染（GDD: design/gdd/systems/theme-system.md）
 * 核心规则/物理不依赖此模块。
 *
 * v2（还原 design/design.png）：新增设计图字段（渲染层均带 ?? 兜底，缺字段不崩）：
 *  - primaryColor    主题强调色（选中胶囊/计数徽章/开战按钮）
 *  - titleGrad       首页大字「磁极对决」纵向渐变 [顶色, 底色]
 *  - titleEdge       大字白描边色
 *  - subtitleColor   副标题「— 磁吸对战棋 —」字色
 *  - cellTints       棋盘格底纹交替色（糖果淡彩 / 量子深蓝 / 实验室木纹）
 *  - cellLine        格线颜色（替代旧 boardLine 的更亮观感，boardLine 保留兼容）
 *  - bgOrbs          背景漂浮磁珠色板（糖果/量子发光珠）；lab 为空=改用工具角装饰
 *  - bgDeco          背景装饰类型：'orbs'(糖果) | 'particles'(量子) | 'kraft'(实验室)
 *  - cardBg          结算/面板浅色卡底
 *
 * v3（对齐 design/design.png 渲染细节）：
 *  - accentColor   选中胶囊/✓角标/星芒等强调橙
 *  - btnPrimary    果冻/金属主按钮渐变 [顶亮, 底深]（糖果=粉红果冻、实验室=银灰金属）
 *  - bannerGrad    结算缎带横幅渐变 [顶, 底]（糖果=红 / 量子=蓝 / 实验室=银）
 *  - bannerGlow    缎带霓虹外发光色（仅量子）
 */
import { COLORS } from './config.js';

/** 默认玩家四色（candy 主题与 config 一致） */
const defaultPlayers = COLORS.PLAYERS.map((p) => ({ color: p.color, accent: p.accent }));

/** 三主题定义 */
export const THEMES = {
  candy: {
    id: 'candy',
    name: '糖果风暴',
    background: { type: 'gradient', colors: ['#FFF3DC', '#FFE0BF'], dark: false },
    boardBg: '#FBF0DC',
    boardLine: '#E2CFA9',
    boardEdge: '#8A5A34',
    playerColors: defaultPlayers,
    pieceStyle: 'candy',
    warnColor: '#FFB300',
    magnetLine: 'rgba(62,39,35,0.35)',
    snapFx: 'juice',
    snapIntensity: 1.0,
    btnStyle: 'jelly',
    textColor: '#4A3123',
    bgDark: false,
    // ── 设计图还原字段 ──
    primaryColor: '#FF6B35',
    titleGrad: ['#FFB13B', '#FF5A4E'],
    titleEdge: '#FFFFFF',
    subtitleColor: '#FFFFFF',
    cellTints: ['#FFF8E9', '#FFEFD3', '#FFE4EA', '#E1F3FB', '#E7F6E4'],
    cellLine: 'rgba(160,120,70,0.22)',
    bgOrbs: ['#FF5A5F', '#FFC93C', '#4FC3F7', '#66BB6A', '#FF8A65', '#F48FB1'],
    bgDeco: 'orbs',
    cardBg: 'rgba(255,252,244,0.92)',
    accentColor: '#FF9F2E',
    btnPrimary: ['#FF8F9B', '#F0506A'],
    bannerGrad: ['#FF7668', '#E8403F'],
  },

  quantum: {
    id: 'quantum',
    name: '量子棋盘格',
    background: { type: 'gradient', colors: ['#07182B', '#0E2E4A'], dark: true },
    boardBg: '#0C2740',
    boardLine: '#1E5A6E',
    boardEdge: '#33E0FF',
    playerColors: [
      { color: '#FF5A5F', accent: '#FF8A8F' },
      { color: '#00E5FF', accent: '#66F0FF' },
      { color: '#2EFF8F', accent: '#80FFC0' },
      { color: '#FFD23F', accent: '#FFE88A' },
    ],
    pieceStyle: 'neon',
    warnColor: '#FFB300',
    magnetLine: 'rgba(51,224,255,0.5)',
    snapFx: 'ripple',
    snapIntensity: 1.2,
    btnStyle: 'neon',
    textColor: '#E6F5FF',
    bgDark: true,
    // ── 设计图还原字段 ──
    primaryColor: '#33E0FF',
    titleGrad: ['#EAFDFF', '#7CEBFF'],
    titleEdge: '#0A2A44',
    subtitleColor: '#8FF3FF',
    cellTints: ['#0F2E4C', '#0C2740', '#123a5e', '#0A2138'],
    cellLine: 'rgba(51,224,255,0.45)',
    // 发光粒子球：紫/品红全部拉向青蓝系（合规红线）
    bgOrbs: ['#33E0FF', '#4FC3F7', '#2EFF8F', '#FFD23F', '#FF7A45', '#7CEBFF'],
    bgDeco: 'particles',
    cardBg: 'rgba(13,40,64,0.78)',
    accentColor: '#FFA940',
    btnPrimary: ['#7CEBFF', '#1B9AD6'],
    bannerGrad: ['#3FB6FF', '#1E6FD0'],
    bannerGlow: '#33E0FF',
  },

  lab: {
    id: 'lab',
    name: '实验室桌面',
    background: { type: 'solid', colors: ['#E5DCC3'], dark: false },
    boardBg: '#DCC9A0',
    boardLine: '#9A8B71',
    boardEdge: '#6B5638',
    playerColors: [
      { color: '#C8553D', accent: '#8F3D2E' },
      { color: '#3D7EA6', accent: '#2C5D7E' },
      { color: '#5B8C4A', accent: '#3E6333' },
      { color: '#D6A42B', accent: '#A87E1C' },
    ],
    pieceStyle: 'metal',
    warnColor: '#E07A2A',
    magnetLine: 'rgba(62,39,35,0.4)',
    snapFx: 'glow',
    snapIntensity: 0.9,
    btnStyle: 'metal',
    textColor: '#3A332B',
    bgDark: false,
    // ── 设计图还原字段 ──
    primaryColor: '#E07A2A',
    titleGrad: ['#6B4A2E', '#43301F'], // 设计图：深棕金属感大字
    titleEdge: '#FFFDF4',
    subtitleColor: '#5C5244',
    cellTints: ['#EAD6AE', '#E3CCA0', '#F0DDB9', '#E6D2A8', '#DFC496'],
    cellLine: 'rgba(110,86,52,0.28)',
    bgOrbs: [],
    bgDeco: 'kraft',
    cardBg: 'rgba(250,243,224,0.94)',
    accentColor: '#E0862A',
    btnPrimary: ['#B3AC9C', '#6E6759'], // 设计图：银灰金属开战钮
    bannerGrad: ['#D8D1C1', '#948C7A'],
  },
};

export const THEME_IDS = Object.keys(THEMES);
export const DEFAULT_THEME = 'candy';

/**
 * 读取当前主题 id（本地存储）
 */
export function getSavedTheme() {
  try {
    const saved = wx.getStorageSync('polar_theme');
    if (THEME_IDS.includes(saved)) return saved;
  } catch (e) {
    // 存储不可用时回退默认
  }
  return DEFAULT_THEME;
}

/**
 * 保存主题选择（本地存储）
 */
export function saveTheme(id) {
  if (!THEME_IDS.includes(id)) return false;
  try {
    wx.setStorageSync('polar_theme', id);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 获取主题对象（未传 id 则读取本地存储；非法 id 回退默认）
 */
export function getTheme(id) {
  const key = id || getSavedTheme();
  return THEMES[key] || THEMES[DEFAULT_THEME];
}

/**
 * 玩家色（按主题）：返回 playerColors 数组
 */
export function themePlayerColors(theme) {
  const t = theme || getTheme();
  return t.playerColors;
}
