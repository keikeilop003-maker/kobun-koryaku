const TYPE_CONFIG = {
  all:      { label: '全語句',   className: 'hl-all' },
  vocab:    { label: '重要単語', className: 'hl-vocab' },
  aux:      { label: '助動詞',   className: 'hl-aux' },
  verb:     { label: '動詞',     className: 'hl-verb' },
  adj:      { label: '形容詞',   className: 'hl-adj' },
  particle: { label: '助詞',     className: 'hl-particle' },
  grammar:  { label: '文法・句法', className: 'hl-grammar' },
};

export default function HighlightedToken({ target, isSelected, onClick, showAsAll, children }) {
  const cfg = showAsAll
    ? TYPE_CONFIG.all
    : (TYPE_CONFIG[target.type] ?? { label: '?', className: '' });

  return (
    <span
      className={`highlight-token ${cfg.className}${isSelected ? ' selected' : ''}`}
      onClick={() => onClick(target)}
      title={cfg.label}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(target)}
    >
      {children ?? target.surface}
    </span>
  );
}
