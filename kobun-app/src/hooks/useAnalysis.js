import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
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
import { reviewSharePost } from '../services/gemini';

const LAST_KEY = 'kobun-analysis-last';
const RATE_MS = 60_000;
const MAX_POST_CHARS = 500;

function cleanText(value, max = MAX_POST_CHARS) {
  return String(value ?? '').trim().slice(0, max);
}

function reactionId({ textId, postId, uid, type }) {
  return `${textId}_${postId}_${uid}_${type}`.replace(/[^\w.-]/g, '_');
}

export default function useAnalysis(textId, user, isAdmin = false) {
  const [theme, setTheme] = useState(null);
  const [posts, setPosts] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [loadingThemes, setLoadingThemes] = useState(false);

  const uid = user?.uid ?? '';
  const email = user?.email ?? '';

  useEffect(() => {
    if (!textId) return undefined;
    return onSnapshot(
      doc(db, 'analysisThemes', textId),
      snap => {
        setTheme(snap.exists() ? snap.data() : null);
        setLoadingThemes(false);
      },
      err => {
        console.error('[useAnalysis] theme error:', err.code ?? err.message);
        setLoadingThemes(false);
      },
    );
  }, [textId]);

  useEffect(() => {
    if (!textId) return undefined;
    const q = query(
      collection(db, 'analysisPosts'),
      where('textId', '==', textId),
      orderBy('createdAt', 'asc'),
      limit(300),
    );
    return onSnapshot(
      q,
      snap => {
        setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      err => { console.error('[useAnalysis] posts error:', err.code ?? err.message); },
    );
  }, [textId]);

  useEffect(() => {
    if (!textId) return undefined;
    const q = query(
      collection(db, 'analysisReactions'),
      where('textId', '==', textId),
    );
    return onSnapshot(
      q,
      snap => {
        setReactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      err => { console.error('[useAnalysis] reactions error:', err.code ?? err.message); },
    );
  }, [textId]);

  const themes = Array.isArray(theme?.themes) ? theme.themes : [];

  const addPost = async ({ text, avatarSeed, themeId, replyTo, replyToText, replyToAvatarSeed, equipped }) => {
    const body = cleanText(text);
    if (!body || !textId || !uid) return;
    const lastKey = `${LAST_KEY}:${textId}`;
    const last = Number(localStorage.getItem(lastKey) ?? 0);
    if (Date.now() - last < RATE_MS) throw new Error('rate_limit');

    const data = {
      textId,
      themeId: themeId ?? '',
      text: body,
      authorUid: uid,
      avatarSeed: avatarSeed ?? uid.substring(0, 8),
      pinnedByOwner: false,
      pinnedByAdmin: false,
      createdAt: serverTimestamp(),
    };
    if (replyTo) {
      data.replyTo = replyTo;
      data.replyToText = cleanText(replyToText, 80);
      data.replyToAvatarSeed = replyToAvatarSeed ?? '';
    }
    if (equipped) {
      data.equipped = {
        frame: equipped.frame ?? null,
        badge: equipped.badge ?? null,
        avatarStyle: equipped.avatarStyle ?? 'pixel-art',
      };
    }

    await addDoc(collection(db, 'analysisPosts'), data);
    localStorage.setItem(lastKey, String(Date.now()));
  };

  const addReply = (payload) => addPost(payload);

  const toggleReaction = async ({ postId, type = 'like' }) => {
    if (!textId || !uid || !postId) return;
    const id = reactionId({ textId, postId, uid, type });
    const existing = reactions.some(r => r.id === id || (
      r.postId === postId && r.authorUid === uid && r.type === type
    ));
    if (existing) {
      await deleteDoc(doc(db, 'analysisReactions', id));
    } else {
      await setDoc(doc(db, 'analysisReactions', id), {
        textId,
        postId,
        authorUid: uid,
        type,
        createdAt: serverTimestamp(),
      });
    }
  };

  const togglePin = async (post) => {
    if (!post?.id || !uid) return;
    const isOwner = post.authorUid === uid || (!post.authorUid && post.avatarSeed === uid.substring(0, 8));
    if (!isAdmin && !isOwner) throw new Error('permission_denied');
    const field = isAdmin && !isOwner ? 'pinnedByAdmin' : 'pinnedByOwner';
    await updateDoc(doc(db, 'analysisPosts', post.id), {
      [field]: !post[field],
      updatedAt: serverTimestamp(),
    });
  };

  const updatePostText = async (postId, text) => {
    const body = cleanText(text);
    if (!isAdmin || !postId || !body) throw new Error('permission_denied');
    await updateDoc(doc(db, 'analysisPosts', postId), {
      text: body,
      correction: null,
      editedAt: serverTimestamp(),
      editedBy: uid,
      updatedAt: serverTimestamp(),
    });
  };

  const deletePost = async (post) => {
    if (!isAdmin || !post?.id) throw new Error('permission_denied');
    const ids = [post.id];
    if (!post.replyTo) {
      const repliesSnap = await getDocs(query(
        collection(db, 'analysisPosts'),
        where('replyTo', '==', post.id),
      ));
      repliesSnap.docs.forEach(reply => ids.push(reply.id));
    }
    for (const id of ids) {
      const reactionsSnap = await getDocs(query(
        collection(db, 'analysisReactions'),
        where('postId', '==', id),
      ));
      await Promise.all(reactionsSnap.docs.map(reaction => deleteDoc(reaction.ref)));
      await deleteDoc(doc(db, 'analysisPosts', id));
    }
  };

  const addTheme = async ({ title, description, attachments, modelAnswer }) => {
    const safeTitle = cleanText(title, 120);
    if (!textId || !safeTitle) return;
    const currentThemes = Array.isArray(theme?.themes) ? theme.themes : [];
    const newTheme = {
      id: `theme-${Date.now()}`,
      title: safeTitle,
      description: cleanText(description, 1000),
      modelAnswer: cleanText(modelAnswer, 2000),
      modelAnswerPublished: false,
      attachments: (attachments ?? []).filter(a => a.name?.trim() && a.url?.trim()),
    };
    await setDoc(doc(db, 'analysisThemes', textId), {
      ...(theme ?? {}),
      themes: [...currentThemes, newTheme],
      updatedBy: uid,
      updatedByEmail: email,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  const updateTheme = async (themeId, { title, description, attachments, modelAnswer }) => {
    const safeTitle = cleanText(title, 120);
    if (!textId || !themeId || !safeTitle) return;
    const currentThemes = Array.isArray(theme?.themes) ? theme.themes : [];
    const nextModelAnswer = cleanText(modelAnswer, 2000);
    const nextThemes = currentThemes.map((item) => {
      if (item.id !== themeId) return item;
      const modelAnswerChanged = nextModelAnswer !== (item.modelAnswer ?? '');
      return {
        ...item,
        title: safeTitle,
        description: cleanText(description, 1000),
        modelAnswer: nextModelAnswer,
        modelAnswerPublished: modelAnswerChanged ? false : Boolean(item.modelAnswerPublished),
        modelAnswerPublishedBy: modelAnswerChanged ? '' : (item.modelAnswerPublishedBy ?? ''),
        attachments: (attachments ?? []).filter(a => a.name?.trim() && a.url?.trim()),
      };
    });
    await setDoc(doc(db, 'analysisThemes', textId), {
      ...(theme ?? {}),
      themes: nextThemes,
      updatedBy: uid,
      updatedByEmail: email,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  const updateThemeModelAnswer = async (themeId, modelAnswer) => {
    const target = themes.find(item => item.id === themeId);
    if (!target) return;
    await updateTheme(themeId, { ...target, modelAnswer });
  };

  const deleteTheme = async (themeId) => {
    if (!textId || !themeId) return;
    const currentThemes = Array.isArray(theme?.themes) ? theme.themes : [];
    await setDoc(doc(db, 'analysisThemes', textId), {
      ...(theme ?? {}),
      themes: currentThemes.filter((item) => item.id !== themeId),
      updatedBy: uid,
      updatedByEmail: email,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  const batchCorrectThemePosts = async (themeId) => {
    if (!isAdmin) throw new Error('permission_denied');
    const targetTheme = themes.find(item => item.id === themeId);
    if (!targetTheme) return { corrected: 0 };
    const targets = posts.filter(post => (
      post.themeId === themeId && !post.replyTo && !post.correction && cleanText(post.text)
    ));
    let corrected = 0;
    for (const post of targets) {
      const result = await reviewSharePost({
        themeTitle: targetTheme.title,
        themeDescription: targetTheme.description,
        modelAnswer: targetTheme.modelAnswer,
        userAnswer: post.text,
      });
      await updateDoc(doc(db, 'analysisPosts', post.id), {
        correction: {
          judgement: result?.judgement ?? '',
          comment: result?.comment ?? result?.reason ?? '',
          correctedAt: serverTimestamp(),
          correctedBy: uid,
          modelAnswer: targetTheme.modelAnswer ?? '',
        },
        updatedAt: serverTimestamp(),
      });
      corrected += 1;
    }
    return { corrected };
  };

  const setThemeModelAnswerPublished = async (themeId, published) => {
    if (!isAdmin) throw new Error('permission_denied');
    if (!textId || !themeId) return;
    const currentThemes = Array.isArray(theme?.themes) ? theme.themes : [];
    const nextThemes = currentThemes.map((item) => (
      item.id === themeId
        ? {
            ...item,
            modelAnswerPublished: Boolean(published),
            modelAnswerPublishedBy: published ? uid : '',
          }
        : item
    ));
    await setDoc(doc(db, 'analysisThemes', textId), {
      ...(theme ?? {}),
      themes: nextThemes,
      updatedBy: uid,
      updatedByEmail: email,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  return {
    theme,
    themes,
    loadingThemes,
    posts,
    addPost,
    addReply,
    reactions,
    toggleReaction,
    togglePin,
    updatePostText,
    deletePost,
    addTheme,
    updateTheme,
    updateThemeModelAnswer,
    deleteTheme,
    batchCorrectThemePosts,
    setThemeModelAnswerPublished,
  };
}
