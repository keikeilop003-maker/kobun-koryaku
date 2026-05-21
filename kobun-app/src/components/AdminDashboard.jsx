import { useEffect, useMemo, useState } from 'react';
import useAdminData from '../hooks/useAdminData';
import { MESSAGE_STATUS, useAllAdminMessages } from '../hooks/useAdminMessages';
import { useAdminTopTools, useTopInformation } from '../hooks/useTopCommunications';
import { STUDENT_CODE_RE } from '../hooks/useAccount';
import { DEFAULT_EQUIPPED, ITEMS, SLOT_LABELS } from '../data/items';

const TABS = [
  { id: 'users', label: 'ユーザー一覧' },
  { id: 'history', label: '取り組み履歴' },
  { id: 'profile', label: 'プロフィール編集' },
  { id: 'codes', label: '利用番号申請' },
  { id: 'messages', label: 'メッセージ' },
  { id: 'top', label: 'TOP連絡' },
];

const HISTORY_LIMIT = 50;

function fmtDate(value) {
  const ms = typeof value === 'number' ? value : value?.toMillis?.();
  if (!ms) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function userLabel(user) {
  return user.account?.username || user.account?.loginId || user.account?.displayName || user.account?.email || user.uid;
}

function textTitle(textbooks, textId) {
  return textbooks.find(t => t.id === textId)?.title ?? textId;
}

function entryAttempts(entry) {
  return Array.isArray(entry?.attempts) ? entry.attempts : [];
}

function isCorrectJudgement(judgement) {
  return judgement === '正解' || judgement === '豁｣隗｣' || judgement === '雎・ｽ｣髫暦ｽ｣';
}

function historyRows(history, filter) {
  const entries = history?.entries ?? {};
  return Object.values(entries)
    .map(entry => {
      const attempts = entryAttempts(entry);
      const last = attempts.at(-1);
      const hasCorrect = attempts.some(attempt => isCorrectJudgement(attempt.judgement));
      return {
        ...entry,
        attemptCount: attempts.length,
        lastAt: Number(last?.at ?? 0),
        lastJudgement: last?.judgement ?? '-',
        lastAnswer: last?.feedback?.userAnswer ?? '',
        hasCorrect,
      };
    })
    .filter(entry => {
      if (filter === 'review') return !entry.hasCorrect;
      if (filter === 'recent') return entry.lastAt > 0;
      return true;
    })
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, HISTORY_LIMIT);
}

function UserTable({ users, textbooks }) {
  return (
    <div className="admin-dash-table-wrap">
      <table className="admin-dash-table">
        <thead>
          <tr>
            <th>ユーザー</th>
            <th>ユーザーネーム</th>
            <th>ひとこと</th>
            <th>Gmail</th>
            <th>最終ログイン</th>
            <th>利用番号</th>
            <th>ポイント</th>
            <th>最終学習</th>
            <th>解答</th>
            <th>正答率</th>
            <th>教材別</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.uid}>
              <td>{userLabel(user)}</td>
              <td>{user.account?.username || '-'}</td>
              <td>{user.account?.bio || '-'}</td>
              <td>{user.account?.email ?? '-'}</td>
              <td>{fmtDate(user.lastSeenAt)}</td>
              <td>{user.account?.studentCode ?? user.account?.requestedStudentCode ?? '-'}</td>
              <td>{user.profile?.points ?? 0} pt</td>
              <td>{fmtDate(user.summary.lastStudiedAt)}</td>
              <td>{user.summary.totalAttempts}</td>
              <td>{user.summary.totalAttempts ? `${user.summary.accuracy}%` : '-'}</td>
              <td>
                <div className="admin-dash-chips">
                  {Object.entries(user.summary.byText).map(([id, count]) => (
                    <span key={id}>{textTitle(textbooks, id)}: {count}</span>
                  ))}
                  {Object.keys(user.summary.byText).length === 0 && <span>記録なし</span>}
                </div>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr><td colSpan="11" className="admin-dash-empty">ユーザー情報がまだありません</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HistoryManager({ users, textbooks, onSaveEntries, onClearText }) {
  const [uid, setUid] = useState('');
  const [textId, setTextId] = useState('');
  const [filter, setFilter] = useState('review');
  const [message, setMessage] = useState('');
  const selectedUser = users.find(user => user.uid === uid) ?? users[0];
  const histories = selectedUser?.histories ?? [];
  const selectedHistory = histories.find(history => history.textId === textId) ?? histories[0];
  const currentTextId = selectedHistory?.textId ?? '';
  const rows = historyRows(selectedHistory, filter);

  const selectUser = (nextUid) => {
    setUid(nextUid);
    setTextId('');
    setMessage('');
  };

  const deleteEntry = async (entryId) => {
    if (!selectedUser || !selectedHistory || !window.confirm('この問題の履歴を削除しますか？')) return;
    const nextEntries = { ...(selectedHistory.entries ?? {}) };
    delete nextEntries[entryId];
    await onSaveEntries(selectedUser.uid, selectedHistory.textId, nextEntries);
    setMessage('履歴を削除しました');
  };

  const clearText = async () => {
    if (!selectedUser || !selectedHistory || !window.confirm('この教材の履歴をすべて削除しますか？')) return;
    await onClearText(selectedUser.uid, selectedHistory.textId);
    setMessage('教材の履歴をクリアしました');
  };

  if (!selectedUser) return <div className="admin-dash-empty">履歴のあるユーザーがまだありません</div>;

  return (
    <div className="admin-history-manager">
      <div className="admin-history-controls">
        <label>
          ユーザー
          <select value={selectedUser.uid} onChange={e => selectUser(e.target.value)}>
            {users.map(user => <option key={user.uid} value={user.uid}>{userLabel(user)}</option>)}
          </select>
        </label>
        <label>
          教材
          <select value={currentTextId} onChange={e => { setTextId(e.target.value); setMessage(''); }}>
            {histories.map(history => (
              <option key={history.textId} value={history.textId}>{textTitle(textbooks, history.textId)}</option>
            ))}
          </select>
        </label>
        <label>
          表示
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="review">要復習のみ</option>
            <option value="recent">直近順</option>
            <option value="all">全件から直近50件</option>
          </select>
        </label>
      </div>

      <div className="admin-history-summary">
        <span>表示は最大{HISTORY_LIMIT}件です。</span>
        <span>教材内の記録: {Object.keys(selectedHistory?.entries ?? {}).length}問</span>
        {message && <strong>{message}</strong>}
        {selectedHistory && <button onClick={clearText}>この教材の履歴をクリア</button>}
      </div>

      <div className="admin-dash-table-wrap">
        <table className="admin-dash-table admin-history-table">
          <thead>
            <tr>
              <th>問題</th>
              <th>種別</th>
              <th>最終判定</th>
              <th>回数</th>
              <th>最終回答</th>
              <th>最終学習</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(entry => (
              <tr key={entry.id}>
                <td>{entry.surface || entry.questionId || entry.id}</td>
                <td>{entry.type ?? '-'}</td>
                <td>{entry.lastJudgement}</td>
                <td>{entry.attemptCount}</td>
                <td>{entry.lastAnswer || '-'}</td>
                <td>{fmtDate(entry.lastAt)}</td>
                <td><button className="admin-danger-btn" onClick={() => deleteEntry(entry.id)}>削除</button></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan="7" className="admin-dash-empty">条件に合う履歴はありません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildProfileForm(profile = {}) {
  return {
    points: profile.points ?? 0,
    totalEarned: profile.totalEarned ?? 0,
    unlockedItems: profile.unlockedItems ?? ['style-pixel-art'],
    equipped: { ...DEFAULT_EQUIPPED, ...(profile.equipped ?? {}) },
  };
}

function ProfileForm({ selected, users, onSelect, onSave }) {
  const [form, setForm] = useState(() => buildProfileForm(selected.profile));
  const [message, setMessage] = useState('');
  const itemsBySlot = useMemo(() => {
    return ITEMS.reduce((acc, item) => {
      acc[item.slot] = acc[item.slot] ?? [];
      acc[item.slot].push(item);
      return acc;
    }, {});
  }, []);

  const toggleItem = (itemId) => {
    setForm(prev => {
      const owned = new Set(prev.unlockedItems);
      if (owned.has(itemId) && itemId !== 'style-pixel-art') owned.delete(itemId);
      else owned.add(itemId);
      return { ...prev, unlockedItems: [...owned] };
    });
  };

  const save = async () => {
    setMessage('');
    await onSave(selected.uid, {
      ...form,
      points: Math.max(0, Number(form.points) || 0),
      totalEarned: Math.max(0, Number(form.totalEarned) || 0),
    });
    setMessage('保存しました');
  };

  return (
    <div className="admin-profile-editor">
      <label>
        ユーザー
        <select value={selected.uid} onChange={e => onSelect(e.target.value)}>
          {users.map(user => <option key={user.uid} value={user.uid}>{userLabel(user)}</option>)}
        </select>
      </label>
      <div className="admin-profile-grid">
        <label>
          現在ポイント
          <input type="number" min="0" value={form.points} onChange={e => setForm({ ...form, points: e.target.value })} />
        </label>
        <label>
          累計ポイント
          <input type="number" min="0" value={form.totalEarned} onChange={e => setForm({ ...form, totalEarned: e.target.value })} />
        </label>
      </div>
      <div className="admin-profile-grid">
        {Object.keys(DEFAULT_EQUIPPED).map(slot => (
          <label key={slot}>
            装備: {SLOT_LABELS[slot] ?? slot}
            <select
              value={form.equipped?.[slot] ?? ''}
              onChange={e => setForm({ ...form, equipped: { ...form.equipped, [slot]: e.target.value || null } })}
            >
              <option value="">なし</option>
              {(itemsBySlot[slot] ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="admin-profile-items">
        {ITEMS.map(item => (
          <label key={item.id} className="admin-profile-item">
            <input
              type="checkbox"
              checked={form.unlockedItems.includes(item.id)}
              disabled={item.id === 'style-pixel-art'}
              onChange={() => toggleItem(item.id)}
            />
            <span>{item.name}</span>
            <small>{SLOT_LABELS[item.slot] ?? item.slot} / {item.cost}pt</small>
          </label>
        ))}
      </div>
      <div className="admin-dash-actions">
        {message && <span>{message}</span>}
        <button onClick={save}>プロフィールを保存</button>
      </div>
    </div>
  );
}

function ProfileEditor({ users, onSave }) {
  const [uid, setUid] = useState('');
  const selected = users.find(u => u.uid === uid) ?? users[0];

  if (!selected) return <div className="admin-dash-empty">編集できるユーザーがまだありません</div>;

  return (
    <ProfileForm
      key={selected.uid}
      selected={selected}
      users={users}
      onSelect={setUid}
      onSave={onSave}
    />
  );
}

function CodeRequests({ users, onSave }) {
  const [codes, setCodes] = useState({});
  const [message, setMessage] = useState('');
  const usedCodes = useMemo(() => {
    const map = new Map();
    users.forEach(user => {
      if (user.account?.studentCode) map.set(user.account.studentCode, user.uid);
    });
    return map;
  }, [users]);

  const save = async (user) => {
    const code = (codes[user.uid] ?? user.account?.requestedStudentCode ?? user.account?.studentCode ?? '').trim().toUpperCase();
    setMessage('');
    if (!STUDENT_CODE_RE.test(code)) {
      setMessage('利用番号は 1A00 から 1H99 の形式で入力してください');
      return;
    }
    const usedBy = usedCodes.get(code);
    if (usedBy && usedBy !== user.uid) {
      setMessage('その利用番号は別のユーザーに登録済みです');
      return;
    }
    await onSave(user.uid, code, 'approved');
    setCodes(prev => ({ ...prev, [user.uid]: code }));
    setMessage('保存しました');
  };

  return (
    <div className="admin-dash-list">
      <div className="admin-dash-note">
        利用番号申請は、登録された利用番号を管理者が確認済みにするための欄です。
        承認待ちでもユーザーの利用は制限されません。
      </div>
      {message && <div className="admin-dash-notice">{message}</div>}
      {users.map(user => (
        <div key={user.uid} className="admin-code-row">
          <div>
            <strong>{userLabel(user)}</strong>
            <span>{user.account?.email ?? '-'}</span>
            <span>申請: {user.account?.requestedStudentCode ?? '-'}</span>
            <span>状態: {user.account?.studentCodeStatus === 'approved' ? '承認済み' : user.account?.studentCodeStatus === 'rejected' ? '却下' : '承認待ち'}</span>
          </div>
          <input
            value={codes[user.uid] ?? user.account?.studentCode ?? user.account?.requestedStudentCode ?? ''}
            onChange={e => setCodes({ ...codes, [user.uid]: e.target.value.toUpperCase() })}
            placeholder="1A00"
            maxLength={4}
          />
          <button onClick={() => save(user)}>承認・保存</button>
        </div>
      ))}
      {users.length === 0 && <div className="admin-dash-empty">利用番号申請はまだありません</div>}
    </div>
  );
}

function TopCommunicationEditor({ users, information, directMessages, onSaveInformation, onSendMessage }) {
  const [title, setTitle] = useState(information?.title ?? '');
  const [body, setBody] = useState(information?.body ?? '');
  const [uid, setUid] = useState('');
  const [messageTitle, setMessageTitle] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [notice, setNotice] = useState('');
  const selectedUser = users.find(user => user.uid === uid) ?? users[0];

  useEffect(() => {
    setTitle(information?.title ?? '');
    setBody(information?.body ?? '');
  }, [information?.title, information?.body]);

  const saveInfo = async () => {
    setNotice('');
    await onSaveInformation({ title, body });
    setNotice('informationを保存しました');
  };

  const send = async () => {
    if (!selectedUser || !messageBody.trim()) {
      setNotice('送信先と本文を入力してください');
      return;
    }
    setNotice('');
    await onSendMessage({
      user: selectedUser,
      title: messageTitle || '管理者からのメッセージ',
      body: messageBody,
    });
    setMessageTitle('');
    setMessageBody('');
    setNotice('個別メッセージを送信しました');
  };

  return (
    <div className="admin-top-tools">
      {notice && <div className="admin-dash-notice">{notice}</div>}
      <section className="admin-top-card">
        <h2>TOP information</h2>
        <label>
          見出し
          <input value={title} onChange={event => setTitle(event.target.value)} maxLength={80} />
        </label>
        <label>
          本文
          <textarea value={body} onChange={event => setBody(event.target.value)} rows={5} maxLength={1000} />
        </label>
        <button onClick={saveInfo}>informationを保存</button>
      </section>

      <section className="admin-top-card">
        <h2>ユーザーへの個別メッセージ</h2>
        <label>
          送信先
          <select value={selectedUser?.uid ?? ''} onChange={event => setUid(event.target.value)}>
            {users.map(user => <option key={user.uid} value={user.uid}>{userLabel(user)}</option>)}
          </select>
        </label>
        <label>
          件名
          <input value={messageTitle} onChange={event => setMessageTitle(event.target.value)} maxLength={80} />
        </label>
        <label>
          本文
          <textarea value={messageBody} onChange={event => setMessageBody(event.target.value)} rows={5} maxLength={1000} />
        </label>
        <button onClick={send}>送信</button>
      </section>

      <section className="admin-top-card">
        <h2>送信履歴</h2>
        <div className="admin-direct-message-list">
          {directMessages.map(message => (
            <div key={message.id} className="admin-message-row">
              <div className="admin-message-head">
                <strong>{message.displayName || message.loginId || message.uid}</strong>
                <span>{message.status === 'read' ? '既読' : '未読'}</span>
                <span>{fmtDate(message.createdAt)}</span>
              </div>
              <strong>{message.title}</strong>
              <p>{message.body}</p>
            </div>
          ))}
          {directMessages.length === 0 && <div className="admin-dash-empty">個別メッセージの送信履歴はまだありません</div>}
        </div>
      </section>
    </div>
  );
}

function MessageInbox({ messages, onStatus }) {
  return (
    <div className="admin-dash-list">
      {messages.map(message => (
        <div key={message.id} className="admin-message-row">
          <div className="admin-message-head">
            <strong>{message.displayName || message.email || message.uid}</strong>
            <span>{message.email}</span>
            <span>{fmtDate(message.createdAt)}</span>
          </div>
          <p>{message.text}</p>
          <select value={message.status ?? 'open'} onChange={e => onStatus(message.id, e.target.value)}>
            {Object.entries(MESSAGE_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      ))}
      {messages.length === 0 && <div className="admin-dash-empty">メッセージはまだありません</div>}
    </div>
  );
}

export default function AdminDashboard({ isAdmin, currentUser, textbooks, onClose }) {
  const [tab, setTab] = useState('users');
  const {
    users,
    saveStudentCode,
    saveProfile,
    saveHistoryEntries,
    clearHistoryText,
  } = useAdminData(isAdmin, currentUser);
  const { messages, updateStatus } = useAllAdminMessages(isAdmin);
  const information = useTopInformation();
  const { directMessages, saveInformation, sendDirectMessage } = useAdminTopTools(isAdmin, currentUser);
  const requestedUsers = users.filter(user => user.account?.requestedStudentCode || user.account?.studentCode);

  return (
    <main className="admin-dash">
      <div className="admin-dash-header">
        <div>
          <h1>管理者ページ</h1>
          <p>利用状況、履歴、利用番号、プロフィール、問い合わせ、TOP連絡を管理します。</p>
        </div>
        <button onClick={onClose}>教材選択へ戻る</button>
      </div>
      <div className="admin-dash-tabs">
        {TABS.map(item => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'users' && <UserTable users={users} textbooks={textbooks} />}
      {tab === 'history' && (
        <HistoryManager
          users={users.filter(user => user.histories.length > 0)}
          textbooks={textbooks}
          onSaveEntries={saveHistoryEntries}
          onClearText={clearHistoryText}
        />
      )}
      {tab === 'profile' && <ProfileEditor users={users} onSave={saveProfile} />}
      {tab === 'codes' && <CodeRequests users={requestedUsers} onSave={saveStudentCode} />}
      {tab === 'messages' && <MessageInbox messages={messages} onStatus={updateStatus} />}
      {tab === 'top' && (
        <TopCommunicationEditor
          users={users}
          information={information}
          directMessages={directMessages}
          onSaveInformation={saveInformation}
          onSendMessage={sendDirectMessage}
        />
      )}
    </main>
  );
}
