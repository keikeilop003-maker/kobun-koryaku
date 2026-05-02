import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'kobun-history:';

function load(storageKey) {
  if (!storageKey) return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed?.entries ?? {};
  } catch {
    return {};
  }
}

function save(storageKey, entries) {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ entries }));
  } catch {
    // ignore quota / privacy errors
  }
}

export default function useHistory(textId) {
  const storageKey = textId ? `${PREFIX}${textId}` : null;
  const [entries, setEntries] = useState(() => load(storageKey));

  useEffect(() => {
    setEntries(load(storageKey));
  }, [storageKey]);

  const record = useCallback(({ id, type, surface, sectionId, targetId, questionId, judgement, feedback }) => {
    if (!id || !judgement) return;
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
      save(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const clearAll = useCallback(() => {
    setEntries({});
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch { /* noop */ }
    }
  }, [storageKey]);

  const removeOne = useCallback(id => {
    setEntries(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      save(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return { entries, record, clearAll, removeOne };
}
