import { useState } from 'react';
import AvatarIcon from './AvatarIcon';
import { ITEMS, BADGE_EMOJI, TITLE_COLOR, STYLE_DICEBEAR, DEFAULT_EQUIPPED } from '../data/items';

const TABS = [
  { key: 'frame',       label: 'フレーム' },
  { key: 'badge',       label: 'バッジ' },
  { key: 'title',       label: '称号' },
  { key: 'avatarStyle', label: 'スタイル' },
];

function ItemPreview({ item }) {
  if (item.slot === 'badge') return <span style={{ fontSize: '1.8rem' }}>{item.emoji}</span>;
  if (item.slot === 'title') {
    const color = TITLE_COLOR[item.id];
    if (color === 'rainbow') {
      return <span className="customizer-item-preview title-rainbow" style={{ fontSize: '1rem', fontWeight: 'bold' }}>{item.name}</span>;
    }
    return <span className="customizer-item-preview" style={{ color, fontSize: '1rem', fontWeight: 'bold' }}>{item.name}</span>;
  }
  if (item.slot === 'avatarStyle') {
    return <span className="customizer-item-preview" style={{ fontSize: '1.4rem' }}>🪄</span>;
  }
  // frame
  const frameColors = {
    'frame-silver': '#9e9e9e',
    'frame-gold': '#f9a825',
    'frame-fire': '#e53935',
    'frame-rainbow': 'linear-gradient(135deg,#e53935,#f9a825,#2e7d32,#1565c0,#6a1b9a)',
  };
  const bg = frameColors[item.id] ?? '#ccc';
  return (
    <span
      className="customizer-item-preview"
      style={{
        width: 32, height: 32, borderRadius: '50%', display: 'inline-block',
        background: bg.startsWith('linear') ? bg : undefined,
        border: bg.startsWith('linear') ? undefined : `3px solid ${bg}`,
        boxSizing: 'border-box',
      }}
    />
  );
}

export default function AvatarCustomizer({ seed, profile, displayName, onUnlock, onEquip, onClose }) {
  const [tab, setTab] = useState('frame');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const points = profile?.points ?? 0;
  const unlocked = profile?.unlockedItems ?? ['style-pixel-art'];
  const equipped = profile?.equipped ?? { ...DEFAULT_EQUIPPED };

  const tabItems = ITEMS.filter(i => i.slot === tab);

  const previewEquipped = { ...equipped };

  const handleClick = async (item) => {
    if (busy) return;
    const isOwned = unlocked.includes(item.id);
    const isEquipped = equipped[item.slot] === item.id;

    if (isEquipped) {
      setBusy(true);
      setMsg(null);
      try {
        await onEquip(item.slot, null);
      } catch (e) {
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
      } catch (e) {
        setMsg('エラーが発生しました');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (item.cost === 0) {
      setBusy(true);
      try {
        await onUnlock(item.id);
        await onEquip(item.slot, item.id);
      } catch (e) {
        setMsg('エラーが発生しました');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (points < item.cost) {
      setMsg('ポイントが不足しています');
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
          <AvatarIcon seed={seed} size={56} equipped={previewEquipped} />
          <div className="customizer-preview-info">
            <span className={nameClass} style={nameStyle}>{displayName}</span>
            <span className="customizer-points">所持ポイント: <strong>{points}</strong> pt</span>
          </div>
        </div>

        <div className="customizer-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`customizer-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => { setTab(t.key); setMsg(null); }}
            >{t.label}</button>
          ))}
        </div>

        <div className="customizer-body">
          {equipped[tab] && (
            <button className="customizer-unequip" onClick={() => handleClick({ slot: tab, id: equipped[tab] })}>
              外す
            </button>
          )}
          {msg && <p style={{ fontSize: '0.8rem', color: '#d93025', marginBottom: 10 }}>{msg}</p>}
          <div className="customizer-grid">
            {tabItems.map(item => {
              const isOwned = unlocked.includes(item.id) || item.cost === 0;
              const isEquipped = equipped[item.slot] === item.id;
              const canAfford = points >= item.cost;
              const statusLabel = isEquipped ? '装備中' : isOwned ? '所持済' : `${item.cost}pt`;
              const statusCls = isEquipped ? 'equipped' : isOwned ? 'owned' : 'locked';
              const cardCls = `customizer-item${isEquipped ? ' equipped' : isOwned ? ' unlocked' : ''}`;

              return (
                <button
                  key={item.id}
                  className={cardCls}
                  onClick={() => handleClick(item)}
                  disabled={busy || (!isOwned && !canAfford)}
                  title={!isOwned && !canAfford ? 'ポイント不足' : ''}
                >
                  <ItemPreview item={item} />
                  <span className="customizer-item-name">{item.name}</span>
                  <span className={`customizer-item-status ${statusCls}`}>{statusLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
