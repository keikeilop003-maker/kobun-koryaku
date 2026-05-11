import { BADGE_EMOJI, STYLE_DICEBEAR, normalizeEquipped } from '../data/items';

export default function AvatarIcon({ seed, size = 32, equipped }) {
  const normalized = normalizeEquipped(equipped);
  const style = STYLE_DICEBEAR[normalized.avatarStyle] ?? normalized.avatarStyle ?? 'pixel-art';
  const frameId = normalized.frame;
  const badgeId = normalized.badge;
  const backgroundId = normalized.background;
  const auraId = normalized.aura;
  const url = `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&size=${size}`;

  return (
    <div
      className={[
        'avatar-wrapper',
        frameId,
        backgroundId,
        auraId,
      ].filter(Boolean).join(' ')}
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      {backgroundId && <span className="avatar-background" aria-hidden="true" />}
      {auraId && <span className="avatar-aura" aria-hidden="true" />}
      <img src={url} width={size} height={size} className="avatar-icon" alt="" />
      {badgeId && (
        <span className="avatar-badge" style={{ fontSize: size * 0.36 }}>
          {BADGE_EMOJI[badgeId]}
        </span>
      )}
    </div>
  );
}
