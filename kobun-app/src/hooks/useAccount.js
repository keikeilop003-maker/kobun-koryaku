import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

export const STUDENT_CODE_RE = /^1[A-H][0-9]{2}$/;

const ACCOUNT_REF = (uid) => doc(db, 'users', uid, 'account', 'main');

export default function useAccount(user) {
  const [account, setAccount] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      return undefined;
    }

    const ref = ACCOUNT_REF(user.uid);
    setDoc(ref, {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      lastSeenAt: serverTimestamp(),
    }, { merge: true }).catch(err => {
      console.error('[useAccount] touch failed:', err.code ?? err.message);
    });

    return onSnapshot(
      ref,
      snap => setAccount(snap.exists() ? snap.data() : null),
      err => console.error('[useAccount] load failed:', err.code ?? err.message),
    );
  }, [user?.uid, user?.email, user?.displayName]);

  const requestStudentCode = async (code) => {
    if (!user?.uid) return;
    const normalized = code.trim().toUpperCase();
    if (!STUDENT_CODE_RE.test(normalized)) throw new Error('invalid_student_code');
    await setDoc(ACCOUNT_REF(user.uid), {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      requestedStudentCode: normalized,
      studentCodeStatus: 'requested',
      requestedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    }, { merge: true });
  };

  return { account, requestStudentCode };
}
