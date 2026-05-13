import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

export const STUDENT_CODE_RE = /^1[A-H][0-9]{2}$/;

const ACCOUNT_REF = (uid) => doc(db, 'users', uid, 'account', 'main');

export default function useAccount(user) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      setAccount(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);

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
      snap => {
        setAccount(snap.exists() ? snap.data() : null);
        setLoading(false);
      },
      err => {
        console.error('[useAccount] load failed:', err.code ?? err.message);
        setLoading(false);
      },
    );
  }, [user?.uid, user?.email, user?.displayName]);

  const registerAccount = async (code) => {
    if (!user?.uid) return;
    const normalized = code.trim().toUpperCase();
    if (!STUDENT_CODE_RE.test(normalized)) throw new Error('invalid_student_code');
    await setDoc(ACCOUNT_REF(user.uid), {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      requestedStudentCode: normalized,
      studentCodeStatus: 'requested',
      registrationCompleted: true,
      registeredAt: serverTimestamp(),
      requestedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    }, { merge: true });
  };

  const updatePublicProfile = async ({ username, bio }) => {
    if (!user?.uid) return;
    const nextUsername = username.trim().slice(0, 24);
    const nextBio = bio.trim().slice(0, 80);
    await setDoc(ACCOUNT_REF(user.uid), {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      username: nextUsername,
      bio: nextBio,
      publicProfileUpdatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    }, { merge: true });
  };

  return { account, loading, registerAccount, updatePublicProfile };
}
