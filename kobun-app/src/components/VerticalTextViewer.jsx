import { useEffect, useMemo, useRef, useState } from 'react';
import HighlightedToken from './HighlightedToken';
import { reviewKaeriten } from '../services/gemini';
import { emptyKaeritenAnswer, kaeritenChars, parseKaeritenAnswer, serializeKaeritenAnswer } from '../utils/kaeriten';

const KAERITEN_MARK_OPTIONS = ['', '一', '二', '三', 'レ', '一レ', '上', '下'];

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSyntaxSurfacePiecesInText(text, surface) {
  if (!/[～~]/.test(surface)) {
    const match = findIgnoringLineBreaks(text, surface);
    return match ? [match] : [];
  }
  const indexMap = [];
  const endMap = [];
  let normalized = '';
  let sourceIndex = 0;
  for (const char of text) {
    if (char === '\r' || char === '\n') {
      sourceIndex += char.length;
      continue;
    }
    indexMap.push(sourceIndex);
    endMap.push(sourceIndex + char.length);
    normalized += char;
    sourceIndex += char.length;
  }
  const parts = surface
    .replace(/[\r\n]/g, '')
    .split(/[～~]+/)
    .filter(Boolean);
  const pattern = parts.map(escapeRegExp).join('[\\p{Script=Han}]+?');
  if (!pattern) return [];
  const match = new RegExp(pattern, 'u').exec(normalized);
  if (!match?.[0]) return [];
  const pieces = [];
  let searchFrom = match.index;
  const matchEnd = match.index + match[0].length;
  for (const part of parts) {
    const partIndex = normalized.indexOf(part, searchFrom);
    if (partIndex === -1 || partIndex >= matchEnd) return [];
    pieces.push({
      start: indexMap[partIndex],
      end: endMap[partIndex + part.length - 1],
    });
    searchFrom = partIndex + part.length;
  }
  return pieces;
}

function buildSegments(text, allTargets, activeType, pinnedPhrase) {
  const targets = activeType === 'all'
    ? allTargets
    : allTargets.filter(t => t.type === activeType);
  const nextSearchStartBySurface = new Map();

  const located = targets
    .map(t => {
      const surface = t.surface ?? '';
      if (!surface) return { t, idx: -1, end: -1, pinned: false };
      const exactIdx = Number.isInteger(t.start) && text.slice(t.start, t.start + surface.length) === surface
        ? t.start
        : -1;
      const hint = Math.max(0, (t.start ?? 0) - 5);
      const cursor = nextSearchStartBySurface.get(surface) ?? 0;
      const hintedIdx = exactIdx !== -1 ? exactIdx : text.indexOf(surface, hint);
      const sequentialIdx = hintedIdx !== -1 ? hintedIdx : text.indexOf(surface, cursor);
      const resolvedIdx = sequentialIdx !== -1 ? sequentialIdx : text.indexOf(surface);
      if (resolvedIdx !== -1) nextSearchStartBySurface.set(surface, resolvedIdx + surface.length);
      return { t, idx: resolvedIdx, end: resolvedIdx + surface.length, pinned: false };
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
    if (idx > pos) segments.push({ type: 'plain', text: text.slice(pos, idx), start: pos, end: idx });
    if (pinned) {
      segments.push({ type: 'pinned', text: t.surface, start: idx, end });
    } else {
      segments.push({ type: 'target', target: t, showAsAll: activeType === 'all', start: idx, end });
    }
    pos = end;
  }
  if (pos < text.length) segments.push({ type: 'plain', text: text.slice(pos), start: pos, end: text.length });
  return segments;
}

function getKundoku(section) {
  return section.kundoku ?? section.kakikudashi ?? section.readingText ?? '';
}

function toFullWidthKatakana(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u3041-\u3096]/g, char => String.fromCharCode(char.charCodeAt(0) + 0x60));
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

function verticalOkuriganaText(value) {
  return String(value ?? '')
    .replace(/[（(]/g, '︵')
    .replace(/[）)]/g, '︶');
}

function okuriganaCellExtent(value) {
  const length = Array.from(verticalOkuriganaText(value)).length;
  return `${Math.max(1.25, length * 0.54 + 0.35)}em`;
}

function normalizeFuriganaSpans(value, hanCount) {
  return (Array.isArray(value) ? value : [])
    .map(item => ({
      start: Number(item?.start ?? 0),
      length: Number(item?.length ?? 2),
      text: String(item?.text ?? ''),
      y: Number(item?.y ?? 0),
    }))
    .filter(item => (
      item.text.trim() &&
      Number.isInteger(item.start) &&
      item.start >= 0 &&
      item.start < hanCount - 1
    ))
    .map(item => ({ ...item, length: 2 }))
    .slice(0, hanCount);
}

function furiganaSpanAt(item, start) {
  return (item?.furiganaSpans ?? []).find(span => span.start === start) ?? null;
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
  const furiganaSpans = normalizeFuriganaSpans(value?.furiganaSpans, hanCount);
  const usage = String(value?.usage ?? value?.function ?? '');
  const translation = String(value?.translation ?? value?.meaning ?? '');
  const usageAlternativeAnswers = Array.isArray(value?.usageAlternativeAnswers)
    ? value.usageAlternativeAnswers.map(item => String(item ?? '').trim()).filter(Boolean).slice(0, 5)
    : [];
  const translationAlternativeAnswers = Array.isArray(value?.translationAlternativeAnswers)
    ? value.translationAlternativeAnswers.map(item => String(item ?? '').trim()).filter(Boolean).slice(0, 5)
    : [];
  return { base, usage, translation, usageAlternativeAnswers, translationAlternativeAnswers, marks, okurigana, furigana, furiganaSpans, markX, markY, okuriganaX, okuriganaY, furiganaX, furiganaY };
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

function kanbunSyntaxQuestionTarget(section, item, itemIndex) {
  const surface = String(item?.base ?? item?.text ?? '').trim();
  return {
    id: `kanbun-syntax-${section.id}-${itemIndex}`,
    type: 'grammar',
    surface,
    questionSurface: surface,
    generated: true,
    order: Number.MAX_SAFE_INTEGER - 1000 + itemIndex,
  };
}

function selectedSyntaxSourceTargets(section, selectedTarget) {
  if (!section || !selectedTarget?.generated || selectedTarget.type !== 'grammar') return [];
  if (!String(selectedTarget.id ?? '').startsWith(`kanbun-syntax-${section.id}-`)) return [];
  const surface = String(selectedTarget.surface ?? selectedTarget.questionSurface ?? '').trim();
  if (!surface) return [];
  const pieces = findSyntaxSurfacePiecesInText(section.text ?? '', surface);
  if (!pieces.length) return [];
  return pieces.map((piece, index) => ({
    ...selectedTarget,
    id: `${selectedTarget.id}-source-${index}`,
    groupId: selectedTarget.id,
    surface: section.text.slice(piece.start, piece.end),
    start: piece.start,
    end: piece.end,
  }));
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
    furiganaSpans: normalizeFuriganaSpans(current.furiganaSpans, hanCount),
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

function isKanbunSection(section, isKanbunTextbook = false) {
  return Boolean(
    isKanbunTextbook ||
    section?.isKanbun === true ||
    ['textType', 'genre', 'category', 'kind', 'classicalType'].some(key => {
      const value = String(section?.[key] ?? '').toLowerCase();
      return value === 'kanbun' || value.includes('\u6f22\u6587');
    }) ||
    section?.kanbunSyntax ||
    section?.syntaxGuide ||
    section?.syntax ||
    (section?.targets ?? []).some(target => target.type === 'kaeriten' || String(target.pos ?? '').includes('\u6f22\u6587')) ||
    isKanbunText(section.text ?? '')
  );
}

function longestLineLength(text) {
  return Math.max(...text.split(/\r?\n/).map(line => Array.from(line).length), 0);
}

function sectionTextStyle(sourceText, kundokuText, heightScale = 1, isKanbun = false, compactKanbunSourceHeight = false) {
  const longest = Math.max(
    longestLineLength(sourceText),
    isKanbun && compactKanbunSourceHeight ? 0 : longestLineLength(kundokuText),
    8,
  );
  const sourceFontSizeRem = isKanbun ? 1.764 : 1.26;
  return { '--source-text-height': `calc(${(longest + 1) * 1.1 * sourceFontSizeRem * heightScale}rem + 30px)` };
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

function KaeritenMarkDisplay({ mark }) {
  if (mark === '一レ') {
    return (
      <span className="kaeriten-ichireten" aria-label="一レ">
        <span>一</span>
        <span>レ</span>
      </span>
    );
  }
  return mark;
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

function buildKaeritenAnnotationMap(section, target) {
  if (!target) return null;
  const range = findTargetRange(section, target);
  const answer = parseKaeritenAnswer(target.answer || emptyKaeritenAnswer(target.surface), target.surface);
  const annotations = new Map();
  let markIndex = -1;
  Array.from(section.text ?? '').forEach((char, index) => {
    const inTarget = index >= range.start && index < range.end;
    if (!inTarget || !isKaeritenSourceChar(char)) return;
    markIndex += 1;
    const mark = answer.marks[markIndex] ?? '';
    const furigana = answer.furigana?.[markIndex] ?? '';
    const okurigana = answer.okurigana?.[markIndex] ?? '';
    const markY = answer.markY?.[markIndex] ?? 0;
    const furiganaY = answer.furiganaY?.[markIndex] ?? 0;
    const okuriganaY = answer.okuriganaY?.[markIndex] ?? 0;
    const hasHyphen = answer.hyphens.includes(markIndex);
    if (mark || hasHyphen || furigana || okurigana) annotations.set(index, { mark, hasHyphen, furigana, okurigana, markY, furiganaY, okuriganaY });
  });
  return annotations;
}

function AnnotatedSourceText({ text, start = 0, annotations }) {
  if (!annotations) return text ?? '';
  return Array.from(text ?? '').map((char, offset) => {
    const annotation = annotations?.get(start + offset);
    if (!annotation) return <span key={offset}>{char}</span>;
    const needsAnnotationSpace = Boolean(annotation.mark || annotation.hasHyphen || annotation.furigana || annotation.okurigana);
    const unitStyle = {
      '--kaeriten-mark-y': `${annotation.markY ?? 0}px`,
      '--kaeriten-furi-y': `${annotation.furiganaY ?? 0}px`,
      '--kaeriten-okuri-y': `${annotation.okuriganaY ?? 0}px`,
      '--kaeriten-okuri-extent': okuriganaCellExtent(annotation.okurigana ?? ''),
    };
    return (
      <span className={`kaeriten-source-group${annotation.hasHyphen ? ' kaeriten-source-group--has-hyphen-after' : ''}`} key={offset}>
        <span className={`kaeriten-source-unit${needsAnnotationSpace ? ' kaeriten-source-unit--annotated' : ''}`} style={unitStyle}>
          <span className="kaeriten-source-char">{char}</span>
          {annotation.furigana && <span className="kaeriten-source-furigana">{annotation.furigana}</span>}
          {annotation.okurigana && <span className="kaeriten-source-okurigana">{annotation.okurigana}</span>}
          {annotation.mark && <span className="kaeriten-source-input kaeriten-source-mark-display"><KaeritenMarkDisplay mark={annotation.mark} /></span>}
          {annotation.hasHyphen && <span className="kaeriten-source-hyphen active">-</span>}
        </span>
      </span>
    );
  });
}

function KaeritenSourceExercise({ target, section, isAdmin, onUpdateTarget, isKanbun, sourceTextStyle, practiceMode = true, onSelectLine, correctLineKeys }) {
  const range = findTargetRange(section, target);
  const chars = kaeritenChars(target.surface);
  const initialUser = parseKaeritenAnswer('', target.surface);
  const answer = parseKaeritenAnswer(target.answer || emptyKaeritenAnswer(target.surface), target.surface);
  const [marks, setMarks] = useState(() => chars.map((_, index) => initialUser.marks[index] ?? ''));
  const [hyphens, setHyphens] = useState(() => new Set(initialUser.hyphens));
  const [adminMarks, setAdminMarks] = useState(() => chars.map((_, index) => answer.marks[index] ?? ''));
  const [adminFurigana, setAdminFurigana] = useState(() => chars.map((_, index) => answer.furigana?.[index] ?? ''));
  const [adminOkurigana, setAdminOkurigana] = useState(() => chars.map((_, index) => answer.okurigana?.[index] ?? ''));
  const [adminMarkY, setAdminMarkY] = useState(() => chars.map((_, index) => answer.markY?.[index] ?? 0));
  const [adminFuriganaY, setAdminFuriganaY] = useState(() => chars.map((_, index) => answer.furiganaY?.[index] ?? 0));
  const [adminOkuriganaY, setAdminOkuriganaY] = useState(() => chars.map((_, index) => answer.okuriganaY?.[index] ?? 0));
  const [adminHyphens, setAdminHyphens] = useState(() => new Set(answer.hyphens));
  const [adminEditingAnswer, setAdminEditingAnswer] = useState(false);
  const [selectedAdminIndex, setSelectedAdminIndex] = useState(0);
  const [okuriganaDraft, setOkuriganaDraft] = useState(() => answer.okurigana?.[0] ?? '');
  const [isComposingOkurigana, setIsComposingOkurigana] = useState(false);
  const isComposingOkuriganaRef = useRef(false);
  const okuriganaInputRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const editingAnswer = isAdmin && practiceMode && adminEditingAnswer;
  const showingAnswer = !practiceMode && !editingAnswer;

  const selectedMarks = showingAnswer ? answer.marks : editingAnswer ? adminMarks : marks;
  const selectedFurigana = showingAnswer ? answer.furigana : editingAnswer ? adminFurigana : [];
  const selectedOkurigana = showingAnswer ? answer.okurigana : editingAnswer ? adminOkurigana : [];
  const selectedMarkY = showingAnswer ? answer.markY : editingAnswer ? adminMarkY : [];
  const selectedFuriganaY = showingAnswer ? answer.furiganaY : editingAnswer ? adminFuriganaY : [];
  const selectedOkuriganaY = showingAnswer ? answer.okuriganaY : editingAnswer ? adminOkuriganaY : [];
  const selectedHyphens = showingAnswer ? new Set(answer.hyphens) : editingAnswer ? adminHyphens : hyphens;

  const adminAnswer = (nextMarks = adminMarks, nextHyphens = adminHyphens, nextFurigana = adminFurigana, nextOkurigana = adminOkurigana, nextMarkY = adminMarkY, nextFuriganaY = adminFuriganaY, nextOkuriganaY = adminOkuriganaY) => serializeKaeritenAnswer({
    marks: nextMarks,
    furigana: nextFurigana,
    okurigana: nextOkurigana,
    markY: nextMarkY,
    furiganaY: nextFuriganaY,
    okuriganaY: nextOkuriganaY,
    hyphens: [...nextHyphens],
  }, target.surface);

  const updateMark = (index, value) => {
    const updater = current => current.map((item, itemIndex) => itemIndex === index ? value : item);
    if (editingAnswer) {
      setAdminMarks(updater);
      setMessage('');
    } else {
      setMarks(updater);
    }
  };

  const toggleHyphen = (index) => {
    if (!editingAnswer) return;
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
    }
  };

  const updateAdminFurigana = (index, value) => {
    setAdminFurigana(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
    setMessage('');
  };

  const updateAdminOkurigana = (index, value) => {
    const normalized = toFullWidthKatakana(value);
    setAdminOkurigana(current => current.map((item, itemIndex) => itemIndex === index ? normalized : item));
    setMessage('');
    return normalized;
  };

  useEffect(() => {
    setOkuriganaDraft(adminOkurigana[selectedAdminIndex] ?? '');
  }, [adminOkurigana, selectedAdminIndex]);

  const commitAdminOkurigana = (index, value) => {
    const normalized = updateAdminOkurigana(index, value);
    setOkuriganaDraft(normalized);
  };

  const updateAdminPosition = (field, index, value) => {
    const updater = current => current.map((item, itemIndex) => itemIndex === index ? Number(value) : item);
    if (field === 'markY') setAdminMarkY(updater);
    if (field === 'furiganaY') setAdminFuriganaY(updater);
    if (field === 'okuriganaY') setAdminOkuriganaY(updater);
    setMessage('');
  };

  const sourceText = section.text ?? '';
  const sourceChars = Array.from(sourceText);
  const sourceLines = String(sourceText).split(/\r?\n/);
  const kundokuLines = String(getKundoku(section) ?? '').split(/\r?\n/);
  const lineStarts = [];
  let lineStart = 0;
  sourceLines.forEach((line) => {
    lineStarts.push(lineStart);
    lineStart += Array.from(line).length + 1;
  });
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
  const firstMarkByLine = new Map();
  markLineIndexes.forEach((lineIndex, index) => {
    if (Number.isInteger(lineIndex) && !firstMarkByLine.has(lineIndex)) firstMarkByLine.set(lineIndex, index);
  });

  const focusOkuriganaInput = () => {
    window.setTimeout(() => okuriganaInputRef.current?.focus(), 0);
  };

  const lineAnswer = (lineIndex, sourceMarks, sourceHyphens) => {
    const indexes = markLineIndexes
      .map((item, index) => item === lineIndex ? index : null)
      .filter(Number.isInteger);
    const localIndexByGlobal = new Map(indexes.map((globalIndex, localIndex) => [globalIndex, localIndex]));
    return serializeKaeritenAnswer({
      marks: indexes.map(index => sourceMarks[index] ?? ''),
      hyphens: [...sourceHyphens]
        .filter(index => localIndexByGlobal.has(index) && localIndexByGlobal.has(index + 1))
        .map(index => localIndexByGlobal.get(index)),
    }, sourceLines[lineIndex] ?? '');
  };

  const makeLineTarget = (lineIndex) => ({
    ...target,
    id: `${target.id}-line-${lineIndex}`,
    parentTargetId: target.id,
    lineIndex,
    surface: sourceLines[lineIndex] ?? '',
    kundokuLine: kundokuLines[lineIndex] ?? '',
    questionSurface: `${lineIndex + 1}\u884c\u76ee`,
    questionText: `${lineIndex + 1}\u884c\u76ee\u306b\u8fd4\u308a\u70b9\u3092\u632f\u308b`,
    answer: lineAnswer(lineIndex, answer.marks, new Set(answer.hyphens)),
    gradingMode: 'local',
  });

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
      setAdminEditingAnswer(false);
    } catch (err) {
      console.error('[kaeriten source save] failed:', err);
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  let markIndex = -1;
  let currentLineIndex = 0;
  const renderSourceChar = (char, index, key = index, selectableChar = true) => {
    if (char === '\n') currentLineIndex += 1;
    const inTarget = index >= range.start && index < range.end;
    if (!inTarget || !isKaeritenSourceChar(char)) return <span key={key}>{char}</span>;
    markIndex += 1;
    const currentIndex = markIndex;
    const hasHyphenSlot = currentIndex < chars.length - 1;
    const lineIndex = markLineIndexes[currentIndex] ?? currentLineIndex;
    const revealCorrectLine = practiceMode && !editingAnswer && correctLineKeys?.has(`${section.id}:${target.id}:${lineIndex}`);
    const visibleMark = revealCorrectLine ? (answer.marks[currentIndex] ?? '') : selectedMarks[currentIndex];
    const visibleFurigana = revealCorrectLine ? (answer.furigana?.[currentIndex] ?? '') : selectedFurigana[currentIndex];
    const visibleOkurigana = revealCorrectLine ? (answer.okurigana?.[currentIndex] ?? '') : selectedOkurigana[currentIndex];
    const visibleMarkY = revealCorrectLine ? (answer.markY?.[currentIndex] ?? 0) : (selectedMarkY[currentIndex] ?? 0);
    const visibleFuriganaY = revealCorrectLine ? (answer.furiganaY?.[currentIndex] ?? 0) : (selectedFuriganaY[currentIndex] ?? 0);
    const visibleOkuriganaY = revealCorrectLine ? (answer.okuriganaY?.[currentIndex] ?? 0) : (selectedOkuriganaY[currentIndex] ?? 0);
    const hasVisibleMark = Boolean(visibleMark);
    const hasVisibleFurigana = Boolean(visibleFurigana);
    const hasVisibleOkurigana = Boolean(visibleOkurigana);
    const hasVisibleHyphen = revealCorrectLine ? answer.hyphens.includes(currentIndex) : selectedHyphens.has(currentIndex);
    const needsAnnotationSpace = editingAnswer || hasVisibleMark || hasVisibleHyphen || hasVisibleFurigana || hasVisibleOkurigana;
    const unitStyle = {
      '--kaeriten-mark-y': `${visibleMarkY}px`,
      '--kaeriten-furi-y': `${visibleFuriganaY}px`,
      '--kaeriten-okuri-y': `${visibleOkuriganaY}px`,
      '--kaeriten-okuri-extent': okuriganaCellExtent(visibleOkurigana ?? ''),
    };
    const lineCheck = null;
    const selectLine = () => {
      if (selectableChar && practiceMode && !editingAnswer) onSelectLine?.(makeLineTarget(lineIndex), section);
      if (editingAnswer) {
        setSelectedAdminIndex(currentIndex);
        focusOkuriganaInput();
      }
    };
    return (
      <span className={`kaeriten-source-group${selectableChar && practiceMode && !editingAnswer ? ' kaeriten-source-group--selectable' : ''}${editingAnswer ? ' kaeriten-source-group--editable' : ''}${editingAnswer && selectedAdminIndex === currentIndex ? ' is-selected' : ''}${hasVisibleHyphen ? ' kaeriten-source-group--has-hyphen-after' : ''}`} key={key} onClick={selectLine}>
        {lineCheck}
        <span className={`kaeriten-source-unit${needsAnnotationSpace ? ' kaeriten-source-unit--annotated' : ''}`} data-line={lineIndex} style={unitStyle}>
          <span className="kaeriten-source-char">{char}</span>
          {hasVisibleFurigana && <span className="kaeriten-source-furigana">{visibleFurigana}</span>}
          {hasVisibleOkurigana && <span className="kaeriten-source-okurigana">{visibleOkurigana}</span>}
          {hasVisibleMark && <span className="kaeriten-source-input kaeriten-source-mark-display"><KaeritenMarkDisplay mark={visibleMark} /></span>}
          {hasHyphenSlot && (
            hasVisibleHyphen && <span className="kaeriten-source-hyphen active">-</span>
          )}
        </span>
      </span>
    );
  };

  const nodes = practiceMode && !editingAnswer
    ? sourceLines.flatMap((line, lineIndex) => {
      const baseIndex = lineStarts[lineIndex] ?? 0;
      const lineNodes = Array.from(line).map((char, offset) => renderSourceChar(char, baseIndex + offset, `${lineIndex}-${offset}`, false));
      return [
        <span
          className="kaeriten-source-line-choice"
          key={`line-${lineIndex}`}
          onClick={() => onSelectLine?.(makeLineTarget(lineIndex), section)}
        >
          {lineNodes}
        </span>,
        lineIndex < sourceLines.length - 1 ? <span key={`break-${lineIndex}`}>{'\n'}</span> : null,
      ];
    })
    : sourceChars.map((char, index) => renderSourceChar(char, index));
  const selectedAdminChar = chars[selectedAdminIndex] ?? '';
  const selectedAdminHasHyphenSlot = selectedAdminIndex < chars.length - 1;

  return (
    <>
      <div className={`vertical-text vertical-text--kaeriten-source${isKanbun ? ' vertical-text--kanbun' : ''}`} style={sourceTextStyle}>
        {nodes}
      </div>
      {practiceMode && isAdmin && <div className="kaeriten-source-controls">
        {isAdmin && !adminEditingAnswer ? (
          <button type="button" onClick={() => setAdminEditingAnswer(true)}>{'\u6a21\u7bc4\u89e3\u7b54\u3092\u7de8\u96c6'}</button>
        ) : editingAnswer ? (
          <>
            <span className="kaeriten-source-admin-label">{'\u6a21\u7bc4\u89e3\u7b54\u767b\u9332\u4e2d'}</span>
            {selectedAdminChar && (
              <div className="kaeriten-source-annotation-panel">
                <div className="kanbun-syntax-selected-char">{selectedAdminChar}</div>
                <label>
                  {'\u632f\u308a\u4eee\u540d'}
                  <input value={adminFurigana[selectedAdminIndex] ?? ''} onChange={(event) => updateAdminFurigana(selectedAdminIndex, event.target.value)} />
                </label>
                <div className="kanbun-syntax-position-pair">
                  <label>{'\u632f\u308a\u4eee\u540d'} Y<input type="number" step="1" value={adminFuriganaY[selectedAdminIndex] ?? 0} onChange={(event) => updateAdminPosition('furiganaY', selectedAdminIndex, event.target.value)} /></label>
                </div>
                <label>
                  {'\u9001\u308a\u4eee\u540d'}
                  <input
                    ref={okuriganaInputRef}
                    value={okuriganaDraft}
                    onChange={(event) => {
                      const value = event.target.value;
                      setOkuriganaDraft(value);
                      if (!isComposingOkuriganaRef.current && !isComposingOkurigana) commitAdminOkurigana(selectedAdminIndex, value);
                    }}
                    onCompositionStart={() => {
                      isComposingOkuriganaRef.current = true;
                      setIsComposingOkurigana(true);
                    }}
                    onCompositionEnd={(event) => {
                      isComposingOkuriganaRef.current = false;
                      setIsComposingOkurigana(false);
                      commitAdminOkurigana(selectedAdminIndex, event.currentTarget.value);
                    }}
                    onBlur={(event) => commitAdminOkurigana(selectedAdminIndex, event.currentTarget.value)}
                  />
                </label>
                <div className="kanbun-syntax-position-pair">
                  <label>{'\u9001\u308a\u4eee\u540d'} Y<input type="number" step="1" value={adminOkuriganaY[selectedAdminIndex] ?? 0} onChange={(event) => updateAdminPosition('okuriganaY', selectedAdminIndex, event.target.value)} /></label>
                </div>
                <label>
                  {'\u8fd4\u308a\u70b9'}
                  <select value={normalizeSelectedKaeritenMark(adminMarks[selectedAdminIndex] ?? '')} onChange={(event) => updateMark(selectedAdminIndex, event.target.value)}>
                    {KAERITEN_MARK_OPTIONS.map(option => (
                      <option key={option || 'blank'} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <div className="kanbun-syntax-position-pair">
                  <label>{'\u8fd4\u308a\u70b9'} Y<input type="number" step="1" value={adminMarkY[selectedAdminIndex] ?? 0} onChange={(event) => updateAdminPosition('markY', selectedAdminIndex, event.target.value)} /></label>
                </div>
                {selectedAdminHasHyphenSlot && (
                  <button type="button" className={adminHyphens.has(selectedAdminIndex) ? 'active' : ''} onClick={() => toggleHyphen(selectedAdminIndex)}>
                    {adminHyphens.has(selectedAdminIndex) ? '\u30cf\u30a4\u30d5\u30f3\u3092\u5916\u3059' : '\u5f8c\u308d\u306b\u30cf\u30a4\u30d5\u30f3'}
                  </button>
                )}
              </div>
            )}
            <button type="button" onClick={saveAnswer} disabled={saving}>{saving ? '\u4fdd\u5b58\u4e2d...' : '\u6a21\u7bc4\u89e3\u7b54\u3092\u4fdd\u5b58'}</button>
            <button type="button" className="admin-secondary-btn" onClick={() => { setAdminMarks(chars.map((_, index) => answer.marks[index] ?? '')); setAdminFurigana(chars.map((_, index) => answer.furigana?.[index] ?? '')); setAdminOkurigana(chars.map((_, index) => answer.okurigana?.[index] ?? '')); setAdminMarkY(chars.map((_, index) => answer.markY?.[index] ?? 0)); setAdminFuriganaY(chars.map((_, index) => answer.furiganaY?.[index] ?? 0)); setAdminOkuriganaY(chars.map((_, index) => answer.okuriganaY?.[index] ?? 0)); setAdminHyphens(new Set(answer.hyphens)); setAdminEditingAnswer(false); }} disabled={saving}>{'\u30ad\u30e3\u30f3\u30bb\u30eb'}</button>
            {message && <span className="admin-message">{message}</span>}
          </>
        ) : lineIndexes.length > 0 ? (
          <span className="kaeriten-source-admin-label">{'\u5404\u884c\u306e\u5148\u982d\u3067\u7b54\u3048\u5408\u308f\u305b'}</span>
        ) : null}
      </div>}
    </>
  );
}

function KundokuSourceLineSelector({ section, isKanbun, sourceTextStyle, selectedTarget, onSelectLine, annotations }) {
  const sourceText = section.text ?? '';
  const sourceLines = String(sourceText).split(/\r?\n/);
  const kundokuLines = String(getKundoku(section) ?? '').split(/\r?\n/);
  const kundokuQuestions = Array.isArray(section.kundokuQuestions) ? section.kundokuQuestions : [];
  const lineStarts = [];
  let lineStart = 0;
  sourceLines.forEach((line) => {
    lineStarts.push(lineStart);
    lineStart += Array.from(line).length + 1;
  });
  const makeLineTarget = (lineIndex) => {
    const surface = sourceLines[lineIndex] ?? '';
    const override = kundokuQuestions.find(item => Number(item?.lineIndex) === lineIndex) ?? {};
    return {
      id: `kundoku-${section.id}-line-${lineIndex}`,
      type: 'kundoku',
      generated: true,
      lineIndex,
      surface,
      questionSurface: `${lineIndex + 1}行目`,
      questionText: override.questionText || `${lineIndex + 1}行目を書き下しなさい。`,
      answer: override.answer ?? kundokuLines[lineIndex] ?? '',
      gradingMode: 'local',
    };
  };

  return (
    <div className={`vertical-text vertical-text--kaeriten-source${isKanbun ? ' vertical-text--kanbun' : ''}`} style={sourceTextStyle}>
      {sourceLines.flatMap((line, lineIndex) => {
        const target = makeLineTarget(lineIndex);
        const selected = selectedTarget?.id === target.id;
        return [
          <span
            className={`kaeriten-source-line-choice${selected ? ' is-selected' : ''}`}
            key={`kundoku-line-${lineIndex}`}
            onClick={() => onSelectLine?.(target, section)}
          >
            <AnnotatedSourceText text={line} start={lineStarts[lineIndex] ?? 0} annotations={annotations} />
          </span>,
          lineIndex < sourceLines.length - 1 ? <span key={`kundoku-break-${lineIndex}`}>{'\n'}</span> : null,
        ];
      })}
    </div>
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
  const [judgement, setJudgement] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const userAnswer = (nextMarks = marks, nextHyphens = hyphens) => serializeKaeritenAnswer({
    marks: nextMarks,
    hyphens: [...nextHyphens],
  }, target.surface);

  const adminAnswer = (nextMarks = adminMarks, nextHyphens = adminHyphens) => serializeKaeritenAnswer({
    marks: nextMarks,
    furigana: answer.furigana,
    okurigana: answer.okurigana,
    markY: answer.markY,
    furiganaY: answer.furiganaY,
    okuriganaY: answer.okuriganaY,
    hyphens: [...nextHyphens],
  }, target.surface);

  const updateMark = (index, value) => {
    setMarks(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
    setJudgement('');
  };

  const toggleHyphen = (index) => {
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

  const renderUnits = ({ values, hyphenSet, onMark, onHyphen }) => (
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
      })}
      <span className="kaeriten-inline-actions">
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

function KanbunSyntaxDisplay({ syntax, section, selectedTarget, onSelectTarget, activeType }) {
  const data = normalizeKanbunSyntax(syntax);

  if (!data.items.some(item => item.base)) return <p className="kanbun-syntax-empty">{'\u53e5\u6cd5\u306f\u672a\u767b\u9332\u3067\u3059\u3002'}</p>;

  return (
    <div className="kanbun-syntax-display-list">
      {data.items.map((item, itemIndex) => {
        if (!item.base) return null;
        const syntaxTarget = section ? kanbunSyntaxQuestionTarget(section, item, itemIndex) : null;
        const selectable = activeType === 'grammar' && syntaxTarget;
        const selected = selectable && selectedTarget?.id === syntaxTarget.id;
        let hanIndex = -1;
        return (
          <div
            className={`kanbun-syntax-display-item${selectable ? ' is-clickable' : ''}${selected ? ' is-selected' : ''}`}
            key={`syntax-${itemIndex}`}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            onClick={selectable ? () => onSelectTarget?.(syntaxTarget, section) : undefined}
            onKeyDown={selectable ? (event) => {
              if (event.key === 'Enter') onSelectTarget?.(syntaxTarget, section);
            } : undefined}
          >
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
                  const displayOkuri = verticalOkuriganaText(okuri);
                  const furigana = item.furigana[hanIndex] ?? '';
                  const furiganaSpan = furiganaSpanAt(item, hanIndex);
                  const unitStyle = {
                    '--syntax-mark-x': '7px',
                    '--syntax-mark-y': `${item.markY[hanIndex] ?? 0}px`,
                    '--syntax-okuri-x': '-5px',
                    '--syntax-okuri-y': `${item.okuriganaY[hanIndex] ?? 0}px`,
                    '--syntax-okuri-extent': okuriganaCellExtent(okuri),
                    '--syntax-furi-x': '-10px',
                    '--syntax-furi-y': `${item.furiganaY[hanIndex] ?? 0}px`,
                    '--syntax-furi-span-y': `${furiganaSpan?.y ?? 0}px`,
                  };
                  return (
                    <span className="kanbun-syntax-unit" key={sourceIndex} style={unitStyle}>
                      <span className="kanbun-syntax-char">{char}</span>
                      {furigana && <span className="kanbun-syntax-furigana">{furigana}</span>}
                      {furiganaSpan && <span className="kanbun-syntax-furigana kanbun-syntax-furigana-span">{furiganaSpan.text}</span>}
                      {mark && <span className="kanbun-syntax-mark">{mark}</span>}
                      {displayOkuri && <span className="kanbun-syntax-okurigana">{displayOkuri}</span>}
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
  const updateFuriganaSpan = (itemIndex, start, patch) => {
    const current = data.items[itemIndex];
    const existing = furiganaSpanAt(current, start) ?? { start, length: 2, text: '', y: 0 };
    const nextSpan = { ...existing, ...patch, start, length: 2 };
    const nextSpans = [
      ...(current.furiganaSpans ?? []).filter(span => span.start !== start),
      nextSpan,
    ].filter(span => String(span.text ?? '').trim());
    updateSyntaxItem(itemIndex, { ...current, furiganaSpans: nextSpans });
  };
  const updateAlternativeAnswer = (itemIndex, field, answerIndex, nextValue) => {
    const current = data.items[itemIndex];
    const values = [...(current[field] ?? []), '', '', '', '', ''].slice(0, 5);
    values[answerIndex] = nextValue;
    updateSyntaxItem(itemIndex, { ...current, [field]: values });
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
        const selectedPair = selectedIndex < hanChars.length - 1 ? `${selectedChar}${hanChars[selectedIndex + 1]}` : '';
        const selectedFuriganaSpan = furiganaSpanAt(syntaxItem, selectedIndex) ?? { text: '', y: 0 };
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
            <div className="kanbun-syntax-answer-fields">
              <label>
                {'\u7528\u6cd5'}
                <input
                  value={syntaxItem.usage ?? ''}
                  onChange={(event) => updateSyntaxItem(itemIndex, { ...syntaxItem, usage: event.target.value })}
                  placeholder={'\u4f8b\uff1a\u53cd\u8a9e\u30fb\u6bd4\u8f03\u30fb\u4f7f\u5f79'}
                />
              </label>
              <label>
                {'\u8a33\u3057\u65b9'}
                <input
                  value={syntaxItem.translation ?? ''}
                  onChange={(event) => updateSyntaxItem(itemIndex, { ...syntaxItem, translation: event.target.value })}
                  placeholder={'\u4f8b\uff1a\u3069\u3046\u3057\u3066\uff5e\u304b'}
                />
              </label>
              <fieldset>
                <legend>{'\u7528\u6cd5\u306e\u5225\u89e3'}</legend>
                {[...(syntaxItem.usageAlternativeAnswers ?? []), '', '', '', '', ''].slice(0, 5).map((value, index) => (
                  <input
                    key={'usage-alt-' + index}
                    value={value}
                    onChange={(event) => updateAlternativeAnswer(itemIndex, 'usageAlternativeAnswers', index, event.target.value)}
                    placeholder={`\u5225\u89e3${index + 1}`}
                  />
                ))}
              </fieldset>
              <fieldset>
                <legend>{'\u8a33\u3057\u65b9\u306e\u5225\u89e3'}</legend>
                {[...(syntaxItem.translationAlternativeAnswers ?? []), '', '', '', '', ''].slice(0, 5).map((value, index) => (
                  <input
                    key={'translation-alt-' + index}
                    value={value}
                    onChange={(event) => updateAlternativeAnswer(itemIndex, 'translationAlternativeAnswers', index, event.target.value)}
                    placeholder={`\u5225\u89e3${index + 1}`}
                  />
                ))}
              </fieldset>
            </div>
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
                    const displayOkuri = verticalOkuriganaText(okuri);
                    const furigana = syntaxItem.furigana[currentIndex] ?? '';
                    const furiganaSpan = furiganaSpanAt(syntaxItem, currentIndex);
                    const unitStyle = {
                      '--syntax-mark-x': '7px',
                      '--syntax-mark-y': String(syntaxItem.markY[currentIndex] ?? 0) + 'px',
                      '--syntax-okuri-x': '-5px',
                      '--syntax-okuri-y': String(syntaxItem.okuriganaY[currentIndex] ?? 0) + 'px',
                      '--syntax-okuri-extent': okuriganaCellExtent(okuri),
                      '--syntax-furi-x': '-10px',
                      '--syntax-furi-y': String(syntaxItem.furiganaY[currentIndex] ?? 0) + 'px',
                      '--syntax-furi-span-y': String(furiganaSpan?.y ?? 0) + 'px',
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
                        {furiganaSpan && <span className="kanbun-syntax-furigana kanbun-syntax-furigana-span">{furiganaSpan.text}</span>}
                        {mark && <span className="kanbun-syntax-mark">{mark}</span>}
                        {displayOkuri && <span className="kanbun-syntax-okurigana">{displayOkuri}</span>}
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
                    {selectedPair && (
                      <fieldset className="kanbun-syntax-span-control">
                        <legend>{'2文字まとめて振る'}</legend>
                        <div className="kanbun-syntax-selected-char">{selectedPair}</div>
                        <label>
                          {'振り仮名'}
                          <input
                            value={selectedFuriganaSpan.text ?? ''}
                            onChange={(event) => updateFuriganaSpan(itemIndex, selectedIndex, { text: event.target.value })}
                            placeholder={`${selectedPair}の読み`}
                          />
                        </label>
                        <div className="kanbun-syntax-position-pair">
                          <label>{'振り仮名'} Y<input type="number" step="1" value={selectedFuriganaSpan.y ?? 0} onChange={(event) => updateFuriganaSpan(itemIndex, selectedIndex, { y: Number(event.target.value) })} /></label>
                        </div>
                      </fieldset>
                    )}
                    <label>
                      {'\u9001\u308a\u4eee\u540d'}
                      <input
                        value={syntaxItem.okurigana[selectedIndex] ?? ''}
                        onChange={(event) => updateAnnotation(itemIndex, 'okurigana', selectedIndex, event.target.value)}
                      />
                    </label>
                    <div className="kanbun-syntax-position-pair">
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

function KanbunSyntaxBlock({ section, isAdmin, onUpdateSection, selectedTarget, onSelectTarget, activeType }) {
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
        <KanbunSyntaxDisplay
          syntax={initialSyntax}
          section={section}
          selectedTarget={selectedTarget}
          onSelectTarget={onSelectTarget}
          activeType={activeType}
        />
      ) : (
        <p className="kanbun-syntax-empty">句法は未登録です。</p>
      )}
      {!editing && message && <span className="admin-message">{message}</span>}
    </div>
  );
}

function SectionCard({ section, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern, isAdmin, onUpdateSection, onUpdateTarget, onRecord, onCreateTarget, sourceHeightScale, isKanbunTextbook, compactKanbunSourceHeight, correctKaeritenLines }) {
  const scrollRef = useRef(null);
  const textRef = useRef(null);
  const pinnedRef = useRef(null);
  const [firstPoint, setFirstPoint] = useState(null);
  const [showKundoku, setShowKundoku] = useState(false);
  const [editingSection, setEditingSection] = useState(false);
  const phrase = pinnedPhrase?.sectionId === section.id ? pinnedPhrase.text : null;
  const syntaxSourceTargets = selectedSyntaxSourceTargets(section, selectedTarget);
  const segmentTargets = syntaxSourceTargets.length
    ? [...syntaxSourceTargets, ...(section.targets ?? [])]
    : (section.targets ?? []);
  const segments = buildSegments(section.text, segmentTargets, activeType, phrase);
  const kundoku = getKundoku(section);
  const isKanbun = isKanbunSection(section, isKanbunTextbook);
  const sourceTextStyle = sectionTextStyle(section.text, kundoku, sourceHeightScale, isKanbun, compactKanbunSourceHeight);
  const kaeritenTarget = (section.targets ?? []).find(target => target.type === 'kaeriten');
  const showKaeritenAnnotations = isKanbun && kaeritenTarget && (activeType === 'vocab' || activeType === 'grammar' || activeType === 'kundoku');
  const kaeritenAnnotations = showKaeritenAnnotations ? buildKaeritenAnnotationMap(section, kaeritenTarget) : null;

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
    (selectedTarget?.groupId && selectedTarget.groupId === t.groupId) ||
    (t.groupId && t.groupId === selectedTarget?.id);

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
          {activeType === 'kundoku' && isKanbun ? (
            <KundokuSourceLineSelector
              section={section}
              isKanbun={isKanbun}
              sourceTextStyle={sourceTextStyle}
              selectedTarget={selectedTarget}
              onSelectLine={onSelectTarget}
              annotations={kaeritenAnnotations}
            />
          ) : (activeType === 'kaeriten' || activeType === 'all') && kaeritenTarget ? (
            <KaeritenSourceExercise
              target={kaeritenTarget}
              section={section}
              isAdmin={isAdmin}
              onUpdateTarget={onUpdateTarget}
              onRecord={onRecord}
              isKanbun={isKanbun}
              sourceTextStyle={sourceTextStyle}
              practiceMode={activeType === 'kaeriten'}
              onSelectLine={onSelectTarget}
              correctLineKeys={correctKaeritenLines}
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
                  <span key={i}>
                    <AnnotatedSourceText text={seg.text} start={seg.start} annotations={kaeritenAnnotations} />
                  </span>
                ) : seg.type === 'pinned' ? (
                  <span key={i} className="pinned-translation" ref={pinnedRef}>
                    <AnnotatedSourceText text={seg.text} start={seg.start} annotations={kaeritenAnnotations} />
                  </span>
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
                  >
                    <AnnotatedSourceText text={seg.target.surface} start={seg.start} annotations={kaeritenAnnotations} />
                  </HighlightedToken>
                )
              )}
            </div>
          )}
        </div>
      </SourceKundokuRow>
      {isKanbun && activeType === 'grammar' && (
        <KanbunSyntaxBlock
          section={section}
          isAdmin={isAdmin}
          onUpdateSection={onUpdateSection}
          selectedTarget={selectedTarget}
          onSelectTarget={onSelectTarget}
          activeType={activeType}
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

export default function VerticalTextViewer({ textId, notes, sections, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern, isAdmin, onUpdateSection, onUpdateTarget, onRecord, onCreateTarget, onBackToSelect, onContactAdmin, isKanbunTextbook = false, correctKaeritenLines = {}, shareBoard = null }) {
  const [activeTab, setActiveTab] = useState('source');
  const visibleSections = sections.filter(section => !section.sectionless);
  const visibleTab = activeTab;
  const sourceHeightScale = textId === 'gyofunori' ? 0.63 : 1;
  const compactKanbunSourceHeight = textId === 'mujun';
  const correctKaeritenLineKeys = useMemo(() => new Set(Object.keys(correctKaeritenLines).filter(key => correctKaeritenLines[key])), [correctKaeritenLines]);

  useEffect(() => {
    if (pinnedPhrase) setActiveTab('source');
  }, [pinnedPhrase]);

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
          <button
            type="button"
            role="tab"
            aria-selected={visibleTab === 'share'}
            className={`left-tab-button${visibleTab === 'share' ? ' active' : ''}`}
            onClick={() => setActiveTab('share')}
          >
            共有ボード
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
              isKanbunTextbook={isKanbunTextbook}
              compactKanbunSourceHeight={compactKanbunSourceHeight}
              correctKaeritenLines={correctKaeritenLineKeys}
            />
          ))
        ) : visibleTab === 'notes' ? (
          <NotesTab textId={textId} notes={notes} sections={sections} isAdmin={isAdmin} onUpdateSection={onUpdateSection} />
        ) : (
          shareBoard ?? <p className="analysis-empty">共有ボードを読み込み中です。</p>
        )}
      </div>
    </div>
  );
}
