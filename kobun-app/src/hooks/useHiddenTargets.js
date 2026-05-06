import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

export default function useHiddenTargets(textId) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!textId) {
      setItems([]);
      return undefined;
    }

    const q = query(collection(db, 'hiddenTargets'), where('textId', '==', textId));
    return onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((doc) => ({ docId: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error('[useHiddenTargets] read failed:', err.code);
        setItems([]);
      },
    );
  }, [textId]);

  return useMemo(() => new Set(items.map((item) => `${item.sectionId}:${item.targetId}`)), [items]);
}
