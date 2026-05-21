import { useCallback, useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../services/firebase';

export function useTopInformation() {
  const [information, setInformation] = useState(null);

  useEffect(() => {
    return onSnapshot(
      doc(db, 'appSettings', 'information'),
      snap => setInformation(snap.exists() ? snap.data() : null),
      err => console.error('[useTopInformation] load failed:', err.code ?? err.message),
    );
  }, []);

  return information;
}

export function useMyInboxMessages(user) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!user?.uid) {
      setMessages([]);
      return undefined;
    }
    const q = query(
      collection(db, 'userInboxMessages'),
      where('uid', '==', user.uid),
      limit(30),
    );
    return onSnapshot(
      q,
      snap => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setMessages(rows);
      },
      err => console.error('[useMyInboxMessages] load failed:', err.code ?? err.message),
    );
  }, [user?.uid]);

  const markRead = useCallback(async (messageId) => {
    if (!messageId) return;
    await updateDoc(doc(db, 'userInboxMessages', messageId), {
      status: 'read',
      readAt: serverTimestamp(),
    });
  }, []);

  return { messages, markRead };
}

export function useAdminTopTools(isAdmin, adminUser) {
  const [directMessages, setDirectMessages] = useState([]);

  useEffect(() => {
    if (!isAdmin) {
      setDirectMessages([]);
      return undefined;
    }
    const q = query(
      collection(db, 'userInboxMessages'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(
      q,
      snap => setDirectMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('[useAdminTopTools] messages failed:', err.code ?? err.message),
    );
  }, [isAdmin]);

  const saveInformation = useCallback(async ({ title, body }) => {
    if (!isAdmin) return;
    await setDoc(doc(db, 'appSettings', 'information'), {
      title: title.trim(),
      body: body.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: adminUser?.uid ?? '',
      updatedByEmail: adminUser?.email ?? '',
    }, { merge: true });
  }, [adminUser?.email, adminUser?.uid, isAdmin]);

  const sendDirectMessage = useCallback(async ({ user, title, body }) => {
    if (!isAdmin || !user?.uid) return;
    await addDoc(collection(db, 'userInboxMessages'), {
      uid: user.uid,
      email: user.account?.email ?? '',
      loginId: user.account?.loginId ?? '',
      displayName: user.account?.username || user.account?.displayName || user.account?.loginId || '',
      title: title.trim(),
      body: body.trim(),
      status: 'unread',
      createdAt: serverTimestamp(),
      createdBy: adminUser?.uid ?? '',
      createdByEmail: adminUser?.email ?? '',
    });
  }, [adminUser?.email, adminUser?.uid, isAdmin]);

  return { directMessages, saveInformation, sendDirectMessage };
}
