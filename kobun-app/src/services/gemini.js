const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-lite';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const isMock = !API_KEY || API_KEY === 'your_gemini_api_key_here';

const SYSTEM_INSTRUCTION = `あなたは古文の教師。生徒解答を添削。
判定値は「正解」「部分正解」「不正解」のいずれか。
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
  translation: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
    },
    required: ['judgement'],
  },
  content: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
    },
    required: ['judgement'],
  },
};

// ===== Local comparison (no API) =====

export function localScore(userAnswer, correctAnswer) {
  return { judgement: localCompare(userAnswer, correctAnswer) };
}

function normalize(s) {
  if (!s) return '';
  return String(s).trim().replace(/[。．！？!?]+$/g, '').trim().replace(/[\s　]+/g, '');
}

function stripParens(s) {
  return String(s).replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
}

function normalizeConjugationType(s) {
  return String(s ?? '').replace(/活用$/g, '').trim();
}

function localCompare(userAnswer, correctAnswer) {
  const user = normalize(userAnswer);
  if (!user) return '不正解';
  const parts = String(correctAnswer).split(/[・、]/).map(p => p.trim()).filter(Boolean);
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
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
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
  return { judgement: localCompare(userAnswer, correctAnswer) };
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
  const judgement = localCompare(userAnswer, correctAnswer);
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
  const fj = localCompare(userFormInText, target.formInText);
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
  const judgement = localCompare(userAnswer, correctAnswer);
  return {
    judgement,
    correctUsage: correctAnswer,
    comment: judgement === '正解' ? '' : `正答：${correctAnswer}`,
  };
}

export async function reviewGrammar({ userAnswer, correctAnswer, acceptedAnswers, useAi = false }) {
  if (useAi) return review('grammar', { userAnswer, correctAnswer, acceptedAnswers });
  return { judgement: localCompare(userAnswer, correctAnswer) };
}

export async function reviewTranslation({ targetText, sentence, userAnswer, correctAnswer, explanation }) {
  return review('translation', {
    targetText,
    ctx: contextWindow(sentence, targetText, 30),
    correctAnswer,
    explanation: clip(explanation, 80),
    userAnswer,
  });
}

export async function reviewContent({ question, userAnswer, correctAnswer, explanation }) {
  return review('content', {
    question: clip(question, 120),
    correctAnswer,
    explanation: clip(explanation, 80),
    userAnswer,
  });
}
