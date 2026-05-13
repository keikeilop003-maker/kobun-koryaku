import { useState } from 'react';

const USERNAME_MAX = 24;
const BIO_MAX = 80;

export default function AccountSettingsModal({ account, fallbackName, onSave, onClose }) {
  const [username, setUsername] = useState(account?.username ?? '');
  const [bio, setBio] = useState(account?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const normalizedUsername = username.trim();
  const normalizedBio = bio.trim();
  const displayPreview = normalizedUsername || fallbackName || 'ユーザー';

  const submit = async () => {
    if (saving) return;
    if (normalizedUsername.length > USERNAME_MAX || normalizedBio.length > BIO_MAX) {
      setError('文字数を確認してください');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ username: normalizedUsername, bio: normalizedBio });
      onClose();
    } catch (e) {
      console.error('[account settings] save failed:', e);
      setError('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="account-settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="account-settings-modal">
        <div className="account-settings-header">
          <div>
            <h2>プロフィール設定</h2>
            <p>アプリ内で表示する名前とひとことを設定できます。</p>
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="account-settings-preview">
          <strong>{displayPreview}</strong>
          <span>{normalizedBio || 'ひとこと未設定'}</span>
        </div>

        <label className="account-settings-field">
          ユーザーネーム
          <input
            value={username}
            onChange={e => setUsername(e.target.value.slice(0, USERNAME_MAX))}
            maxLength={USERNAME_MAX}
            placeholder={fallbackName || 'ユーザーネーム'}
          />
          <small>{username.length}/{USERNAME_MAX}</small>
        </label>

        <label className="account-settings-field">
          ひとこと
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value.slice(0, BIO_MAX))}
            maxLength={BIO_MAX}
            rows={3}
            placeholder="今日の目標、好きな一節、今の気分など"
          />
          <small>{bio.length}/{BIO_MAX}</small>
        </label>

        <div className="account-settings-actions">
          {error && <span>{error}</span>}
          <button className="account-settings-secondary" onClick={onClose} disabled={saving}>キャンセル</button>
          <button onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
