import { useEffect, useRef, useState } from 'react';
import { reviewTranslation, reviewContent, localScore } from '../services/gemini';

function timeAgo(ts) {
  if (!ts?.toMillis) return '';
  const sec = Math.floor((Date.now() - ts.toMillis()) / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

function JudgeBadge({ judgement }) {
  if (!judgement) return null;
  const icon = judgement === '正解' ? '○' : judgement === '部分正解' ? '△' : '✕';
  const cls = judgement === '正解' ? 'judge-correct' : judgement === '部分正解' ? 'judge-partial' : 'judge-wrong';
  return (
    <div className="nq-judge-row">
      <span className={`judge-icon ${cls}`}>{icon}</span>
      <span className={`judgement-text ${cls}`}>{judgement}</span>
    </div>
  );
}

function ChoiceInput({ choices, value, onChange, disabled, answered, correctAnswer }) {
  return (
    <div className="nq-choices">
      {choices.map((c, i) => {
        let cls = 'nq-choice';
        if (answered) {
          if (c === correctAnswer) cls += ' choice-correct';
          else if (c === value) cls += ' choice-wrong';
        }
        return (
          <label key={i} className={cls}>
            <input
              type="radio"
              name={`choice-${i}`}
              value={c}
              checked={value === c}
              onChange={() => !disabled && onChange(c)}
              disabled={disabled}
            />
            <span>{c}</span>
          </label>
        );
      })}
    </div>
  );
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

function QuestionItem({ q, sections, onRecord, historyEntry, defaultOpen, onOpened, onFocusTarget, isAdmin, onUpdateQuestion }) {
  const lastFeedback = historyEntry?.attempts?.at(-1)?.feedback ?? null;
  const [ans, setAns] = useState(lastFeedback?.userAnswer ?? '');
  const [result, setResult] = useState(lastFeedback ?? null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(!!defaultOpen);
  const [editingQuestion, setEditingQuestion] = useState(false);
  const [questionText, setQuestionText] = useState(q.question ?? '');
  const [savingQuestion, setSavingQuestion] = useState(false);

  const isChoice = q.inputType === 'choice';

  useEffect(() => {
    if (defaultOpen) { setOpen(true); onOpened?.(); }
  }, [defaultOpen]); // eslint-disable-line

  useEffect(() => {
    setQuestionText(q.question ?? '');
  }, [q.question]);

  const section = sections.find(s => s.id === q.sectionId);

  const focusTarget = () => {
    if (!q.targetText) return;
    onFocusTarget?.(q.sectionId, q.targetText);
  };

  const submit = async () => {
    if (!ans.trim()) return;
    setLoading(true);
    setResult(null);
    let res;
    if (isChoice) {
      res = { judgement: ans === q.answer ? '正解' : '不正解', feedback: '' };
    } else if (q.local) {
      res = localScore(ans, q.answer);
    } else if (q.type === 'translation') {
      res = await reviewTranslation({ targetText: q.targetText, sentence: section?.text ?? '', userAnswer: ans, correctAnswer: q.answer, explanation: q.explanation });
    } else {
      res = await reviewContent({ question: q.question, userAnswer: ans, correctAnswer: q.answer, explanation: q.explanation });
    }
    setLoading(false);
    setResult(res);
    if (res?.judgement) {
      onRecord?.({
        id: `nq_${q.id}`,
        type: q.type,
        surface: q.title,
        sectionId: q.sectionId,
        targetId: null,
        questionId: q.id,
        judgement: res.judgement,
        feedback: { ...res, userAnswer: ans },
      });
    }
  };

  const saveQuestion = async () => {
    if (!questionText.trim() || savingQuestion) return;
    setSavingQuestion(true);
    await onUpdateQuestion?.(q, questionText);
    setSavingQuestion(false);
    setEditingQuestion(false);
  };

  return (
    <div className="normal-question-card">
      <div className="nq-header" onClick={() => setOpen(o => !o)}>
        <span className={`type-badge type-${q.type}`}>{q.type === 'translation' ? '現代語訳' : '内容読解'}</span>
        <span className="nq-title">{q.title}</span>
        <span className="nq-toggle">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="nq-body">
          <div className="nq-content-area">
            {editingQuestion ? (
              <div className="nq-admin-question-form">
                <textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={3} />
                <div className="nq-admin-question-actions">
                  <button onClick={saveQuestion} disabled={savingQuestion || !questionText.trim()}>
                    {savingQuestion ? '保存中...' : '保存'}
                  </button>
                  <button className="nq-admin-secondary" onClick={() => { setQuestionText(q.question ?? ''); setEditingQuestion(false); }} disabled={savingQuestion}>
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <div className="nq-question-row">
                <p className="nq-question">
                  <HighlightQuestionText text={q.question} surface={q.targetText} />
                </p>
                {isAdmin && (
                  <button
                    className="nq-admin-edit-btn"
                    onClick={() => setEditingQuestion(true)}
                  >
                    問題文編集
                  </button>
                )}
              </div>
            )}
            {q.targetText && (
              <div className="nq-target-text">「{q.targetText}」</div>
            )}
            {isChoice ? (
              <div className="nq-choice-area">
                <ChoiceInput
                  choices={q.choices}
                  value={ans}
                  onChange={setAns}
                  disabled={!!result}
                  answered={!!result}
                  correctAnswer={q.answer}
                />
                <button
                  className="nq-choice-submit"
                  onClick={submit}
                  disabled={!ans || !!result}
                >
                  答え合わせ
                </button>
              </div>
            ) : (
              <div className="nq-input-row">
                <textarea
                  value={ans}
                  onChange={e => setAns(e.target.value)}
                  onFocus={focusTarget}
                  onBlur={() => onFocusTarget?.(null, null)}
                  rows={4}
                />
                <div className="nq-action-col">
                  <button onClick={submit} disabled={loading}>
                    {loading ? '添削中…' : '添削する'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {result && (
            <>
              <JudgeBadge judgement={result.judgement} />
              {!isChoice && <div className="hint">模範解答：<em>{q.answer}</em></div>}
              {q.explanation && <div className="explanation">{q.explanation}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function NormalQuestions({ questions, sections, historyEntries, onRecord, expandedNqId, onExpandHandled, onFocusTarget, isAdmin, onUpdateQuestion }) {
  if (!questions?.length) return null;
  const sorted = [...questions].sort((a, b) => {
    if (a.type === b.type) return 0;
    return a.type === 'translation' ? -1 : 1;
  });
  return (
    <div className="normal-questions">
      <div className="nq-section-title">通常問題</div>
      {sorted.map(q => (
        <QuestionItem
          key={q.id}
          q={q}
          sections={sections}
          onRecord={onRecord}
          historyEntry={historyEntries?.[`nq_${q.id}`]}
          defaultOpen={expandedNqId === q.id}
          onOpened={onExpandHandled}
          onFocusTarget={onFocusTarget}
          isAdmin={isAdmin}
          onUpdateQuestion={onUpdateQuestion}
        />
      ))}
    </div>
  );
}
