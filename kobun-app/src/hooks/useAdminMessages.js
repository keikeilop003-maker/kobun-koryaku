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
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { loginIdFromEmail } from '../contexts/AuthContext';

export const MESSAGE_STATUS = {
  open: '未対応',
  working: '対応中',
  closed: '対応済み',
};

export function useMyAdminMessages(user) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!user?.uid) {
      return undefined;
    }
    const q = query(
      collection(db, 'adminMessages'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    return onSnapshot(
      q,
      snap => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('[useMyAdminMessages] load failed:', err.code ?? err.message),
    );
  }, [user?.uid]);

  const sendMessage = async (text) => {
    const body = text.trim();
    if (!user?.uid || !body) return;
    if (body.length > 500) throw new Error('message_too_long');
    const loginId = loginIdFromEmail(user.email);
    await addDoc(collection(db, 'adminMessages'), {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? loginId,
      loginId,
      text: body,
      status: 'open',
      createdAt: serverTimestamp(),
    });
  };

  return { messages, sendMessage };
}

export function useAllAdminMessages(isAdmin) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }
    const q = query(
      collection(db, 'adminMessages'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(
      q,
      snap => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('[useAllAdminMessages] load failed:', err.code ?? err.message),
    );
  }, [isAdmin]);

  const updateStatus = useCallback(async (messageId, status) => {
    await updateDoc(doc(db, 'adminMessages', messageId), {
      status,
      updatedAt: serverTimestamp(),
    });
  }, []);

  return { messages, updateStatus };
}
