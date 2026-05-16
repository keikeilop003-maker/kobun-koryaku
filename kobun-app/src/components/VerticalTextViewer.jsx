import { useEffect, useRef, useState } from 'react';
import HighlightedToken from './HighlightedToken';
import { reviewKaeriten } from '../services/gemini';
import { emptyKaeritenAnswer, kaeritenChars, needsHyphen, parseKaeritenAnswer, serializeKaeritenAnswer } from '../utils/kaeriten';

const KAERITEN_MARK_OPTIONS = ['', '一', '二', '三', 'レ', '上', '下'];

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

function getKanbunSyntax(section) {
  return section.kanbunSyntax ?? section.syntaxGuide ?? section.syntax ?? '';
}

function parseKanbunSyntax(value) {
  if (value && typeof value === 'object') {
    return normalizeKanbunSyntax(value);
  }
  const text = String(value ?? '').trim();
  if (text.startsWith('{')) {
    try {
      return normalizeKanbunSyntax(JSON.parse(text));
    } catch {
      // Fall through to legacy text handling.
    }
  }
  return normalizeKanbunSyntax({ base: text });
}

function kanbunSyntaxChars(base) {
  return Array.from(base ?? '');
}

function kanbunSyntaxHanIndexes(base) {
  const indexes = [];
  kanbunSyntaxChars(base).forEach((char, sourceIndex) => {
    if (isKanbunSyntaxEditableChar(char)) indexes.push(sourceIndex);
  });
  return indexes;
}

function normalizeKanbunSyntaxItem(value) {
  const base = String(value?.base ?? value?.text ?? '');
  const hanCount = kanbunSyntaxHanIndexes(base).length;
  const marks = Array.from({ length: hanCount }, (_, index) => normalizeSelectedKaeritenMark(value?.marks?.[index] ?? ''));
  const okurigana = Array.from({ length: hanCount }, (_, index) => String(value?.okurigana?.[index] ?? ''));
  const furigana = Array.from({ length: hanCount }, (_, index) => String(value?.furigana?.[index] ?? ''));
  const markX = Array.from({ length: hanCount }, (_, index) => Number(value?.markX?.[index] ?? 0));
  const markY = Array.from({ length: hanCount }, (_, index) => Number(value?.markY?.[index] ?? 0));
  const okuriganaX = Array.from({ length: hanCount }, (_, index) => Number(value?.okuriganaX?.[index] ?? 0));
  const okuriganaY = Array.from({ length: hanCount }, (_, index) => Number(value?.okuriganaY?.[index] ?? 0));
  const furiganaX = Array.from({ length: hanCount }, (_, index) => Number(value?.furiganaX?.[index] ?? 0));
  const furiganaY = Array.from({ length: hanCount }, (_, index) => Number(value?.furiganaY?.[index] ?? 0));
  return { base, marks, okurigana, furigana, markX, markY, okuriganaX, okuriganaY, furiganaX, furiganaY };
}

function emptyKanbunSyntaxItem() {
  return normalizeKanbunSyntaxItem({ base: '' });
}

function normalizeKanbunSyntax(value) {
  if (Array.isArray(value?.items)) {
    const items = value.items.map(normalizeKanbunSyntaxItem);
    return { version: 2, items: items.length ? items : [emptyKanbunSyntaxItem()] };
  }
  return { version: 2, items: [normalizeKanbunSyntaxItem(value)] };
}

function serializeKanbunSyntax(value) {
  return JSON.stringify(normalizeKanbunSyntax(value));
}

function resizeKanbunSyntaxAnnotations(base, previousItem) {
  const current = normalizeKanbunSyntaxItem(previousItem);
  const hanCount = kanbunSyntaxHanIndexes(base).length;
  return {
    ...current,
    base,
    marks: Array.from({ length: hanCount }, (_, index) => current.marks[index] ?? ''),
    okurigana: Array.from({ length: hanCount }, (_, index) => current.okurigana[index] ?? ''),
    furigana: Array.from({ length: hanCount }, (_, index) => current.furigana[index] ?? ''),
    markX: Array.from({ length: hanCount }, (_, index) => current.markX[index] ?? 0),
    markY: Array.from({ length: hanCount }, (_, index) => current.markY[index] ?? 0),
    okuriganaX: Array.from({ length: hanCount }, (_, index) => current.okuriganaX[index] ?? 0),
    okuriganaY: Array.from({ length: hanCount }, (_, index) => current.okuriganaY[index] ?? 0),
    furiganaX: Array.from({ length: hanCount }, (_, index) => current.furiganaX[index] ?? 0),
    furiganaY: Array.from({ length: hanCount }, (_, index) => current.furiganaY[index] ?? 0),
  };
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

function isKaeritenSourceChar(char) {
  return /^[\p{Script=Han}]$/u.test(char);
}

function isKanbunSyntaxEditableChar(char) {
  return Boolean(char) && !/\s/u.test(char);
}

function normalizeSelectedKaeritenMark(value) {
  return KAERITEN_MARK_OPTIONS.includes(value) ? value : '';
}

function findTargetRange(section, target) {
  const text = section.text ?? '';
  const surface = target.surface ?? '';
  if (Number.isInteger(target.start) && text.slice(target.start, target.start + surface.length) === surface) {
    return { start: target.start, end: target.start + surface.length };
  }
  const index = text.indexOf(surface);
  if (index !== -1) return { start: index, end: index + surface.length };
  return { start: 0, end: text.length };
}

function createSectionKaeritenTarget(section) {
  const surface = section.text ?? '';
  return {
    id: `kaeriten-${section.id}-${Date.now()}`,
    type: 'kaeriten',
    surface,
    questionText: '返り点を振りなさい。',
    answer: serializeKaeritenAnswer(emptyKaeritenAnswer(surface), surface),
    gradingMode: 'local',
    start: 0,
    end: surface.length,
  };
}

function KaeritenSourceExercise({ target, section, isAdmin, onRecord, onUpdateTarget, isKanbun, sourceTextStyle }) {
  const range = findTargetRange(section, target);
  const chars = kaeritenChars(target.surface);
  const initialUser = parseKaeritenAnswer('', target.surface);
  const answer = parseKaeritenAnswer(target.answer || emptyKaeritenAnswer(target.surface), target.surface);
  const [marks, setMarks] = useState(() => chars.map((_, index) => initialUser.marks[index] ?? ''));
  const [hyphens, setHyphens] = useState(() => new Set(initialUser.hyphens));
  const [adminMarks, setAdminMarks] = useState(() => chars.map((_, index) => answer.marks[index] ?? ''));
  const [adminHyphens, setAdminHyphens] = useState(() => new Set(answer.hyphens));
  const [hyphenMode, setHyphenMode] = useState(false);
  const [lineJudgements, setLineJudgements] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const answerHasHyphen = needsHyphen(target.answer, target.surface);
  const editingAnswer = isAdmin;

  const selectedMarks = editingAnswer ? adminMarks : marks;
  const selectedHyphens = editingAnswer ? adminHyphens : hyphens;

  const userAnswer = (nextMarks = marks, nextHyphens = hyphens) => serializeKaeritenAnswer({
    marks: nextMarks,
    hyphens: [...nextHyphens],
  }, target.surface);

  const adminAnswer = (nextMarks = adminMarks, nextHyphens = adminHyphens) => serializeKaeritenAnswer({
    marks: nextMarks,
    hyphens: [...nextHyphens],
  }, target.surface);

  const updateMark = (index, value) => {
    const updater = current => current.map((item, itemIndex) => itemIndex === index ? value : item);
    if (editingAnswer) {
      setAdminMarks(updater);
      setMessage('');
    } else {
      setMarks(updater);
      setLineJudgements({});
    }
  };

  const toggleHyphen = (index) => {
    if (!editingAnswer && !hyphenMode) return;
    const update = current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    };
    if (editingAnswer) {
      setAdminHyphens(update);
      setMessage('');
    } else {
      setHyphens(update);
      setLineJudgements({});
    }
  };

  const sourceChars = Array.from(section.text ?? '');
  const markLineIndexes = [];
  let scanLineIndex = 0;
  let scanMarkIndex = -1;
  sourceChars.forEach((char, index) => {
    const inTarget = index >= range.start && index < range.end;
    if (inTarget && isKaeritenSourceChar(char)) {
      scanMarkIndex += 1;
      markLineIndexes[scanMarkIndex] = scanLineIndex;
    }
    if (char === '\n') scanLineIndex += 1;
  });
  const lineIndexes = [...new Set(markLineIndexes)].filter(Number.isInteger);

  const lineAnswer = (lineIndex, sourceMarks, sourceHyphens) => {
    const keep = new Set(markLineIndexes
      .map((item, index) => item === lineIndex ? index : null)
      .filter(Number.isInteger));
    return serializeKaeritenAnswer({
      marks: sourceMarks.map((mark, index) => keep.has(index) ? mark : ''),
      hyphens: [...sourceHyphens].filter(index => keep.has(index) && keep.has(index + 1)),
    }, target.surface);
  };

  const submitLine = async (lineIndex) => {
    const current = lineAnswer(lineIndex, marks, hyphens);
    const correct = lineAnswer(lineIndex, answer.marks, new Set(answer.hyphens));
    const result = await reviewKaeriten({
      userAnswer: current,
      correctAnswer: correct,
      acceptedAnswers: [],
    });
    setLineJudgements(currentState => ({
      ...currentState,
      [lineIndex]: result?.judgement ?? '',
    }));
    onRecord?.({
      id: `${target.id}-line-${lineIndex + 1}`,
      type: target.type,
      surface: `${target.surface} ${lineIndex + 1}行目`,
      sectionId: section?.id ?? null,
      targetId: target.id,
      questionId: null,
      judgement: result?.judgement ?? '不正解',
      feedback: {
        ...result,
        userAnswer: current,
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
          start: range.start,
          end: range.end,
        },
      });
      setMessage('保存しました');
    } catch (err) {
      console.error('[kaeriten source save] failed:', err);
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  let markIndex = -1;
  let currentLineIndex = 0;
  const nodes = sourceChars.map((char, index) => {
    if (char === '\n') currentLineIndex += 1;
    const inTarget = index >= range.start && index < range.end;
    if (!inTarget || !isKaeritenSourceChar(char)) return <span key={index}>{char}</span>;
    markIndex += 1;
    const currentIndex = markIndex;
    const hasHyphenSlot = currentIndex < chars.length - 1;
    const lineIndex = markLineIndexes[currentIndex] ?? currentLineIndex;
    return (
      <span className="kaeriten-source-unit" data-line={lineIndex} key={index}>
        <span className="kaeriten-source-char">{char}</span>
        <select
          className="kaeriten-source-input"
          value={normalizeSelectedKaeritenMark(selectedMarks[currentIndex] ?? '')}
          onChange={(event) => updateMark(currentIndex, event.target.value)}
          aria-label={`${char}の返り点`}
        >
          {KAERITEN_MARK_OPTIONS.map(option => (
            <option key={option || 'blank'} value={option}>{option}</option>
          ))}
        </select>
        {hasHyphenSlot && (
          <button
            type="button"
            className={`kaeriten-source-hyphen${selectedHyphens.has(currentIndex) ? ' active' : ''}`}
            disabled={!editingAnswer && !hyphenMode}
            onClick={() => toggleHyphen(currentIndex)}
            aria-label={`${char}の後ろにハイフン`}
          >
            {selectedHyphens.has(currentIndex) ? '-' : ''}
          </button>
        )}
      </span>
    );
  });

  return (
    <>
      <div className={`vertical-text vertical-text--kaeriten-source${isKanbun ? ' vertical-text--kanbun' : ''}`} style={sourceTextStyle}>
        {nodes}
      </div>
      <div className="kaeriten-source-controls">
        {answerHasHyphen && !editingAnswer && <span className="kaeriten-hyphen-note">※ハイフンを使用する必要があります</span>}
        {!editingAnswer && answerHasHyphen && (
          <button type="button" className={hyphenMode ? 'active' : ''} onClick={() => setHyphenMode(value => !value)}>
            ハイフンを入力
          </button>
        )}
        {editingAnswer ? (
          <>
            <span className="kaeriten-source-admin-label">模範解答登録中</span>
            <button type="button" onClick={saveAnswer} disabled={saving}>{saving ? '保存中...' : '模範解答を保存'}</button>
            {message && <span className="admin-message">{message}</span>}
          </>
        ) : (
          <>
            {lineIndexes.map(lineIndex => (
              <span className="kaeriten-line-check" key={lineIndex}>
                <button type="button" onClick={() => submitLine(lineIndex)}>{lineIndex + 1}行目を採点</button>
                {lineJudgements[lineIndex] && (
                  <strong className={`kaeriten-inline-judge ${lineJudgements[lineIndex] === '正解' ? 'correct' : 'wrong'}`}>
                    {lineJudgements[lineIndex]}
                  </strong>
                )}
              </span>
            ))}
          </>
        )}
      </div>
    </>
  );
}

function KaeritenSourceSetup({ section, onCreateTarget }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const create = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    const target = createSectionKaeritenTarget(section);
    try {
      await onCreateTarget?.({
        sectionId: section.id,
        target,
        anchor: {
          sectionId: section.id,
          text: target.surface,
          start: 0,
          end: target.surface.length,
        },
      });
      setMessage('返り点問題を作成しました');
    } catch (err) {
      console.error('[kaeriten source create] failed:', err);
      setMessage('作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="kaeriten-source-setup">
      <p>この段には返り点問題がまだ登録されていません。</p>
      <button type="button" onClick={create} disabled={saving}>{saving ? '作成中...' : 'この段を返り点問題にする'}</button>
      {message && <span className="admin-message">{message}</span>}
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

function KanbunSyntaxDisplay({ syntax }) {
  const data = normalizeKanbunSyntax(syntax);

  if (!data.items.some(item => item.base)) return <p className="kanbun-syntax-empty">{'\u53e5\u6cd5\u306f\u672a\u767b\u9332\u3067\u3059\u3002'}</p>;

  return (
    <div className="kanbun-syntax-display-list">
      {data.items.map((item, itemIndex) => {
        if (!item.base) return null;
        let hanIndex = -1;
        return (
          <div className="kanbun-syntax-display-item" key={`syntax-${itemIndex}`}>
            <div className="kanbun-syntax-number">{itemIndex + 1}</div>
            <div className="kanbun-syntax-view-scroll">
              <div className="kanbun-syntax-vertical">
                {kanbunSyntaxChars(item.base).map((char, sourceIndex) => {
                  if (!isKanbunSyntaxEditableChar(char)) {
                    return <span className="kanbun-syntax-symbol" key={sourceIndex}>{char}</span>;
                  }
                  hanIndex += 1;
                  const mark = item.marks[hanIndex] ?? '';
                  const okuri = item.okurigana[hanIndex] ?? '';
                  const furigana = item.furigana[hanIndex] ?? '';
                  const unitStyle = {
                    '--syntax-mark-x': '7px',
                    '--syntax-mark-y': `${item.markY[hanIndex] ?? 0}px`,
                    '--syntax-okuri-x': `${item.okuriganaX[hanIndex] ?? 0}px`,
                    '--syntax-okuri-y': `${item.okuriganaY[hanIndex] ?? 0}px`,
                    '--syntax-furi-x': '-10px',
                    '--syntax-furi-y': `${item.furiganaY[hanIndex] ?? 0}px`,
                  };
                  return (
                    <span className="kanbun-syntax-unit" key={sourceIndex} style={unitStyle}>
                      <span className="kanbun-syntax-char">{char}</span>
                      {furigana && <span className="kanbun-syntax-furigana">{furigana}</span>}
                      {mark && <span className="kanbun-syntax-mark">{mark}</span>}
                      {okuri && <span className="kanbun-syntax-okurigana">{okuri}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbunSyntaxAnnotationEditor({ value, onChange }) {
  const data = normalizeKanbunSyntax(value);
  const [selectedByItem, setSelectedByItem] = useState({});
  const updateSyntaxItem = (itemIndex, nextItem) => {
    onChange({
      ...data,
      items: data.items.map((item, index) => index === itemIndex ? normalizeKanbunSyntaxItem(nextItem) : item),
    });
  };
  const updateBase = (itemIndex, base) => {
    updateSyntaxItem(itemIndex, resizeKanbunSyntaxAnnotations(base, data.items[itemIndex]));
    setSelectedByItem(current => ({ ...current, [itemIndex]: 0 }));
  };
  const updateAnnotation = (itemIndex, field, annotationIndex, nextValue) => {
    const current = data.items[itemIndex];
    updateSyntaxItem(itemIndex, {
      ...current,
      [field]: current[field].map((item, index) => index === annotationIndex ? nextValue : item),
    });
  };
  const addItem = () => onChange({ ...data, items: [...data.items, emptyKanbunSyntaxItem()] });
  const removeItem = (itemIndex) => {
    const nextItems = data.items.filter((_, index) => index !== itemIndex);
    onChange({ ...data, items: nextItems.length ? nextItems : [emptyKanbunSyntaxItem()] });
  };

  return (
    <div className="kanbun-syntax-builder">
      {data.items.map((syntaxItem, itemIndex) => {
        const hanChars = kanbunSyntaxChars(syntaxItem.base).filter(isKanbunSyntaxEditableChar);
        const selectedIndex = Math.min(selectedByItem[itemIndex] ?? 0, Math.max(hanChars.length - 1, 0));
        const selectedChar = hanChars[selectedIndex] ?? '';
        let hanIndex = -1;
        return (
          <div className="kanbun-syntax-item-editor" key={'syntax-editor-' + itemIndex}>
            <div className="kanbun-syntax-item-header">
              <span>{'\u53e5\u6cd5'} {itemIndex + 1}</span>
              <button type="button" className="admin-secondary-btn" onClick={() => removeItem(itemIndex)}>{'\u524a\u9664'}</button>
            </div>
            <label className="kanbun-syntax-base-input">
              {'\u6f22\u5b57\u30fb\u8a18\u53f7\u30fb\u53e5\u8aad\u70b9'}
              <textarea
                rows={3}
                value={syntaxItem.base}
                onChange={(event) => updateBase(itemIndex, event.target.value)}
                placeholder={'\u6f22\u5b57\u30fb\u8a18\u53f7\u30fb\u53e5\u8aad\u70b9\u3092\u5165\u529b'}
              />
            </label>
            <div className="kanbun-syntax-layout-editor">
              <div className="kanbun-syntax-canvas" aria-label={'\u53e5\u6cd5\u30d7\u30ec\u30d3\u30e5\u30fc'}>
                <div className="kanbun-syntax-vertical kanbun-syntax-vertical-editor">
                  {kanbunSyntaxChars(syntaxItem.base).map((char, sourceIndex) => {
                    if (!isKanbunSyntaxEditableChar(char)) {
                      return <span className="kanbun-syntax-symbol" key={sourceIndex}>{char}</span>;
                    }
                    hanIndex += 1;
                    const currentIndex = hanIndex;
                    const mark = syntaxItem.marks[currentIndex] ?? '';
                    const okuri = syntaxItem.okurigana[currentIndex] ?? '';
                    const furigana = syntaxItem.furigana[currentIndex] ?? '';
                    const unitStyle = {
                      '--syntax-mark-x': '7px',
                      '--syntax-mark-y': String(syntaxItem.markY[currentIndex] ?? 0) + 'px',
                      '--syntax-okuri-x': String(syntaxItem.okuriganaX[currentIndex] ?? 0) + 'px',
                      '--syntax-okuri-y': String(syntaxItem.okuriganaY[currentIndex] ?? 0) + 'px',
                      '--syntax-furi-x': '-10px',
                      '--syntax-furi-y': String(syntaxItem.furiganaY[currentIndex] ?? 0) + 'px',
                    };
                    return (
                      <button
                        type="button"
                        className={'kanbun-syntax-unit kanbun-syntax-editable-unit ' + (currentIndex === selectedIndex ? 'is-selected' : '')}
                        key={sourceIndex}
                        style={unitStyle}
                        onClick={() => setSelectedByItem(current => ({ ...current, [itemIndex]: currentIndex }))}
                      >
                        <span className="kanbun-syntax-char">{char}</span>
                        {furigana && <span className="kanbun-syntax-furigana">{furigana}</span>}
                        {mark && <span className="kanbun-syntax-mark">{mark}</span>}
                        {okuri && <span className="kanbun-syntax-okurigana">{okuri}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="kanbun-syntax-control-panel">
                {selectedChar ? (
                  <>
                    <div className="kanbun-syntax-selected-char">{selectedChar}</div>
                    <label>
                      {'\u632f\u308a\u4eee\u540d'}
                      <input
                        value={syntaxItem.furigana[selectedIndex] ?? ''}
                        onChange={(event) => updateAnnotation(itemIndex, 'furigana', selectedIndex, event.target.value)}
                      />
                    </label>
                    <div className="kanbun-syntax-position-pair">
                      <label>{'\u632f\u308a\u4eee\u540d'} Y<input type="number" step="1" value={syntaxItem.furiganaY[selectedIndex] ?? 0} onChange={(event) => updateAnnotation(itemIndex, 'furiganaY', selectedIndex, Number(event.target.value))} /></label>
                    </div>
                    <label>
                      {'\u9001\u308a\u4eee\u540d'}
                      <input
                        value={syntaxItem.okurigana[selectedIndex] ?? ''}
                        onChange={(event) => updateAnnotation(itemIndex, 'okurigana', selectedIndex, event.target.value)}
                      />
                    </label>
                    <div className="kanbun-syntax-position-pair">
                      <label>{'\u9001\u308a\u4eee\u540d'} X<input type="number" step="1" value={syntaxItem.okuriganaX[selectedIndex] ?? 0} onChange={(event) => updateAnnotation(itemIndex, 'okuriganaX', selectedIndex, Number(event.target.value))} /></label>
                      <label>{'\u9001\u308a\u4eee\u540d'} Y<input type="number" step="1" value={syntaxItem.okuriganaY[selectedIndex] ?? 0} onChange={(event) => updateAnnotation(itemIndex, 'okuriganaY', selectedIndex, Number(event.target.value))} /></label>
                    </div>
                    <label>
                      {'\u8fd4\u308a\u70b9'}
                      <select
                        value={normalizeSelectedKaeritenMark(syntaxItem.marks[selectedIndex] ?? '')}
                        onChange={(event) => updateAnnotation(itemIndex, 'marks', selectedIndex, event.target.value)}
                      >
                        {KAERITEN_MARK_OPTIONS.map(option => (
                          <option key={option || 'blank'} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <div className="kanbun-syntax-position-pair">
                      <label>{'\u8fd4\u308a\u70b9'} Y<input type="number" step="1" value={syntaxItem.markY[selectedIndex] ?? 0} onChange={(event) => updateAnnotation(itemIndex, 'markY', selectedIndex, Number(event.target.value))} /></label>
                    </div>
                  </>
                ) : (
                  <p className="kanbun-syntax-empty">{'\u6f22\u5b57\u3092\u5165\u529b\u3059\u308b\u3068\u3001\u3053\u3053\u3067\u6ce8\u8a18\u3092\u7de8\u96c6\u3067\u304d\u307e\u3059\u3002'}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <button type="button" className="kanbun-syntax-add-btn" onClick={addItem}>{'\u53e5\u6cd5\u3092\u8ffd\u52a0'}</button>
    </div>
  );
}

function KanbunSyntaxBlock({ section, isAdmin, onUpdateSection }) {
  const initialText = getKanbunSyntax(section);
  const initialSyntax = parseKanbunSyntax(initialText);
  const [editing, setEditing] = useState(false);
  const [syntax, setSyntax] = useState(initialSyntax);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSyntax(parseKanbunSyntax(initialText));
  }, [initialText]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      await onUpdateSection?.(section, { kanbunSyntax: serializeKanbunSyntax(syntax) });
      setEditing(false);
      setMessage('保存しました');
      setTimeout(() => setMessage(''), 2000);
    } catch (err) {
      console.error('[KanbunSyntaxBlock] save failed:', err);
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin && !initialSyntax.items.some(item => item.base)) return null;

  return (
    <div className="kanbun-syntax-block">
      <div className="kanbun-syntax-header">
        <span>句法</span>
        {isAdmin && !editing && <button type="button" onClick={() => setEditing(true)}>編集</button>}
      </div>
      {editing ? (
        <div className="kanbun-syntax-editor">
          <KanbunSyntaxAnnotationEditor value={syntax} onChange={setSyntax} />
          <div className="admin-inline-actions">
            {message && <span className="admin-message">{message}</span>}
            <button type="button" className="admin-secondary-btn" onClick={() => { setSyntax(initialSyntax); setEditing(false); }} disabled={saving}>キャンセル</button>
            <button type="button" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
          </div>
        </div>
      ) : initialSyntax.items.some(item => item.base) ? (
        <KanbunSyntaxDisplay syntax={initialSyntax} />
      ) : (
        <p className="kanbun-syntax-empty">句法は未登録です。</p>
      )}
      {!editing && message && <span className="admin-message">{message}</span>}
    </div>
  );
}

function SectionCard({ section, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern, isAdmin, onUpdateSection, onUpdateTarget, onRecord, onCreateTarget, sourceHeightScale }) {
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
  const kaeritenTarget = (section.targets ?? []).find(target => target.type === 'kaeriten');

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
          {activeType === 'kaeriten' && kaeritenTarget ? (
            <KaeritenSourceExercise
              target={kaeritenTarget}
              section={section}
              isAdmin={isAdmin}
              onUpdateTarget={onUpdateTarget}
              onRecord={onRecord}
              isKanbun={isKanbun}
              sourceTextStyle={sourceTextStyle}
            />
          ) : activeType === 'kaeriten' && isAdmin && !section.sectionless ? (
            <>
              <div
                className={`vertical-text${isKanbun ? ' vertical-text--kanbun' : ''}`}
                ref={textRef}
                style={sourceTextStyle}
              >
                {section.text}
              </div>
              <KaeritenSourceSetup section={section} onCreateTarget={onCreateTarget} />
            </>
          ) : (
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
          )}
        </div>
      </SourceKundokuRow>
      {isKanbun && (
        <KanbunSyntaxBlock
          section={section}
          isAdmin={isAdmin}
          onUpdateSection={onUpdateSection}
        />
      )}
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

function GyofunoriNotesImage() {
  return (
    <figure className="notes-figure">
      <img src={`${import.meta.env.BASE_URL}assets/gyofunori/sengoku-shichiyu.png`} alt="戦国七雄" />
    </figure>
  );
}

function NotesTab({ textId, notes, sections, isAdmin, onUpdateSection }) {
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
            {textId === 'gyofunori' && item.text && <GyofunoriNotesImage />}
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

export default function VerticalTextViewer({ textId, notes, sections, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern, isAdmin, onUpdateSection, onUpdateTarget, onRecord, onCreateTarget, onBackToSelect, onContactAdmin }) {
  const [activeTab, setActiveTab] = useState('source');
  const visibleSections = sections.filter(section => !section.sectionless);
  const visibleTab = activeTab;
  const sourceHeightScale = textId === 'gyofunori' ? 0.63 : 1;

  useEffect(() => {
    if (pinnedPhrase) setActiveTab('source');
  }, [pinnedPhrase?.sectionId, pinnedPhrase?.text]);

  return (
    <div className="vertical-viewer">
      <div className="left-view-tabs" role="tablist" aria-label="教材操作">
        <div className="left-tab-top-actions">
          <button type="button" className="left-tab-action" onClick={onBackToSelect}>教材へ</button>
        </div>
        <div className="left-tab-group">
          <button
            type="button"
            role="tab"
            aria-selected={visibleTab === 'source'}
            className={`left-tab-button${visibleTab === 'source' ? ' active' : ''}`}
            onClick={() => setActiveTab('source')}
          >
            原文
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={visibleTab === 'notes'}
            className={`left-tab-button${visibleTab === 'notes' ? ' active' : ''}`}
            onClick={() => setActiveTab('notes')}
          >
            備考
          </button>
        </div>
        <div className="left-tab-bottom-actions">
          <button type="button" className="left-tab-action" onClick={onContactAdmin}>連絡</button>
        </div>
      </div>
      <div className="left-view-body">
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
              onCreateTarget={onCreateTarget}
              sourceHeightScale={sourceHeightScale}
            />
          ))
        ) : (
          <NotesTab textId={textId} notes={notes} sections={sections} isAdmin={isAdmin} onUpdateSection={onUpdateSection} />
        )}
      </div>
    </div>
  );
}
