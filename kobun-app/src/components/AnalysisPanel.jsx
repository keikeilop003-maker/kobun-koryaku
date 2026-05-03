import { useRef, useState } from 'react';
import AvatarIcon from './AvatarIcon';
import useAnalysis from '../hooks/useAnalysis';

const MAX_CHARS = 500;

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

function AnalysisPost({ post, onReply }) {
  return (
    <div className="analysis-post">
      {post.replyTo && (
        <div className="analysis-quote-block">
          <AvatarIcon seed={post.replyToAvatarSeed} size={14} />
          <span className="analysis-quote-text">
            {post.replyToText}{post.replyToText?.length >= 80 ? '…' : ''}
          </span>
        </div>
      )}
      <div className="analysis-post-main">
        <AvatarIcon seed={post.avatarSeed} size={28} />
        <div className="analysis-post-content">
          <p className="analysis-post-text">{post.text}</p>
          <div className="analysis-post-footer">
            <span className="analysis-post-time">{timeAgo(post.createdAt)}</span>
            <button className="analysis-reply-btn" onClick={onReply}>返信</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnalysisPanel({ textId, avatarSeed, analysisTheme }) {
  const { posts, addPost } = useAnalysis(textId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [replyContext, setReplyContext] = useState(null);
  const textareaRef = useRef(null);

  const handleReply = (post) => {
    setReplyContext({ id: post.id, text: post.text, avatarSeed: post.avatarSeed });
    textareaRef.current?.focus();
  };

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await addPost({
        text,
        avatarSeed,
        replyTo: replyContext?.id ?? null,
        replyToText: replyContext ? replyContext.text.substring(0, 80) : null,
        replyToAvatarSeed: replyContext?.avatarSeed ?? null,
      });
      setText('');
      setReplyContext(null);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (e) {
      setError(e.message === 'rate_limit' ? '1分おきに1回投稿できます' : '投稿に失敗しました');
    } finally {
      setSending(false);
    }
  };

  const remaining = MAX_CHARS - text.length;

  return (
    <div className="analysis-panel">
      {analysisTheme && (
        <div className="analysis-theme">
          <span className="analysis-theme-label">テーマ</span>
          <p className="analysis-theme-text">{analysisTheme}</p>
        </div>
      )}

      <div className="analysis-form">
        <AvatarIcon seed={avatarSeed} size={32} />
        <div className="analysis-form-inner">
          {replyContext && (
            <div className="analysis-reply-context">
              <AvatarIcon seed={replyContext.avatarSeed} size={14} />
              <span className="analysis-reply-text">
                {replyContext.text.substring(0, 60)}{replyContext.text.length > 60 ? '…' : ''}
              </span>
              <button className="analysis-reply-dismiss" onClick={() => setReplyContext(null)}>✕</button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="analysis-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="意見・考察を投稿…"
            rows={3}
            maxLength={MAX_CHARS}
          />
          <div className="analysis-form-footer">
            <span className={`analysis-char-count${remaining < 50 ? ' warn' : ''}`}>{remaining}</span>
            {error && <span className="analysis-error">{error}</span>}
            {done && <span className="analysis-done">投稿しました</span>}
            <button
              className="analysis-send-btn"
              onClick={submit}
              disabled={sending || !text.trim() || remaining < 0}
            >
              {sending ? '投稿中…' : '投稿'}
            </button>
          </div>
        </div>
      </div>

      <div className="analysis-feed">
        {posts.length === 0 && (
          <p className="analysis-empty">まだ投稿がありません。最初の考察をどうぞ。</p>
        )}
        {posts.map(post => (
          <AnalysisPost key={post.id} post={post} onReply={() => handleReply(post)} />
        ))}
      </div>
    </div>
  );
}
