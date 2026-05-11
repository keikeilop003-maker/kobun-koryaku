import { useState } from 'react';
import { STUDENT_CODE_RE } from '../hooks/useAccount';

export default function RegistrationScreen({ user, onRegister, onLogout }) {
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const normalized = code.trim().toUpperCase();
    setError('');
    if (!STUDENT_CODE_RE.test(normalized)) {
      setError('利用番号は 1A00 から 1H99 の形式で入力してください。');
      return;
    }
    setSaving(true);
    try {
      await onRegister(normalized);
    } catch (err) {
      console.error('[RegistrationScreen] register failed:', err);
      setError('登録に失敗しました。時間をおいてもう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="registration-screen">
      <form className="registration-card" onSubmit={submit}>
        <h1>利用者登録</h1>
        <p className="registration-lead">
          Googleアカウントでのログインが完了しました。続けるには利用番号を登録してください。
        </p>
        <div className="registration-user">
          <strong>{user.displayName || 'ログイン中のユーザー'}</strong>
          <span>{user.email}</span>
        </div>
        <label>
          利用番号
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="1A00"
            maxLength={4}
            autoFocus
          />
        </label>
        <p className="registration-hint">形式: 1 + A〜H の英字1文字 + 数字2桁</p>
        {error && <p className="registration-error">{error}</p>}
        <div className="registration-actions">
          <button type="button" className="registration-secondary" onClick={onLogout} disabled={saving}>
            ログアウト
          </button>
          <button type="submit" disabled={saving}>
            {saving ? '登録中...' : '登録して始める'}
          </button>
        </div>
      </form>
    </div>
  );
}
