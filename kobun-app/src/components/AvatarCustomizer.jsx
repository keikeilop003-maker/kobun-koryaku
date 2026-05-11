import { useState } from 'react';
import AvatarIcon from './AvatarIcon';
import {
  DICEBEAR_ATTRIBUTION,
  ITEMS,
  SLOT_LABELS,
  TITLE_COLOR,
  normalizeEquipped,
} from '../data/items';

const TABS = [
  { key: 'frame', label: SLOT_LABELS.frame },
  { key: 'badge', label: SLOT_LABELS.badge },
  { key: 'title', label: SLOT_LABELS.title },
  { key: 'background', label: SLOT_LABELS.background },
  { key: 'aura', label: SLOT_LABELS.aura },
  { key: 'avatarStyle', label: SLOT_LABELS.avatarStyle },
];

const RARITY_LABEL = {
  free: '初期',
  basic: '入門',
  standard: '標準',
  rare: '希少',
  special: '特別',
};

function ItemPreview({ item }) {
  if (item.slot === 'badge') return <span className="customizer-emoji-preview">{item.emoji}</span>;

  if (item.slot === 'title') {
    const color = TITLE_COLOR[item.id];
    if (color === 'rainbow') {
      return <span className="customizer-title-preview title-rainbow">{item.name}</span>;
    }
    return <span className="customizer-title-preview" style={{ color }}>{item.name}</span>;
  }

  if (item.slot === 'background') {
    return <span className={`customizer-swatch customizer-swatch-${item.preview}`} />;
  }

  if (item.slot === 'aura') {
    return <span className={`customizer-aura-preview customizer-aura-${item.preview}`} />;
  }

  if (item.slot === 'avatarStyle') {
    return <span className="customizer-item-preview" aria-hidden="true">🪄</span>;
  }

  return <span className={`customizer-frame-preview ${item.id}`} />;
}

export default function AvatarCustomizer({ seed, profile, displayName, onUnlock, onEquip, onClose }) {
  const [tab, setTab] = useState('frame');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [previewItem, setPreviewItem] = useState(null);

  const points = profile?.points ?? 0;
  const unlocked = profile?.unlockedItems ?? ['style-pixel-art'];
  const equipped = normalizeEquipped(profile?.equipped);
  const tabItems = ITEMS.filter(i => i.slot === tab);
  const hoveredItem = previewItem?.slot === tab ? previewItem : null;
  const previewEquipped = hoveredItem ? { ...equipped, [hoveredItem.slot]: hoveredItem.id } : equipped;

  const handleClick = async (item) => {
    if (busy) return;
    const isOwned = unlocked.includes(item.id) || item.cost === 0;
    const isEquipped = equipped[item.slot] === item.id;

    if (isEquipped) {
      if (item.slot === 'avatarStyle') return;
      setBusy(true);
      setMsg(null);
      try {
        await onEquip(item.slot, null);
      } catch {
        setMsg('エラーが発生しました');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isOwned) {
      setBusy(true);
      setMsg(null);
      try {
        await onEquip(item.slot, item.id);
      } catch {
        setMsg('エラーが発生しました');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (points < item.cost) {
      setMsg(`${item.name}にはあと${item.cost - points}pt必要です`);
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      await onUnlock(item.id);
      await onEquip(item.slot, item.id);
    } catch (e) {
      if (e.message === 'not_enough_points') setMsg('ポイントが不足しています');
      else if (e.message === 'already_owned') setMsg('すでに所持しています');
      else setMsg('エラーが発生しました');
    } finally {
      setBusy(false);
    }
  };

  const titleId = equipped.title;
  const titleColor = titleId ? TITLE_COLOR[titleId] : null;
  const nameStyle = titleColor === 'rainbow' ? {} : titleColor ? { color: titleColor } : { color: '#2c2c2c' };
  const nameClass = titleColor === 'rainbow' ? 'customizer-name title-rainbow' : 'customizer-name';

  return (
    <div className="customizer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="customizer-modal">
        <div className="customizer-header">
          <span className="customizer-title">アバターカスタマイズ</span>
          <button className="customizer-close" onClick={onClose}>✕</button>
        </div>

        <div className="customizer-preview">
          <AvatarIcon seed={seed} size={64} equipped={previewEquipped} />
          <div className="customizer-preview-info">
            <span className={nameClass} style={nameStyle}>{displayName}</span>
            <span className="customizer-points">所持ポイント: <strong>{points}</strong> pt</span>
            <span className="customizer-hint">カードに触れると試着できます</span>
          </div>
        </div>

        <div className="customizer-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`customizer-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => { setTab(t.key); setMsg(null); setPreviewItem(null); }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="customizer-body">
          {equipped[tab] && tab !== 'avatarStyle' && (
            <button className="customizer-unequip" onClick={() => handleClick({ slot: tab, id: equipped[tab] })}>
              {SLOT_LABELS[tab]}を外す
            </button>
          )}
          {msg && <p className="customizer-message">{msg}</p>}
          <div className="customizer-grid">
            {tabItems.map(item => {
              const isOwned = unlocked.includes(item.id) || item.cost === 0;
              const isEquipped = equipped[item.slot] === item.id;
              const canAfford = points >= item.cost;
              const statusLabel = isEquipped
                ? '装備中'
                : isOwned
                  ? '所持済'
                  : canAfford
                    ? '購入可'
                    : `未所持 ${item.cost}pt`;
              const statusCls = isEquipped ? 'equipped' : isOwned ? 'owned' : canAfford ? 'available' : 'locked';
              const cardCls = [
                'customizer-item',
                `rarity-${item.rarity}`,
                isEquipped ? 'equipped' : '',
                isOwned ? 'unlocked' : '',
              ].filter(Boolean).join(' ');

              return (
                <button
                  key={item.id}
                  className={cardCls}
                  onClick={() => handleClick(item)}
                  onMouseEnter={() => setPreviewItem(item)}
                  onFocus={() => setPreviewItem(item)}
                  onMouseLeave={() => setPreviewItem(null)}
                  onBlur={() => setPreviewItem(null)}
                  disabled={busy || (!isOwned && !canAfford)}
                  title={!isOwned && !canAfford ? 'ポイント不足' : ''}
                >
                  <ItemPreview item={item} />
                  <span className="customizer-item-name">{item.name}</span>
                  {item.theme && <span className="customizer-item-theme">{item.theme}</span>}
                  <span className="customizer-item-rarity">{RARITY_LABEL[item.rarity] ?? item.rarity}</span>
                  <span className={`customizer-item-status ${statusCls}`}>{statusLabel}</span>
                </button>
              );
            })}
          </div>
          {tab === 'avatarStyle' && (
            <p className="customizer-source-note">
              アバター本体は <a href={DICEBEAR_ATTRIBUTION.url} target="_blank" rel="noreferrer">{DICEBEAR_ATTRIBUTION.name}</a> の生成APIを使用しています。
              スタイルごとのライセンスは <a href={DICEBEAR_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer">DiceBear Licenses</a> を参照してください。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
