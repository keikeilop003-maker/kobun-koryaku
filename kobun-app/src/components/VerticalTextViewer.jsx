import { useEffect, useRef } from 'react';
import HighlightedToken from './HighlightedToken';

function buildSegments(text, targets) {
  // Sort by first occurrence in text to handle position ambiguity
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
    if (idx < pos) continue; // already consumed (overlap)
    if (idx > pos) segments.push({ type: 'plain', text: text.slice(pos, idx) });
    segments.push({ type: 'target', target: t });
    pos = idx + t.surface.length;
  }
  if (pos < text.length) segments.push({ type: 'plain', text: text.slice(pos) });
  return segments;
}

function SectionCard({ section, selectedTarget, onSelectTarget, activeTypes }) {
  const scrollRef = useRef(null);
  const visibleTargets = (section.targets ?? []).filter(t => activeTypes.has(t.type));
  const segments = buildSegments(section.text, visibleTargets);

  // Scroll to the start of vertical text (rightmost = beginning) after render
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, []);

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
                key={seg.target.id}
                target={seg.target}
                isSelected={selectedTarget?.id === seg.target.id}
                onClick={t => onSelectTarget(t, section)}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerticalTextViewer({ sections, selectedTarget, onSelectTarget, activeTypes }) {
  return (
    <div className="vertical-viewer">
      {sections.map(section => (
        <SectionCard
          key={section.id}
          section={section}
          selectedTarget={selectedTarget}
          onSelectTarget={onSelectTarget}
          activeTypes={activeTypes}
        />
      ))}
    </div>
  );
}
