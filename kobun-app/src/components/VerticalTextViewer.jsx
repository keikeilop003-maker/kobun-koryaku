import { useEffect, useRef } from 'react';
import HighlightedToken from './HighlightedToken';

function buildSegments(text, allTargets, activeType) {
  const targets = activeType === 'all'
    ? allTargets
    : allTargets.filter(t => t.type === activeType);

  const located = targets
    .map(t => {
      const hint = Math.max(0, (t.start ?? 0) - 5);
      const idx = text.indexOf(t.surface, hint);
      return { t, idx: idx !== -1 ? idx : text.indexOf(t.surface) };
    })
    .filter(({ idx }) => idx !== -1)
    .sort((a, b) => a.idx - b.idx);

  const segments = [];
  let pos = 0;
  for (const { t, idx } of located) {
    if (idx < pos) continue;
    if (idx > pos) segments.push({ type: 'plain', text: text.slice(pos, idx) });
    segments.push({ type: 'target', target: t, showAsAll: activeType === 'all' });
    pos = idx + t.surface.length;
  }
  if (pos < text.length) segments.push({ type: 'plain', text: text.slice(pos) });
  return segments;
}

function SectionCard({ section, selectedTarget, onSelectTarget, activeType }) {
  const scrollRef = useRef(null);
  const segments = buildSegments(section.text, section.targets ?? [], activeType);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, []);

  const isSelected = t =>
    selectedTarget?.id === t.id ||
    (selectedTarget?.groupId && selectedTarget.groupId === t.groupId);

  return (
    <div className="section-card">
      <div className="section-title">{section.title}</div>
      <div className="vertical-text-scroll" ref={scrollRef}>
        <div className="vertical-text">
          {segments.map((seg, i) =>
            seg.type === 'plain' ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <HighlightedToken
                key={`${seg.target.id}-${seg.showAsAll}`}
                target={seg.target}
                isSelected={isSelected(seg.target)}
                onClick={t => onSelectTarget(t, section)}
                showAsAll={seg.showAsAll}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerticalTextViewer({ sections, selectedTarget, onSelectTarget, activeType }) {
  return (
    <div className="vertical-viewer">
      {sections.map(section => (
        <SectionCard
          key={section.id}
          section={section}
          selectedTarget={selectedTarget}
          onSelectTarget={onSelectTarget}
          activeType={activeType}
        />
      ))}
    </div>
  );
}
