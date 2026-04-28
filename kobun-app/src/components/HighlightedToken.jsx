const TYPE_CONFIG = {
  vocab:    { label: '単語', className: 'hl-vocab' },
  aux:      { label: '助動詞', className: 'hl-aux' },
  verb:     { label: '動詞', className: 'hl-verb' },
  particle: { label: '助詞', className: 'hl-particle' },
  grammar:  { label: '文法', className: 'hl-grammar' },
};

export default function HighlightedToken({ target, isSelected, onClick }) {
  const cfg = TYPE_CONFIG[target.type] ?? { label: '?', className: '' };

  return (
    <span
      className={`highlight-token ${cfg.className}${isSelected ? ' selected' : ''}`}
      onClick={() => onClick(target)}
      title={cfg.label}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(target)}
    >
      {target.surface}
    </span>
  );
}
