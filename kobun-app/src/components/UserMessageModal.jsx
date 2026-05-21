import { useState } from 'react';
import { MESSAGE_STATUS, useMyAdminMessages } from '../hooks/useAdminMessages';

function fmtDate(value) {
  const ms = value?.toMillis?.() ?? 0;
  if (!ms) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

export default function UserMessageModal({ user, textbooks = [], selectedTextId = '', onClose }) {
  const { messages, sendMessage } = useMyAdminMessages(user);
  const [text, setText] = useState('');
  const [textbookId, setTextbookId] = useState(selectedTextId || 'other');
  const [status, setStatus] = useState('');
  const selectedTextbook = textbooks.find(item => item.id === textbookId);

  const submitMessage = async () => {
    setStatus('');
    if (!text.trim()) return;
    await sendMessage({
      text,
      textbookId,
      textbookTitle: selectedTextbook ? `${selectedTextbook.title}` : 'その他',
    });
    setText('');
    setStatus('メッセージを送信しました');
  };

  return (
    <div className="user-contact-overlay" role="dialog" aria-modal="true">
      <div className="user-contact-modal">
        <div className="user-contact-header">
          <div>
            <h2>管理者へ連絡</h2>
            <p>管理者への問い合わせを送信できます。</p>
          </div>
          <button onClick={onClose}>×</button>
        </div>

        <section className="user-contact-section">
          <h3>問い合わせ</h3>
          <label className="user-contact-field">
            教材
            <select value={textbookId} onChange={e => setTextbookId(e.target.value)}>
              {textbooks.map(item => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
              <option value="other">その他</option>
            </select>
          </label>
          <textarea
            value={text}
            maxLength={500}
            onChange={e => setText(e.target.value)}
            placeholder="管理者に伝えたい内容を入力してください"
            rows={5}
          />
          <div className="user-contact-actions">
            <span>{text.length}/500</span>
            <button onClick={submitMessage} disabled={!text.trim()}>送信</button>
          </div>
        </section>

        {status && <div className="user-contact-status">{status}</div>}

        <section className="user-contact-section user-contact-history">
          <h3>送信履歴</h3>
          {messages.map(message => (
            <div key={message.id} className="user-contact-message">
              <div>
                <strong>{MESSAGE_STATUS[message.status] ?? '未対応'}</strong>
                <span>{message.textbookTitle || 'その他'}</span>
                <span>{fmtDate(message.createdAt)}</span>
              </div>
              <p>{message.text}</p>
            </div>
          ))}
          {messages.length === 0 && <p className="user-contact-empty">送信履歴はまだありません</p>}
        </section>
      </div>
    </div>
  );
}
