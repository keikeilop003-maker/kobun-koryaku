import { useEffect, useRef, useState } from 'react';
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

function WhisperForm({ avatarSeed, questionId, questionTitle, addWhisper, onClose }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setMsg(null);
    try {
      await addWhisper({ text, avatarSeed, questionId, questionTitle });
      setText('');
      setMsg({ type: 'done', text: '投稿しました' });
      setTimeout(() => { setMsg(null); onClose?.(); }, 1500);
    } catch (e) {
      setMsg({ type: 'error', text: e.message === 'rate_limit' ? '30秒おきに1回' : '投稿失敗' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="whisper-form-row">
      <AvatarIcon seed={avatarSeed} size={24} />
      <input
        ref={inputRef}
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
      <button className="whisper-inline-btn" onClick={submit} disabled={sending || !text.trim()}>
        投稿
      </button>
      <button className="whisper-close-btn" onClick={onClose} title="閉じる">✕</button>
    </div>
  );
}

function QuestionItem({ q, sections, onRecord, historyEntry, defaultOpen, onOpened, onFocusTarget, questionWhispers, addWhisper, avatarSeed }) {
  const lastFeedback = historyEntry?.attempts?.at(-1)?.feedback ?? null;
  const [ans, setAns] = useState(lastFeedback?.userAnswer ?? '');
  const [result, setResult] = useState(lastFeedback ?? null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(!!defaultOpen);
  const [whisperFormOpen, setWhisperFormOpen] = useState(false);
  const [bubblePositions, setBubblePositions] = useState({});

  useEffect(() => {
    if (defaultOpen) { setOpen(true); onOpened?.(); }
  }, [defaultOpen]); // eslint-disable-line

  // 新しいつぶやきにランダム座標を割り当て
  useEffect(() => {
    if (!result) return;
    const newOnes = questionWhispers.filter(w => !bubblePositions[w.id]);
    if (newOnes.length === 0) return;
    const additions = {};
    newOnes.forEach(w => {
      additions[w.id] = {
        top:  `${8  + Math.random() * 62}%`,
        left: `${4  + Math.random() * 52}%`,
      };
    });
    setBubblePositions(prev => ({ ...prev, ...additions }));
  }, [questionWhispers, result]); // eslint-disable-line

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
          {/* 問題＋入力欄エリア（吹き出しオーバーレイの基準） */}
          <div className="nq-content-area">
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
              <div className="nq-action-col">
                <button onClick={submit} disabled={loading}>
                  {loading ? '添削中…' : '添削する'}
                </button>
                <button
                  className={`nq-whisper-icon-btn${whisperFormOpen ? ' active' : ''}`}
                  onClick={() => setWhisperFormOpen(o => !o)}
                  title="つぶやく"
                >
                  💬
                </button>
              </div>
            </div>

            {/* 吹き出しオーバーレイ */}
            {result && questionWhispers.map(w => {
              const pos = bubblePositions[w.id];
              if (!pos) return null;
              return (
                <div key={w.id} className="whisper-bubble" style={pos}>
                  <div className="whisper-bubble-row">
                    <AvatarIcon seed={w.avatarSeed} size={16} />
                    <p className="whisper-bubble-text">{w.text}</p>
                  </div>
                  <span className="whisper-bubble-time">{timeAgo(w.createdAt)}</span>
                </div>
              );
            })}
          </div>

          {/* つぶやき入力フォーム */}
          {whisperFormOpen && (
            <WhisperForm
              avatarSeed={avatarSeed}
              questionId={q.id}
              questionTitle={q.title}
              addWhisper={addWhisper}
              onClose={() => setWhisperFormOpen(false)}
            />
          )}

          {/* 添削結果 */}
          {result && (
            <>
              <JudgeBadge judgement={result.judgement} />
              <div className="hint">模範解答：<em>{q.answer}</em></div>
              {q.explanation && <div className="explanation">{q.explanation}</div>}
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
