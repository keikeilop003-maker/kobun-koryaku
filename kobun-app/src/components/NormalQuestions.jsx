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

function quotedRanges(text) {
  if (!text) return [];
  const ranges = [];
  const pattern = /「([^」]+)」/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    ranges.push({
      start: match.index + 1,
      end: match.index + match[0].length - 1,
    });
  }
  return ranges;
}

function boldRanges(text, surface, surfaces) {
  const targets = boldTargets(surfaces, surface);
  const ranges = quotedRanges(text);
  const seen = new Map();
  let index = 0;
  while (index < text.length) {
    const matchedText = targets.find((item) => text.startsWith(item.text, index))?.text;
    if (!matchedText) {
      index += 1;
      continue;
    }
    const matchingTargets = targets.filter((item) => item.text === matchedText);
    const count = (seen.get(matchedText) ?? 0) + 1;
    seen.set(matchedText, count);
    if (matchingTargets.some((item) => !item.occurrence || item.occurrence === count)) {
      ranges.push({ start: index, end: index + matchedText.length });
    }
    index += matchedText.length;
  }
  return ranges
    .filter(range => range.start < range.end)
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce((acc, range) => {
      const last = acc.at(-1);
      if (!last || range.start >= last.end) acc.push(range);
      else last.end = Math.max(last.end, range.end);
      return acc;
    }, []);
}

function HighlightQuestionText({ text, surface, surfaces }) {
  const ranges = boldRanges(text, surface, surfaces);
  if (!text || ranges.length === 0) return <>{text}</>;
  const nodes = [];
  let pos = 0;
  for (const range of ranges) {
    if (range.start > pos) nodes.push(text.slice(pos, range.start));
    nodes.push(
      <span key={`bold-${range.start}`} className="question-surface">
        {text.slice(range.start, range.end)}
      </span>
    );
    pos = range.end;
  }
  if (pos < text.length) nodes.push(text.slice(pos));
  return <>{nodes}</>;
}

function QuestionItem({ q, sections, onRecord, historyEntry, open, onToggleOpen, isAdmin, onUpdateQuestion, onDeleteQuestion }) {
  const lastFeedback = historyEntry?.attempts?.at(-1)?.feedback ?? null;
  const [ans, setAns] = useState(lastFeedback?.userAnswer ?? '');
  const [result, setResult] = useState(lastFeedback ?? null);
  const [loading, setLoading] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(false);
  const [questionText, setQuestionText] = useState(q.question ?? '');
  const [answerText, setAnswerText] = useState(q.answer ?? '');
  const [alternativeAnswers, setAlternativeAnswers] = useState(() => [...(q.alternativeAnswers ?? []), '', '', '', '', ''].slice(0, 5));
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [deletingQuestion, setDeletingQuestion] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [focusAnswerAfterEdit, setFocusAnswerAfterEdit] = useState(false);
  const deleteStartedRef = useRef(false);
  const answerInputRef = useRef(null);

  const isChoice = q.inputType === 'choice';

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

  useEffect(() => {
    if (!focusAnswerAfterEdit || editingQuestion) return;
    const timer = window.setTimeout(() => {
      answerInputRef.current?.focus();
      setFocusAnswerAfterEdit(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editingQuestion, focusAnswerAfterEdit]);

  const section = sections.find(s => s.id === q.sectionId);

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
    if (!questionText.trim() || !answerText.trim() || savingQuestion) return;
    setSavingQuestion(true);
    await onUpdateQuestion?.(q, {
      question: questionText,
      answer: answerText,
      alternativeAnswers,
    });
    setSavingQuestion(false);
    setEditingQuestion(false);
    setFocusAnswerAfterEdit(true);
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
      <div className="nq-header" onClick={onToggleOpen}>
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
                <label>
                  模範解答
                  <textarea value={answerText} onChange={e => setAnswerText(e.target.value)} rows={3} />
                </label>
                {q.type === 'translation' && (
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
                )}
                <div className="nq-admin-question-actions">
                  <button onClick={saveQuestion} disabled={savingQuestion || !questionText.trim() || !answerText.trim()}>
                    {savingQuestion ? '保存中...' : '保存'}
                  </button>
                  <button className="nq-admin-secondary" onClick={() => { setQuestionText(q.question ?? ''); setAnswerText(q.answer ?? ''); setEditingQuestion(false); }} disabled={savingQuestion}>
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
                  ref={answerInputRef}
                  value={ans}
                  onChange={e => setAns(e.target.value)}
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

export default function NormalQuestions({ questions, sections, historyEntries, onRecord, expandedNqId, onExpandHandled, onOpenQuestionChange, isAdmin, onUpdateQuestion, onDeleteQuestion }) {
  const safeQuestions = questions ?? [];
  const [openQuestionId, setOpenQuestionId] = useState(null);
  useEffect(() => {
    if (!expandedNqId) return;
    const question = safeQuestions.find(q => q.id === expandedNqId);
    setOpenQuestionId(expandedNqId);
    onOpenQuestionChange?.(question ?? null);
    onExpandHandled?.();
  }, [expandedNqId, safeQuestions, onOpenQuestionChange, onExpandHandled]);

  if (!safeQuestions.length) return null;
  const counters = {};
  const sorted = [...safeQuestions].sort((a, b) => {
    if (a.type === b.type) return 0;
    return a.type === 'translation' ? -1 : 1;
  }).map((q) => {
    const label = q.type === 'translation' ? '現代語訳' : '内容読解';
    counters[q.type] = (counters[q.type] ?? 0) + 1;
    return { ...q, displayTitle: `${label}${circledNumber(counters[q.type])}` };
  });

  const toggleQuestion = (question) => {
    setOpenQuestionId((current) => {
      const nextId = current === question.id ? null : question.id;
      onOpenQuestionChange?.(nextId ? question : null);
      return nextId;
    });
  };

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
          open={openQuestionId === q.id}
          onToggleOpen={() => toggleQuestion(q)}
          isAdmin={isAdmin}
          onUpdateQuestion={onUpdateQuestion}
          onDeleteQuestion={onDeleteQuestion}
        />
      ))}
    </div>
  );
}
