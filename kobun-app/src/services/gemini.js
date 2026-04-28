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
      comment: { type: 'string' },
      betterAnswer: { type: 'string' },
      contextPoint: { type: 'string' },
    },
    required: ['judgement', 'comment'],
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
  grammar: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
      grammaticalRole: { type: 'string' },
      translation: { type: 'string' },
      reason: { type: 'string' },
      comment: { type: 'string' },
    },
  },
  translation: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
      modelAnswer: { type: 'string' },
      missingPoints: { type: 'string' },
      incorrectParts: { type: 'string' },
      advice: { type: 'string' },
    },
  },
  content: {
    type: 'object',
    properties: {
      judgement: { type: 'string' },
      modelAnswer: { type: 'string' },
      missingPoints: { type: 'string' },
      advice: { type: 'string' },
    },
  },
};

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
        maxOutputTokens: 320,
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
  return base;
}

async function review(type, payload) {
  const key = `${type}|${JSON.stringify(payload)}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const r = (await callGemini(type, payload)) ?? mockResult(type);
    cacheSet(key, r);
    return r;
  } catch {
    return mockResult(type);
  }
}

export async function reviewVocab({ surface, sentence, userAnswer, correctAnswer, explanation }) {
  return review('vocab', {
    surface,
    ctx: contextWindow(sentence, surface),
    correctAnswer,
    explanation: clip(explanation, 80),
    userAnswer,
  });
}

export async function reviewAux({ surface, sentence, userAnswer, correctAnswer, explanation }) {
  return review('aux', {
    surface,
    ctx: contextWindow(sentence, surface),
    correctAnswer,
    explanation: clip(explanation, 80),
    userAnswer,
  });
}

export async function reviewVerb({ surface, sentence, userBaseForm, userConjugationType, userFormInText, target }) {
  return review('verb', {
    surface,
    ctx: contextWindow(sentence, surface),
    target: {
      baseForm: target.baseForm,
      conjugationType: target.conjugationType,
      formInText: target.formInText,
      explanation: clip(target.explanation, 80),
    },
    user: { baseForm: userBaseForm, conjugationType: userConjugationType, formInText: userFormInText },
  });
}

export async function reviewParticle({ surface, sentence, userAnswer, correctAnswer, explanation }) {
  return review('particle', {
    surface,
    ctx: contextWindow(sentence, surface),
    correctAnswer,
    explanation: clip(explanation, 80),
    userAnswer,
  });
}

export async function reviewGrammar({ surface, sentence, userAnswer, correctAnswer, explanation }) {
  return review('grammar', {
    surface,
    ctx: contextWindow(sentence, surface),
    correctAnswer,
    explanation: clip(explanation, 80),
    userAnswer,
  });
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
