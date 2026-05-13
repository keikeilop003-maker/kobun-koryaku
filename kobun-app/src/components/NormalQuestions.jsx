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

function feedbackReason(result, q, isChoice) {
  if (!result || result.judgement === '正解') return '';
  const text = [result.reason, result.comment, result.feedback]
    .filter(Boolean)
    .join('\n')
    .trim();
  if (text) return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 3).join('\n');
  if (isChoice) return `選んだ答えが正答「${q.answer}」と一致していません。`;
  if (result.judgement === '部分正解') return '大意は近いですが、模範解答と比べて不足している要素があります。';
  return '模範解答と比べて、重要な内容が一致していません。';
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

function circledNumber(index) {
  const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
  return circled[index - 1] ?? `(${index})`;
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

function QuestionItem({ q, sections, onRecord, historyEntry, defaultOpen, onOpened, onFocusTarget, isAdmin, onUpdateQuestion, onDeleteQuestion }) {
  const lastFeedback = historyEntry?.attempts?.at(-1)?.feedback ?? null;
  const [ans, setAns] = useState(lastFeedback?.userAnswer ?? '');
  const [result, setResult] = useState(lastFeedback ?? null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(!!defaultOpen);
  const [editingQuestion, setEditingQuestion] = useState(false);
  const [questionText, setQuestionText] = useState(q.question ?? '');
  const [answerText, setAnswerText] = useState(q.answer ?? '');
  const [alternativeAnswers, setAlternativeAnswers] = useState(() => [...(q.alternativeAnswers ?? []), '', '', '', '', ''].slice(0, 5));
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [deletingQuestion, setDeletingQuestion] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteStartedRef = useRef(false);

  const isChoice = q.inputType === 'choice';

  useEffect(() => {
    if (defaultOpen) { setOpen(true); onOpened?.(); }
  }, [defaultOpen]); // eslint-disable-line

  useEffect(() => {
    setQuestionText(q.question ?? '');
  }, [q.question]);

  useEffect(() => {
    setAnswerText(q.answer ?? '');
  }, [q.answer]);

  useEffect(() => {
    setAlternativeAnswers([...(q.alternativeAnswers ?? []), '', '', '', '', ''].slice(0, 5));
  }, [q.alternativeAnswers]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [q.id]);

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
      res = await reviewTranslation({ targetText: q.targetText, sentence: section?.text ?? '', userAnswer: ans, correctAnswer: q.answer, acceptedAnswers: q.alternativeAnswers, explanation: q.explanation });
    } else {
      res = await reviewContent({ question: q.question, userAnswer: ans, correctAnswer: q.answer, explanation: q.explanation });
    }
    setLoading(false);
    setResult(res);
    if (res?.judgement) {
      onRecord?.({
        id: `nq_${q.id}`,
        type: q.type,
        surface: q.displayTitle ?? q.title,
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
    if (q.type === 'translation' && !answerText.trim()) return;
    setSavingQuestion(true);
    await onUpdateQuestion?.(q, {
      question: questionText,
      answer: answerText,
      alternativeAnswers,
    });
    setSavingQuestion(false);
    setEditingQuestion(false);
  };

  const updateAlternativeAnswer = (index, value) => {
    setAlternativeAnswers((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  };

  const deleteQuestion = async (event) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (deletingQuestion || deleteStartedRef.current) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteStartedRef.current = true;
    setDeletingQuestion(true);
    try {
      await onDeleteQuestion?.(q);
    } finally {
      deleteStartedRef.current = false;
      setDeletingQuestion(false);
      setConfirmingDelete(false);
    }
  };

  const reasonText = feedbackReason(result, q, isChoice);

  return (
    <div className="normal-question-card">
      <div className="nq-header" onClick={() => setOpen(o => !o)}>
        <span className={`type-badge type-${q.type}`}>{q.type === 'translation' ? '現代語訳' : '内容読解'}</span>
        <span className="nq-title">{q.displayTitle ?? q.title}</span>
        {isAdmin && (
          <button
            type="button"
            className={`nq-admin-delete-btn nq-admin-delete-btn--header${confirmingDelete ? ' nq-admin-delete-btn--confirm' : ''}`}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={deleteQuestion}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') deleteQuestion(event);
            }}
            disabled={deletingQuestion}
          >
            {deletingQuestion ? '削除中...' : confirmingDelete ? 'もう一度押す' : '削除'}
          </button>
        )}
        <span className="nq-toggle">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="nq-body">
          <div className="nq-content-area">
            {editingQuestion ? (
              <div className="nq-admin-question-form">
                <label>
                  問題文
                  <textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={3} />
                </label>
                {q.type === 'translation' && (
                  <>
                    <label>
                      模範解答
                      <textarea value={answerText} onChange={e => setAnswerText(e.target.value)} rows={3} />
                    </label>
                    <fieldset className="nq-admin-alt-answers">
                      <legend>別解（5個まで）</legend>
                      {alternativeAnswers.map((value, index) => (
                        <input
                          key={index}
                          value={value}
                          onChange={(e) => updateAlternativeAnswer(index, e.target.value)}
                          placeholder={`別解${index + 1}`}
                        />
                      ))}
                    </fieldset>
                  </>
                )}
                <div className="nq-admin-question-actions">
                  <button onClick={saveQuestion} disabled={savingQuestion || !questionText.trim() || (q.type === 'translation' && !answerText.trim())}>
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
                  <HighlightQuestionText text={q.question} surface={q.targetText} surfaces={q.questionSurfaces} />
                </p>
                {isAdmin && (
                  <div className="nq-admin-actions">
                    <button
                      type="button"
                      className="nq-admin-edit-btn"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setEditingQuestion(true);
                      }}
                    >
                      編集
                    </button>
                  </div>
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
              {reasonText && (
                <div className="nq-feedback-reason">
                  {reasonText.split('\n').map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                </div>
              )}
              {!isChoice && <div className="hint">模範解答：<em>{q.answer}</em></div>}
              {q.explanation && <div className="explanation">{q.explanation}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function NormalQuestions({ questions, sections, historyEntries, onRecord, expandedNqId, onExpandHandled, onFocusTarget, isAdmin, onUpdateQuestion, onDeleteQuestion }) {
  if (!questions?.length) return null;
  const counters = {};
  const sorted = [...questions].sort((a, b) => {
    if (a.type === b.type) return 0;
    return a.type === 'translation' ? -1 : 1;
  }).map((q) => {
    const label = q.type === 'translation' ? '現代語訳' : '内容読解';
    counters[q.type] = (counters[q.type] ?? 0) + 1;
    return { ...q, displayTitle: `${label}${circledNumber(counters[q.type])}` };
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
          onDeleteQuestion={onDeleteQuestion}
        />
      ))}
    </div>
  );
}
