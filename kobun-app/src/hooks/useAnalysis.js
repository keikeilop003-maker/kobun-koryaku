import { useEffect, useState } from 'react';
import { addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../services/firebase';

const LAST_KEY = 'kobun-analysis-last';
const RATE_MS = 60_000;

export default function useAnalysis(textId) {
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    if (!textId) return;
    const q = query(
      collection(db, 'analysisPosts'),
      where('textId', '==', textId),
      orderBy('createdAt', 'asc'),
      limit(100),
    );
    return onSnapshot(q, snap => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [textId]);

  const addPost = async ({ text, avatarSeed, replyTo, replyToText, replyToAvatarSeed }) => {
    if (!text.trim() || !textId) return;
    const lastKey = `${LAST_KEY}:${textId}`;
    const last = Number(localStorage.getItem(lastKey) ?? 0);
    if (Date.now() - last < RATE_MS) {
      throw new Error('rate_limit');
    }
    const data = { textId, text: text.trim(), avatarSeed, createdAt: serverTimestamp() };
    if (replyTo) {
      data.replyTo = replyTo;
      data.replyToText = replyToText ?? '';
      data.replyToAvatarSeed = replyToAvatarSeed ?? '';
    }
    await addDoc(collection(db, 'analysisPosts'), data).catch(e => {
      console.error('[useAnalysis] addDoc failed:', e.code, e.message);
      throw e;
    });
    localStorage.setItem(lastKey, String(Date.now()));
  };

  return { posts, addPost };
}
