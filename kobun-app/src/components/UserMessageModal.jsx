import { useState } from 'react';
import { MESSAGE_STATUS, useMyAdminMessages } from '../hooks/useAdminMessages';
import { STUDENT_CODE_RE } from '../hooks/useAccount';

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

export default function UserMessageModal({ user, account, onRequestStudentCode, onClose }) {
  const { messages, sendMessage } = useMyAdminMessages(user);
  const [code, setCode] = useState(account?.requestedStudentCode ?? account?.studentCode ?? '');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');

  const submitCode = async () => {
    const normalized = code.trim().toUpperCase();
    setStatus('');
    if (!STUDENT_CODE_RE.test(normalized)) {
      setStatus('利用番号は 1A00 から 1H99 の形式で入力してください');
      return;
    }
    await onRequestStudentCode(normalized);
    setCode(normalized);
    setStatus('利用番号を申請しました');
  };

  const submitMessage = async () => {
    setStatus('');
    if (!text.trim()) return;
    await sendMessage(text);
    setText('');
    setStatus('メッセージを送信しました');
  };

  return (
    <div className="user-contact-overlay" role="dialog" aria-modal="true">
      <div className="user-contact-modal">
        <div className="user-contact-header">
          <div>
            <h2>管理者へ連絡</h2>
            <p>利用番号の申請と問い合わせを送信できます。</p>
          </div>
          <button onClick={onClose}>×</button>
        </div>

        <section className="user-contact-section">
          <h3>利用番号</h3>
          <div className="user-contact-code">
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="1A00"
              maxLength={4}
            />
            <button onClick={submitCode}>申請する</button>
          </div>
          <p>現在の登録: {account?.studentCode ?? '未登録'} / 申請中: {account?.requestedStudentCode ?? '-'}</p>
        </section>

        <section className="user-contact-section">
          <h3>問い合わせ</h3>
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
