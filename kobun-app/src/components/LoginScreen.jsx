import { useState } from 'react';
import { normalizeLoginId, useAuth } from '../contexts/AuthContext';

function messageForAuthError(error) {
  if (!error) return '';
  switch (error.code) {
    case 'auth/invalid-login-id':
      return 'ユーザーIDは3〜32文字の半角英数字・ドット・アンダーバー・ハイフンで入力してください。';
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'ユーザーIDまたはパスワードが正しくありません。';
    case 'auth/email-already-in-use':
      return 'このユーザーIDはすでに使われています。';
    case 'auth/weak-password':
      return 'パスワードは6文字以上で入力してください。';
    case 'auth/operation-not-allowed':
      return 'ID・パスワードログインが有効化されていません。管理者に連絡してください。';
    default:
      return `認証に失敗しました: ${error.code ?? error.message ?? 'unknown error'}`;
  }
}

export default function LoginScreen() {
  const { signIn, signUp, authError } = useAuth();
  const [mode, setMode] = useState('login');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const shownError = error || messageForAuthError(authError);
  const isSignup = mode === 'signup';

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setError(null);

    if (isSignup && password !== passwordConfirm) {
      setError('確認用パスワードが一致しません。');
      return;
    }

    setSaving(true);
    try {
      const payload = { loginId: normalizeLoginId(loginId), password };
      if (isSignup) await signUp(payload);
      else await signIn(payload);
    } catch (e) {
      console.error('[LoginScreen] auth failed:', e);
      setError(messageForAuthError(e));
    } finally {
      setSaving(false);
    }
  };

  const switchMode = () => {
    setMode(isSignup ? 'login' : 'signup');
    setError(null);
    setPassword('');
    setPasswordConfirm('');
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-title">古典ポータル</h1>
        <p className="login-subtitle">
          {isSignup
            ? 'このアプリ専用のユーザーIDとパスワードを設定してください。'
            : 'ユーザーIDとパスワードでログインしてください。'}
        </p>

        <label className="login-field">
          ユーザーID
          <input
            value={loginId}
            onChange={(event) => setLoginId(normalizeLoginId(event.target.value))}
            autoComplete="username"
            inputMode="latin"
            placeholder="例: student01"
            required
          />
        </label>

        <label className="login-field">
          パスワード
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            minLength={6}
            required
          />
        </label>

        {isSignup && (
          <label className="login-field">
            パスワード確認
            <input
              type="password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
        )}

        <button className="login-primary-btn" type="submit" disabled={saving}>
          {saving ? '処理中...' : isSignup ? '新規登録' : 'ログイン'}
        </button>

        <button className="login-switch-btn" type="button" onClick={switchMode} disabled={saving}>
          {isSignup ? 'ログイン画面へ' : '新規登録はこちら'}
        </button>

        {shownError && <p className="login-error">{shownError}</p>}
      </form>
    </div>
  );
}
