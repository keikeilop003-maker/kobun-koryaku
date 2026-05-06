import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';

export default function useAdmin(user) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user?.email) {
      setIsAdmin(false);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    return onSnapshot(
      doc(db, 'admins', user.email),
      (snap) => {
        setIsAdmin(snap.exists());
        setLoading(false);
      },
      (err) => {
        console.error('[useAdmin] admin check failed:', err.code);
        setIsAdmin(false);
        setLoading(false);
      },
    );
  }, [user?.email]);

  return { isAdmin, loading };
}
