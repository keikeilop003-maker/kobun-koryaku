import { useMemo, useState } from 'react';
import useAdminData from '../hooks/useAdminData';
import { MESSAGE_STATUS, useAllAdminMessages } from '../hooks/useAdminMessages';
import { STUDENT_CODE_RE } from '../hooks/useAccount';
import { DEFAULT_EQUIPPED, ITEMS } from '../data/items';

const TABS = [
  { id: 'users', label: 'ユーザー一覧' },
  { id: 'profile', label: 'プロフィール編集' },
  { id: 'codes', label: '利用番号申請' },
  { id: 'messages', label: 'メッセージ' },
];

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
  return user.account?.displayName || user.account?.email || user.uid;
}

function textTitle(textbooks, textId) {
  return textbooks.find(t => t.id === textId)?.title ?? textId;
}

function UserTable({ users, textbooks }) {
  return (
    <div className="admin-dash-table-wrap">
      <table className="admin-dash-table">
        <thead>
          <tr>
            <th>ユーザー</th>
            <th>Gmail</th>
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
              <td>{user.account?.email ?? '-'}</td>
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
            <tr><td colSpan="8" className="admin-dash-empty">ユーザー情報がまだありません</td></tr>
          )}
        </tbody>
      </table>
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
            装備: {slot}
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
            <small>{item.slot}</small>
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
      {message && <div className="admin-dash-notice">{message}</div>}
      {users.map(user => (
        <div key={user.uid} className="admin-code-row">
          <div>
            <strong>{userLabel(user)}</strong>
            <span>{user.account?.email ?? '-'}</span>
            <span>申請: {user.account?.requestedStudentCode ?? '-'}</span>
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
  const { users, saveStudentCode, saveProfile } = useAdminData(isAdmin, currentUser);
  const { messages, updateStatus } = useAllAdminMessages(isAdmin);
  const requestedUsers = users.filter(user => user.account?.requestedStudentCode || user.account?.studentCode);

  return (
    <main className="admin-dash">
      <div className="admin-dash-header">
        <div>
          <h1>管理者ページ</h1>
          <p>利用状況、利用番号、プロフィール、問い合わせを管理します。</p>
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
      {tab === 'profile' && <ProfileEditor users={users} onSave={saveProfile} />}
      {tab === 'codes' && <CodeRequests users={requestedUsers} onSave={saveStudentCode} />}
      {tab === 'messages' && <MessageInbox messages={messages} onStatus={updateStatus} />}
    </main>
  );
}
