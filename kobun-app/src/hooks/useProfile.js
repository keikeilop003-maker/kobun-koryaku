import { useEffect, useState } from 'react';
import {
  doc, onSnapshot, runTransaction, arrayUnion, getDoc, updateDoc, setDoc,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { ITEM_MAP, DEFAULT_EQUIPPED } from '../data/items';

const PROFILE_REF = (uid) => doc(db, 'users', uid, 'profile', 'main');

const BLANK_PROFILE = () => ({
  points: 0,
  totalEarned: 0,
  unlockedItems: ['style-pixel-art'],
  equipped: { ...DEFAULT_EQUIPPED },
});

export default function useProfile(uid) {
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      PROFILE_REF(uid),
      snap => { setProfile(snap.exists() ? snap.data() : BLANK_PROFILE()); },
      err => { console.error('[useProfile] error:', err.code); },
    );
  }, [uid]);

  const awardPoints = async (amount) => {
    if (!uid || amount <= 0) return;
    const ref = PROFILE_REF(uid);
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        const d = snap.data();
        tx.update(ref, {
          points: (d.points ?? 0) + amount,
          totalEarned: (d.totalEarned ?? 0) + amount,
        });
      } else {
        tx.set(ref, { ...BLANK_PROFILE(), points: amount, totalEarned: amount });
      }
    });
  };

  const unlockItem = async (itemId) => {
    if (!uid) return;
    const item = ITEM_MAP[itemId];
    if (!item) throw new Error('unknown_item');
    const ref = PROFILE_REF(uid);
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const d = snap.exists() ? snap.data() : BLANK_PROFILE();
      if ((d.unlockedItems ?? []).includes(itemId)) throw new Error('already_owned');
      if ((d.points ?? 0) < item.cost) throw new Error('not_enough_points');
      if (snap.exists()) {
        tx.update(ref, {
          points: (d.points ?? 0) - item.cost,
          unlockedItems: arrayUnion(itemId),
        });
      } else {
        tx.set(ref, {
          ...d,
          points: (d.points ?? 0) - item.cost,
          unlockedItems: ['style-pixel-art', itemId],
        });
      }
    });
  };

  const equipItem = async (slot, itemId) => {
    if (!uid) return;
    const ref = PROFILE_REF(uid);
    const snap = await getDoc(ref);
    const d = snap.exists() ? snap.data() : BLANK_PROFILE();
    if (itemId !== null && !(d.unlockedItems ?? []).includes(itemId)) {
      throw new Error('not_owned');
    }
    const newEquipped = { ...(d.equipped ?? DEFAULT_EQUIPPED), [slot]: itemId };
    if (snap.exists()) {
      await updateDoc(ref, { equipped: newEquipped });
    } else {
      await setDoc(ref, { ...d, equipped: newEquipped });
    }
  };

  return { profile, awardPoints, unlockItem, equipItem };
}
