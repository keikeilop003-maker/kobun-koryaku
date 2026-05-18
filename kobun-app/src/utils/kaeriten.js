const MARK_OPTIONS = ['', '一', '二', '三', 'レ', '一レ', '上', '下'];

export function kaeritenChars(surface) {
  return Array.from(surface ?? '').filter(char => /[\p{Script=Han}]/u.test(char));
}

export function normalizeKaeritenMark(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const normalized = text
    .replace(/[㆒一][㆑レ]/g, '一レ')
    .replace(/一レ点/g, '一レ')
    .replace(/レ点/g, 'レ')
    .replace(/一点/g, '一')
    .replace(/二点/g, '二')
    .replace(/三点/g, '三')
    .replace(/上点/g, '上')
    .replace(/下点/g, '下')
    .replace(/[1１]/g, '一')
    .replace(/[2２]/g, '二')
    .replace(/[3３]/g, '三')
    .replace(/[,\s、。・|/／]/g, '');
  return MARK_OPTIONS.includes(normalized) ? normalized : '';
}

export function emptyKaeritenAnswer(surface) {
  const chars = kaeritenChars(surface);
  return {
    version: 1,
    marks: chars.map(() => ''),
    furigana: chars.map(() => ''),
    okurigana: chars.map(() => ''),
    markY: chars.map(() => 0),
    furiganaY: chars.map(() => 0),
    okuriganaY: chars.map(() => 0),
    hyphens: [],
  };
}

export function parseKaeritenAnswer(value, surface = '') {
  if (value && typeof value === 'object') {
    return normalizeKaeritenAnswer(value, surface);
  }
  const text = String(value ?? '').trim();
  if (text.startsWith('{')) {
    try {
      return normalizeKaeritenAnswer(JSON.parse(text), surface);
    } catch {
      // Fall through to legacy handling.
    }
  }
  const chars = kaeritenChars(surface);
  const legacyMarks = text
    ? text.split(/[,\s、。・|/／]+/).filter(Boolean)
    : [];
  return normalizeKaeritenAnswer({
    marks: chars.map((_, index) => legacyMarks[index] ?? ''),
    hyphens: text.includes('-') ? legacyHyphenIndexes(text, chars.length) : [],
  }, surface);
}

function legacyHyphenIndexes(text, length) {
  const indexes = [];
  let seenMarks = 0;
  for (const char of Array.from(text)) {
    if (char === '-' && seenMarks > 0 && seenMarks < length) {
      indexes.push(seenMarks - 1);
    } else if (!/[\s,、。・|/／-]/.test(char)) {
      seenMarks += 1;
    }
  }
  return indexes;
}

export function normalizeKaeritenAnswer(answer, surface = '') {
  const chars = kaeritenChars(surface);
  const length = chars.length || answer?.marks?.length || 0;
  const marks = Array.from({ length }, (_, index) => normalizeKaeritenMark(answer?.marks?.[index] ?? ''));
  const furigana = Array.from({ length }, (_, index) => String(answer?.furigana?.[index] ?? ''));
  const okurigana = Array.from({ length }, (_, index) => String(answer?.okurigana?.[index] ?? ''));
  const markY = Array.from({ length }, (_, index) => Number(answer?.markY?.[index] ?? 0));
  const furiganaY = Array.from({ length }, (_, index) => Number(answer?.furiganaY?.[index] ?? 0));
  const okuriganaY = Array.from({ length }, (_, index) => Number(answer?.okuriganaY?.[index] ?? 0));
  const hyphens = [...new Set((answer?.hyphens ?? [])
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value >= 0 && value < Math.max(length - 1, 0)))]
    .sort((a, b) => a - b);
  return { version: 1, marks, furigana, okurigana, markY, furiganaY, okuriganaY, hyphens };
}

export function serializeKaeritenAnswer(answer, surface = '') {
  return JSON.stringify(normalizeKaeritenAnswer(answer, surface));
}

export function kaeritenAnswerKey(value, surface = '') {
  const answer = parseKaeritenAnswer(value, surface);
  return [
    answer.marks.join('|'),
    answer.hyphens.join(','),
  ].join('#');
}

export function needsHyphen(value, surface = '') {
  return parseKaeritenAnswer(value, surface).hyphens.length > 0;
}
