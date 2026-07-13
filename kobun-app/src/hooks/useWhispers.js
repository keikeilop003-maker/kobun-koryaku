import { useEffect, useState } from 'react';
import { addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../services/firebase';

const LAST_KEY = 'kobun-whisper-last';
const RATE_MS = 30_000;

export default function useWhispers(textId) {
  const [whispers, setWhispers] = useState([]);

  useEffect(() => {
    if (!textId) return;
    const q = query(
      collection(db, 'whispers'),
      where('textId', '==', textId),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    return onSnapshot(q, snap => {
      setWhispers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [textId]);

  const addWhisper = async ({ text, avatarSeed, questionId, questionTitle }) => {
    if (!text.trim() || !textId) return;
    const lastKey = `${LAST_KEY}:${textId}`;
    const last = Number(localStorage.getItem(lastKey) ?? 0);
    if (Date.now() - last < RATE_MS) {
      throw new Error('rate_limit');
    }
    const data = { textId, text: text.trim(), avatarSeed, createdAt: serverTimestamp() };
    if (questionId) { data.questionId = questionId; data.questionTitle = questionTitle ?? ''; }
    await addDoc(collection(db, 'whispers'), data).catch(e => {
      console.error('[useWhispers] addDoc failed:', e.code, e.message);
      throw e;
    });
    localStorage.setItem(lastKey, String(Date.now()));
  };

  return { whispers, addWhisper };
}
