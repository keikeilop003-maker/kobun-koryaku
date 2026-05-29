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

function SectionEditor({ section, kundoku, onCancel, onSave, allowTitle = false }) {
  const [title, setTitle] = useState(section.title ?? '');
  const [sourceText, setSourceText] = useState(section.text ?? '');
  const [kundokuText, setKundokuText] = useState(kundoku ?? '');
  const [modernText, setModernText] = useState(section.modern ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      await onSave?.({
        ...(allowTitle ? { title: title.trim() || '追加した段' } : {}),
        text: sourceText,
        kundoku: kundokuText,
        modern: modernText,
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
      {allowTitle && (
        <label>
          段の見出し
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      )}
      <label>
        原文
        <textarea rows={8} value={sourceText} onChange={(e) => setSourceText(e.target.value)} />
      </label>
      <label>
        書き下し文
        <textarea rows={8} value={kundokuText} onChange={(e) => setKundokuText(e.target.value)} />
      </label>
      <label>
        現代語訳
        <textarea rows={8} value={modernText} onChange={(e) => setModernText(e.target.value)} />
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

function splitViewLines(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function splitViewLineEntries(value) {
  const text = String(value ?? '');
  const entries = [];
  let cursor = 0;
  text.split(/\r?\n/).forEach((rawLine) => {
    const leading = rawLine.match(/^\s*/u)?.[0]?.length ?? 0;
    const trimmed = rawLine.trim();
    const lineStart = cursor + leading;
    if (trimmed) entries.push({ text: trimmed, start: lineStart, end: lineStart + trimmed.length });
    cursor += rawLine.length + 1;
  });
  return entries;
}

function snapViewSplit(chars, target, min, max) {
  const punctuation = /[\u3001\u3002\uff0c\uff0e\uff1f\uff01\u300d\u300f]/u;
  for (let offset = 0; offset <= 16; offset += 1) {
    const forward = target + offset;
    if (forward >= min && forward <= max && punctuation.test(chars[forward - 1] ?? '')) return forward;
    const backward = target - offset;
    if (backward >= min && backward <= max && punctuation.test(chars[backward - 1] ?? '')) return backward;
  }
  return Math.min(Math.max(target, min), max);
}

function splitModernForSourceLines(modernText, sourceLines) {
  const explicitLines = splitViewLines(modernText);
  if (explicitLines.length !== 1 || sourceLines.length <= 1) return explicitLines;

  const chars = Array.from(explicitLines[0]);
  const sourceLengths = sourceLines.map(line => Math.max(Array.from(line).length, 1));
  const totalSourceLength = sourceLengths.reduce((sum, length) => sum + length, 0);
  const chunks = [];
  let sourceCursor = 0;
  let modernCursor = 0;

  sourceLengths.forEach((length, index) => {
    if (index === sourceLengths.length - 1) {
      chunks.push(chars.slice(modernCursor).join('').trim());
      return;
    }
    sourceCursor += length;
    const proportionalTarget = Math.round((chars.length * sourceCursor) / totalSourceLength);
    const remainingLines = sourceLengths.length - index - 1;
    const min = Math.min(chars.length, modernCursor + 1);
    const max = Math.max(min, chars.length - remainingLines);
    const end = snapViewSplit(chars, proportionalTarget, min, max);
    chunks.push(chars.slice(modernCursor, end).join('').trim());
    modernCursor = end;
  });

  return chunks;
}

function maskedTextParts(text, hiddenWords) {
  const words = hiddenWords
    .map(word => String(word ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => Array.from(b).length - Array.from(a).length);
  if (!words.length) return [{ type: 'text', value: text }];

  const parts = [];
  let position = 0;
  while (position < text.length) {
    const match = words
      .map(word => ({ word, index: text.indexOf(word, position) }))
      .filter(item => item.index !== -1)
      .sort((a, b) => a.index - b.index || b.word.length - a.word.length)[0];
    if (!match) {
      parts.push({ type: 'text', value: text.slice(position) });
      break;
    }
    if (match.index > position) parts.push({ type: 'text', value: text.slice(position, match.index) });
    parts.push({ type: 'mask', value: match.word, start: match.index });
    position = match.index + match.word.length;
  }
  return parts;
}

const LESSON_GRAMMAR_TYPES = new Set(['verb', 'adj', 'aux']);
const LESSON_FORM_ABBR = {
  '未然形': '未',
  '連用形': '用',
  '終止形': '終',
  '連体形': '体',
  '已然形': '已',
  '命令形': '命',
};
const LESSON_EUPHONY_ABBR = {
  'ウ音便': 'ウ音',
  'イ音便': 'イ音',
  '撥音便': '撥',
  '促音便': '促',
};

function lessonGrammarSourceText(target) {
  return [
    target?.conjugationType,
    target?.formInText,
    target?.answer,
    target?.explanation,
  ].map(value => String(value ?? '')).join('・');
}

function lessonFormAbbr(target) {
  const source = lessonGrammarSourceText(target);
  return Object.entries(LESSON_FORM_ABBR).find(([word]) => source.includes(word))?.[1] ?? '';
}

function lessonEuphonyAbbr(target) {
  const source = lessonGrammarSourceText(target);
  return Object.entries(LESSON_EUPHONY_ABBR)
    .filter(([word]) => source.includes(word))
    .map(([, abbr]) => abbr);
}

function shortenLessonConjugation(value, type) {
  let text = String(value ?? '').trim();
  if (!text || text === '?') return '';
  text = text
    .replace(/形容動詞/g, '')
    .replace(/形容詞/g, '')
    .replace(/活用/g, '')
    .replace(/変格/g, '変');
  if (type === 'verb') text = text.replace(/行/g, '').replace(/段/g, '');
  return text;
}

function lessonAuxiliaryKind(target) {
  return String(target?.answer ?? target?.explanation ?? '')
    .replace(/の助動詞/g, '')
    .split('・')[0]
    .trim();
}

function grammarTooltipText(target) {
  const override = String(target?.lessonGrammarLabelOverride ?? '').trim();
  if (override) return override;
  const form = lessonFormAbbr(target);
  const euphony = lessonEuphonyAbbr(target);
  const isSupplementary = lessonGrammarSourceText(target).includes('補助');
  if (target?.type === 'aux') {
    return [lessonAuxiliaryKind(target), form, ...euphony].filter(Boolean).join('・');
  }
  const conjugation = shortenLessonConjugation(target?.conjugationType, target?.type);
  const core = [conjugation, form].filter(Boolean).join('');
  return [core, ...euphony, isSupplementary ? '補' : ''].filter(Boolean).join('・')
    || String(target?.explanation ?? target?.answer ?? '').trim();
}

function buildLessonGrammarSegments(text, targets) {
  const located = (targets ?? [])
    .filter(target => LESSON_GRAMMAR_TYPES.has(target.type) && grammarTooltipText(target))
    .map(target => {
      const surface = String(target.surface ?? '');
      if (!surface) return null;
      const start = Number.isInteger(target.lineStart) ? target.lineStart : text.indexOf(surface);
      if (start < 0 || text.slice(start, start + surface.length) !== surface) return null;
      return { target, start, end: start + surface.length };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const segments = [];
  let cursor = 0;
  located.forEach(({ target, start, end }) => {
    if (start < cursor) return;
    if (start > cursor) segments.push({ type: 'text', value: text.slice(cursor, start) });
    segments.push({ type: 'grammar', value: text.slice(start, end), target });
    cursor = end;
  });
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) });
  return segments.length ? segments : [{ type: 'text', value: text }];
}

function LessonViewColumn({ text, kind, columnKey, hiddenWords, revealedMasks, onRevealMask, revealed = true, framed = false, onToggle, isKanbunSource = false, grammarTargets = [], onGrammarTargetClick }) {
  if (!text && !framed) return null;
  const content = text || '\u3000';
  const grammarSegments = grammarTargets.length ? buildLessonGrammarSegments(content, grammarTargets) : null;
  return (
    <section
      className={`lesson-view-column lesson-view-column--${kind}${isKanbunSource ? ' lesson-view-column--kanbun-source' : ''}${framed ? ' lesson-view-column--framed' : ''}${revealed ? ' is-revealed' : ' is-hidden'}`}
    >
      <button
        type="button"
        className="lesson-view-reveal-frame"
        onClick={onToggle}
        disabled={!onToggle && !grammarSegments}
        aria-label={revealed ? '\u975e\u8868\u793a\u306b\u3059\u308b' : '\u8868\u793a\u3059\u308b'}
      >
        <span className="lesson-view-text">
          {revealed && grammarSegments ? grammarSegments.map((part, index) => {
            if (part.type === 'text') return <span key={`${columnKey}-grammar-text-${index}`}>{part.value}</span>;
            const bubbleText = grammarTooltipText(part.target);
            return (
              <span
                key={`${columnKey}-grammar-${part.target.id}-${index}`}
                role="button"
                tabIndex={0}
                className="lesson-view-grammar-token"
                onClick={(event) => {
                  event.stopPropagation();
                  onGrammarTargetClick?.(part.target, bubbleText, event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onGrammarTargetClick?.(part.target, bubbleText, event.currentTarget);
                  }
                }}
              >
                {part.value}
              </span>
            );
          }) : revealed ? maskedTextParts(content, hiddenWords).map((part, index) => {
            if (part.type === 'text') return <span key={`${columnKey}-text-${index}`}>{part.value}</span>;
            const maskKey = `${columnKey}:${part.start}:${part.value}`;
            if (revealedMasks.has(maskKey)) return <span key={maskKey}>{part.value}</span>;
            return (
              <span
                key={maskKey}
                role="button"
                tabIndex={0}
                className="lesson-view-mask"
                style={{ '--mask-length': Array.from(part.value).length }}
                onClick={(event) => {
                  event.stopPropagation();
                  onRevealMask(maskKey);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onRevealMask(maskKey);
                  }
                }}
                aria-label={'\u96a0\u3057\u305f\u8a9e\u3092\u8868\u793a'}
              >
                ?
              </span>
            );
          }) : content}
        </span>
      </button>
    </section>
  );
}

function LineNumberedTextarea({ value, onChange }) {
  const lineCount = Math.max(String(value ?? '').split(/\r?\n/).length, 1);
  return (
    <div className="lesson-view-numbered-textarea">
      <div className="lesson-view-line-numbers" aria-hidden="true">
        {Array.from({ length: lineCount }).map((_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <textarea value={value} onChange={onChange} />
    </div>
  );
}

function LessonViewEditor({ section, kundoku, lineCount, maskRules, grammarTargets, customGrammarTargets, hiddenGrammarTargetIds, grammarLabelOverrides, onGrammarLabelOverrideChange, onAddGrammarTarget, onRemoveGrammarTarget, onAddMaskRule, onRemoveMaskRule, onCancel, onSave }) {
  const [editorTab, setEditorTab] = useState('text');
  const [sourceText, setSourceText] = useState(section.text ?? '');
  const [modernText, setModernText] = useState(section.modern ?? '');
  const [kundokuText, setKundokuText] = useState(kundoku ?? '');
  const [maskLineIndex, setMaskLineIndex] = useState(0);
  const [maskWord, setMaskWord] = useState('');
  const [grammarLineIndex, setGrammarLineIndex] = useState(0);
  const [grammarSurface, setGrammarSurface] = useState('');
  const [grammarLabel, setGrammarLabel] = useState('');
  const [grammarType, setGrammarType] = useState('verb');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      await onSave?.(section, {
        text: sourceText,
        modern: modernText,
        kundoku: kundokuText,
        maskRules,
        grammarLabelOverrides,
        customGrammarTargets,
        hiddenGrammarTargetIds,
      });
      onCancel?.();
    } catch (err) {
      console.error('[LessonViewEditor] save failed:', err);
      setMessage('\u4fdd\u5b58\u306b\u5931\u6557\u3057\u307e\u3057\u305f');
    } finally {
      setSaving(false);
    }
  };

  const addMask = () => {
    const word = maskWord.trim();
    if (!word) return;
    onAddMaskRule?.({
      sectionId: section.id,
      lineIndex: maskLineIndex,
      word,
    });
    setMaskWord('');
  };

  const addGrammar = () => {
    const surface = grammarSurface.trim();
    const label = grammarLabel.trim();
    if (!surface || !label) return;
    const lineEntries = splitViewLineEntries(sourceText);
    const entry = lineEntries[grammarLineIndex];
    if (!entry) return;
    const localIndex = entry.text.indexOf(surface);
    if (localIndex === -1) {
      setMessage('対象行にその語が見つかりません');
      return;
    }
    onAddGrammarTarget?.({
      id: `custom-grammar-${section.id}-${Date.now()}`,
      sectionId: section.id,
      type: grammarType,
      surface,
      start: entry.start + localIndex,
      end: entry.start + localIndex + surface.length,
      answer: label,
      explanation: label,
      customLessonGrammar: true,
    });
    setGrammarSurface('');
    setGrammarLabel('');
    setMessage('');
  };

  return (
    <div className="lesson-view-editor">
      <div className="lesson-view-editor-tabs" role="tablist" aria-label="授業表示編集">
        <button type="button" className={editorTab === 'text' ? 'active' : ''} onClick={() => setEditorTab('text')}>本文</button>
        <button type="button" className={editorTab === 'grammar' ? 'active' : ''} onClick={() => setEditorTab('grammar')}>吹き出し</button>
      </div>
      {editorTab === 'text' ? (
        <>
          <div className="lesson-view-editor-grid">
            <label>
              {'\u539f\u6587'}
              <LineNumberedTextarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
            </label>
            <label>
              {'\u73fe\u4ee3\u8a9e\u8a33'}
              <LineNumberedTextarea value={modernText} onChange={(event) => setModernText(event.target.value)} />
            </label>
            {kundoku || section.kundoku ? (
              <label>
                {'\u66f8\u304d\u4e0b\u3057\u6587'}
                <textarea value={kundokuText} onChange={(event) => setKundokuText(event.target.value)} />
              </label>
            ) : null}
          </div>
          <div className="lesson-view-mask-editor">
            <label>
              {'\u5bfe\u8c61\u884c'}
              <select value={maskLineIndex} onChange={(event) => setMaskLineIndex(Number(event.target.value))}>
                {Array.from({ length: Math.max(lineCount, 1) }).map((_, index) => (
                  <option value={index} key={index}>{`${index + 1}\u884c\u76ee`}</option>
                ))}
              </select>
            </label>
            <label>
              {'\u73fe\u4ee3\u8a9e\u8a33\u306e\u96a0\u3059\u8a9e'}
              <input
                value={maskWord}
                onChange={(event) => setMaskWord(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addMask();
                  }
                }}
              />
            </label>
            <button type="button" onClick={addMask}>{'\u8ffd\u52a0'}</button>
            {maskRules.length > 0 && (
              <div className="lesson-view-mask-editor-list">
                {maskRules.map(rule => (
                  <button type="button" key={rule.id} onClick={() => onRemoveMaskRule?.(rule.id)}>
                    {`${rule.lineIndex + 1}\u884c\u76ee: ${rule.word} \u00d7`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="lesson-view-grammar-editor">
          <div className="lesson-view-editor-subtitle">文法吹き出し</div>
          <div className="lesson-view-grammar-editor-layout">
            <div className="lesson-view-grammar-editor-list">
              {grammarTargets.map(target => (
                <div key={target.id} className="lesson-view-grammar-editor-row">
                  <span>{target.surface}</span>
                  <input
                    type="text"
                    value={grammarLabelOverrides[target.id] ?? ''}
                    placeholder={grammarTooltipText(target)}
                    onChange={(event) => onGrammarLabelOverrideChange?.(target.id, event.target.value)}
                  />
                  <button type="button" onClick={() => onRemoveGrammarTarget?.(target)}>削除</button>
                </div>
              ))}
            </div>
            <div className="lesson-view-grammar-add">
              <label>
                対象行
                <select value={grammarLineIndex} onChange={(event) => setGrammarLineIndex(Number(event.target.value))}>
                  {Array.from({ length: Math.max(lineCount, 1) }).map((_, index) => (
                    <option value={index} key={index}>{`${index + 1}行目`}</option>
                  ))}
                </select>
              </label>
              <label>
                品詞
                <select value={grammarType} onChange={(event) => setGrammarType(event.target.value)}>
                  <option value="verb">動詞</option>
                  <option value="adj">形容詞・形容動詞</option>
                  <option value="aux">助動詞</option>
                </select>
              </label>
              <label>
                語
                <input value={grammarSurface} onChange={(event) => setGrammarSurface(event.target.value)} />
              </label>
              <label>
                表示
                <input value={grammarLabel} onChange={(event) => setGrammarLabel(event.target.value)} />
              </label>
              <button type="button" onClick={addGrammar}>追加</button>
            </div>
          </div>
        </div>
      )}
      <div className="lesson-view-editor-actions">
        {message && <span>{message}</span>}
        <button type="button" onClick={onCancel} disabled={saving}>{'\u30ad\u30e3\u30f3\u30bb\u30eb'}</button>
        <button type="button" onClick={save} disabled={saving}>{saving ? '\u4fdd\u5b58\u4e2d...' : '\u4fdd\u5b58'}</button>
      </div>
    </div>
  );
}

function LessonViewMode({ textId, sections, lessonViewSections, lessonViewPublished, isKanbunTextbook, isAdmin, onUpdateLessonViewSection, onUpdateLessonViewPublished }) {
  const visibleSections = sections.filter(section => !section.sectionless);
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editingAll, setEditingAll] = useState(false);
  const [revealedColumns, setRevealedColumns] = useState(() => new Set());
  const [maskRules, setMaskRules] = useState([]);
  const [revealedMasks, setRevealedMasks] = useState(() => new Set());
  const [maskActive, setMaskActive] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [grammarBubbles, setGrammarBubbles] = useState([]);
  const [grammarLabelOverrides, setGrammarLabelOverrides] = useState({});
  const [customGrammarTargets, setCustomGrammarTargets] = useState([]);
  const [hiddenGrammarTargetIds, setHiddenGrammarTargetIds] = useState(() => new Set());
  const grammarBubbleZ = useRef(1000);
  const pairsPerSlide = isKanbunTextbook ? 4 : 5;
  const lessonGrammarEnabled = textId === 'akutagawa';

  useEffect(() => {
    const next = [];
    lessonViewSections?.forEach(item => {
      const rules = Array.isArray(item?.section?.maskRules) ? item.section.maskRules : [];
      rules.forEach((rule, index) => {
        const sectionId = rule?.sectionId || item.sectionId;
        const word = String(rule?.word ?? '').trim();
        const lineIndex = Number(rule?.lineIndex);
        if (!sectionId || !word || !Number.isInteger(lineIndex)) return;
        next.push({
          id: rule.id || `${sectionId}:${lineIndex}:${word}:${index}`,
          sectionId,
          lineIndex,
          word,
        });
      });
    });
    setMaskRules(next);
    setRevealedMasks(new Set());
  }, [lessonViewSections]);

  useEffect(() => {
    const next = {};
    const nextCustomTargets = [];
    const nextHiddenIds = new Set();
    lessonViewSections?.forEach(item => {
      const overrides = item?.section?.grammarLabelOverrides;
      if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
        Object.entries(overrides).forEach(([targetId, value]) => {
          const label = String(value ?? '').trim();
          if (targetId && label) next[targetId] = label;
        });
      }
      const customTargets = Array.isArray(item?.section?.customGrammarTargets) ? item.section.customGrammarTargets : [];
      customTargets.forEach(target => {
        const surface = String(target?.surface ?? '').trim();
        const id = String(target?.id ?? '').trim();
        const sectionId = String(target?.sectionId ?? item.sectionId ?? '').trim();
        if (!id || !sectionId || !surface || !LESSON_GRAMMAR_TYPES.has(target?.type)) return;
        nextCustomTargets.push({
          id,
          sectionId,
          type: target.type,
          surface,
          start: Number(target.start),
          end: Number(target.end),
          answer: String(target.answer ?? '').trim(),
          explanation: String(target.explanation ?? '').trim(),
          customLessonGrammar: true,
        });
      });
      const hiddenIds = Array.isArray(item?.section?.hiddenGrammarTargetIds) ? item.section.hiddenGrammarTargetIds : [];
      hiddenIds.forEach(id => {
        const targetId = String(id ?? '').trim();
        if (targetId) nextHiddenIds.add(targetId);
      });
    });
    setGrammarLabelOverrides(next);
    setCustomGrammarTargets(nextCustomTargets);
    setHiddenGrammarTargetIds(nextHiddenIds);
    setGrammarBubbles([]);
  }, [lessonViewSections]);

  const addMaskRule = (rule) => {
    const word = String(rule?.word ?? '').trim();
    if (!word || !rule?.sectionId || !Number.isInteger(rule.lineIndex)) return;
    setMaskRules(current => {
      const exists = current.some(item => item.sectionId === rule.sectionId && item.lineIndex === rule.lineIndex && item.word === word);
      if (exists) return current;
      return [...current, {
        id: `${rule.sectionId}:${rule.lineIndex}:${word}:${Date.now()}`,
        sectionId: rule.sectionId,
        lineIndex: rule.lineIndex,
        word,
      }];
    });
    setRevealedMasks(new Set());
  };

  const removeMaskRule = (ruleId) => {
    setMaskRules(current => current.filter(item => item.id !== ruleId));
    setRevealedMasks(new Set());
  };

  const updateGrammarLabelOverride = (targetId, value) => {
    setGrammarLabelOverrides(current => {
      const next = { ...current };
      const label = String(value ?? '').trim();
      if (label) next[targetId] = label;
      else delete next[targetId];
      return next;
    });
    setGrammarBubbles(current => current.filter(item => item.targetId !== targetId));
  };

  const addGrammarTarget = (target) => {
    if (!target?.id || !target?.sectionId || !target?.surface || !LESSON_GRAMMAR_TYPES.has(target.type)) return;
    setCustomGrammarTargets(current => [...current.filter(item => item.id !== target.id), target]);
    updateGrammarLabelOverride(target.id, target.answer ?? target.explanation ?? '');
  };

  const removeGrammarTarget = (target) => {
    if (!target?.id) return;
    if (target.customLessonGrammar) {
      setCustomGrammarTargets(current => current.filter(item => item.id !== target.id));
    } else {
      setHiddenGrammarTargetIds(current => {
        const next = new Set(current);
        next.add(target.id);
        return next;
      });
    }
    updateGrammarLabelOverride(target.id, '');
    setGrammarBubbles(current => current.filter(item => item.targetId !== target.id));
  };

  const revealMask = (maskKey) => {
    setRevealedMasks(current => {
      const next = new Set(current);
      next.add(maskKey);
      return next;
    });
  };

  const toggleColumn = (columnKey) => {
    setRevealedColumns(current => {
      const next = new Set(current);
      if (next.has(columnKey)) next.delete(columnKey);
      else next.add(columnKey);
      return next;
    });
  };

  const toggleGrammarBubble = (target, text, element) => {
    if (!target?.bubbleKey || !text || !element) return;
    setGrammarBubbles(current => {
      if (current.some(item => item.key === target.bubbleKey)) {
        return current.filter(item => item.key !== target.bubbleKey);
      }
      const rect = element.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const horizontal = rect.right > viewportWidth * 0.78 ? 'left' : 'right';
      const align = centerY < viewportHeight * 0.34
        ? 'top'
        : centerY > viewportHeight * 0.66
          ? 'bottom'
          : 'middle';
      return [...current, {
        key: target.bubbleKey,
        targetId: target.id,
        text,
        left: horizontal === 'left' ? rect.left - 10 : rect.right + 10,
        top: align === 'top' ? rect.top : align === 'bottom' ? rect.bottom : centerY,
        align,
        horizontal,
        zIndex: grammarBubbleZ.current += 1,
        fontSize: window.getComputedStyle(element).fontSize,
      }];
    });
  };

  const closeEditor = () => {
    setEditingAll(false);
    setEditingSectionId(null);
  };

  const preparedSections = visibleSections.map(section => {
    const lessonEdit = lessonViewSections?.get(section.id)?.section ?? {};
    const lessonSection = {
      ...section,
      ...(typeof lessonEdit.text === 'string' ? { text: lessonEdit.text } : {}),
      ...(typeof lessonEdit.kundoku === 'string' ? { kundoku: lessonEdit.kundoku } : {}),
      ...(typeof lessonEdit.modern === 'string' ? { modern: lessonEdit.modern } : {}),
      ...(Array.isArray(lessonEdit.maskRules) ? { maskRules: lessonEdit.maskRules } : {}),
      ...(lessonEdit.grammarLabelOverrides && typeof lessonEdit.grammarLabelOverrides === 'object' ? { grammarLabelOverrides: lessonEdit.grammarLabelOverrides } : {}),
      ...(Array.isArray(lessonEdit.customGrammarTargets) ? { customGrammarTargets: lessonEdit.customGrammarTargets } : {}),
      ...(Array.isArray(lessonEdit.hiddenGrammarTargetIds) ? { hiddenGrammarTargetIds: lessonEdit.hiddenGrammarTargetIds } : {}),
    };
    const kundoku = getKundoku(lessonSection);
    const isKanbun = isKanbunSection(lessonSection, isKanbunTextbook);
    const sourceLineEntries = splitViewLineEntries(lessonSection.text);
    const sourceLines = sourceLineEntries.map(entry => entry.text);
    const modernLines = splitModernForSourceLines(lessonSection.modern, sourceLines);
    const kundokuLines = isKanbun ? splitViewLines(kundoku) : [];
    const lineCount = Math.max(sourceLines.length, modernLines.length, kundokuLines.length, 1);
    return { section, lessonSection, kundoku, isKanbun, sourceLineEntries, sourceLines, modernLines, kundokuLines, lineCount };
  });

  const slides = preparedSections.flatMap(item => {
    const count = Math.max(item.lineCount, 1);
    const result = [];
    for (let start = 0; start < count; start += pairsPerSlide) {
      result.push({ ...item, start, end: Math.min(start + pairsPerSlide, count) });
    }
    return result;
  });
  const activeSlide = slides[Math.min(slideIndex, Math.max(slides.length - 1, 0))];
  const canGoPrev = slideIndex > 0;
  const canGoNext = slideIndex < slides.length - 1;

  useEffect(() => {
    if (slideIndex > Math.max(slides.length - 1, 0)) setSlideIndex(Math.max(slides.length - 1, 0));
  }, [slideIndex, slides.length]);

  useEffect(() => {
    setGrammarBubbles([]);
  }, [slideIndex, textId]);

  return (
    <div className="lesson-view-mode">
      <div className="lesson-view-side-controls">
        {slides.length > 1 && (
          <div className="lesson-view-slide-controls" aria-label="\u30b9\u30e9\u30a4\u30c9\u64cd\u4f5c">
            <button type="button" onClick={() => setSlideIndex(index => Math.max(index - 1, 0))} disabled={!canGoPrev}>
              {'\u524d\u3078'}
            </button>
            <span>{`${Math.min(slideIndex + 1, slides.length)} / ${slides.length}`}</span>
            <button type="button" onClick={() => setSlideIndex(index => Math.min(index + 1, slides.length - 1))} disabled={!canGoNext}>
              {'\u6b21\u3078'}
            </button>
          </div>
        )}
        {isAdmin && (
          <div className="lesson-view-floating-actions">
            <button
              type="button"
              onClick={() => {
                setEditingSectionId(null);
                setEditingAll(value => !value);
              }}
            >
              {editingAll ? '\u7de8\u96c6\u3092\u9589\u3058\u308b' : '\u7de8\u96c6'}
            </button>
            <button type="button" onClick={() => {
              setRevealedMasks(new Set());
              setMaskActive(value => !value);
            }}>
              {maskActive ? '\u96a0\u3055\u306a\u3044' : '\u96a0\u3059'}
            </button>
            <button type="button" onClick={() => onUpdateLessonViewPublished?.(!lessonViewPublished)}>
              {lessonViewPublished ? '\u975e\u516c\u958b\u306b\u3059\u308b' : '\u516c\u958b\u3059\u308b'}
            </button>
          </div>
        )}
      </div>
      {activeSlide ? (() => {
        const { section, lessonSection, kundoku, isKanbun, sourceLineEntries, sourceLines, modernLines, kundokuLines, lineCount, start, end } = activeSlide;
        const editing = editingAll || editingSectionId === section.id;
        const sectionMaskRules = maskRules.filter(rule => rule.sectionId === section.id);
        const sectionCustomGrammarTargets = customGrammarTargets.filter(target => target.sectionId === section.id);
        const sectionHiddenGrammarTargetIds = [...hiddenGrammarTargetIds].filter(targetId => (lessonSection.targets ?? []).some(target => target.id === targetId));
        const visibleGrammarTargets = [
          ...(lessonSection.targets ?? [])
            .filter(target => LESSON_GRAMMAR_TYPES.has(target.type))
            .filter(target => !hiddenGrammarTargetIds.has(target.id)),
          ...sectionCustomGrammarTargets,
        ];
        const sectionTargetIds = new Set(visibleGrammarTargets.map(target => target.id));
        const sectionGrammarLabelOverrides = Object.fromEntries(
          Object.entries(grammarLabelOverrides).filter(([targetId]) => sectionTargetIds.has(targetId))
        );
        return (
          <article className="lesson-view-section" key={`${section.id}-${start}`}>
            {editing && (
              <LessonViewEditor
                section={lessonSection}
                kundoku={kundoku}
                lineCount={lineCount}
                maskRules={sectionMaskRules}
                grammarTargets={visibleGrammarTargets}
                customGrammarTargets={sectionCustomGrammarTargets}
                hiddenGrammarTargetIds={sectionHiddenGrammarTargetIds}
                grammarLabelOverrides={sectionGrammarLabelOverrides}
                onGrammarLabelOverrideChange={updateGrammarLabelOverride}
                onAddGrammarTarget={addGrammarTarget}
                onRemoveGrammarTarget={removeGrammarTarget}
                onAddMaskRule={addMaskRule}
                onRemoveMaskRule={removeMaskRule}
                onCancel={closeEditor}
                onSave={onUpdateLessonViewSection}
              />
            )}
            <div className="lesson-view-scroll">
              <div className="lesson-view-line-pairs">
                {Array.from({ length: end - start }).map((_, offset) => {
                  const index = start + offset;
                  const source = sourceLines[index] ?? (index === 0 ? String(lessonSection.text ?? '').trim() : '');
                  const sourceEntry = sourceLineEntries[index];
                  const grammarTargets = lessonGrammarEnabled && sourceEntry
                    ? visibleGrammarTargets
                        .filter(target => target.sectionId === section.id)
                        .filter(target => Number.isInteger(target.start) && target.start >= sourceEntry.start && target.start < sourceEntry.end)
                        .map(target => ({
                          ...target,
                          lessonGrammarLabelOverride: grammarLabelOverrides[target.id] ?? '',
                          lineStart: target.start - sourceEntry.start,
                          bubbleKey: `${section.id}-${index}-${target.id}`,
                        }))
                    : [];
                  const modern = modernLines.length > 1 ? modernLines[index] : (index === 0 ? String(lessonSection.modern ?? '').trim() : '');
                  const reading = kundokuLines[index] ?? '';
                  const modernKey = `${section.id}-${index}-modern`;
                  const kundokuKey = `${section.id}-${index}-kundoku`;
                  const lineHiddenWords = sectionMaskRules
                    .filter(rule => rule.sectionId === section.id && rule.lineIndex === index)
                    .map(rule => rule.word);
                  const activeHiddenWords = maskActive ? lineHiddenWords : [];
                  return (
                    <div className="lesson-view-pair" key={`${section.id}-${index}`}>
                      <LessonViewColumn
                        text={source}
                        kind="source"
                        columnKey={`${section.id}-${index}-source`}
                        hiddenWords={[]}
                        revealedMasks={revealedMasks}
                        onRevealMask={revealMask}
                        isKanbunSource={isKanbun}
                        grammarTargets={grammarTargets}
                        onGrammarTargetClick={toggleGrammarBubble}
                      />
                      {isKanbun && (
                        <LessonViewColumn
                          text={reading}
                          kind="kundoku"
                          columnKey={kundokuKey}
                          hiddenWords={[]}
                          revealedMasks={revealedMasks}
                          onRevealMask={revealMask}
                          framed
                          revealed={revealedColumns.has(kundokuKey)}
                          onToggle={() => toggleColumn(kundokuKey)}
                        />
                      )}
                      <LessonViewColumn
                        text={modern}
                        kind="modern"
                        columnKey={modernKey}
                        hiddenWords={activeHiddenWords}
                        revealedMasks={revealedMasks}
                        onRevealMask={revealMask}
                        framed
                        revealed={revealedColumns.has(modernKey)}
                        onToggle={() => toggleColumn(modernKey)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="lesson-view-grammar-bubbles" aria-live="polite">
              {grammarBubbles.map(bubble => (
                <div
                  key={bubble.key}
                  className={`lesson-view-grammar-bubble lesson-view-grammar-bubble--${bubble.align} lesson-view-grammar-bubble--${bubble.horizontal}`}
                  style={{
                    left: `${bubble.left}px`,
                    top: `${bubble.top}px`,
                    zIndex: bubble.zIndex,
                    fontSize: bubble.fontSize,
                  }}
                >
                  {bubble.text}
                </div>
              ))}
            </div>
          </article>
        );
      })() : null}
    </div>
  );
}

function AddSectionEditor({ onSave }) {
  const [adding, setAdding] = useState(false);

  const createSection = async (updates) => {
    const id = `custom-section-${Date.now()}`;
    await onSave?.({
      id,
      title: updates.title || '追加した段',
      text: '',
      kundoku: '',
      modern: '',
      notes: '',
      kanbunSyntax: '',
      kundokuQuestions: [],
      customSection: true,
    }, updates);
    setAdding(false);
  };

  if (!adding) {
    return (
      <div className="admin-add-section">
        <button type="button" onClick={() => setAdding(true)}>段を追加</button>
      </div>
    );
  }

  return (
    <div className="admin-add-section admin-add-section--editing">
      <div className="admin-add-section-title">段を追加</div>
      <SectionEditor
        section={{ title: '追加した段', text: '', kundoku: '', modern: '' }}
        kundoku=""
        allowTitle
        onCancel={() => setAdding(false)}
        onSave={createSection}
      />
    </div>
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

export default function VerticalTextViewer({ textId, notes, sections, selectedTarget, onSelectTarget, activeType, pinnedPhrase, selectionMode, selectionRange, onRangeSelect, showModern, isAdmin, onUpdateSection, lessonViewSections, lessonViewPublished, onUpdateLessonViewSection, onUpdateLessonViewPublished, onUpdateTarget, onRecord, onCreateTarget, onBackToSelect, onContactAdmin, isKanbunTextbook = false, correctKaeritenLines = {}, shareBoard = null, onViewModeChange }) {
  const [activeTab, setActiveTab] = useState('source');
  const visibleSections = sections.filter(section => !section.sectionless);
  const canViewLesson = isAdmin || lessonViewPublished;
  const visibleTab = activeTab === 'view' && !canViewLesson ? 'source' : activeTab;
  const sourceHeightScale = textId === 'gyofunori' ? 0.63 : 1;
  const compactKanbunSourceHeight = textId === 'mujun';
  const correctKaeritenLineKeys = useMemo(() => new Set(Object.keys(correctKaeritenLines).filter(key => correctKaeritenLines[key])), [correctKaeritenLines]);

  useEffect(() => {
    if (pinnedPhrase) setActiveTab('source');
  }, [pinnedPhrase]);

  useEffect(() => {
    onViewModeChange?.(visibleTab === 'view');
    return () => onViewModeChange?.(false);
  }, [onViewModeChange, visibleTab]);

  return (
    <div className="vertical-viewer">
      <div className="left-view-tabs" role="tablist" aria-label={'\u6559\u6750\u8868\u793a'}>
        <div className="left-tab-top-actions">
          <button type="button" className="left-tab-action" onClick={onBackToSelect}>{'\u6559\u6750\u3078'}</button>
        </div>
        <div className="left-tab-group">
          <button
            type="button"
            role="tab"
            aria-selected={visibleTab === 'source'}
            className={`left-tab-button${visibleTab === 'source' ? ' active' : ''}`}
            onClick={() => setActiveTab('source')}
          >
            {'\u6f14\u7fd2'}
          </button>
          {canViewLesson && (
            <button
              type="button"
              role="tab"
              aria-selected={visibleTab === 'view'}
              className={`left-tab-button${visibleTab === 'view' ? ' active' : ''}`}
              onClick={() => setActiveTab('view')}
            >
              {'\u6388\u696d'}
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={visibleTab === 'notes'}
            className={`left-tab-button${visibleTab === 'notes' ? ' active' : ''}`}
            onClick={() => setActiveTab('notes')}
          >
            {'\u5099\u8003'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={visibleTab === 'share'}
            className={`left-tab-button${visibleTab === 'share' ? ' active' : ''}`}
            onClick={() => setActiveTab('share')}
          >
            {'\u5206\u6790\u7814\u7a76'}
          </button>
        </div>
        <div className="left-tab-bottom-actions">
          <button type="button" className="left-tab-action" onClick={onContactAdmin}>{'\u9023\u7d61'}</button>
        </div>
      </div>
      <div className="left-view-body">
        {visibleTab === 'source' ? (
          <>
            {isAdmin && <AddSectionEditor onSave={onUpdateSection} />}
            {visibleSections.map((section) => (
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
            ))}
          </>
        ) : visibleTab === 'view' ? (
          <LessonViewMode
            textId={textId}
            sections={sections}
            lessonViewSections={lessonViewSections}
            lessonViewPublished={lessonViewPublished}
            isKanbunTextbook={isKanbunTextbook}
            isAdmin={isAdmin}
            onUpdateLessonViewSection={onUpdateLessonViewSection}
            onUpdateLessonViewPublished={onUpdateLessonViewPublished}
          />
        ) : visibleTab === 'notes' ? (
          <NotesTab textId={textId} notes={notes} sections={sections} isAdmin={isAdmin} onUpdateSection={onUpdateSection} />
        ) : (
          shareBoard ?? <p className="analysis-empty">{'\u5206\u6790\u7814\u7a76\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u3067\u3059\u3002'}</p>
        )}
      </div>
    </div>
  );
}
