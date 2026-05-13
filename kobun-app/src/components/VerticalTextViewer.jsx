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

function sectionTextStyle(sourceText, kundokuText) {
  const longest = Math.max(longestLineLength(sourceText), longestLineLength(kundokuText), 18);
  return { '--source-text-height': `${(longest + 2) * 1.35}em` };
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

function KundokuTextBlock({ text, isKanbun, style }) {
  if (!text) return null;
  return (
    <div className="kundoku-text-scroll">
      <p
        className={`kundoku-vertical-text${isKanbun ? ' kundoku-vertical-text--kanbun' : ''}`}
        style={style}
      >
        {text}
      </p>
    </div>
  );
}

function KundokuToggle({ kundoku, showKundoku, onToggle, isKanbun, sourceTextStyle }) {
  if (!kundoku) return null;
  return (
    <div className="student-kundoku-area">
      <button className="kundoku-toggle-btn" onClick={onToggle}>
        {showKundoku ? '書き下し文を隠す' : '書き下し文を表示する'}
      </button>
      {showKundoku && <KundokuTextBlock text={kundoku} isKanbun={isKanbun} style={sourceTextStyle} />}
    </div>
  );
}

function SourceKundokuRow({ children, kundoku, showKundoku, onToggle, isKanbun, sourceTextStyle }) {
  return (
    <div className="source-kundoku-row">
      <div className="source-text-pane">{children}</div>
      <KundokuToggle
        kundoku={kundoku}
        showKundoku={showKundoku}
        onToggle={onToggle}
        isKanbun={isKanbun}
        sourceTextStyle={sourceTextStyle}
      />
    </div>
  );
}

function SectionEditor({ section, kundoku, onCancel, onSave }) {
  const [sourceText, setSourceText] = useState(section.text ?? '');
  const [kundokuText, setKundokuText] = useState(kundoku ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      await onSave?.({
        text: sourceText,
        kundoku: kundokuText,
      });
      setMessage('保存しました');
      onCancel?.();
    } catch (err) {
      console.error('[SectionEditor] save failed:', err);
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-section-editor">
      <label>
        原文
        <textarea rows={8} value={sourceText} onChange={(e) => setSourceText(e.target.value)} />
      </label>
      <label>
        書き下し文
        <textarea rows={8} value={kundokuText} onChange={(e) => setKundokuText(e.target.value)} />
      </label>
      <div className="admin-inline-actions">
        {message && <span className="admin-message">{message}</span>}
        <button type="button" className="admin-secondary-btn" onClick={onCancel}>キャンセル</button>
        <button type="button" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
      </div>
    </div>
  );
}

function SectionCard({ section, textNotes, isFirstSection, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern, isAdmin, onUpdateSection }) {
  const scrollRef = useRef(null);
  const textRef = useRef(null);
  const [firstPoint, setFirstPoint] = useState(null);
  const [showKundoku, setShowKundoku] = useState(false);
  const [editingSection, setEditingSection] = useState(false);
  const phrase = pinnedPhrase?.sectionId === section.id ? pinnedPhrase.text : null;
  const segments = buildSegments(section.text, section.targets ?? [], activeType, phrase);
  const kundoku = getKundoku(section);
  const notes = getNotes(section, textNotes, isFirstSection);
  const isKanbun = isKanbunText(section.text);
  const sourceTextStyle = sectionTextStyle(section.text, kundoku);

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
          isKanbun={isKanbun}
          sourceTextStyle={sourceTextStyle}
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
      {isAdmin && !section.sectionless && (
        <div className="admin-section-tools">
          <button type="button" onClick={() => setEditingSection(value => !value)}>
            {editingSection ? '編集を閉じる' : '原文・書き下し文を編集'}
          </button>
        </div>
      )}
      {editingSection && (
        <SectionEditor
          section={section}
          kundoku={kundoku}
          onCancel={() => setEditingSection(false)}
          onSave={(updates) => onUpdateSection?.(section, updates)}
        />
      )}
      <SourceKundokuRow
        kundoku={kundoku}
        showKundoku={showKundoku}
        onToggle={() => setShowKundoku(value => !value)}
        isKanbun={isKanbun}
        sourceTextStyle={sourceTextStyle}
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

export default function VerticalTextViewer({ notes, sections, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern, isAdmin, onUpdateSection }) {
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
          isAdmin={isAdmin}
          onUpdateSection={onUpdateSection}
        />
      ))}
    </div>
  );
}
