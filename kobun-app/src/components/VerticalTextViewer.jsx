import { useEffect, useRef, useState } from 'react';
import HighlightedToken from './HighlightedToken';
import { reviewKaeriten } from '../services/gemini';
import { emptyKaeritenAnswer, kaeritenChars, needsHyphen, parseKaeritenAnswer, serializeKaeritenAnswer } from '../utils/kaeriten';

function findIgnoringLineBreaks(text, phrase) {
  const needle = phrase.replace(/[\r\n]/g, '');
  if (!needle) return null;
  const indexMap = [];
  let normalized = '';
  let sourceIndex = 0;
  for (const char of text) {
    if (char === '\r' || char === '\n') {
      sourceIndex += char.length;
      continue;
    }
    indexMap.push(sourceIndex);
    normalized += char;
    sourceIndex += char.length;
  }
  const normalizedIndex = normalized.indexOf(needle);
  if (normalizedIndex === -1) return null;
  const start = indexMap[normalizedIndex];
  const end = indexMap[normalizedIndex + needle.length - 1] + 1;
  return { start, end };
}

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
      const resolvedIdx = idx !== -1 ? idx : text.indexOf(t.surface);
      return { t, idx: resolvedIdx, end: resolvedIdx + t.surface.length, pinned: false };
    })
    .filter(({ idx }) => idx !== -1);

  if (pinnedPhrase) {
    const match = findIgnoringLineBreaks(text, pinnedPhrase);
    if (match) {
      located.push({
        t: { id: '__pinned__', surface: text.slice(match.start, match.end) },
        idx: match.start,
        end: match.end,
        pinned: true,
      });
    }
  }

  located.sort((a, b) => a.idx - b.idx);

  const segments = [];
  let pos = 0;
  for (const { t, idx, end, pinned } of located) {
    if (idx < pos) continue;
    if (idx > pos) segments.push({ type: 'plain', text: text.slice(pos, idx) });
    if (pinned) {
      segments.push({ type: 'pinned', text: t.surface });
    } else {
      segments.push({ type: 'target', target: t, showAsAll: activeType === 'all' });
    }
    pos = end;
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

function sectionTextStyle(sourceText, kundokuText, heightScale = 1, isKanbun = false) {
  const longest = Math.max(longestLineLength(sourceText), longestLineLength(kundokuText), 8);
  const sourceFontSizeRem = isKanbun ? 1.764 : 1.26;
  return { '--source-text-height': `${(longest + 1) * 1.1 * sourceFontSizeRem * heightScale}rem` };
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

function KaeritenInlineExercise({ target, section, isAdmin, onRecord, onUpdateTarget }) {
  const chars = kaeritenChars(target.surface);
  const initialUser = parseKaeritenAnswer('', target.surface);
  const answer = parseKaeritenAnswer(target.answer || emptyKaeritenAnswer(target.surface), target.surface);
  const [marks, setMarks] = useState(() => chars.map((_, index) => initialUser.marks[index] ?? ''));
  const [hyphens, setHyphens] = useState(() => new Set(initialUser.hyphens));
  const [adminMarks, setAdminMarks] = useState(() => chars.map((_, index) => answer.marks[index] ?? ''));
  const [adminHyphens, setAdminHyphens] = useState(() => new Set(answer.hyphens));
  const [hyphenMode, setHyphenMode] = useState(false);
  const [judgement, setJudgement] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const answerHasHyphen = needsHyphen(target.answer, target.surface);

  const userAnswer = (nextMarks = marks, nextHyphens = hyphens) => serializeKaeritenAnswer({
    marks: nextMarks,
    hyphens: [...nextHyphens],
  }, target.surface);

  const adminAnswer = (nextMarks = adminMarks, nextHyphens = adminHyphens) => serializeKaeritenAnswer({
    marks: nextMarks,
    hyphens: [...nextHyphens],
  }, target.surface);

  const updateMark = (index, value) => {
    setMarks(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
    setJudgement('');
  };

  const toggleHyphen = (index) => {
    if (!hyphenMode) return;
    setHyphens(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setJudgement('');
  };

  const updateAdminMark = (index, value) => {
    setAdminMarks(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
    setMessage('');
  };

  const toggleAdminHyphen = (index) => {
    setAdminHyphens(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setMessage('');
  };

  const submit = async () => {
    const result = await reviewKaeriten({
      userAnswer: userAnswer(),
      correctAnswer: target.answer,
      acceptedAnswers: target.alternativeAnswers,
    });
    setJudgement(result?.judgement ?? '');
    onRecord?.({
      id: target.id,
      type: target.type,
      surface: target.surface,
      sectionId: section?.id ?? null,
      targetId: target.id,
      questionId: null,
      judgement: result?.judgement ?? '不正解',
      feedback: {
        ...result,
        userAnswer: userAnswer(),
      },
    });
  };

  const saveAnswer = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      await onUpdateTarget?.(target, section, {
        sectionId: section.id,
        target: {
          ...target,
          answer: adminAnswer(),
        },
        anchor: {
          sectionId: section.id,
          text: target.surface,
          start: Number.isInteger(target.start) ? target.start : section.text.indexOf(target.surface),
          end: Number.isInteger(target.start) ? target.start + target.surface.length : section.text.indexOf(target.surface) + target.surface.length,
        },
      });
      setMessage('保存しました');
    } catch (err) {
      console.error('[kaeriten inline save] failed:', err);
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const renderUnits = ({ values, hyphenSet, onMark, onHyphen, hyphenEnabled }) => (
    <div className="kaeriten-inline-units">
      {chars.map((char, index) => (
        <div className="kaeriten-inline-unit-wrap" key={`${char}-${index}`}>
          <div className="kaeriten-inline-unit">
            <span>{char}</span>
            <input
              value={values[index] ?? ''}
              maxLength={2}
              onChange={(event) => onMark(index, event.target.value)}
              aria-label={`${char}の返り点`}
            />
          </div>
          {index < chars.length - 1 && (
            <button
              type="button"
              className={`kaeriten-inline-hyphen${hyphenSet.has(index) ? ' active' : ''}`}
              disabled={!hyphenEnabled}
              onClick={() => onHyphen(index)}
            >
              {hyphenSet.has(index) ? '-' : ''}
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <span className="kaeriten-inline-exercise">
      {renderUnits({
        values: marks,
        hyphenSet: hyphens,
        onMark: updateMark,
        onHyphen: toggleHyphen,
        hyphenEnabled: hyphenMode,
      })}
      {answerHasHyphen && <span className="kaeriten-hyphen-note">※ハイフンを使用する必要があります</span>}
      <span className="kaeriten-inline-actions">
        {answerHasHyphen && (
          <button type="button" className={hyphenMode ? 'active' : ''} onClick={() => setHyphenMode(value => !value)}>
            ハイフンを入力
          </button>
        )}
        <button type="button" onClick={submit}>採点</button>
        {judgement && <strong className={`kaeriten-inline-judge ${judgement === '正解' ? 'correct' : 'wrong'}`}>{judgement}</strong>}
      </span>
      {isAdmin && (
        <span className="kaeriten-inline-admin">
          <span className="kaeriten-inline-admin-title">模範解答</span>
          {renderUnits({
            values: adminMarks,
            hyphenSet: adminHyphens,
            onMark: updateAdminMark,
            onHyphen: toggleAdminHyphen,
            hyphenEnabled: true,
          })}
          <span className="kaeriten-inline-actions">
            <button type="button" onClick={saveAnswer} disabled={saving}>{saving ? '保存中...' : '模範解答を保存'}</button>
            {message && <span className="admin-message">{message}</span>}
          </span>
        </span>
      )}
    </span>
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

function SectionCard({ section, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern, isAdmin, onUpdateSection, onUpdateTarget, onRecord, sourceHeightScale }) {
  const scrollRef = useRef(null);
  const textRef = useRef(null);
  const pinnedRef = useRef(null);
  const [firstPoint, setFirstPoint] = useState(null);
  const [showKundoku, setShowKundoku] = useState(false);
  const [editingSection, setEditingSection] = useState(false);
  const phrase = pinnedPhrase?.sectionId === section.id ? pinnedPhrase.text : null;
  const segments = buildSegments(section.text, section.targets ?? [], activeType, phrase);
  const kundoku = getKundoku(section);
  const isKanbun = isKanbunText(section.text);
  const sourceTextStyle = sectionTextStyle(section.text, kundoku, sourceHeightScale, isKanbun);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, []);

  useEffect(() => {
    if (!phrase) return;
    const token = pinnedRef.current;
    if (!token) return;
    const timer = window.setTimeout(() => {
      token.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pinnedPhrase, phrase]);

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
                <span key={i} className="pinned-translation" ref={pinnedRef}>{seg.text}</span>
              ) : seg.target.type === 'kaeriten' && activeType === 'kaeriten' ? (
                <KaeritenInlineExercise
                  key={`${seg.target.id}-kaeriten`}
                  target={seg.target}
                  section={section}
                  isAdmin={isAdmin}
                  onUpdateTarget={onUpdateTarget}
                  onRecord={onRecord}
                />
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
        </>
      ) : null}
    </div>
  );
}

function NotesEditor({ section, initialText, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialText ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setText(initialText ?? '');
  }, [initialText]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      await onSave?.(section, { notes: text });
      setEditing(false);
      setMessage('保存しました');
      setTimeout(() => setMessage(''), 2000);
    } catch (err) {
      console.error('[NotesEditor] save failed:', err);
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="notes-admin-actions">
        {message && <span className="admin-message">{message}</span>}
        <button type="button" onClick={() => setEditing(true)}>備考を編集</button>
      </div>
    );
  }

  return (
    <div className="notes-editor">
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="admin-inline-actions">
        {message && <span className="admin-message">{message}</span>}
        <button type="button" className="admin-secondary-btn" onClick={() => { setText(initialText ?? ''); setEditing(false); }} disabled={saving}>キャンセル</button>
        <button type="button" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
      </div>
    </div>
  );
}

function NotesTab({ notes, sections, isAdmin, onUpdateSection }) {
  const visibleSections = sections.filter(section => !section.sectionless);
  const items = visibleSections
    .map((section, index) => ({
      id: section.id,
      title: section.title,
      section,
      text: getNotes(section, notes, index === 0),
    }))
    .filter(item => isAdmin || item.text);

  return (
    <div className="notes-tab-content">
      {items.length > 0 ? (
        items.map(item => (
          <div className="notes-section-card" key={item.id}>
            <div className="section-title">{item.title}</div>
            {item.text ? <ReferenceBlock label="備考" text={item.text} /> : <p className="notes-empty notes-empty--inline">備考はありません。</p>}
            {isAdmin && (
              <NotesEditor
                section={item.section}
                initialText={item.text}
                onSave={onUpdateSection}
              />
            )}
          </div>
        ))
      ) : (
        <p className="notes-empty">備考はありません。</p>
      )}
    </div>
  );
}

export default function VerticalTextViewer({ textId, notes, sections, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern, isAdmin, onUpdateSection, onUpdateTarget, onRecord }) {
  const [activeTab, setActiveTab] = useState('source');
  const visibleSections = sections.filter(section => !section.sectionless);
  const visibleTab = pinnedPhrase ? 'source' : activeTab;
  const sourceHeightScale = textId === 'gyofunori' ? 0.63 : 1;

  return (
    <div className="vertical-viewer">
      <div className="left-view-tabs">
        <button
          type="button"
          className={visibleTab === 'source' ? 'active' : ''}
          onClick={() => setActiveTab('source')}
        >
          原文
        </button>
        <button
          type="button"
          className={visibleTab === 'notes' ? 'active' : ''}
          onClick={() => setActiveTab('notes')}
        >
          備考
        </button>
      </div>
      {visibleTab === 'source' ? (
        visibleSections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
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
            onUpdateTarget={onUpdateTarget}
            onRecord={onRecord}
            sourceHeightScale={sourceHeightScale}
          />
        ))
      ) : (
        <NotesTab notes={notes} sections={sections} isAdmin={isAdmin} onUpdateSection={onUpdateSection} />
      )}
    </div>
  );
}
