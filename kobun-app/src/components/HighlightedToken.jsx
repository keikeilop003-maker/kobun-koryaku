const TYPE_CONFIG = {
  reading:  { label: '読み', className: 'hl-reading' },
  rhetoric: { label: '修辞', className: 'hl-rhetoric' },
  all:      { label: '全語句',   className: 'hl-all' },
  vocab:    { label: '語句', className: 'hl-vocab' },
  aux:      { label: '助動詞',   className: 'hl-aux' },
  verb:     { label: '動詞',     className: 'hl-verb' },
  adj:      { label: '形容詞',   className: 'hl-adj' },
  particle: { label: '助詞',     className: 'hl-particle' },
  grammar:  { label: '文法', className: 'hl-grammar' },
};

export default function HighlightedToken({ target, isSelected, onClick, showAsAll, children }) {
  const cfg = showAsAll
    ? TYPE_CONFIG.all
    : (TYPE_CONFIG[target.type] ?? { label: '?', className: '' });

  return (
    <span
      className={`highlight-token ${cfg.className}${isSelected ? ' selected' : ''}`}
      onClick={() => onClick(target)}
      data-target-id={target.id ?? ''}
      data-group-id={target.groupId ?? ''}
      title={cfg.label}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(target)}
    >
      {children ?? target.surface}
    </span>
  );
}
