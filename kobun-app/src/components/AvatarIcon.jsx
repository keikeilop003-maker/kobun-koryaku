import { BADGE_EMOJI } from '../data/items';

export default function AvatarIcon({ seed, size = 32, equipped }) {
  const style = equipped?.avatarStyle ?? 'pixel-art';
  const frameId = equipped?.frame ?? null;
  const badgeId = equipped?.badge ?? null;
  const url = `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&size=${size}`;

  return (
    <div
      className={`avatar-wrapper${frameId ? ` ${frameId}` : ''}`}
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <img src={url} width={size} height={size} className="avatar-icon" alt="" />
      {badgeId && (
        <span className="avatar-badge" style={{ fontSize: size * 0.36 }}>
          {BADGE_EMOJI[badgeId]}
        </span>
      )}
    </div>
  );
}
