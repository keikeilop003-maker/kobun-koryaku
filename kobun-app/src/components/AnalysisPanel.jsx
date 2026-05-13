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

function attachmentType(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)) return 'image';
  return 'link';
}
function youtubeId(url) {
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function AttachmentItem({ a }) {
  const type = attachmentType(a.url);
  if (type === 'youtube') {
    const vid = youtubeId(a.url);
    return (
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="analysis-attachment-yt">
        {vid && <img src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`} alt={a.name} className="analysis-attachment-yt-thumb" />}
        <span className="analysis-attachment-yt-label">▶ {a.name}</span>
      </a>
    );
  }
  if (type === 'image') {
    return (
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="analysis-attachment-img">
        <img src={a.url} alt={a.name} className="analysis-attachment-img-preview" />
        <span className="analysis-attachment-img-label">{a.name}</span>
      </a>
    );
  }
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer" className="analysis-theme-attachment">
      📎 {a.name}
    </a>
  );
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
          <AvatarIcon seed={post.avatarSeed} size={isReply ? 22 : 28} equipped={post.equipped ?? null} />
          {hasReplies && !isReply && <div className="analysis-thread-line" />}
        </div>
        <div className="analysis-post-content">
          <p className={`analysis-post-text${hasReplies && !isReply ? ' clickable' : ''}`}
            onClick={() => hasReplies && !isReply && setOpen(o => !o)}>
            {post.text}
          </p>
          <div className="analysis-post-actions">
            <button className="analysis-action-btn" onClick={e => { e.stopPropagation(); onReply(post); }} title="返信">
              <ReplyIcon />
            </button>
            <button className={`analysis-action-btn${myLike ? ' active-like' : ''}`}
              onClick={e => { e.stopPropagation(); onToggleReaction({ postId: post.id, avatarSeed, type: 'like' }); }} title="いいね">
              {myLike ? '♥' : '♡'}
              {likeCount > 0 && <span className="analysis-action-count">{likeCount}</span>}
            </button>
            <button className={`analysis-action-btn${myDoubt ? ' active-doubt' : ''}`}
              onClick={e => { e.stopPropagation(); onToggleReaction({ postId: post.id, avatarSeed, type: 'doubt' }); }} title="疑義">
              ？{doubtCount > 0 && <span className="analysis-action-count">{doubtCount}</span>}
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
                <PostItem key={r.id} post={r} replies={[]} reactions={reactions} avatarSeed={avatarSeed}
                  onReply={onReply} onToggleReaction={onToggleReaction} isReply />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeItem({ theme, posts, reactions, avatarSeed, equipped, addPost, toggleReaction, isAdmin, onUpdateTheme, onDeleteTheme }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [replyContext, setReplyContext] = useState(null);
  const textareaRef = useRef(null);

  const topLevel = posts.filter(p => !p.replyTo);
  const repliesByParent = posts.filter(p => p.replyTo).reduce((acc, r) => {
    acc[r.replyTo] = acc[r.replyTo] ?? [];
    acc[r.replyTo].push(r);
    return acc;
  }, {});

  const handleReply = (post) => {
    setReplyContext({ id: post.id, text: post.text, avatarSeed: post.avatarSeed });
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await addPost({
        text, avatarSeed,
        themeId: theme.id,
        replyTo: replyContext?.id ?? null,
        replyToText: replyContext ? replyContext.text.substring(0, 80) : null,
        replyToAvatarSeed: replyContext?.avatarSeed ?? null,
        equipped: equipped ?? null,
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
    <div className={`analysis-theme-item${open ? ' open' : ''}`}>
      <div className="analysis-theme-header" onClick={() => setOpen(o => !o)}>
        <div className="analysis-theme-header-body">
          <p className="analysis-theme-title">{theme.title}</p>
          <p className="analysis-theme-desc">{theme.description}</p>
          {theme.attachments?.length > 0 && (
            <div className="analysis-theme-attachments" onClick={e => e.stopPropagation()}>
              {theme.attachments.map((a, i) => <AttachmentItem key={i} a={a} />)}
            </div>
          )}
        </div>
        <span className="analysis-theme-toggle">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="analysis-thread">
          {isAdmin && (
            <div className="analysis-theme-admin-actions">
              <button onClick={() => setEditing(value => !value)}>{editing ? '編集を閉じる' : 'テーマ編集'}</button>
              <button
                className="analysis-admin-danger"
                onClick={async () => {
                  if (!window.confirm('このテーマを削除しますか？関連する投稿は残ります。')) return;
                  await onDeleteTheme?.(theme.id);
                }}
              >
                テーマ削除
              </button>
            </div>
          )}
          {editing && (
            <AdminThemeForm
              mode="edit"
              initialTheme={theme}
              onSave={async (payload) => {
                await onUpdateTheme?.(theme.id, payload);
                setEditing(false);
              }}
            />
          )}
          {topLevel.length === 0 && (
            <p className="analysis-empty-thread">まだ投稿がありません。最初の考察をどうぞ。</p>
          )}
          {topLevel.map(post => (
            <PostItem key={post.id} post={post} replies={repliesByParent[post.id] ?? []}
              reactions={reactions} avatarSeed={avatarSeed}
              onReply={handleReply} onToggleReaction={toggleReaction} />
          ))}

          <div className="analysis-form-inline">
            <AvatarIcon seed={avatarSeed} size={28} equipped={equipped} />
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
                <button className="analysis-send-btn" onClick={submit}
                  disabled={sending || !text.trim() || remaining < 0}>
                  {sending ? '投稿中…' : '投稿'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminThemeForm({ onSave, mode = 'add', initialTheme = null }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTheme?.title ?? '');
  const [description, setDescription] = useState(initialTheme?.description ?? '');
  const [attachmentName, setAttachmentName] = useState(initialTheme?.attachments?.[0]?.name ?? '');
  const [attachmentUrl, setAttachmentUrl] = useState(initialTheme?.attachments?.[0]?.url ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const isEdit = mode === 'edit';

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const attachments = attachmentName.trim() && attachmentUrl.trim()
        ? [{ name: attachmentName.trim(), url: attachmentUrl.trim() }]
        : [];
      await onSave({ title, description, attachments });
      if (!isEdit) {
        setTitle('');
        setDescription('');
        setAttachmentName('');
        setAttachmentUrl('');
      }
      setOpen(false);
      setMessage(isEdit ? '更新しました' : '追加しました');
      setTimeout(() => setMessage(''), 2000);
    } catch (e) {
      console.error('[analysis theme] save failed:', e);
      setMessage(`${isEdit ? '更新' : '追加'}に失敗しました: ${e.code ?? e.message ?? 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="analysis-admin-tools">
      <div className="analysis-admin-toolbar">
        <button onClick={() => setOpen(o => !o)}>{open ? '閉じる' : (isEdit ? '編集フォーム' : '項目追加')}</button>
        {message && <span className={message.includes('失敗') ? 'analysis-admin-error' : 'analysis-admin-done'}>{message}</span>}
      </div>
      {open && (
        <div className="analysis-admin-form">
          <label>
            タイトル
            <input value={title} onChange={e => setTitle(e.target.value)} />
          </label>
          <label>
            説明
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </label>
          <div className="analysis-admin-grid">
            <label>
              添付名
              <input value={attachmentName} onChange={e => setAttachmentName(e.target.value)} />
            </label>
            <label>
              URL
              <input value={attachmentUrl} onChange={e => setAttachmentUrl(e.target.value)} />
            </label>
          </div>
          <div className="analysis-admin-actions">
            <button onClick={submit} disabled={saving || !title.trim()}>{saving ? '保存中…' : (isEdit ? '更新' : '保存')}</button>
            <button className="analysis-admin-secondary" onClick={() => setOpen(false)} disabled={saving}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalysisPanel({ textId, avatarSeed, equipped, isAdmin }) {
  const { theme: themeDoc, posts, addPost, reactions, toggleReaction, addTheme, updateTheme, deleteTheme } = useAnalysis(textId);
  const themes = themeDoc?.themes ?? [];

  return (
    <div className="analysis-panel">
      {isAdmin && <AdminThemeForm onSave={addTheme} />}
      {themes.map(theme => (
        <ThemeItem
          key={theme.id}
          theme={theme}
          posts={posts.filter(p => p.themeId === theme.id)}
          reactions={reactions}
          avatarSeed={avatarSeed}
          equipped={equipped}
          addPost={addPost}
          toggleReaction={toggleReaction}
          isAdmin={isAdmin}
          onUpdateTheme={updateTheme}
          onDeleteTheme={deleteTheme}
        />
      ))}
      {themes.length === 0 && (
        <p className="analysis-empty">テーマが設定されていません。</p>
      )}
    </div>
  );
}
