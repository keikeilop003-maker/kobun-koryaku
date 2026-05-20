import { useMemo, useRef, useState } from 'react';
import AvatarIcon from './AvatarIcon';

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
  const m = String(url ?? '').match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function AttachmentItem({ attachment }) {
  const type = attachmentType(attachment.url);
  if (type === 'youtube') {
    const vid = youtubeId(attachment.url);
    return (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="analysis-attachment-yt">
        {vid && <img src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`} alt={attachment.name} className="analysis-attachment-yt-thumb" />}
        <span className="analysis-attachment-yt-label">{attachment.name}</span>
      </a>
    );
  }
  if (type === 'image') {
    return (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="analysis-attachment-img">
        <img src={attachment.url} alt={attachment.name} className="analysis-attachment-img-preview" />
        <span className="analysis-attachment-img-label">{attachment.name}</span>
      </a>
    );
  }
  return (
    <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="analysis-theme-attachment">
      資料: {attachment.name}
    </a>
  );
}

function ThemeHeader({ theme, open, onToggle, postCount }) {
  return (
    <button type="button" className="analysis-theme-header" onClick={onToggle}>
      <span className="analysis-theme-header-body">
        <span className="analysis-theme-title">{theme.title}</span>
        {theme.description && <span className="analysis-theme-desc">{theme.description}</span>}
        <span className="analysis-theme-meta">{postCount}件の投稿</span>
      </span>
      <span className="analysis-theme-toggle">{open ? '閉じる' : '開く'}</span>
    </button>
  );
}

function ThemeForm({ onSave, initialTheme = null, triggerLabel = 'テーマを追加' }) {
  const [open, setOpen] = useState(Boolean(initialTheme));
  const [title, setTitle] = useState(initialTheme?.title ?? '');
  const [description, setDescription] = useState(initialTheme?.description ?? '');
  const [modelAnswer, setModelAnswer] = useState(initialTheme?.modelAnswer ?? '');
  const [attachmentName, setAttachmentName] = useState(initialTheme?.attachments?.[0]?.name ?? '');
  const [attachmentUrl, setAttachmentUrl] = useState(initialTheme?.attachments?.[0]?.url ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const attachments = attachmentName.trim() && attachmentUrl.trim()
        ? [{ name: attachmentName.trim(), url: attachmentUrl.trim() }]
        : [];
      await onSave({ title, description, modelAnswer, attachments });
      if (!initialTheme) {
        setTitle('');
        setDescription('');
        setModelAnswer('');
        setAttachmentName('');
        setAttachmentUrl('');
      }
      setOpen(false);
      setMessage('保存しました');
      window.setTimeout(() => setMessage(''), 2000);
    } catch (e) {
      setMessage(`保存に失敗しました: ${e.code ?? e.message ?? 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="analysis-admin-tools">
      <div className="analysis-admin-toolbar">
        <button type="button" onClick={() => setOpen(value => !value)}>
          {open ? '閉じる' : triggerLabel}
        </button>
        {message && <span className={message.includes('失敗') ? 'analysis-admin-error' : 'analysis-admin-done'}>{message}</span>}
      </div>
      {open && (
        <div className="analysis-admin-form">
          <label>
            テーマ
            <input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} />
          </label>
          <label>
            説明
            <textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={1000} />
          </label>
          <label>
            模範解答
            <textarea value={modelAnswer} onChange={event => setModelAnswer(event.target.value)} rows={4} maxLength={2000} />
          </label>
          <div className="analysis-admin-grid">
            <label>
              資料名
              <input value={attachmentName} onChange={event => setAttachmentName(event.target.value)} />
            </label>
            <label>
              URL
              <input value={attachmentUrl} onChange={event => setAttachmentUrl(event.target.value)} />
            </label>
          </div>
          <div className="analysis-admin-actions">
            <button type="button" onClick={submit} disabled={saving || !title.trim()}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button type="button" className="analysis-admin-secondary" onClick={() => setOpen(false)} disabled={saving}>
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PostForm({ theme, avatarSeed, equipped, addPost, replyContext = null, onCancelReply, onDone }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const textareaRef = useRef(null);
  const remaining = MAX_CHARS - text.length;

  const submit = async () => {
    if (!text.trim() || sending || remaining < 0) return;
    setSending(true);
    setError('');
    try {
      await addPost({
        text,
        avatarSeed,
        themeId: theme.id,
        replyTo: replyContext?.id ?? null,
        replyToText: replyContext?.text ?? null,
        replyToAvatarSeed: replyContext?.avatarSeed ?? null,
        equipped,
      });
      setText('');
      setDone(true);
      onCancelReply?.();
      onDone?.();
      window.setTimeout(() => setDone(false), 1800);
    } catch (e) {
      setError(e.message === 'rate_limit' ? '投稿は1分に1回までです。' : '投稿に失敗しました。');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="analysis-form-inline">
      <AvatarIcon seed={avatarSeed} size={28} equipped={equipped} />
      <div className="analysis-form-inner">
        {replyContext && (
          <div className="analysis-reply-context">
            <span className="analysis-reply-text">返信先: {replyContext.text.slice(0, 60)}{replyContext.text.length > 60 ? '...' : ''}</span>
            <button type="button" className="analysis-reply-dismiss" onClick={onCancelReply}>解除</button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="analysis-textarea"
          value={text}
          onChange={event => setText(event.target.value)}
          placeholder={replyContext ? '返信を入力...' : '意見・考察を投稿...'}
          rows={3}
          maxLength={MAX_CHARS}
        />
        <div className="analysis-form-footer">
          <span className={`analysis-char-count${remaining < 50 ? ' warn' : ''}`}>{remaining}</span>
          {error && <span className="analysis-error">{error}</span>}
          {done && <span className="analysis-done">投稿しました</span>}
          <button type="button" className="analysis-send-btn" onClick={submit} disabled={sending || !text.trim() || remaining < 0}>
            {sending ? '投稿中...' : '投稿'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PostItem({ post, replies, reactions, currentUid, avatarSeed, equipped, isAdmin, onReply, onToggleReaction, onTogglePin, isReply = false }) {
  const [open, setOpen] = useState(true);
  const likeCount = reactions.filter(reaction => reaction.postId === post.id && reaction.type === 'like').length;
  const myLike = reactions.some(reaction => (
    reaction.postId === post.id
    && reaction.type === 'like'
    && (reaction.authorUid === currentUid || (!reaction.authorUid && reaction.avatarSeed === avatarSeed))
  ));
  const isOwner = post.authorUid === currentUid || (!post.authorUid && post.avatarSeed === avatarSeed);
  const canPin = isAdmin || isOwner;
  const pinned = Boolean(post.pinnedByAdmin || post.pinnedByOwner);
  const hasReplies = replies.length > 0;

  return (
    <article className={`analysis-post${isReply ? ' analysis-post--reply' : ''}${pinned ? ' analysis-post--pinned' : ''}`}>
      <div className="analysis-post-main">
        <div className="analysis-post-avatar">
          <AvatarIcon seed={post.avatarSeed ?? 'anon'} size={isReply ? 22 : 28} equipped={post.equipped ?? null} />
          {hasReplies && !isReply && <div className="analysis-thread-line" />}
        </div>
        <div className="analysis-post-content">
          <div className="analysis-post-head">
            <span className="analysis-author-label">匿名ユーザー</span>
            {pinned && <span className="analysis-pin-badge">固定</span>}
            <span className="analysis-post-time">{timeAgo(post.createdAt)}</span>
          </div>
          <p className="analysis-post-text">{post.text}</p>
          {post.correction && (
            <div className="analysis-correction">
              <div className="analysis-correction-title">添削結果: {post.correction.judgement}</div>
              {post.correction.comment && <p>{post.correction.comment}</p>}
            </div>
          )}
          <div className="analysis-post-actions">
            {!isReply && (
              <button type="button" className="analysis-action-btn" onClick={() => onReply(post)}>
                返信
              </button>
            )}
            <button
              type="button"
              className={`analysis-action-btn${myLike ? ' active-like' : ''}`}
              onClick={() => onToggleReaction({ postId: post.id, type: 'like' })}
            >
              {myLike ? 'いいね済み' : 'いいね'}
              {likeCount > 0 && <span className="analysis-action-count">{likeCount}</span>}
            </button>
            {canPin && (
              <button type="button" className={`analysis-action-btn${pinned ? ' active-pin' : ''}`} onClick={() => onTogglePin(post)}>
                {pinned ? '固定解除' : '固定'}
              </button>
            )}
            {hasReplies && !isReply && (
              <button type="button" className="analysis-replies-toggle" onClick={() => setOpen(value => !value)}>
                {open ? '返信を隠す' : `返信 ${replies.length}件`}
              </button>
            )}
          </div>
          {open && hasReplies && (
            <div className="analysis-replies">
              {replies.map(reply => (
                <PostItem
                  key={reply.id}
                  post={reply}
                  replies={[]}
                  reactions={reactions}
                  currentUid={currentUid}
                  avatarSeed={avatarSeed}
                  equipped={equipped}
                  isAdmin={isAdmin}
                  onReply={onReply}
                  onToggleReaction={onToggleReaction}
                  onTogglePin={onTogglePin}
                  isReply
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function splitPosts(posts) {
  const topLevel = [];
  const repliesByParent = {};
  for (const post of posts) {
    if (post.replyTo) {
      repliesByParent[post.replyTo] = repliesByParent[post.replyTo] ?? [];
      repliesByParent[post.replyTo].push(post);
    } else {
      topLevel.push(post);
    }
  }
  topLevel.sort((a, b) => Number(Boolean(b.pinnedByAdmin || b.pinnedByOwner)) - Number(Boolean(a.pinnedByAdmin || a.pinnedByOwner)));
  return { topLevel, repliesByParent };
}

function ShareTheme({ theme, posts, reactions, analysis, avatarSeed, equipped, currentUid, isAdmin }) {
  const [open, setOpen] = useState(false);
  const [replyContext, setReplyContext] = useState(null);
  const { topLevel, repliesByParent } = useMemo(() => splitPosts(posts), [posts]);

  return (
    <section className={`analysis-theme-item${open ? ' open' : ''}`}>
      <ThemeHeader theme={theme} open={open} onToggle={() => setOpen(value => !value)} postCount={posts.length} />
      {open && (
        <div className="analysis-thread">
          {theme.modelAnswer && (
            <div className="analysis-model-answer">
              <div className="analysis-model-answer-title">模範解答</div>
              <p>{theme.modelAnswer}</p>
            </div>
          )}
          {theme.attachments?.length > 0 && (
            <div className="analysis-theme-attachments">
              {theme.attachments.map((attachment, index) => <AttachmentItem key={index} attachment={attachment} />)}
            </div>
          )}
          {topLevel.length === 0 ? (
            <p className="analysis-empty-thread">まだ投稿がありません。</p>
          ) : (
            topLevel.map(post => (
              <PostItem
                key={post.id}
                post={post}
                replies={repliesByParent[post.id] ?? []}
                reactions={reactions}
                currentUid={currentUid}
                avatarSeed={avatarSeed}
                equipped={equipped}
                isAdmin={isAdmin}
                onReply={setReplyContext}
                onToggleReaction={analysis.toggleReaction}
                onTogglePin={analysis.togglePin}
              />
            ))
          )}
          {replyContext && (
            <PostForm
              theme={theme}
              avatarSeed={avatarSeed}
              equipped={equipped}
              addPost={analysis.addReply}
              replyContext={replyContext}
              onCancelReply={() => setReplyContext(null)}
            />
          )}
        </div>
      )}
    </section>
  );
}

export function ShareBoard({ analysis, avatarSeed, equipped, currentUid, isAdmin }) {
  const themes = analysis?.themes ?? [];
  const posts = analysis?.posts ?? [];
  const reactions = analysis?.reactions ?? [];

  return (
    <div className="share-board">
      <div className="share-board-title">共有ボード</div>
      {analysis?.loadingThemes && <p className="analysis-empty">テーマを読み込み中です。</p>}
      {themes.map(theme => (
        <ShareTheme
          key={theme.id}
          theme={theme}
          posts={posts.filter(post => post.themeId === theme.id)}
          reactions={reactions}
          analysis={analysis}
          avatarSeed={avatarSeed}
          equipped={equipped}
          currentUid={currentUid}
          isAdmin={isAdmin}
        />
      ))}
      {!analysis?.loadingThemes && themes.length === 0 && <p className="analysis-empty">テーマがまだ設定されていません。</p>}
    </div>
  );
}

function AnalysisThemeComposer({ theme, posts, analysis, avatarSeed, equipped, isAdmin }) {
  const [editing, setEditing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [message, setMessage] = useState('');
  const uncorrectedCount = posts.filter(post => !post.replyTo && !post.correction).length;

  const correctAll = async () => {
    if (correcting) return;
    setCorrecting(true);
    setMessage('');
    try {
      const result = await analysis.batchCorrectThemePosts(theme.id);
      setMessage(`${result.corrected}件を添削しました`);
    } catch (e) {
      setMessage(`添削に失敗しました: ${e.code ?? e.message ?? 'unknown error'}`);
    } finally {
      setCorrecting(false);
    }
  };

  return (
    <section className="analysis-compose-card">
      <div className="analysis-compose-head">
        <div>
          <h3>{theme.title}</h3>
          {theme.description && <p>{theme.description}</p>}
          <span className="analysis-compose-label">このテーマへの投稿フォーム</span>
        </div>
        {isAdmin && (
          <div className="analysis-theme-admin-actions">
            <button type="button" onClick={() => setEditing(value => !value)}>{editing ? '編集を閉じる' : 'テーマ編集'}</button>
            <button type="button" onClick={correctAll} disabled={correcting || uncorrectedCount === 0}>
              {correcting ? '添削中...' : `一斉添削 (${uncorrectedCount})`}
            </button>
          </div>
        )}
      </div>
      {message && <div className={message.includes('失敗') ? 'analysis-admin-error' : 'analysis-admin-done'}>{message}</div>}
      {editing && (
        <ThemeForm
          initialTheme={theme}
          triggerLabel="編集フォーム"
          onSave={payload => analysis.updateTheme(theme.id, payload)}
        />
      )}
      <PostForm theme={theme} avatarSeed={avatarSeed} equipped={equipped} addPost={analysis.addPost} />
    </section>
  );
}

export default function AnalysisPanel({ analysis, avatarSeed, equipped, isAdmin }) {
  const themes = analysis?.themes ?? [];
  const posts = analysis?.posts ?? [];

  return (
    <div className="analysis-panel">
      <div className="analysis-panel-intro">
        <strong>分析研究</strong>
        <span>テーマごとに意見を投稿できます。投稿後は左の共有ボードに表示されます。</span>
      </div>
      {isAdmin && <ThemeForm onSave={analysis.addTheme} />}
      {analysis?.loadingThemes && <p className="analysis-empty">テーマを読み込み中です。</p>}
      {themes.map(theme => (
        <AnalysisThemeComposer
          key={theme.id}
          theme={theme}
          posts={posts.filter(post => post.themeId === theme.id)}
          analysis={analysis}
          avatarSeed={avatarSeed}
          equipped={equipped}
          isAdmin={isAdmin}
        />
      ))}
      {!analysis?.loadingThemes && themes.length === 0 && <p className="analysis-empty">テーマがまだ設定されていません。</p>}
    </div>
  );
}
