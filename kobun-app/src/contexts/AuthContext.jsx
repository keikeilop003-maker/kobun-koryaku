import { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { auth } from '../services/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (mounted) setUser(nextUser);
    });
    getRedirectResult(auth)
      .then((result) => {
        if (mounted && result?.user) setUser(result.user);
      })
      .catch((e) => {
        console.error('[AuthContext] redirect result failed:', e);
        if (mounted) setAuthError(e);
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const signIn = async () => {
    setAuthError(null);
    await setPersistence(auth, browserLocalPersistence);
    const provider = new GoogleAuthProvider();
    try {
      return await signInWithPopup(auth, provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked') {
        return signInWithRedirect(auth, provider);
      }
      throw e;
    }
  };
  const logout = () => {
    setAuthError(null);
    return signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, signIn, logout, authError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
