import { kaeritenAnswerKey, parseKaeritenAnswer } from '../utils/kaeriten';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-lite';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const isMock = !API_KEY || API_KEY === 'your_gemini_api_key_here';

const SYSTEM_INSTRUCTION = `あなたは古文の教師。生徒解答を添削。
判定値は「正解」「部分正解」「不正解」のいずれか。
現代語訳では、助詞・語尾・同義表現の違いがあっても意味がほぼ同じなら「正解」とする。
「部分正解」「不正解」の場合は、判定理由を1〜3行で簡潔に示す。
コメントは100字以内。指定JSONスキーマのみ返す。前置き・コードフェンス禁止。`;

const SCHEMAS = {
  vocab: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
    },
    required: ['judgement'],
  },
  aux: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
      correctUsage: { type: 'string' },
      reason: { type: 'string' },
      comment: { type: 'string' },
    },
    required: ['judgement', 'comment'],
  },
  verb: {
    type: 'object',
    properties: {
      baseForm: {
        type: 'object',
        properties: {
          judgement: { type: 'string' },
          correctAnswer: { type: 'string' },
          comment: { type: 'string' },
        },
      },
      conjugationType: {
        type: 'object',
        properties: {
          judgement: { type: 'string' },
          correctAnswer: { type: 'string' },
          comment: { type: 'string' },
        },
      },
      formInText: {
        type: 'object',
        properties: {
          judgement: { type: 'string' },
          correctAnswer: { type: 'string' },
          comment: { type: 'string' },
        },
      },
      overallAdvice: { type: 'string' },
    },
  },
  particle: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
      correctUsage: { type: 'string' },
      translation: { type: 'string' },
      reason: { type: 'string' },
      comment: { type: 'string' },
    },
  },
  adj: {
    type: 'object',
    properties: {
      baseForm: {
        type: 'object',
        properties: {
          judgement: { type: 'string' },
          correctAnswer: { type: 'string' },
          comment: { type: 'string' },
        },
      },
      conjugationType: {
        type: 'object',
        properties: {
          judgement: { type: 'string' },
          correctAnswer: { type: 'string' },
          comment: { type: 'string' },
        },
      },
      formInText: {
        type: 'object',
        properties: {
          judgement: { type: 'string' },
          correctAnswer: { type: 'string' },
          comment: { type: 'string' },
        },
      },
      meaning: {
        type: 'object',
        properties: {
          judgement: { type: 'string' },
          correctAnswer: { type: 'string' },
          comment: { type: 'string' },
        },
      },
      overallAdvice: { type: 'string' },
    },
  },
  grammar: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
    },
    required: ['judgement'],
  },
  kaeriten: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
    },
    required: ['judgement'],
  },
  translation: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
      reason: { type: 'string' },
      comment: { type: 'string' },
    },
    required: ['judgement', 'reason'],
  },
  content: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
      reason: { type: 'string' },
      comment: { type: 'string' },
    },
    required: ['judgement', 'reason'],
  },
  shareCorrection: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
      comment: { type: 'string' },
    },
    required: ['judgement', 'comment'],
  },
};

// ===== Local comparison (no API) =====

export function localScore(userAnswer, correctAnswer) {
  return { judgement: localCompare(userAnswer, correctAnswer) };
}

function normalize(s) {
  if (!s) return '';
  return String(s).trim().replace(/[。．！？!?]+$/g, '').trim().replace(/[\s\u3000]+/g, '');
}

function stripParens(s) {
  return String(s).replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
}

function normalizeConjugationType(s) {
  return String(s ?? '').replace(/活用$/g, '').trim();
}

function normalizeConjugationForm(s) {
  return String(s ?? '').replace(/形$/g, '').trim();
}

function answerParts(answer) {
  return String(answer)
    .split(/[。．・、／/]/)
    .map(p => p.trim())
    .filter(Boolean);
}

function localCompare(userAnswer, correctAnswer, acceptedAnswers = []) {
  const user = normalize(userAnswer);
  if (!user) return '不正解';
  const candidates = [correctAnswer, ...(acceptedAnswers ?? [])].filter(Boolean);
  const parts = candidates.flatMap(answer => [String(answer), ...answerParts(answer)]);
  for (const p of parts) {
    if (normalize(p) === user || normalize(stripParens(p)) === user) return '正解';
  }
  for (const p of parts) {
    const n = normalize(p);
    const ns = normalize(stripParens(p));
    if (n.includes(user) || user.includes(n) || ns.includes(user) || user.includes(ns)) return '部分正解';
  }
  return '不正解';
}

function localCompareKaeriten(userAnswer, correctAnswer, acceptedAnswers = []) {
  const parsedUser = parseKaeritenAnswer(userAnswer);
  if (parsedUser.marks.every(mark => !mark) && parsedUser.hyphens.length === 0) return '不正解';
  const userKey = kaeritenAnswerKey(userAnswer);
  const candidates = [correctAnswer, ...(acceptedAnswers ?? [])].filter(Boolean);
  for (const answer of candidates) {
    if (kaeritenAnswerKey(answer) === userKey) return '正解';
  }
  return localCompare(userAnswer, correctAnswer, acceptedAnswers);
}

function canonicalTranslation(s) {
  return normalize(stripParens(s))
    .replace(/[「」『』（）()]/g, '')
    .replace(/ところ/g, '所')
    .replace(/場所/g, '所')
    .replace(/箇所/g, '所')
    .replace(/事/g, 'こと')
    .replace(/物/g, 'もの');
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      prev[j] = a[i - 1] === b[j - 1]
        ? diagonal
        : Math.min(prev[j - 1], prev[j], diagonal) + 1;
      diagonal = temp;
    }
  }
  return prev[b.length];
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - (editDistance(a, b) / max);
}

function localCompareTranslationLenient(userAnswer, correctAnswer, acceptedAnswers = []) {
  if (localCompare(userAnswer, correctAnswer, acceptedAnswers) === '正解') return '正解';
  const user = canonicalTranslation(userAnswer);
  if (!user) return '不正解';
  const candidates = [correctAnswer, ...(acceptedAnswers ?? [])].filter(Boolean);
  const parts = candidates.flatMap(answer => [String(answer), ...answerParts(answer)]);
  for (const p of parts) {
    const answer = canonicalTranslation(p);
    if (!answer) continue;
    if (answer === user) return '正解';
    const shorter = Math.min(answer.length, user.length);
    const longer = Math.max(answer.length, user.length);
    if (shorter >= 4 && longer > 0 && shorter / longer >= 0.8 && (answer.includes(user) || user.includes(answer))) return '正解';
    if (shorter >= 5 && similarity(answer, user) >= 0.82) return '正解';
  }
  return '不正解';
}

function localCompareConjugationForm(userAnswer, correctAnswer, acceptedAnswers = []) {
  const user = normalize(normalizeConjugationForm(userAnswer));
  if (!user) return '不正解';
  const candidates = [correctAnswer, ...(acceptedAnswers ?? [])].filter(Boolean);
  const parts = candidates.flatMap(answer => [String(answer), ...answerParts(answer)]);
  for (const p of parts) {
    const normalizedPart = normalize(p);
    const normalizedWithoutForm = normalize(normalizeConjugationForm(p));
    if (normalizedPart === user || normalizedWithoutForm === user) return '正解';
  }
  return localCompare(userAnswer, correctAnswer, acceptedAnswers);
}

// ======================================

function clip(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function contextWindow(sentence, surface, span = 20) {
  if (!sentence || !surface) return clip(sentence, span * 2);
  const i = sentence.indexOf(surface);
  if (i < 0) return clip(sentence, span * 2);
  const start = Math.max(0, i - span);
  const end = Math.min(sentence.length, i + surface.length + span);
  return (start > 0 ? '…' : '') + sentence.slice(start, end) + (end < sentence.length ? '…' : '');
}

const CACHE_KEY = 'gemini_review_cache_v1';
const cache = (() => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
})();
function cacheGet(k) { return cache[k]; }
function cacheSet(k, v) {
  cache[k] = v;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* noop */ }
}

async function callGemini(type, payload) {
  if (isMock) return null;
  const res = await fetch(`${API_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ parts: [{ text: `[type=${type}]\n${JSON.stringify(payload)}` }] }],
      generationConfig: {
        maxOutputTokens: 150,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: SCHEMAS[type],
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return JSON.parse(text);
}

function mockResult(type) {
  const base = { judgement: '（モック）要API設定', comment: 'Gemini APIキーを.envに設定すると実際の添削が利用できます。' };
  if (type === 'shareCorrection') {
    return {
      judgement: '（モック）要確認',
      comment: 'Gemini APIキーを.envに設定すると、共有投稿の一斉添削が利用できます。',
    };
  }
  if (type === 'verb') {
    return {
      baseForm: { judgement: '（モック）', correctAnswer: '—', comment: 'APIキーを設定してください。' },
      conjugationType: { judgement: '（モック）', correctAnswer: '—', comment: '' },
      formInText: { judgement: '（モック）', correctAnswer: '—', comment: '' },
      overallAdvice: 'Gemini APIキーを.envファイルに設定すると実際の添削が利用できます。',
    };
  }
  if (type === 'adj') {
    return {
      baseForm: { judgement: '（モック）', correctAnswer: '—', comment: 'APIキーを設定してください。' },
      conjugationType: { judgement: '（モック）', correctAnswer: '—', comment: '' },
      formInText: { judgement: '（モック）', correctAnswer: '—', comment: '' },
      meaning: { judgement: '（モック）', correctAnswer: '—', comment: '' },
      overallAdvice: 'Gemini APIキーを.envファイルに設定すると実際の添削が利用できます。',
    };
  }
  return base;
}

async function review(type, payload) {
  if (isMock) return mockResult(type);
  const key = `${type}|${JSON.stringify(payload)}`;
  const hit = cacheGet(key);
  if (hit && !String(hit.judgement ?? '').includes('モック')) return hit;
  try {
    const r = (await callGemini(type, payload)) ?? mockResult(type);
    cacheSet(key, r);
    return r;
  } catch {
    return mockResult(type);
  }
}

export async function reviewVocab({ userAnswer, correctAnswer, acceptedAnswers, useAi = false }) {
  if (useAi) return review('vocab', { userAnswer, correctAnswer, acceptedAnswers });
  return { judgement: localCompare(userAnswer, correctAnswer, acceptedAnswers) };
}

export async function reviewAux({ surface, sentence, userAnswer, correctAnswer, acceptedAnswers, explanation, useAi = false }) {
  if (useAi) {
    return review('aux', {
      surface,
      ctx: contextWindow(sentence, surface, 30),
      correctAnswer,
      acceptedAnswers,
      explanation: clip(explanation, 80),
      userAnswer,
    });
  }
  const judgement = localCompare(userAnswer, correctAnswer, acceptedAnswers);
  return {
    judgement,
    correctUsage: correctAnswer,
    comment: judgement === '正解' ? '' : `正答：${correctAnswer}`,
  };
}

export async function reviewVerb({ surface, sentence, userBaseForm, userConjugationType, userFormInText, target, useAi = false }) {
  if (useAi) {
    return review('verb', {
      surface,
      ctx: contextWindow(sentence, surface, 30),
      correctBaseForm: target.baseForm,
      correctConjugationType: target.conjugationType,
      correctFormInText: target.formInText,
      explanation: clip(target.explanation, 80),
      userBaseForm,
      userConjugationType,
      userFormInText,
    });
  }
  const bj = localCompare(userBaseForm, target.baseForm);
  const userConj = normalizeConjugationType(userConjugationType);
  const targetConj = normalizeConjugationType(target.conjugationType);
  const cj = localCompare(userConj, targetConj);
  const fj = localCompareConjugationForm(userFormInText, target.formInText);
  const allCorrect = bj === '正解' && cj === '正解' && fj === '正解';
  return {
    baseForm:       { judgement: bj, correctAnswer: target.baseForm,       comment: '' },
    conjugationType:{ judgement: cj, correctAnswer: target.conjugationType, comment: '' },
    formInText:     { judgement: fj, correctAnswer: target.formInText,      comment: '' },
    overallAdvice: allCorrect ? '全問正解！' : (target.explanation ?? ''),
  };
}

export async function reviewAdj({ surface, sentence, userBaseForm, userConjugationType, userFormInText, target, useAi = false }) {
  if (useAi) {
    return review('adj', {
      surface,
      ctx: contextWindow(sentence, surface, 30),
      correctBaseForm: target.baseForm,
      correctConjugationType: target.conjugationType,
      correctFormInText: target.formInText,
      explanation: clip(target.explanation, 80),
      userBaseForm,
      userConjugationType,
      userFormInText,
    });
  }
  const bj = localCompare(userBaseForm, target.baseForm);
  const cj = localCompare(normalizeConjugationType(userConjugationType), normalizeConjugationType(target.conjugationType));
  const fj = localCompare(userFormInText, target.formInText);
  const allCorrect = bj === '正解' && cj === '正解' && fj === '正解';
  return {
    baseForm:       { judgement: bj, correctAnswer: target.baseForm,       comment: '' },
    conjugationType:{ judgement: cj, correctAnswer: target.conjugationType, comment: '' },
    formInText:     { judgement: fj, correctAnswer: target.formInText,      comment: '' },
    overallAdvice: allCorrect ? '全問正解！' : (target.explanation ?? ''),
  };
}

export async function reviewParticle({ userAnswer, correctAnswer, acceptedAnswers, useAi = false }) {
  if (useAi) return review('particle', { userAnswer, correctAnswer, acceptedAnswers });
  const judgement = localCompare(userAnswer, correctAnswer, acceptedAnswers);
  return {
    judgement,
    correctUsage: correctAnswer,
    comment: judgement === '正解' ? '' : `正答：${correctAnswer}`,
  };
}

export async function reviewGrammar({ userAnswer, correctAnswer, acceptedAnswers, useAi = false }) {
  if (useAi) return review('grammar', { userAnswer, correctAnswer, acceptedAnswers });
  return { judgement: localCompare(userAnswer, correctAnswer, acceptedAnswers) };
}

export async function reviewKaeriten({ userAnswer, correctAnswer, acceptedAnswers, useAi = false }) {
  if (useAi) return review('kaeriten', { userAnswer, correctAnswer, acceptedAnswers });
  return { judgement: localCompareKaeriten(userAnswer, correctAnswer, acceptedAnswers) };
}

export async function reviewTranslation({ targetText, sentence, userAnswer, correctAnswer, acceptedAnswers, explanation }) {
  const payload = {
    targetText,
    ctx: contextWindow(sentence, targetText, 30),
    correctAnswer,
    acceptedAnswers,
    explanation: clip(explanation, 80),
    userAnswer,
  };
  const result = await review('translation', payload);
  if (result?.judgement !== '正解' && localCompareTranslationLenient(userAnswer, correctAnswer, acceptedAnswers) === '正解') {
    return { ...result, judgement: '正解', reason: '' };
  }
  return result;
}

export async function reviewContent({ question, userAnswer, correctAnswer, acceptedAnswers, explanation }) {
  return review('content', {
    question: clip(question, 120),
    correctAnswer,
    acceptedAnswers,
    explanation: clip(explanation, 80),
    userAnswer,
  });
}

export async function reviewSharePost({ themeTitle, themeDescription, modelAnswer, userAnswer }) {
  return review('shareCorrection', {
    themeTitle: clip(themeTitle, 120),
    themeDescription: clip(themeDescription, 240),
    modelAnswer: clip(modelAnswer, 600),
    userAnswer: clip(userAnswer, 600),
  });
}
