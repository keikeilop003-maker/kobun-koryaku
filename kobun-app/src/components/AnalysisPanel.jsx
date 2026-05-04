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

const ReplyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

function PostItem({ post, replies, reactions, avatarSeed, onReply, onToggleReaction, isReply }) {
  const [open, setOpen] = useState(false);
  const likeCount = reactions.filter(r => r.postId === post.id && r.type === 'like').length;
  const doubtCount = reactions.filter(r => r.postId === post.id && r.type === 'doubt').length;
  const myLike = reactions.some(r => r.postId === post.id && r.avatarSeed === avatarSeed && r.type === 'like');
  const myDoubt = reactions.some(r => r.postId === post.id && r.avatarSeed === avatarSeed && r.type === 'doubt');
  const hasReplies = replies.length > 0;

  return (
    <div className={`analysis-post${isReply ? ' analysis-post--reply' : ''}`}>
      <div className="analysis-post-main">
        <div className="analysis-post-avatar">
          <AvatarIcon seed={post.avatarSeed} size={isReply ? 22 : 28} />
          {hasReplies && !isReply && <div className="analysis-thread-line" />}
        </div>
        <div className="analysis-post-content">
          <p
            className={`analysis-post-text${hasReplies && !isReply ? ' clickable' : ''}`}
            onClick={() => hasReplies && !isReply && setOpen(o => !o)}
          >
            {post.text}
          </p>
          <div className="analysis-post-actions">
            <button
              className="analysis-action-btn"
              onClick={e => { e.stopPropagation(); onReply(post); }}
              title="返信"
            >
              <ReplyIcon />
            </button>
            <button
              className={`analysis-action-btn${myLike ? ' active-like' : ''}`}
              onClick={e => { e.stopPropagation(); onToggleReaction({ postId: post.id, avatarSeed, type: 'like' }); }}
              title="いいね"
            >
              {myLike ? '♥' : '♡'}
              {likeCount > 0 && <span className="analysis-action-count">{likeCount}</span>}
            </button>
            <button
              className={`analysis-action-btn${myDoubt ? ' active-doubt' : ''}`}
              onClick={e => { e.stopPropagation(); onToggleReaction({ postId: post.id, avatarSeed, type: 'doubt' }); }}
              title="疑義"
            >
              ？
              {doubtCount > 0 && <span className="analysis-action-count">{doubtCount}</span>}
            </button>
            <span className="analysis-post-time">{timeAgo(post.createdAt)}</span>
            {hasReplies && !isReply && (
              <button className="analysis-replies-toggle" onClick={() => setOpen(o => !o)}>
                {open ? '▲' : `返信 ${replies.length}件`}
              </button>
            )}
          </div>

          {open && (
            <div className="analysis-replies">
              {replies.map(r => (
                <PostItem
                  key={r.id}
                  post={r}
                  replies={[]}
                  reactions={reactions}
                  avatarSeed={avatarSeed}
                  onReply={onReply}
                  onToggleReaction={onToggleReaction}
                  isReply
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AnalysisPanel({ textId, avatarSeed }) {
  const { theme, posts, addPost, reactions, toggleReaction } = useAnalysis(textId);
  const [formOpen, setFormOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [replyContext, setReplyContext] = useState(null);
  const textareaRef = useRef(null);

  const handleReply = (post) => {
    setReplyContext({ id: post.id, text: post.text, avatarSeed: post.avatarSeed });
    setFormOpen(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
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

  const topLevel = posts.filter(p => !p.replyTo);
  const repliesByParent = posts.filter(p => p.replyTo).reduce((acc, r) => {
    acc[r.replyTo] = acc[r.replyTo] ?? [];
    acc[r.replyTo].push(r);
    return acc;
  }, {});

  const remaining = MAX_CHARS - text.length;

  return (
    <div className="analysis-panel">
      {theme && (
        <div className={`analysis-theme${formOpen ? ' open' : ''}`} onClick={() => setFormOpen(o => !o)}>
          <div className="analysis-theme-body">
            <p className="analysis-theme-title">{theme.title}</p>
            {theme.description && (
              <p className="analysis-theme-desc">{theme.description}</p>
            )}
            {theme.attachments?.length > 0 && (
              <div className="analysis-theme-attachments" onClick={e => e.stopPropagation()}>
                {theme.attachments.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="analysis-theme-attachment">
                    📎 {a.name}
                  </a>
                ))}
              </div>
            )}
          </div>
          <span className="analysis-theme-toggle">{formOpen ? '▲' : '✎'}</span>
        </div>
      )}

      {formOpen && (
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
              placeholder={replyContext ? '返信を入力…' : '意見・考察を投稿…'}
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
      )}

      <div className="analysis-feed">
        {topLevel.length === 0 && (
          <p className="analysis-empty">まだ投稿がありません。テーマをクリックして最初の考察をどうぞ。</p>
        )}
        {topLevel.map(post => (
          <PostItem
            key={post.id}
            post={post}
            replies={repliesByParent[post.id] ?? []}
            reactions={reactions}
            avatarSeed={avatarSeed}
            onReply={handleReply}
            onToggleReaction={toggleReaction}
          />
        ))}
      </div>
    </div>
  );
}
