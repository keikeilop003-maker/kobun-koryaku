import { useCallback, useEffect, useState } from 'react';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

const PREFIX = 'kobun-history:';

function loadLocal(storageKey) {
  if (!storageKey) return {};
  try {
    const raw = localStorage.getItem(storageKey);
    return JSON.parse(raw)?.entries ?? {};
  } catch {
    return {};
  }
}

function saveLocal(storageKey, entries) {
  if (!storageKey) return;
  try { localStorage.setItem(storageKey, JSON.stringify({ entries })); } catch { /* noop */ }
}

function fsRef(uid, textId) {
  return uid && textId ? doc(db, 'users', uid, 'history', textId) : null;
}

export default function useHistory(textId, uid) {
  const storageKey = textId ? `${PREFIX}${textId}` : null;
  const [entries, setEntries] = useState({});

  useEffect(() => {
    if (!textId) { setEntries({}); return; }

    if (!uid) {
      setEntries(loadLocal(storageKey));
      return;
    }

    const ref = fsRef(uid, textId);
    getDoc(ref).then(snap => {
      const fsEntries = snap.exists() ? (snap.data().entries ?? {}) : {};
      if (Object.keys(fsEntries).length === 0) {
        const local = loadLocal(storageKey);
        if (Object.keys(local).length > 0) {
          setDoc(ref, { entries: local });
          localStorage.removeItem(storageKey);
          setEntries(local);
          return;
        }
      }
      setEntries(fsEntries);
    }).catch(() => setEntries(loadLocal(storageKey)));
  }, [textId, uid]); // eslint-disable-line

  const record = useCallback(({ id, type, surface, sectionId, targetId, questionId, judgement, feedback }) => {
    if (!id || !judgement) return;
    const ref = fsRef(uid, textId);
    setEntries(prev => {
      const now = Date.now();
      const existing = prev[id];
      const attempt = { judgement, at: now, feedback };
      const next = {
        ...prev,
        [id]: existing
          ? { ...existing, type, surface, sectionId, targetId, questionId, attempts: [...existing.attempts, attempt] }
          : { id, type, surface, sectionId, targetId, questionId, attempts: [attempt] },
      };
      if (ref) setDoc(ref, { entries: next });
      else saveLocal(storageKey, next);
      return next;
    });
  }, [textId, uid, storageKey]); // eslint-disable-line

  const clearAll = useCallback(() => {
    setEntries({});
    const ref = fsRef(uid, textId);
    if (ref) deleteDoc(ref);
    else if (storageKey) { try { localStorage.removeItem(storageKey); } catch { /* noop */ } }
  }, [textId, uid, storageKey]); // eslint-disable-line

  const removeOne = useCallback(id => {
    const ref = fsRef(uid, textId);
    setEntries(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      if (ref) setDoc(ref, { entries: next });
      else saveLocal(storageKey, next);
      return next;
    });
  }, [textId, uid, storageKey]); // eslint-disable-line

  return { entries, record, clearAll, removeOne };
}
