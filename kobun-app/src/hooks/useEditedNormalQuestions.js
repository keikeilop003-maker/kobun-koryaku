import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

export default function useEditedNormalQuestions(textId) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!textId) {
      setItems([]);
      return undefined;
    }

    const q = query(collection(db, 'editedNormalQuestions'), where('textId', '==', textId));
    return onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((doc) => ({ docId: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error('[useEditedNormalQuestions] read failed:', err.code);
        setItems([]);
      },
    );
  }, [textId]);

  return useMemo(() => {
    return new Map(items.map((item) => [item.questionId, item]));
  }, [items]);
}
