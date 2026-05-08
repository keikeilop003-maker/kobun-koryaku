import { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import FeedbackCard from './FeedbackCard';
import AdminTargetForm from './AdminTargetForm';
import { reviewVocab, reviewAux, reviewVerb, reviewAdj, reviewParticle, reviewGrammar } from '../services/gemini';

const TYPE_LABEL = {
  vocab:    '重要単語',
  aux:      '助動',
  verb:     '動',
  adj:      '形',
  particle: '助',
  grammar:  '文法・句法',
};

const SCORE_TYPES = new Set(['aux', 'verb', 'adj', 'particle', 'vocab', 'grammar']);
const ADMIN_ADD_TYPES = new Set(['aux', 'verb', 'adj', 'particle', 'vocab', 'grammar']);

function targetOrder(section, target) {
  if (Number.isInteger(target.start)) return target.start;
  const idx = section.text.indexOf(target.surface);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
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

function HighlightQuestionText({ text, surface }) {
  if (!text || !surface || !text.includes(surface)) return <>{text}</>;
  const parts = text.split(surface);
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && <span className="question-surface">{surface}</span>}
        </span>
      ))}
    </>
  );
}

function QuestionHeader({ target }) {
  if (target.questionText) {
    return (
      <span className="question-header-text">
        <HighlightQuestionText text={target.questionText} surface={target.questionSurface ?? target.surface} />
      </span>
    );
  }
  const surface = target.type === 'grammar' ? (target.questionSurface ?? target.surface) : target.surface;
  const prefix = { aux: '助動詞', particle: '助詞' }[target.type] ?? '';
  const suffix = {
    vocab: 'の意味', aux: 'の用法', verb: 'の文法事項',
    adj: 'の文法事項',
    particle: target.particleQuestionType === 'usage' ? 'の用法' : 'の訳し方',
    grammar: 'の文法的な働きと訳し方',
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
    const res = await reviewVocab({ userAnswer: ans, correctAnswer: target.answer, useAi: target.gradingMode === 'ai' });
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
    const res = await reviewAux({ surface: target.surface, sentence: section.text, userAnswer: v, correctAnswer: target.answer, explanation: target.explanation, useAi: target.gradingMode === 'ai' });
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
    const res = await reviewParticle({ userAnswer: v, correctAnswer: target.answer, useAi: target.gradingMode === 'ai' });
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
    const res = await reviewGrammar({ surface: target.surface, sentence: section.text, userAnswer: ans, correctAnswer: target.answer, explanation: target.explanation, useAi: target.gradingMode === 'ai' });
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

// ── QuestionCard ─────────────────────────────────────────────
const QuestionCard = forwardRef(function QuestionCard({ target, section, isSelected, initialFeedback, onHistoryUpdate, onAdvance, initialInputs, onInputChange, onFocusTarget, isAdmin, onDeleteTarget, onUpdateTarget, sections }, ref) {
  const [feedback, setFeedback] = useState(initialFeedback ?? null);
  const [editing, setEditing] = useState(false);
  const cardRef = useRef(null);
  const formRef = useRef(null);

  useImperativeHandle(ref, () => ({ focus: () => formRef.current?.focus() }));

  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  return (
    <div ref={cardRef} className={`question-card${isSelected ? ' question-card--selected' : ''}`}>
      <div className="panel-header">
        <span className={`type-badge type-${target.type}`}>{TYPE_LABEL[target.type] ?? '問題'}</span>
        <QuestionHeader target={target} />
        {isAdmin && (
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
          </div>
        )}
      </div>
      {editing && (
        <AdminTargetForm
          type={target.type}
          sections={sections}
          mode="edit"
          initialTarget={target}
          initialSectionId={section.id}
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
      {target.type === 'grammar'  && <GrammarForm  ref={formRef} target={target} section={section} onResult={setResult} initialResult={feedback} onAdvance={onAdvance} {...formProps} />}
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
  deletedTargetNotice,
  onUndoDelete,
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
  }, [onRecord]);

  const lastFeedback = useCallback((targetId) => {
    return historyEntries?.[targetId]?.attempts?.at(-1)?.feedback ?? null;
  }, [historyEntries]);

  const questions = useMemo(() => {
    if (activeType === 'all') return [];
    const all = sections.flatMap(section =>
      (section.targets ?? [])
        .filter(t => t.type === activeType)
        .map(t => ({ target: t, section }))
    );
    const seenGroups = new Set();
    return all.filter(({ target }) => {
      if (!target.groupId) return true;
      if (seenGroups.has(target.groupId)) return false;
      seenGroups.add(target.groupId);
      return true;
    }).sort((a, b) => {
      const sectionDiff = sections.findIndex(section => section.id === a.section.id) - sections.findIndex(section => section.id === b.section.id);
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
          sections={sections}
        />
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
          sections={sections}
        />
      ))}
    </div>
  );
}
