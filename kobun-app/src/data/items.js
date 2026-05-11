export const DICEBEAR_ATTRIBUTION = {
  name: 'DiceBear',
  url: 'https://www.dicebear.com/',
  licenseUrl: 'https://www.dicebear.com/licenses/',
};

export const ITEMS = [
  // --- フレーム ---
  { id: 'frame-silver', slot: 'frame', name: '銀枠', cost: 120, rarity: 'basic', tone: '#9e9e9e' },
  { id: 'frame-gold', slot: 'frame', name: '金枠', cost: 280, rarity: 'standard', tone: '#f9a825' },
  { id: 'frame-ink', slot: 'frame', name: '墨流し枠', cost: 360, rarity: 'standard', tone: '#2d3a5e' },
  { id: 'frame-fire', slot: 'frame', name: '炎枠', cost: 720, rarity: 'rare', tone: '#e53935' },
  { id: 'frame-rainbow', slot: 'frame', name: '虹枠', cost: 1350, rarity: 'special', tone: 'rainbow' },

  // --- バッジ ---
  { id: 'badge-star', slot: 'badge', name: '星', cost: 90, rarity: 'basic', emoji: '⭐' },
  { id: 'badge-book', slot: 'badge', name: '本', cost: 120, rarity: 'basic', emoji: '📖' },
  { id: 'badge-scroll', slot: 'badge', name: '巻物', cost: 180, rarity: 'standard', emoji: '📜' },
  { id: 'badge-sleep', slot: 'badge', name: 'そら寝', cost: 260, rarity: 'standard', emoji: '💤', theme: '児のそら寝' },
  { id: 'badge-shield', slot: 'badge', name: '矛盾', cost: 340, rarity: 'standard', emoji: '🛡️', theme: '矛盾' },
  { id: 'badge-fish', slot: 'badge', name: '漁夫', cost: 420, rarity: 'standard', emoji: '🎣', theme: '漁夫之利' },
  { id: 'badge-fire', slot: 'badge', name: '炎', cost: 650, rarity: 'rare', emoji: '🔥' },
  { id: 'badge-mortarboard', slot: 'badge', name: '学士帽', cost: 900, rarity: 'rare', emoji: '🎓' },
  { id: 'badge-crown', slot: 'badge', name: '王冠', cost: 1250, rarity: 'special', emoji: '👑' },
  { id: 'badge-gem', slot: 'badge', name: '文豪印', cost: 1500, rarity: 'special', emoji: '💎' },

  // --- 称号 ---
  { id: 'title-blue', slot: 'title', name: '蒼', cost: 100, rarity: 'basic', color: '#1565c0' },
  { id: 'title-green', slot: 'title', name: '翠', cost: 100, rarity: 'basic', color: '#2e7d32' },
  { id: 'title-purple', slot: 'title', name: '紫', cost: 220, rarity: 'standard', color: '#6a1b9a' },
  { id: 'title-red', slot: 'title', name: '紅', cost: 360, rarity: 'standard', color: '#c62828' },
  { id: 'title-konosorane', slot: 'title', name: 'そら寝の達人', cost: 520, rarity: 'rare', color: '#7b4f1d', theme: '児のそら寝' },
  { id: 'title-mujun', slot: 'title', name: '矛盾を見抜く者', cost: 620, rarity: 'rare', color: '#455a64', theme: '矛盾' },
  { id: 'title-gyofu', slot: 'title', name: '漁夫の利', cost: 720, rarity: 'rare', color: '#00796b', theme: '漁夫之利' },
  { id: 'title-gold', slot: 'title', name: '金', cost: 900, rarity: 'rare', color: '#f9a825' },
  { id: 'title-rainbow', slot: 'title', name: '虹', cost: 1400, rarity: 'special', color: 'rainbow' },

  // --- 背景 ---
  { id: 'bg-paper', slot: 'background', name: '料紙', cost: 80, rarity: 'basic', preview: 'paper' },
  { id: 'bg-sakura', slot: 'background', name: '桜霞', cost: 220, rarity: 'standard', preview: 'sakura' },
  { id: 'bg-night', slot: 'background', name: '月夜', cost: 380, rarity: 'standard', preview: 'night' },
  { id: 'bg-bamboo', slot: 'background', name: '竹林', cost: 520, rarity: 'rare', preview: 'bamboo', theme: '丹波に出雲といふ所あり' },
  { id: 'bg-scroll', slot: 'background', name: '漢文巻物', cost: 680, rarity: 'rare', preview: 'scroll', theme: '矛盾' },
  { id: 'bg-river', slot: 'background', name: '川霧', cost: 760, rarity: 'rare', preview: 'river', theme: '漁夫之利' },
  { id: 'bg-palace', slot: 'background', name: '御簾', cost: 1250, rarity: 'special', preview: 'palace' },

  // --- オーラ ---
  { id: 'aura-soft', slot: 'aura', name: 'やわらか光', cost: 150, rarity: 'basic', preview: 'soft' },
  { id: 'aura-ink', slot: 'aura', name: '墨の気配', cost: 320, rarity: 'standard', preview: 'ink' },
  { id: 'aura-spark', slot: 'aura', name: 'ひらめき', cost: 640, rarity: 'rare', preview: 'spark' },
  { id: 'aura-flame', slot: 'aura', name: '集中の炎', cost: 880, rarity: 'rare', preview: 'flame' },
  { id: 'aura-legend', slot: 'aura', name: '古典の光', cost: 1500, rarity: 'special', preview: 'legend' },

  // --- アバタースタイル ---
  { id: 'style-pixel-art', slot: 'avatarStyle', name: 'ピクセルアート', cost: 0, rarity: 'free', dicebear: 'pixel-art', source: DICEBEAR_ATTRIBUTION },
  { id: 'style-fun-emoji', slot: 'avatarStyle', name: '絵文字', cost: 180, rarity: 'standard', dicebear: 'fun-emoji', source: DICEBEAR_ATTRIBUTION },
  { id: 'style-bottts', slot: 'avatarStyle', name: 'ロボット', cost: 260, rarity: 'standard', dicebear: 'bottts', source: DICEBEAR_ATTRIBUTION },
  { id: 'style-croodles', slot: 'avatarStyle', name: 'クルードル', cost: 420, rarity: 'standard', dicebear: 'croodles', source: DICEBEAR_ATTRIBUTION },
  { id: 'style-adventurer', slot: 'avatarStyle', name: '冒険者', cost: 650, rarity: 'rare', dicebear: 'adventurer', source: DICEBEAR_ATTRIBUTION },
  { id: 'style-lorelei', slot: 'avatarStyle', name: 'ローレライ', cost: 820, rarity: 'rare', dicebear: 'lorelei', source: DICEBEAR_ATTRIBUTION },
  { id: 'style-avataaars', slot: 'avatarStyle', name: 'クラシック', cost: 1200, rarity: 'special', dicebear: 'avataaars', source: DICEBEAR_ATTRIBUTION },
];

export const ITEM_MAP = Object.fromEntries(ITEMS.map(i => [i.id, i]));

export const SLOT_LABELS = {
  frame: 'フレーム',
  badge: 'バッジ',
  title: '称号',
  background: '背景',
  aura: 'オーラ',
  avatarStyle: 'スタイル',
};

export const BADGE_EMOJI = Object.fromEntries(
  ITEMS.filter(i => i.slot === 'badge').map(i => [i.id, i.emoji])
);

export const TITLE_COLOR = Object.fromEntries(
  ITEMS.filter(i => i.slot === 'title').map(i => [i.id, i.color])
);

export const STYLE_DICEBEAR = Object.fromEntries(
  ITEMS.filter(i => i.slot === 'avatarStyle').map(i => [i.id, i.dicebear])
);

const STYLE_ITEM_ID_BY_DICEBEAR = Object.fromEntries(
  ITEMS.filter(i => i.slot === 'avatarStyle').map(i => [i.dicebear, i.id])
);

export const DEFAULT_EQUIPPED = {
  frame: null,
  badge: null,
  title: null,
  background: null,
  aura: null,
  avatarStyle: 'style-pixel-art',
};

export function normalizeEquipped(equipped) {
  const avatarStyle = equipped?.avatarStyle;
  return {
    ...DEFAULT_EQUIPPED,
    ...(equipped ?? {}),
    avatarStyle: STYLE_ITEM_ID_BY_DICEBEAR[avatarStyle] ?? avatarStyle ?? DEFAULT_EQUIPPED.avatarStyle,
  };
}
