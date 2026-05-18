import { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import FeedbackCard from './FeedbackCard';
import AdminTargetForm from './AdminTargetForm';
import { reviewVocab, reviewAux, reviewVerb, reviewAdj, reviewParticle, reviewGrammar, reviewKaeriten } from '../services/gemini';
import { kaeritenChars, parseKaeritenAnswer, serializeKaeritenAnswer } from '../utils/kaeriten';

const TYPE_LABEL = {
  vocab:    '重要単語',
  aux:      '助動',
  verb:     '動',
  adj:      '形',
  particle: '助',
  grammar:  '文法・句法',
  kundoku:  '書き下し',
  kaeriten: '返り点',
};

const SCORE_TYPES = new Set(['aux', 'verb', 'adj', 'particle', 'vocab', 'grammar', 'kundoku', 'kaeriten']);
const ADMIN_ADD_TYPES = new Set(['aux', 'verb', 'adj', 'particle', 'vocab', 'grammar', 'kaeriten']);
const KAERITEN_MARK_OPTIONS = ['', '\u4e00', '\u4e8c', '\u4e09', '\u30ec', '\u4e00\u30ec', '\u4e0a', '\u4e0b'];
const KAERITEN_INSTRUCTION = '行を選択し、漢字を選択して返り点を付けてください。';

function isKaeritenChar(char) {
  return /^[\p{Script=Han}]$/u.test(char);
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

function targetOrder(section, target) {
  if (Number.isFinite(target.order)) return target.order;
  if (Number.isInteger(target.start)) return target.start;
  if (!target.surface) return Number.MAX_SAFE_INTEGER;
  const idx = section.text.indexOf(target.surface);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function parseKanbunSyntaxForQuestions(value) {
  if (value && typeof value === 'object') {
    return Array.isArray(value.items) ? value.items : [value];
  }
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed?.items) ? parsed.items : [parsed];
    } catch {
      return [];
    }
  }
  return [];
}

function kanbunSyntaxAnswer(item) {
  const usage = String(item?.usage ?? item?.function ?? '').trim();
  const translation = String(item?.translation ?? item?.meaning ?? '').trim();
  if (!usage && !translation) return '';
  if (usage && translation) return `用法：${usage}。訳し方：${translation}`;
  return usage || translation;
}

function syntaxAlternativeAnswers(item, keys) {
  return keys
    .flatMap(key => Array.isArray(item?.[key]) ? item[key] : [])
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

function syntaxQuestionsForSection(section) {
  const syntaxValue = section?.kanbunSyntax ?? section?.syntaxGuide ?? section?.syntax;
  return parseKanbunSyntaxForQuestions(syntaxValue)
    .map((item, itemIndex) => {
      const surface = String(item?.base ?? item?.text ?? '').trim();
      const answer = kanbunSyntaxAnswer(item);
      if (!surface) return null;
      const usage = String(item?.usage ?? item?.function ?? '').trim();
      const translation = String(item?.translation ?? item?.meaning ?? '').trim();
      const usageAlternativeAnswers = syntaxAlternativeAnswers(item, ['usageAlternativeAnswers', 'usageAlternatives', 'functionAlternativeAnswers', 'functionAlternatives']);
      const translationAlternativeAnswers = syntaxAlternativeAnswers(item, ['translationAlternativeAnswers', 'translationAlternatives', 'meaningAlternativeAnswers', 'meaningAlternatives']);
      return {
        target: {
          id: `kanbun-syntax-${section.id}-${itemIndex}`,
          syntaxIndex: itemIndex,
          type: 'grammar',
          surface,
          questionSurface: surface,
          questionText: `「${surface}」の用法と訳し方を答えなさい。`,
          answer,
          syntaxUsage: usage,
          syntaxTranslation: translation,
          usageAlternativeAnswers,
          translationAlternativeAnswers,
          alternativeAnswers: [
            usage && translation ? `${usage}。${translation}` : '',
            usage && translation ? `${usage} ${translation}` : '',
            ...usageAlternativeAnswers,
            ...translationAlternativeAnswers,
          ].filter(Boolean),
          explanation: answer ? '' : '用法・訳し方が未登録です。',
          gradingMode: 'local',
          generated: true,
          order: Number.MAX_SAFE_INTEGER - 1000 + itemIndex,
        },
        section,
      };
    })
    .filter(Boolean);
}

function sectionOrder(sections, section) {
  if (section?.sectionless) return Number.MAX_SAFE_INTEGER;
  const index = sections.findIndex(item => item.id === section?.id);
  return index === -1 ? Number.MAX_SAFE_INTEGER - 1 : index;
}

function inputCls(judgement, value) {
  if (!value?.trim() || !judgement) return '';
  if (judgement === '正解') return 'input-correct';
  if (judgement === '部分正解') return 'input-partial';
  return 'input-wrong';
}

function JudgeIcon({ judgement }) {
  if (!judgement) return <span className="judge-icon judge-empty" aria-hidden="true" />;
  if (judgement === '正解')   return <span className="judge-icon judge-correct">○</span>;
  if (judgement === '部分正解') return <span className="judge-icon judge-partial">△</span>;
  return <span className="judge-icon judge-wrong">✕</span>;
}

function boldTargets(surfaces, fallbackSurface) {
  const values = Array.isArray(surfaces) ? surfaces : [surfaces ?? fallbackSurface];
  return values
    .map((value) => {
      if (typeof value === 'string') return { text: value.trim(), occurrence: null };
      return {
        text: (value?.text ?? value?.surface ?? '').trim(),
        occurrence: Number.isInteger(value?.occurrence) && value.occurrence > 0 ? value.occurrence : null,
      };
    })
    .filter((value) => value.text)
    .sort((a, b) => b.text.length - a.text.length);
}

function HighlightQuestionText({ text, surface, surfaces }) {
  const targets = boldTargets(surfaces, surface);
  const seen = new Map();
  if (!text || targets.length === 0 || !targets.some(target => text.includes(target.text))) return <>{text}</>;
  const nodes = [];
  let buffer = '';
  let index = 0;
  while (index < text.length) {
    const matchedText = targets.find((item) => text.startsWith(item.text, index))?.text;
    if (matchedText) {
      const matchingTargets = targets.filter((item) => item.text === matchedText);
      const count = (seen.get(matchedText) ?? 0) + 1;
      seen.set(matchedText, count);
      if (buffer) {
        nodes.push(buffer);
        buffer = '';
      }
      if (matchingTargets.some((item) => !item.occurrence || item.occurrence === count)) {
        nodes.push(<span key={`bold-${index}`} className="question-surface">{matchedText}</span>);
      } else {
        nodes.push(matchedText);
      }
      index += matchedText.length;
    } else {
      buffer += text[index];
      index += 1;
    }
  }
  if (buffer) nodes.push(buffer);
  return <>{nodes}</>;
}

function QuestionHeader({ target }) {
  if (target.questionText) {
    return (
      <span className="question-header-text">
        <HighlightQuestionText
          text={target.questionText}
          surface={target.questionSurface ?? target.surface}
          surfaces={target.questionSurfaces}
        />
      </span>
    );
  }
  const surface = target.type === 'grammar' || target.type === 'kaeriten' || target.type === 'kundoku' ? (target.questionSurface ?? target.surface) : target.surface;
  const prefix = { aux: '助動詞', particle: '助詞' }[target.type] ?? '';
  const suffix = {
    vocab: 'の意味', aux: 'の用法', verb: 'の文法事項',
    adj: 'の文法事項',
    particle: target.particleQuestionType === 'usage' ? 'の用法' : 'の訳し方',
    grammar: 'の文法的な働きと訳し方',
    kundoku: 'を書き下す',
    kaeriten: 'に返り点を振る',
  }[target.type] ?? '';
  return (
    <span className="question-header-text">
      {prefix}<span className="question-surface">「{surface}」</span>{suffix}
    </span>
  );
}

function UndoDeleteNotice({ deletedTargetNotice, onUndoDelete }) {
  if (!deletedTargetNotice) return null;
  return (
    <div className="admin-undo-notice">
      <span>「{deletedTargetNotice.target?.surface ?? '問題'}」を削除しました。</span>
      <button type="button" onClick={onUndoDelete}>元に戻す</button>
    </div>
  );
}

function acceptedAnswers(target) {
  return [target.answer, ...(target.alternativeAnswers ?? [])].filter(Boolean);
}

// ── 重要単語 ─────────────────────────────────────────────────
const VocabForm = forwardRef(function VocabForm({ target, section, onResult, initialResult, onAdvance, initialInputs, onInputChange, onFocusTarget }, ref) {
  const [ans, setAns] = useState(initialInputs?.ans ?? '');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(initialInputs?.submitted ?? false);
  const [result, setResult] = useState(initialResult ?? null);
  const textareaRef = useRef(null);
  const btnRef = useRef(null);

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }));

  const submit = async () => {
    if (!ans.trim()) return;
    setLoading(true);
    const res = await reviewVocab({ userAnswer: ans, correctAnswer: target.answer, acceptedAnswers: acceptedAnswers(target), useAi: target.gradingMode === 'ai' });
    setLoading(false);
    setSubmitted(true);
    setResult(res);
    onInputChange?.({ ans, submitted: true });
    onResult(res);
  };
  const handleTextareaKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnRef.current?.focus(); }
  };
  const handleBtnKeyDown = e => {
    if (e.key === 'Enter' && submitted) { e.preventDefault(); onAdvance?.(); }
  };
  return (
    <div className="form-group" onFocus={() => onFocusTarget?.()}>
      <div className="form-textarea-row">
        <textarea ref={textareaRef} value={ans} onChange={e => { const v = e.target.value; setAns(v); onInputChange?.({ ans: v, submitted }); }} onKeyDown={handleTextareaKeyDown} rows={3} />
        <button ref={btnRef} onClick={submit} disabled={loading} onKeyDown={handleBtnKeyDown}>{loading ? '採点中…' : '採点'}</button>
      </div>
      {submitted && (
        <>
          <div className="judge-row-standalone">
            <JudgeIcon judgement={result?.judgement} />
            {result?.judgement && <span className="judgement-text">{result.judgement}</span>}
          </div>
          <div className="hint">模範解答：<em>{target.answer}</em></div>
          {target.explanation && <div className="explanation">{target.explanation}</div>}
        </>
      )}
    </div>
  );
});

// ── 助動詞（Enter自動採点） ───────────────────────────────────
const AuxForm = forwardRef(function AuxForm({ target, section, onResult, initialResult, onAdvance, initialInputs, onInputChange, onFocusTarget }, ref) {
  const [ans, setAns] = useState(initialInputs?.ans ?? '');
  const ansRef = useRef(initialInputs?.ans ?? '');
  const inputRef = useRef(null);
  const [result, setResult] = useState(initialResult ?? null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  const score = useCallback(async () => {
    const v = ansRef.current;
    if (!v.trim()) return;
    const res = await reviewAux({ surface: target.surface, sentence: section.text, userAnswer: v, correctAnswer: target.answer, acceptedAnswers: acceptedAnswers(target), explanation: target.explanation, useAi: target.gradingMode === 'ai' });
    setResult(res);
    onResult(res);
  }, [target, section, onResult]);

  const handleKeyDown = e => {
    if (e.key === 'Enter') { e.preventDefault(); score(); onAdvance?.(); }
  };

  return (
    <div className="form-group" onFocus={() => onFocusTarget?.()}>
      <div className="form-inline-row">
        <input
          ref={inputRef}
          value={ans}
          onChange={e => { const v = e.target.value; setAns(v); ansRef.current = v; setResult(null); onInputChange?.({ ans: v }); }}
          onKeyDown={handleKeyDown}
          className={inputCls(result?.judgement, ans)}
          placeholder=""
        />
        <JudgeIcon judgement={ans.trim() ? result?.judgement : null} />
      </div>
    </div>
  );
});

// ── 動詞（Enter自動採点） ────────────────────────────────────
const VerbForm = forwardRef(function VerbForm({ target, section, onResult, initialResult, onAdvance, initialInputs, onInputChange, onFocusTarget }, ref) {
  const [base, setBase] = useState(initialInputs?.base ?? '');
  const [conj, setConj] = useState(initialInputs?.conj ?? '');
  const [form, setForm] = useState(initialInputs?.form ?? '');
  const baseRef = useRef(initialInputs?.base ?? '');
  const conjRef = useRef(initialInputs?.conj ?? '');
  const formRef = useRef(initialInputs?.form ?? '');
  const baseInputRef = useRef(null);
  const conjInputRef = useRef(null);
  const formInputRef = useRef(null);
  const [baseResult, setBaseResult] = useState(initialResult?.baseForm ?? null);
  const [conjResult, setConjResult] = useState(initialResult?.conjugationType ?? null);
  const [formResult, setFormResult] = useState(initialResult?.formInText ?? null);

  useImperativeHandle(ref, () => ({ focus: () => baseInputRef.current?.focus() }));

  const score = useCallback(async () => {
    const b = baseRef.current, c = conjRef.current, f = formRef.current;
    if (!b && !c && !f) return;
    const res = await reviewVerb({ surface: target.surface, sentence: section.text, userBaseForm: b, userConjugationType: c, userFormInText: f, target, useAi: target.gradingMode === 'ai' });
    setBaseResult(res.baseForm);
    setConjResult(res.conjugationType);
    setFormResult(res.formInText);
    if (b.trim() && c.trim() && f.trim()) onResult(res);
  }, [target, section, onResult]);

  const handleKeyDown = (e, nextRef, isLast) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      score();
      if (nextRef) { nextRef.current?.focus(); }
      else if (isLast) { onAdvance?.(); }
    }
  };

  return (
    <div className="form-group" onFocus={() => onFocusTarget?.()}>
      <div className="verb-fields">
        <div className="field-row">
          <span>基本形</span>
          <input ref={baseInputRef} value={base}
            onChange={e => { const v = e.target.value; setBase(v); baseRef.current = v; setBaseResult(null); onInputChange?.({ base: v, conj: conjRef.current, form: formRef.current }); }}
            onKeyDown={e => handleKeyDown(e, conjInputRef, false)}
            className={inputCls(baseResult?.judgement, base)}
            placeholder="" />
          <JudgeIcon judgement={base.trim() ? baseResult?.judgement : null} />
        </div>
        <div className="field-row">
          <span>活用の行と種類</span>
          <input ref={conjInputRef} value={conj}
            onChange={e => { const v = e.target.value; setConj(v); conjRef.current = v; setConjResult(null); onInputChange?.({ base: baseRef.current, conj: v, form: formRef.current }); }}
            onKeyDown={e => handleKeyDown(e, formInputRef, false)}
            className={inputCls(conjResult?.judgement, conj)}
            placeholder="" />
          <JudgeIcon judgement={conj.trim() ? conjResult?.judgement : null} />
        </div>
        <div className="field-row">
          <span>文中の活用形</span>
          <input ref={formInputRef} value={form}
            onChange={e => { const v = e.target.value; setForm(v); formRef.current = v; setFormResult(null); onInputChange?.({ base: baseRef.current, conj: conjRef.current, form: v }); }}
            onKeyDown={e => handleKeyDown(e, null, true)}
            className={inputCls(formResult?.judgement, form)}
            placeholder="" />
          <JudgeIcon judgement={form.trim() ? formResult?.judgement : null} />
        </div>
      </div>
    </div>
  );
});

// ── 形容詞（Enter自動採点） ──────────────────────────────────
const AdjForm = forwardRef(function AdjForm({ target, section, onResult, initialResult, onAdvance, initialInputs, onInputChange, onFocusTarget }, ref) {
  const [base, setBase] = useState(initialInputs?.base ?? '');
  const [conj, setConj] = useState(initialInputs?.conj ?? '');
  const [form, setForm] = useState(initialInputs?.form ?? '');
  const baseRef = useRef(initialInputs?.base ?? '');
  const conjRef = useRef(initialInputs?.conj ?? '');
  const formRef = useRef(initialInputs?.form ?? '');
  const baseInputRef = useRef(null);
  const conjInputRef = useRef(null);
  const formInputRef = useRef(null);
  const [baseResult, setBaseResult] = useState(initialResult?.baseForm ?? null);
  const [conjResult, setConjResult] = useState(initialResult?.conjugationType ?? null);
  const [formResult, setFormResult] = useState(initialResult?.formInText ?? null);

  useImperativeHandle(ref, () => ({ focus: () => baseInputRef.current?.focus() }));

  const score = useCallback(async () => {
    const b = baseRef.current, c = conjRef.current, f = formRef.current;
    if (!b && !c && !f) return;
    const res = await reviewAdj({ surface: target.surface, sentence: section.text, userBaseForm: b, userConjugationType: c, userFormInText: f, target, useAi: target.gradingMode === 'ai' });
    setBaseResult(res.baseForm);
    setConjResult(res.conjugationType);
    setFormResult(res.formInText);
    if (b.trim() && c.trim() && f.trim()) onResult(res);
  }, [target, section, onResult]);

  const handleKeyDown = (e, nextRef, isLast) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      score();
      if (nextRef) { nextRef.current?.focus(); }
      else if (isLast) { onAdvance?.(); }
    }
  };

  return (
    <div className="form-group" onFocus={() => onFocusTarget?.()}>
      <div className="verb-fields">
        <div className="field-row">
          <span>基本形（終止形）</span>
          <input ref={baseInputRef} value={base}
            onChange={e => { const v = e.target.value; setBase(v); baseRef.current = v; setBaseResult(null); onInputChange?.({ base: v, conj: conjRef.current, form: formRef.current }); }}
            onKeyDown={e => handleKeyDown(e, conjInputRef, false)}
            className={inputCls(baseResult?.judgement, base)}
            placeholder="" />
          <JudgeIcon judgement={base.trim() ? baseResult?.judgement : null} />
        </div>
        <div className="field-row">
          <span>活用の種類</span>
          <input ref={conjInputRef} value={conj}
            onChange={e => { const v = e.target.value; setConj(v); conjRef.current = v; setConjResult(null); onInputChange?.({ base: baseRef.current, conj: v, form: formRef.current }); }}
            onKeyDown={e => handleKeyDown(e, formInputRef, false)}
            className={inputCls(conjResult?.judgement, conj)}
            placeholder="" />
          <JudgeIcon judgement={conj.trim() ? conjResult?.judgement : null} />
        </div>
        <div className="field-row">
          <span>文中の活用形</span>
          <input ref={formInputRef} value={form}
            onChange={e => { const v = e.target.value; setForm(v); formRef.current = v; setFormResult(null); onInputChange?.({ base: baseRef.current, conj: conjRef.current, form: v }); }}
            onKeyDown={e => handleKeyDown(e, null, true)}
            className={inputCls(formResult?.judgement, form)}
            placeholder="" />
          <JudgeIcon judgement={form.trim() ? formResult?.judgement : null} />
        </div>
      </div>
    </div>
  );
});

// ── 助詞 ─────────────────────────────────────────────────────
const ParticleForm = forwardRef(function ParticleForm({ target, section, onResult, initialResult, onAdvance, initialInputs, onInputChange, onFocusTarget }, ref) {
  const [ans, setAns] = useState(initialInputs?.ans ?? '');
  const ansRef = useRef(initialInputs?.ans ?? '');
  const inputRef = useRef(null);
  const [result, setResult] = useState(initialResult ?? null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  const score = useCallback(async () => {
    const v = ansRef.current;
    if (!v.trim()) return;
    const res = await reviewParticle({ userAnswer: v, correctAnswer: target.answer, acceptedAnswers: acceptedAnswers(target), useAi: target.gradingMode === 'ai' });
    setResult(res);
    onResult(res);
  }, [target, onResult]);

  const handleKeyDown = e => {
    if (e.key === 'Enter') { e.preventDefault(); score(); onAdvance?.(); }
  };

  return (
    <div className="form-group" onFocus={() => onFocusTarget?.()}>
      <div className="form-inline-row">
        <input
          ref={inputRef}
          value={ans}
          onChange={e => { const v = e.target.value; setAns(v); ansRef.current = v; setResult(null); onInputChange?.({ ans: v }); }}
          onKeyDown={handleKeyDown}
          className={inputCls(result?.judgement, ans)}
          placeholder=""
        />
        <JudgeIcon judgement={ans.trim() ? result?.judgement : null} />
      </div>
    </div>
  );
});

// ── 文法・句法 ───────────────────────────────────────────────
const GrammarForm = forwardRef(function GrammarForm({ target, section, onResult, initialResult, onAdvance, initialInputs, onInputChange, onFocusTarget }, ref) {
  const [ans, setAns] = useState(initialInputs?.ans ?? '');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(initialInputs?.submitted ?? false);
  const [result, setResult] = useState(initialResult ?? null);
  const textareaRef = useRef(null);
  const btnRef = useRef(null);

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }));

  const submit = async () => {
    if (!ans.trim()) return;
    setLoading(true);
    const res = await reviewGrammar({ surface: target.surface, sentence: section.text, userAnswer: ans, correctAnswer: target.answer, acceptedAnswers: acceptedAnswers(target), explanation: target.explanation, useAi: target.gradingMode === 'ai' });
    setLoading(false);
    setSubmitted(true);
    setResult(res);
    onInputChange?.({ ans, submitted: true });
    onResult(res);
  };
  const handleTextareaKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnRef.current?.focus(); }
  };
  const handleBtnKeyDown = e => {
    if (e.key === 'Enter' && submitted) { e.preventDefault(); onAdvance?.(); }
  };
  return (
    <div className="form-group" onFocus={() => onFocusTarget?.()}>
      <div className="form-textarea-row">
        <textarea ref={textareaRef} value={ans} onChange={e => { const v = e.target.value; setAns(v); onInputChange?.({ ans: v, submitted }); }} onKeyDown={handleTextareaKeyDown} rows={3} />
        <button ref={btnRef} onClick={submit} disabled={loading} onKeyDown={handleBtnKeyDown}>{loading ? '採点中…' : '採点'}</button>
      </div>
      {submitted && (
        <>
          <div className="judge-row-standalone">
            <JudgeIcon judgement={result?.judgement} />
            {result?.judgement && <span className="judgement-text">{result.judgement}</span>}
          </div>
          <div className="hint">模範解答：<em>{target.answer}</em></div>
          {target.explanation && <div className="explanation">{target.explanation}</div>}
        </>
      )}
    </div>
  );
});

// ── 返り点 ───────────────────────────────────────────────
const KaeritenForm = forwardRef(function KaeritenForm({ target, section, onResult, initialResult, onAdvance, initialInputs, onInputChange, onFocusTarget }, ref) {
  const surfaceText = target.surface || target.questionSurface || '';
  const displayChars = Array.from(surfaceText);
  const chars = kaeritenChars(surfaceText);
  const initialAnswer = parseKaeritenAnswer(initialInputs?.ans, target.surface);
  const [marks, setMarks] = useState(() => chars.map((_, index) => initialAnswer.marks[index] ?? ''));
  const [hyphens, setHyphens] = useState(() => new Set(initialAnswer.hyphens));
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [submitted, setSubmitted] = useState(initialInputs?.submitted ?? false);
  const [result, setResult] = useState(initialResult ?? null);
  const btnRef = useRef(null);

  useImperativeHandle(ref, () => ({ focus: () => btnRef.current?.focus() }));

  const currentAnswer = (nextMarks = marks, nextHyphens = hyphens) => serializeKaeritenAnswer({
    marks: nextMarks,
    hyphens: [...nextHyphens],
  }, target.surface);

  const updateMark = (index, value) => {
    const next = marks.map((item, itemIndex) => itemIndex === index ? value : item);
    setMarks(next);
    setSelectedIndex(null);
    setResult(null);
    onInputChange?.({ ans: currentAnswer(next, hyphens), submitted });
  };

  const chooseHyphen = (index) => {
    if (index >= chars.length - 1) return;
    const next = new Set(hyphens);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setHyphens(next);
    setSelectedIndex(null);
    setResult(null);
    onInputChange?.({ ans: currentAnswer(marks, next), submitted });
  };

  const submit = async () => {
    const userAnswer = currentAnswer();
    const res = await reviewKaeriten({
      userAnswer,
      correctAnswer: target.answer,
      acceptedAnswers: acceptedAnswers(target),
    });
    setSubmitted(true);
    setResult(res);
    onInputChange?.({ ans: userAnswer, submitted: true });
    onResult(res);
  };
  const handleBtnKeyDown = e => {
    if (e.key === 'Enter' && submitted) { e.preventDefault(); onAdvance?.(); }
  };

  return (
    <div className="form-group kaeriten-line-form" onFocus={() => onFocusTarget?.()}>
      <div className="kaeriten-line-stage source-text-pane">
        <div className="kaeriten-line-display">
          <InstructionLane />
          <div className="vertical-text vertical-text--kaeriten-source vertical-text--kanbun kaeriten-line-source">
            {(() => {
              let hanIndex = -1;
              return displayChars.map((char, sourceIndex) => {
              if (!isKaeritenChar(char)) return <span className="kaeriten-source-char" key={sourceIndex}>{char}</span>;
              hanIndex += 1;
              const currentIndex = hanIndex;
              const hasVisibleMark = Boolean(marks[currentIndex]);
              const hasVisibleHyphen = hyphens.has(currentIndex);
              const isSelectedChar = selectedIndex === currentIndex;
              const needsAnnotationSpace = isSelectedChar || hasVisibleMark || hasVisibleHyphen;
              const choicePosition = currentIndex < chars.length / 3
                ? 'near-start'
                : currentIndex > (chars.length * 2) / 3 ? 'near-end' : 'middle';
              return (
              <span className={`kaeriten-source-group kaeriten-source-group--selectable${hasVisibleHyphen ? ' kaeriten-source-group--has-hyphen-after' : ''}`} key={char + '-' + sourceIndex}>
                <span className={`kaeriten-source-unit${needsAnnotationSpace ? ' kaeriten-source-unit--annotated' : ''}`}>
                <button
                  type="button"
                  className={'kaeriten-source-char kaeriten-source-char-button' + (isSelectedChar ? ' active' : '')}
                  onClick={() => setSelectedIndex(currentIndex)}
                >
                  {char}
                </button>
                {isSelectedChar ? (
                  <span className={`kaeriten-mark-choice-list kaeriten-mark-choice-list--${choicePosition}`} role="listbox" aria-label={char + '\u306e\u8fd4\u308a\u70b9'}>
                    {KAERITEN_MARK_OPTIONS.map(option => (
                      <button
                        type="button"
                        key={option || 'blank'}
                        className={'kaeriten-mark-choice' + ((marks[currentIndex] ?? '') === option ? ' active' : '')}
                        onClick={() => updateMark(currentIndex, option)}
                        role="option"
                        aria-selected={(marks[currentIndex] ?? '') === option}
                      >
                        {option || 'なし'}
                      </button>
                    ))}
                    {currentIndex < chars.length - 1 && (
                      <button
                        type="button"
                        className={'kaeriten-mark-choice kaeriten-mark-choice--hyphen' + (hasVisibleHyphen ? ' active' : '')}
                        onClick={() => chooseHyphen(currentIndex)}
                        role="option"
                        aria-selected={hasVisibleHyphen}
                      >
                        -
                      </button>
                    )}
                  </span>
                ) : (
                  hasVisibleMark && <span className="kaeriten-source-input kaeriten-source-mark-display"><KaeritenMarkDisplay mark={marks[currentIndex]} /></span>
                )}
                {currentIndex < chars.length - 1 && (
                  hasVisibleHyphen && <span className="kaeriten-source-hyphen active">-</span>
                )}
                </span>
              </span>
              );
            });
            })()}
          </div>
          {target.kundokuLine && (
            <div className="kundoku-vertical-text kundoku-vertical-text--kanbun kaeriten-line-kundoku">
              {target.kundokuLine}
            </div>
          )}
        </div>
      </div>
      <div className="kaeriten-line-controls">
        <button ref={btnRef} onClick={submit} onKeyDown={handleBtnKeyDown}>{'\u63a1\u70b9'}</button>
      </div>
      {submitted && (
        <>
          <div className="judge-row-standalone">
            <JudgeIcon judgement={result?.judgement} />
            {result?.judgement && <span className="judgement-text">{result.judgement}</span>}
          </div>
          {target.explanation && <div className="explanation">{target.explanation}</div>}
        </>
      )}
    </div>
  );
});

const KundokuForm = forwardRef(function KundokuForm({ target, section, onResult, initialResult, onAdvance, initialInputs, onInputChange, onFocusTarget }, ref) {
  const [answer, setAnswer] = useState(initialInputs?.answer ?? '');
  const [submitted, setSubmitted] = useState(initialInputs?.submitted ?? false);
  const [result, setResult] = useState(initialResult ?? null);
  const textareaRef = useRef(null);
  const btnRef = useRef(null);
  const candidateChars = [...new Set(Array.from(target.surface ?? '').filter(char => /^[\p{Script=Han}]$/u.test(char)))];

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }));

  const insertChar = (char) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? answer.length;
    const end = textarea?.selectionEnd ?? answer.length;
    const next = answer.slice(0, start) + char + answer.slice(end);
    setAnswer(next);
    setResult(null);
    onInputChange?.({ answer: next, submitted });
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start + char.length, start + char.length);
    }, 0);
  };

  const submit = async () => {
    if (!answer.trim()) return;
    const res = await reviewGrammar({
      surface: target.surface,
      sentence: section.text,
      userAnswer: answer,
      correctAnswer: target.answer,
      acceptedAnswers: target.alternativeAnswers ?? [],
      useAi: false,
    });
    setSubmitted(true);
    setResult(res);
    onInputChange?.({ answer, submitted: true });
    onResult(res);
  };

  const handleTextareaKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnRef.current?.focus(); }
  };
  const handleBtnKeyDown = e => {
    if (e.key === 'Enter' && submitted) { e.preventDefault(); onAdvance?.(); }
  };

  return (
    <div className="form-group kundoku-practice-form" onFocus={() => onFocusTarget?.()}>
      <div className="kundoku-form-instruction">漢字候補を使いながら書き下し文を入力してください。</div>
      <div className="kundoku-candidate-row" aria-label="原文の漢字候補">
        {candidateChars.map((char, index) => (
          <button type="button" key={`${char}-${index}`} onClick={() => insertChar(char)}>{char}</button>
        ))}
      </div>
      <div className="kundoku-answer-row">
        <textarea
          ref={textareaRef}
          className={inputCls(result?.judgement, answer)}
          value={answer}
          onChange={e => { const value = e.target.value; setAnswer(value); setResult(null); onInputChange?.({ answer: value, submitted }); }}
          onKeyDown={handleTextareaKeyDown}
          rows={8}
        />
        <button ref={btnRef} onClick={submit} onKeyDown={handleBtnKeyDown}>採点</button>
      </div>
      {submitted && (
        <>
          <div className="judge-row-standalone">
            <JudgeIcon judgement={result?.judgement} />
            {result?.judgement && <span className="judgement-text">{result.judgement}</span>}
          </div>
          <div className="hint">模範解答：<em>{target.answer}</em></div>
        </>
      )}
    </div>
  );
});

const SyntaxGrammarForm = forwardRef(function SyntaxGrammarForm({ target, section, onResult, initialResult, onAdvance, initialInputs, onInputChange, onFocusTarget }, ref) {
  const [usage, setUsage] = useState(initialInputs?.usage ?? '');
  const [translation, setTranslation] = useState(initialInputs?.translation ?? '');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(initialInputs?.submitted ?? false);
  const [result, setResult] = useState(initialResult ?? null);
  const usageRef = useRef(null);
  const translationRef = useRef(null);
  const btnRef = useRef(null);

  useImperativeHandle(ref, () => ({ focus: () => usageRef.current?.focus() }));

  const submit = async () => {
    if (!usage.trim() && !translation.trim()) return;
    setLoading(true);
    const expectedUsage = target.syntaxUsage ?? '';
    const expectedTranslation = target.syntaxTranslation ?? '';
    const [usageResult, translationResult] = await Promise.all([
      expectedUsage.trim()
        ? reviewGrammar({ surface: target.surface, sentence: section.text, userAnswer: usage, correctAnswer: expectedUsage, acceptedAnswers: target.usageAlternativeAnswers ?? [], useAi: false })
        : Promise.resolve({ judgement: usage.trim() ? '不正解' : '正解' }),
      expectedTranslation.trim()
        ? reviewGrammar({ surface: target.surface, sentence: section.text, userAnswer: translation, correctAnswer: expectedTranslation, acceptedAnswers: target.translationAlternativeAnswers ?? [], useAi: false })
        : Promise.resolve({ judgement: translation.trim() ? '不正解' : '正解' }),
    ]);
    const judgements = [usageResult.judgement, translationResult.judgement];
    const judgement = judgements.every(item => item === '正解')
      ? '正解'
      : judgements.some(item => item === '正解' || item === '部分正解') ? '部分正解' : '不正解';
    const nextResult = {
      judgement,
      usage: usageResult,
      translation: translationResult,
    };
    setLoading(false);
    setSubmitted(true);
    setResult(nextResult);
    onInputChange?.({ usage, translation, submitted: true });
    onResult(nextResult);
  };

  const handleUsageKeyDown = e => {
    if (e.key === 'Enter') { e.preventDefault(); translationRef.current?.focus(); }
  };
  const handleTranslationKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnRef.current?.focus(); }
  };
  const handleBtnKeyDown = e => {
    if (e.key === 'Enter' && submitted) { e.preventDefault(); onAdvance?.(); }
  };

  return (
    <div className="form-group" onFocus={() => onFocusTarget?.()}>
      <div className="syntax-answer-form">
        <label>
          {'用法'}
          <input
            ref={usageRef}
            value={usage}
            onChange={e => { const value = e.target.value; setUsage(value); setResult(null); onInputChange?.({ usage: value, translation, submitted }); }}
            onKeyDown={handleUsageKeyDown}
            className={inputCls(result?.usage?.judgement, usage)}
          />
        </label>
        <label>
          {'訳し方'}
          <input
            ref={translationRef}
            value={translation}
            onChange={e => { const value = e.target.value; setTranslation(value); setResult(null); onInputChange?.({ usage, translation: value, submitted }); }}
            onKeyDown={handleTranslationKeyDown}
            className={inputCls(result?.translation?.judgement, translation)}
          />
        </label>
        <button ref={btnRef} onClick={submit} disabled={loading} onKeyDown={handleBtnKeyDown}>{loading ? '採点中…' : '採点'}</button>
      </div>
      {submitted && (
        <>
          <div className="judge-row-standalone">
            <JudgeIcon judgement={result?.judgement} />
            {result?.judgement && <span className="judgement-text">{result.judgement}</span>}
          </div>
          <div className="hint">模範解答：<em>{target.answer || '用法・訳し方が未登録です。'}</em></div>
          {target.explanation && <div className="explanation">{target.explanation}</div>}
        </>
      )}
    </div>
  );
});

function InstructionLane() {
  return (
    <aside className="kaeriten-instruction-lane" aria-label="返り点演習の指示">
      <div className="kaeriten-practice-instruction">
        {KAERITEN_INSTRUCTION}
      </div>
    </aside>
  );
}

const SyntaxAnswerEditor = forwardRef(function SyntaxAnswerEditor({ target, section, onUpdateSection, onCancel }, ref) {
  const [usage, setUsage] = useState(target.syntaxUsage ?? '');
  const [translation, setTranslation] = useState(target.syntaxTranslation ?? '');
  const [usageAlternativeAnswers, setUsageAlternativeAnswers] = useState([...(target.usageAlternativeAnswers ?? []), '', '', '', '', ''].slice(0, 5));
  const [translationAlternativeAnswers, setTranslationAlternativeAnswers] = useState([...(target.translationAlternativeAnswers ?? []), '', '', '', '', ''].slice(0, 5));
  const [saving, setSaving] = useState(false);
  const usageRef = useRef(null);

  useImperativeHandle(ref, () => ({ focus: () => usageRef.current?.focus() }));

  const updateUsageAlternative = (index, value) => {
    setUsageAlternativeAnswers(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
  };

  const updateTranslationAlternative = (index, value) => {
    setTranslationAlternativeAnswers(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const currentValue = section?.kanbunSyntax ?? section?.syntaxGuide ?? section?.syntax ?? '';
      const items = parseKanbunSyntaxForQuestions(currentValue);
      const index = Number.isInteger(target.syntaxIndex) ? target.syntaxIndex : -1;
      const nextUsageAlternatives = usageAlternativeAnswers.map(item => item.trim()).filter(Boolean).slice(0, 5);
      const nextTranslationAlternatives = translationAlternativeAnswers.map(item => item.trim()).filter(Boolean).slice(0, 5);
      const nextItems = items.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        usage,
        translation,
        usageAlternativeAnswers: nextUsageAlternatives,
        translationAlternativeAnswers: nextTranslationAlternatives,
      } : item);
      await onUpdateSection?.(section, { kanbunSyntax: JSON.stringify({ version: 2, items: nextItems }) });
      onCancel?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="syntax-answer-editor">
      <label>
        {'用法'}
        <input ref={usageRef} value={usage} onChange={(event) => setUsage(event.target.value)} />
      </label>
      <label>
        {'訳し方'}
        <input value={translation} onChange={(event) => setTranslation(event.target.value)} />
      </label>
      <fieldset>
        <legend>{'用法の別解'}</legend>
        {usageAlternativeAnswers.map((value, index) => (
          <input
            key={'usage-alt-' + index}
            value={value}
            onChange={(event) => updateUsageAlternative(index, event.target.value)}
            placeholder={`別解${index + 1}`}
          />
        ))}
      </fieldset>
      <fieldset>
        <legend>{'訳し方の別解'}</legend>
        {translationAlternativeAnswers.map((value, index) => (
          <input
            key={'translation-alt-' + index}
            value={value}
            onChange={(event) => updateTranslationAlternative(index, event.target.value)}
            placeholder={`別解${index + 1}`}
          />
        ))}
      </fieldset>
      <div className="admin-inline-actions">
        <button type="button" className="admin-secondary-btn" onClick={onCancel} disabled={saving}>キャンセル</button>
        <button type="button" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
      </div>
    </div>
  );
});

const QuestionCard = forwardRef(function QuestionCard({ target, section, isSelected, initialFeedback, onHistoryUpdate, onAdvance, initialInputs, onInputChange, onFocusTarget, isAdmin, onDeleteTarget, onUpdateTarget, onUpdateSection, sections }, ref) {
  const [feedback, setFeedback] = useState(initialFeedback ?? null);
  const [editing, setEditing] = useState(false);
  const cardRef = useRef(null);
  const formRef = useRef(null);

  useImperativeHandle(ref, () => ({ focus: () => formRef.current?.focus() }));

  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      window.setTimeout(() => formRef.current?.focus(), 0);
    }
  }, [isSelected]);

  const setResult = r => {
    setFeedback(null);
    setTimeout(() => {
      setFeedback(r);
      onHistoryUpdate?.(r);
    }, 0);
  };

  const isScoreType = SCORE_TYPES.has(target.type);
  const formProps = { initialInputs, onInputChange, onFocusTarget };
  const showPanelHeader = target.type !== 'kaeriten';

  return (
    <div ref={cardRef} className={`question-card${isSelected ? ' question-card--selected' : ''}`}>
      {showPanelHeader && <div className="panel-header">
        <span className={`type-badge type-${target.type}`}>{TYPE_LABEL[target.type] ?? '問題'}</span>
        <QuestionHeader target={target} />
        {isAdmin && (!target.generated || target.syntaxUsage !== undefined || target.syntaxTranslation !== undefined) && (
          <div className="admin-card-actions">
            <button
              type="button"
              className="admin-edit-target-btn"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setEditing((value) => !value);
              }}
            >
              編集
            </button>
            {!target.generated && (
              <button
                type="button"
                className="admin-delete-target-btn"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDeleteTarget?.(target, section);
                }}
              >
                削除
              </button>
            )}
          </div>
        )}
      </div>}
      {editing && target.generated ? (
        <SyntaxAnswerEditor
          ref={formRef}
          target={target}
          section={section}
          onUpdateSection={onUpdateSection}
          onCancel={() => setEditing(false)}
        />
      ) : editing && (
        <AdminTargetForm
          type={target.type}
          sections={sections}
          mode="edit"
          initialTarget={target}
          initialSectionId={section.sectionless ? '' : section.id}
          onCancel={() => setEditing(false)}
          onSave={async (payload) => {
            await onUpdateTarget?.(target, section, payload);
            setEditing(false);
          }}
        />
      )}
      {target.type === 'vocab'    && <VocabForm    ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />}
      {target.type === 'aux'      && <AuxForm      ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />}
      {target.type === 'verb'     && <VerbForm     ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />}
      {target.type === 'adj'      && <AdjForm      ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />}
      {target.type === 'particle' && <ParticleForm ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />}
      {target.type === 'grammar' && target.generated && (target.syntaxUsage !== undefined || target.syntaxTranslation !== undefined)
        ? <SyntaxGrammarForm ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />
        : target.type === 'grammar' && <GrammarForm ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />}
      {target.type === 'kundoku' && <KundokuForm ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />}
      {target.type === 'kaeriten' && <KaeritenForm ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />}
      {feedback && !isScoreType && <FeedbackCard type={target.type} data={feedback} />}
    </div>
  );
});

// ── AnswerPanel ──────────────────────────────────────────────
export default function AnswerPanel({
  activeType,
  sections,
  selectedTarget,
  selectedSection,
  onFocusTarget,
  historyEntries,
  onRecord,
  isAdmin,
  adminSelection,
  addingType,
  onStartAdd,
  onCancelAdd,
  onCreateTarget,
  onDeleteTarget,
  onUpdateTarget,
  onUpdateSection,
  deletedTargetNotice,
  onUndoDelete,
  onKaeritenLineCorrect,
}) {
  const cardRefs = useRef([]);
  const inputsMap = useRef({});

  const recordHistory = useCallback((target, section, result) => {
    if (!result) return;
    // verb/adj returns sub-field judgements, not a top-level judgement
    let judgement = result.judgement;
    if (!judgement) {
      const subs = [result.baseForm, result.conjugationType, result.formInText, result.meaning].filter(Boolean).map(s => s.judgement);
      if (subs.length === 0) return;
      if (subs.every(j => j === '正解')) judgement = '正解';
      else if (subs.every(j => j === '不正解')) judgement = '不正解';
      else judgement = '部分正解';
    }
    onRecord?.({
      id: target.id,
      type: target.type,
      surface: target.surface,
      sectionId: section?.id ?? null,
      targetId: target.id,
      questionId: null,
      judgement,
      feedback: result,
    });
    if (target.type === 'kaeriten' && result?.judgement === '正解' && Number.isInteger(target.lineIndex)) {
      onKaeritenLineCorrect?.(target, section);
    }
  }, [onRecord, onKaeritenLineCorrect]);

  const lastFeedback = useCallback((targetId) => {
    return historyEntries?.[targetId]?.attempts?.at(-1)?.feedback ?? null;
  }, [historyEntries]);

  const questions = useMemo(() => {
    if (activeType === 'all') return [];
    const all = sections.flatMap(section =>
      [
        ...(section.targets ?? [])
        .filter(t => t.type === activeType)
        .map(t => ({ target: t, section })),
        ...(activeType === 'grammar' ? syntaxQuestionsForSection(section) : []),
      ]
    );
    const seenGroups = new Set();
    return all.filter(({ target }) => {
      if (!target.groupId) return true;
      if (seenGroups.has(target.groupId)) return false;
      seenGroups.add(target.groupId);
      return true;
    }).sort((a, b) => {
      const sectionDiff = sectionOrder(sections, a.section) - sectionOrder(sections, b.section);
      if (sectionDiff !== 0) return sectionDiff;
      return targetOrder(a.section, a.target) - targetOrder(b.section, b.target);
    });
  }, [activeType, sections]);

  const adminTools = isAdmin && ADMIN_ADD_TYPES.has(activeType) ? (
    <>
      <UndoDeleteNotice deletedTargetNotice={deletedTargetNotice} onUndoDelete={onUndoDelete} />
      <div className="admin-list-tools">
        <button type="button" onClick={() => onStartAdd?.(activeType)}>問題追加</button>
        {addingType === activeType && <span>左カラムで最初の文字、最後の文字の順にクリックしてください。</span>}
      </div>
      {addingType === activeType && (
        <AdminTargetForm
          type={activeType}
          selection={adminSelection}
          sections={sections}
          onCancel={onCancelAdd}
          onSave={onCreateTarget}
        />
      )}
    </>
  ) : null;
  const undoNotice = isAdmin ? <UndoDeleteNotice deletedTargetNotice={deletedTargetNotice} onUndoDelete={onUndoDelete} /> : null;

  if (activeType === 'all') {
    if (!selectedTarget) {
      return (
        <div className="answer-panel empty">
          <div className="empty-message">
            <span className="empty-icon">📖</span>
            <p>ハイライトされた語を<br />選んでください</p>
          </div>
        </div>
      );
    }
    return (
      <div className="answer-panel-list">
        {undoNotice}
        <QuestionCard
          key={selectedTarget.id}
          target={selectedTarget}
          section={selectedSection}
          isSelected={false}
          initialFeedback={lastFeedback(selectedTarget.id)}
          onHistoryUpdate={r => recordHistory(selectedTarget, selectedSection, r)}
          initialInputs={inputsMap.current[selectedTarget.id]}
          onInputChange={vals => { inputsMap.current[selectedTarget.id] = vals; }}
          onFocusTarget={() => onFocusTarget?.(selectedTarget, selectedSection)}
          isAdmin={isAdmin}
          onDeleteTarget={onDeleteTarget}
          onUpdateTarget={onUpdateTarget}
          onUpdateSection={onUpdateSection}
          sections={sections}
        />
      </div>
    );
  }

  if (activeType === 'kaeriten') {
    if (selectedTarget?.type === 'kaeriten' && selectedSection) {
      return (
        <div className="answer-panel-list">
          {adminTools ?? undoNotice}
          <QuestionCard
            key={selectedTarget.id}
            target={selectedTarget}
            section={selectedSection}
            isSelected={false}
            initialFeedback={lastFeedback(selectedTarget.id)}
            onHistoryUpdate={r => recordHistory(selectedTarget, selectedSection, r)}
            initialInputs={inputsMap.current[selectedTarget.id]}
            onInputChange={vals => { inputsMap.current[selectedTarget.id] = vals; }}
            onFocusTarget={() => onFocusTarget?.(selectedTarget, selectedSection)}
            isAdmin={isAdmin}
            onDeleteTarget={onDeleteTarget}
            onUpdateTarget={onUpdateTarget}
            onUpdateSection={onUpdateSection}
            sections={sections}
          />
        </div>
      );
    }
    return (
      <div className="answer-panel-list">
        {adminTools ?? undoNotice}
        <div className="question-card kaeriten-instruction-card">
          <div className="form-group kaeriten-line-form">
            <div className="kaeriten-line-stage source-text-pane">
              <div className="kaeriten-line-display">
                <InstructionLane />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeType === 'kundoku') {
    if (selectedTarget?.type === 'kundoku' && selectedSection) {
      const target = selectedTarget;
      const section = selectedSection;
      return (
        <div className="answer-panel-list">
          {adminTools ?? undoNotice}
          <QuestionCard
            key={target.id}
            ref={el => { cardRefs.current[0] = el; }}
            target={target}
            section={section}
            isSelected
            initialFeedback={lastFeedback(target.id)}
            onHistoryUpdate={r => recordHistory(target, section, r)}
            onAdvance={() => {}}
            initialInputs={inputsMap.current[target.id]}
            onInputChange={vals => { inputsMap.current[target.id] = vals; }}
            onFocusTarget={() => onFocusTarget?.(target, section)}
            isAdmin={isAdmin}
            onDeleteTarget={onDeleteTarget}
            onUpdateTarget={onUpdateTarget}
            onUpdateSection={onUpdateSection}
            sections={sections}
          />
        </div>
      );
    }
    return (
      <div className="answer-panel-list">
        {adminTools ?? undoNotice}
        <div className="question-card kaeriten-instruction-card">
          <div className="kundoku-select-empty">書き下す行を選択してください。</div>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="answer-panel-list">
        {adminTools ?? undoNotice}
        <div className="answer-panel empty">
          <div className="empty-message">
            <p>この品詞の問題はありません</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="answer-panel-list">
      {adminTools ?? undoNotice}
      {questions.map(({ target, section }, i) => (
        <QuestionCard
          key={target.id}
          ref={el => { cardRefs.current[i] = el; }}
          target={target}
          section={section}
          isSelected={
            target.groupId
              ? selectedTarget?.groupId === target.groupId
              : selectedTarget?.id === target.id
          }
          initialFeedback={lastFeedback(target.id)}
          onHistoryUpdate={r => recordHistory(target, section, r)}
          onAdvance={() => cardRefs.current[i + 1]?.focus()}
          initialInputs={inputsMap.current[target.id]}
          onInputChange={vals => { inputsMap.current[target.id] = vals; }}
          onFocusTarget={() => onFocusTarget?.(target, section)}
          isAdmin={isAdmin}
          onDeleteTarget={onDeleteTarget}
          onUpdateTarget={onUpdateTarget}
          onUpdateSection={onUpdateSection}
          sections={sections}
        />
      ))}
    </div>
  );
}
