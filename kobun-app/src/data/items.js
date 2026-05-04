export const ITEMS = [
  // --- フレーム ---
  { id: 'frame-silver',  slot: 'frame', name: '銀枠',   cost: 20  },
  { id: 'frame-gold',    slot: 'frame', name: '金枠',   cost: 60  },
  { id: 'frame-fire',    slot: 'frame', name: '炎枠',   cost: 150 },
  { id: 'frame-rainbow', slot: 'frame', name: '虹枠',   cost: 200 },

  // --- バッジ ---
  { id: 'badge-star',        slot: 'badge', name: '星',     cost: 20,  emoji: '⭐' },
  { id: 'badge-book',        slot: 'badge', name: '本',     cost: 30,  emoji: '📖' },
  { id: 'badge-fire',        slot: 'badge', name: '炎',     cost: 60,  emoji: '🔥' },
  { id: 'badge-mortarboard', slot: 'badge', name: '学士帽', cost: 100, emoji: '🎓' },
  { id: 'badge-crown',       slot: 'badge', name: '王冠',   cost: 180, emoji: '👑' },

  // --- 称号 ---
  { id: 'title-blue',    slot: 'title', name: '蒼',   cost: 15  },
  { id: 'title-green',   slot: 'title', name: '翠',   cost: 15  },
  { id: 'title-purple',  slot: 'title', name: '紫',   cost: 40  },
  { id: 'title-red',     slot: 'title', name: '紅',   cost: 80  },
  { id: 'title-gold',    slot: 'title', name: '金',   cost: 120 },
  { id: 'title-rainbow', slot: 'title', name: '虹',   cost: 280 },

  // --- アバタースタイル ---
  { id: 'style-pixel-art',  slot: 'avatarStyle', name: 'ピクセルアート', cost: 0,   dicebear: 'pixel-art'  },
  { id: 'style-fun-emoji',  slot: 'avatarStyle', name: '絵文字',         cost: 30,  dicebear: 'fun-emoji'  },
  { id: 'style-bottts',     slot: 'avatarStyle', name: 'ロボット',       cost: 50,  dicebear: 'bottts'     },
  { id: 'style-croodles',   slot: 'avatarStyle', name: 'クルードル',     cost: 80,  dicebear: 'croodles'   },
  { id: 'style-adventurer', slot: 'avatarStyle', name: '冒険者',         cost: 100, dicebear: 'adventurer' },
];

export const ITEM_MAP = Object.fromEntries(ITEMS.map(i => [i.id, i]));

export const BADGE_EMOJI = Object.fromEntries(
  ITEMS.filter(i => i.slot === 'badge').map(i => [i.id, i.emoji])
);

export const TITLE_COLOR = {
  'title-blue':    '#1565c0',
  'title-green':   '#2e7d32',
  'title-purple':  '#6a1b9a',
  'title-red':     '#c62828',
  'title-gold':    '#f9a825',
  'title-rainbow': 'rainbow',
};

export const STYLE_DICEBEAR = Object.fromEntries(
  ITEMS.filter(i => i.slot === 'avatarStyle').map(i => [i.id, i.dicebear])
);

export const DEFAULT_EQUIPPED = {
  frame: null,
  badge: null,
  title: null,
  avatarStyle: 'pixel-art',
};
