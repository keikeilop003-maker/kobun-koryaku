import { useEffect, useState } from 'react';
import { reviewTranslation, reviewContent, localScore } from '../services/gemini';
import AvatarIcon from './AvatarIcon';

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

function InlineWhisperForm({ avatarSeed, questionId, questionTitle, addWhisper }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'error'|'done', text }

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setMsg(null);
    try {
      await addWhisper({ text, avatarSeed, questionId, questionTitle });
      setText('');
      setMsg({ type: 'done', text: '投稿しました' });
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setMsg({ type: 'error', text: e.message === 'rate_limit' ? '30秒おきに1回' : '投稿失敗' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="whisper-inline-form">
      <AvatarIcon seed={avatarSeed} size={24} />
      <input
        type="text"
        className="whisper-inline-input"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
        placeholder="つぶやく…"
        maxLength={200}
      />
      {msg && (
        <span className={msg.type === 'done' ? 'whisper-done' : 'whisper-error'}>
          {msg.text}
        </span>
      )}
      <button
        className="whisper-inline-btn"
        onClick={submit}
        disabled={sending || !text.trim()}
      >
        投稿
      </button>
    </div>
  );
}

function QuestionItem({ q, sections, onRecord, historyEntry, defaultOpen, onOpened, onFocusTarget, questionWhispers, addWhisper, avatarSeed }) {
  const lastFeedback = historyEntry?.attempts?.at(-1)?.feedback ?? null;
  const [ans, setAns] = useState(lastFeedback?.userAnswer ?? '');
  const [result, setResult] = useState(lastFeedback ?? null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(!!defaultOpen);

  useEffect(() => {
    if (defaultOpen) {
      setOpen(true);
      onOpened?.();
    }
  }, [defaultOpen]);  // eslint-disable-line react-hooks/exhaustive-deps

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
    if (q.local) {
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

  return (
    <div className="normal-question-card">
      <div className="nq-header" onClick={() => setOpen(o => !o)}>
        <span className={`type-badge type-${q.type}`}>{q.type === 'translation' ? '現代語訳' : '内容読解'}</span>
        <span className="nq-title">{q.title}</span>
        <span className="nq-toggle">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="nq-body">
          <p className="nq-question">{q.question}</p>
          {q.targetText && (
            <div className="nq-target-text">「{q.targetText}」</div>
          )}
          <div className="nq-input-row">
            <textarea
              value={ans}
              onChange={e => setAns(e.target.value)}
              onFocus={focusTarget}
              onBlur={() => onFocusTarget?.(null, null)}
              rows={4}
            />
            <button onClick={submit} disabled={loading}>
              {loading ? '添削中…' : '添削する'}
            </button>
          </div>
          {result && (
            <>
              <JudgeBadge judgement={result.judgement} />
              <div className="hint">模範解答：<em>{q.answer}</em></div>
              {q.explanation && <div className="explanation">{q.explanation}</div>}

              <div className="whisper-inline-section">
                <div className="whisper-inline-header">
                  💬 みんなのつぶやき
                  {questionWhispers.length > 0 && (
                    <span className="whisper-inline-count">{questionWhispers.length}</span>
                  )}
                </div>
                <div className="whisper-inline-feed">
                  {questionWhispers.length === 0 && (
                    <p className="whisper-inline-empty">まだつぶやきはありません</p>
                  )}
                  {questionWhispers.map(w => (
                    <div key={w.id} className="whisper-inline-item">
                      <AvatarIcon seed={w.avatarSeed} size={24} />
                      <div className="whisper-inline-body">
                        <p className="whisper-inline-text">{w.text}</p>
                        <span className="whisper-inline-time">{timeAgo(w.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <InlineWhisperForm
                  avatarSeed={avatarSeed}
                  questionId={q.id}
                  questionTitle={q.title}
                  addWhisper={addWhisper}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function NormalQuestions({ questions, sections, historyEntries, onRecord, expandedNqId, onExpandHandled, onFocusTarget, whispers, addWhisper, avatarSeed }) {
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
          questionWhispers={(whispers ?? []).filter(w => w.questionId === q.id)}
          addWhisper={addWhisper}
          avatarSeed={avatarSeed}
        />
      ))}
    </div>
  );
}
