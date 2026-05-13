import { useEffect, useRef, useState } from 'react';
import HighlightedToken from './HighlightedToken';

function buildSegments(text, allTargets, activeType, pinnedPhrase) {
  const targets = activeType === 'all'
    ? allTargets
    : allTargets.filter(t => t.type === activeType);

  const located = targets
    .map(t => {
      const exactIdx = Number.isInteger(t.start) && text.slice(t.start, t.start + t.surface.length) === t.surface
        ? t.start
        : -1;
      const hint = Math.max(0, (t.start ?? 0) - 5);
      const idx = exactIdx !== -1 ? exactIdx : text.indexOf(t.surface, hint);
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

function getKundoku(section) {
  return section.kundoku ?? section.kakikudashi ?? section.readingText ?? '';
}

function getNotes(section, textNotes, isFirstSection) {
  return section.notes ?? section.remarks ?? section.memo ?? (isFirstSection ? textNotes : '') ?? '';
}

function isKanbunText(text) {
  const normalized = text.replace(/[\s、。，．・「」『』（）()〈〉《》！？!?]/g, '');
  return normalized.length > 0 && /^[\p{Script=Han}]+$/u.test(normalized);
}

function longestLineLength(text) {
  return Math.max(...text.split(/\r?\n/).map(line => Array.from(line).length), 0);
}

function ReferenceBlock({ label, text }) {
  if (!text) return null;
  return (
    <div className="admin-modern-translation">
      <div className="admin-modern-label">{label}</div>
      <div className="reference-text-scroll">
        <p className="reference-vertical-text">{text}</p>
      </div>
    </div>
  );
}

function KundokuTextBlock({ text }) {
  if (!text) return null;
  return (
    <div className="kundoku-text-scroll">
      <p className="kundoku-vertical-text">{text}</p>
    </div>
  );
}

function KundokuToggle({ kundoku, showKundoku, onToggle }) {
  if (!kundoku) return null;
  return (
    <div className="student-kundoku-area">
      <button className="kundoku-toggle-btn" onClick={onToggle}>
        {showKundoku ? '書き下し文を隠す' : '書き下し文を表示する'}
      </button>
      {showKundoku && <KundokuTextBlock text={kundoku} />}
    </div>
  );
}

function SourceKundokuRow({ children, kundoku, showKundoku, onToggle }) {
  return (
    <div className="source-kundoku-row">
      <div className="source-text-pane">{children}</div>
      <KundokuToggle
        kundoku={kundoku}
        showKundoku={showKundoku}
        onToggle={onToggle}
      />
    </div>
  );
}

function SectionCard({ section, textNotes, isFirstSection, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern }) {
  const scrollRef = useRef(null);
  const textRef = useRef(null);
  const [firstPoint, setFirstPoint] = useState(null);
  const [showKundoku, setShowKundoku] = useState(false);
  const phrase = pinnedPhrase?.sectionId === section.id ? pinnedPhrase.text : null;
  const segments = buildSegments(section.text, section.targets ?? [], activeType, phrase);
  const kundoku = getKundoku(section);
  const notes = getNotes(section, textNotes, isFirstSection);
  const isKanbun = isKanbunText(section.text);
  const sourceTextStyle = isKanbun
    ? { '--source-text-height': `${Math.max(longestLineLength(section.text) + 2, 8) * 1.12}em` }
    : undefined;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, []);

  const isSelected = t =>
    selectedTarget?.id === t.id ||
    (selectedTarget?.groupId && selectedTarget.groupId === t.groupId);

  const handleCharClick = (index) => {
    if (!selectionMode) return;
    if (!firstPoint || firstPoint.sectionId !== section.id) {
      setFirstPoint({ sectionId: section.id, index });
      return;
    }

    const start = Math.min(firstPoint.index, index);
    const end = Math.max(firstPoint.index, index) + 1;
    onRangeSelect?.({
      sectionId: section.id,
      sectionTitle: section.title,
      text: section.text.slice(start, end),
      start,
      end,
    });
    setFirstPoint(null);
  };

  const selectedStart = selectionRange?.sectionId === section.id ? selectionRange.start : null;
  const selectedEnd = selectionRange?.sectionId === section.id ? selectionRange.end : null;

  if (selectionMode) {
    return (
      <div className="section-card section-card--selection">
        <div className="section-title">{section.title}</div>
        <SourceKundokuRow
          kundoku={kundoku}
          showKundoku={showKundoku}
          onToggle={() => setShowKundoku(value => !value)}
        >
          <div className="vertical-text-scroll" ref={scrollRef}>
            <div
              className={`vertical-text vertical-text--selecting${isKanbun ? ' vertical-text--kanbun' : ''}`}
              ref={textRef}
              style={sourceTextStyle}
            >
              {Array.from(section.text).map((char, index) => {
                const isFirst = firstPoint?.sectionId === section.id && firstPoint.index === index;
                const isSelected = selectedStart !== null && index >= selectedStart && index < selectedEnd;
                return (
                  <span
                    key={`${section.id}-${index}`}
                    className={`range-char${isFirst ? ' range-char--first' : ''}${isSelected ? ' range-char--selected' : ''}`}
                    onClick={() => handleCharClick(index)}
                  >
                    {char}
                  </span>
                );
              })}
            </div>
          </div>
        </SourceKundokuRow>
        {showModern && (
          <>
            <ReferenceBlock label="現代語訳" text={section.modern} />
            <ReferenceBlock label="備考" text={notes} />
          </>
        )}
      </div>
    );
  };

  return (
    <div className="section-card">
      <div className="section-title">{section.title}</div>
      <SourceKundokuRow
        kundoku={kundoku}
        showKundoku={showKundoku}
        onToggle={() => setShowKundoku(value => !value)}
      >
        <div className="vertical-text-scroll" ref={scrollRef}>
          <div
            className={`vertical-text${isKanbun ? ' vertical-text--kanbun' : ''}`}
            ref={textRef}
            style={sourceTextStyle}
          >
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
      </SourceKundokuRow>
      {showModern ? (
        <>
          <ReferenceBlock label="現代語訳" text={section.modern} />
          <ReferenceBlock label="備考" text={notes} />
        </>
      ) : (
        <>
          <ReferenceBlock label="備考" text={notes} />
        </>
      )}
    </div>
  );
}

export default function VerticalTextViewer({ notes, sections, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern }) {
  const visibleSections = sections.filter(section => !section.sectionless);
  return (
    <div className="vertical-viewer">
      {visibleSections.map((section, index) => (
        <SectionCard
          key={section.id}
          section={section}
          textNotes={notes}
          isFirstSection={index === 0}
          selectedTarget={selectedTarget}
          onSelectTarget={onSelectTarget}
          activeType={activeType}
          pinnedPhrase={pinnedPhrase}
          selectionMode={selectionMode}
          selectionRange={selectionRange}
          onRangeSelect={onRangeSelect}
          showModern={showModern}
        />
      ))}
    </div>
  );
}
