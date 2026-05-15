import { createContext, useContext, useEffect, useState } from 'react';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from '../services/firebase';

const AuthContext = createContext(null);
const INTERNAL_EMAIL_DOMAIN = 'kobun.local';
const USER_ID_RE = /^[a-z0-9._-]{3,32}$/;

export function normalizeLoginId(value) {
  return value.trim().toLowerCase();
}

export function loginIdToEmail(value) {
  const loginId = normalizeLoginId(value);
  if (!USER_ID_RE.test(loginId)) {
    const error = new Error('invalid_login_id');
    error.code = 'auth/invalid-login-id';
    throw error;
  }
  return `${loginId}@${INTERNAL_EMAIL_DOMAIN}`;
}

export function loginIdFromEmail(email) {
  const suffix = `@${INTERNAL_EMAIL_DOMAIN}`;
  return typeof email === 'string' && email.endsWith(suffix)
    ? email.slice(0, -suffix.length)
    : '';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (mounted) setUser(nextUser);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const signIn = async ({ loginId, password }) => {
    setAuthError(null);
    await setPersistence(auth, browserLocalPersistence);
    try {
      return await signInWithEmailAndPassword(auth, loginIdToEmail(loginId), password);
    } catch (e) {
      setAuthError(e);
      throw e;
    }
  };

  const signUp = async ({ loginId, password }) => {
    setAuthError(null);
    await setPersistence(auth, browserLocalPersistence);
    try {
      return await createUserWithEmailAndPassword(auth, loginIdToEmail(loginId), password);
    } catch (e) {
      setAuthError(e);
      throw e;
    }
  };

  const logout = () => {
    setAuthError(null);
    return signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, signIn, signUp, logout, authError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
