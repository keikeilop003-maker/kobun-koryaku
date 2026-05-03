export default function AvatarIcon({ seed, size = 32 }) {
  const url = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(seed)}&size=${size}`;
  return (
    <img
      src={url}
      width={size}
      height={size}
      className="avatar-icon"
      alt=""
      style={{ borderRadius: '50%', flexShrink: 0 }}
    />
  );
}
