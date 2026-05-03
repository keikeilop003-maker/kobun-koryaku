import { useEffect, useRef, useState } from 'react';
import AvatarIcon from './AvatarIcon';
import useWhispers from '../hooks/useWhispers';

const MAX_CHARS = 200;

function timeAgo(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts.toMillis()) / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

export default function WhisperPanel({ textId, uid, context, onContextUsed }) {
  const avatarSeed = uid ? uid.substring(0, 8) : 'anon';
  const { whispers, addWhisper } = useWhispers(textId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const textareaRef = useRef(null);

  // コンテキスト（問題からのプリセット）を受け取ったらフォーカス
  useEffect(() => {
    if (context) {
      textareaRef.current?.focus();
      onContextUsed?.();
    }
  }, [context]); // eslint-disable-line

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await addWhisper({
        text,
        avatarSeed,
        questionId: context?.questionId ?? null,
        questionTitle: context?.questionTitle ?? null,
      });
      setText('');
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (e) {
      setError(e.message === 'rate_limit' ? '30秒おきに1回投稿できます' : '投稿に失敗しました');
    } finally {
      setSending(false);
    }
  };

  const remaining = MAX_CHARS - text.length;

  return (
    <div className="whisper-panel">
      <div className="whisper-form">
        <AvatarIcon seed={avatarSeed} size={36} />
        <div className="whisper-form-inner">
          {context && (
            <div className="whisper-context-tag">
              💬 {context.questionTitle}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="whisper-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="感想・疑問・気づきをつぶやく…"
            rows={3}
            maxLength={MAX_CHARS}
          />
          <div className="whisper-form-footer">
            <span className={`whisper-char-count${remaining < 20 ? ' warn' : ''}`}>
              {remaining}
            </span>
            {error && <span className="whisper-error">{error}</span>}
            {done && <span className="whisper-done">投稿しました</span>}
            <button
              className="whisper-send-btn"
              onClick={submit}
              disabled={sending || !text.trim() || remaining < 0}
            >
              {sending ? '投稿中…' : '投稿'}
            </button>
          </div>
        </div>
      </div>

      <div className="whisper-feed">
        {whispers.length === 0 && (
          <p className="whisper-empty">まだつぶやきがありません。最初の一言をどうぞ。</p>
        )}
        {whispers.map(w => (
          <div key={w.id} className="whisper-card">
            <AvatarIcon seed={w.avatarSeed} size={32} />
            <div className="whisper-card-body">
              {w.questionTitle && (
                <span className="whisper-card-tag">{w.questionTitle}</span>
              )}
              <p className="whisper-card-text">{w.text}</p>
              <span className="whisper-card-time">{timeAgo(w.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
