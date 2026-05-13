import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../services/firebase';


const LAST_KEY = 'kobun-analysis-last';
const RATE_MS = 60_000;

export default function useAnalysis(textId) {
  const [theme, setTheme] = useState(null);
  const [posts, setPosts] = useState([]);
  const [reactions, setReactions] = useState([]);

  useEffect(() => {
    if (!textId) return;
    return onSnapshot(
      doc(db, 'analysisThemes', textId),
      snap => { setTheme(snap.exists() ? snap.data() : null); },
      err => { console.error('[useAnalysis] theme error:', err.code); },
    );
  }, [textId]);

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

  useEffect(() => {
    if (!textId) return;
    const q = query(
      collection(db, 'analysisReactions'),
      where('textId', '==', textId),
    );
    return onSnapshot(q, snap => {
      setReactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [textId]);

  const addPost = async ({ text, avatarSeed, themeId, replyTo, replyToText, replyToAvatarSeed, equipped }) => {
    if (!text.trim() || !textId) return;
    const lastKey = `${LAST_KEY}:${textId}`;
    const last = Number(localStorage.getItem(lastKey) ?? 0);
    if (Date.now() - last < RATE_MS) {
      throw new Error('rate_limit');
    }
    const data = { textId, text: text.trim(), avatarSeed, createdAt: serverTimestamp() };
    if (themeId) data.themeId = themeId;
    if (replyTo) {
      data.replyTo = replyTo;
      data.replyToText = replyToText ?? '';
      data.replyToAvatarSeed = replyToAvatarSeed ?? '';
    }
    if (equipped) {
      data.equipped = {
        frame: equipped.frame ?? null,
        badge: equipped.badge ?? null,
        avatarStyle: equipped.avatarStyle ?? 'pixel-art',
      };
    }
    await addDoc(collection(db, 'analysisPosts'), data).catch(e => {
      console.error('[useAnalysis] addDoc failed:', e.code, e.message);
      throw e;
    });
    localStorage.setItem(lastKey, String(Date.now()));
  };

  const toggleReaction = async ({ postId, avatarSeed, type }) => {
    const existing = reactions.find(r => r.postId === postId && r.avatarSeed === avatarSeed && r.type === type);
    if (existing) {
      await deleteDoc(doc(db, 'analysisReactions', existing.id)).catch(e => {
        console.error('[useAnalysis] deleteDoc reaction failed:', e.code, e.message);
      });
    } else {
      await addDoc(collection(db, 'analysisReactions'), { postId, textId, avatarSeed, type }).catch(e => {
        console.error('[useAnalysis] addDoc reaction failed:', e.code, e.message);
      });
    }
  };

  const addTheme = async ({ title, description, attachments }) => {
    if (!textId || !title.trim()) return;
    const currentThemes = Array.isArray(theme?.themes) ? theme.themes : [];
    const newTheme = {
      id: `theme-${Date.now()}`,
      title: title.trim(),
      description: description.trim(),
      attachments: (attachments ?? []).filter(a => a.name?.trim() && a.url?.trim()),
    };
    await setDoc(doc(db, 'analysisThemes', textId), {
      ...(theme ?? {}),
      themes: [...currentThemes, newTheme],
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  const updateTheme = async (themeId, { title, description, attachments }) => {
    if (!textId || !themeId || !title.trim()) return;
    const currentThemes = Array.isArray(theme?.themes) ? theme.themes : [];
    const nextThemes = currentThemes.map((item) => (
      item.id === themeId
        ? {
            ...item,
            title: title.trim(),
            description: description.trim(),
            attachments: (attachments ?? []).filter(a => a.name?.trim() && a.url?.trim()),
          }
        : item
    ));
    await setDoc(doc(db, 'analysisThemes', textId), {
      ...(theme ?? {}),
      themes: nextThemes,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  const deleteTheme = async (themeId) => {
    if (!textId || !themeId) return;
    const currentThemes = Array.isArray(theme?.themes) ? theme.themes : [];
    await setDoc(doc(db, 'analysisThemes', textId), {
      ...(theme ?? {}),
      themes: currentThemes.filter((item) => item.id !== themeId),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  return { theme, posts, addPost, reactions, toggleReaction, addTheme, updateTheme, deleteTheme };
}
