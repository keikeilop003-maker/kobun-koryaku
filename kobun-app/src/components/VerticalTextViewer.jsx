import { useEffect, useRef } from 'react';
import HighlightedToken from './HighlightedToken';

function buildSegments(text, allTargets, activeType, pinnedPhrase) {
  const targets = activeType === 'all'
    ? allTargets
    : allTargets.filter(t => t.type === activeType);

  const located = targets
    .map(t => {
      const hint = Math.max(0, (t.start ?? 0) - 5);
      const idx = text.indexOf(t.surface, hint);
      return { t, idx: idx !== -1 ? idx : text.indexOf(t.surface), pinned: false };
    })
    .filter(({ idx }) => idx !== -1);

  if (pinnedPhrase) {
    const idx = text.indexOf(pinnedPhrase);
    if (idx !== -1) {
      located.push({ t: { id: '__pinned__', surface: pinnedPhrase }, idx, pinned: true });
    }
  }

  located.sort((a, b) => a.idx - b.idx);

  const segments = [];
  let pos = 0;
  for (const { t, idx, pinned } of located) {
    if (idx < pos) continue;
    if (idx > pos) segments.push({ type: 'plain', text: text.slice(pos, idx) });
    if (pinned) {
      segments.push({ type: 'pinned', text: t.surface });
    } else {
      segments.push({ type: 'target', target: t, showAsAll: activeType === 'all' });
    }
    pos = idx + t.surface.length;
  }
  if (pos < text.length) segments.push({ type: 'plain', text: text.slice(pos) });
  return segments;
}

function SectionCard({ section, selectedTarget, onSelectTarget, activeType, pinnedPhrase }) {
  const scrollRef = useRef(null);
  const phrase = pinnedPhrase?.sectionId === section.id ? pinnedPhrase.text : null;
  const segments = buildSegments(section.text, section.targets ?? [], activeType, phrase);

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
            ) : seg.type === 'pinned' ? (
              <span key={i} className="pinned-translation">{seg.text}</span>
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

export default function VerticalTextViewer({ sections, selectedTarget, onSelectTarget, activeType, pinnedPhrase }) {
  return (
    <div className="vertical-viewer">
      {sections.map(section => (
        <SectionCard
          key={section.id}
          section={section}
          selectedTarget={selectedTarget}
          onSelectTarget={onSelectTarget}
          activeType={activeType}
          pinnedPhrase={pinnedPhrase}
        />
      ))}
    </div>
  );
}
