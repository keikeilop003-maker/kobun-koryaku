import { useEffect, useMemo, useState } from 'react';
import { collectionGroup, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

function uidFromGroupedDoc(snap) {
  return snap.ref.parent.parent?.id ?? '';
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

function summarizeHistory(historyDocs) {
  let totalAttempts = 0;
  let correctAttempts = 0;
  let lastStudiedAt = 0;
  const byText = {};

  historyDocs.forEach(docData => {
    const entries = docData.entries ?? {};
    Object.values(entries).forEach(entry => {
      const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
      totalAttempts += attempts.length;
      correctAttempts += attempts.filter(a => a.judgement === '豁｣隗｣' || a.judgement === '正解').length;
      attempts.forEach(attempt => {
        lastStudiedAt = Math.max(lastStudiedAt, Number(attempt.at ?? 0));
      });
      byText[docData.textId] = (byText[docData.textId] ?? 0) + attempts.length;
    });
  });

  return {
    totalAttempts,
    correctAttempts,
    lastStudiedAt,
    accuracy: totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0,
    byText,
  };
}

export default function useAdminData(isAdmin, adminUser) {
  const [accounts, setAccounts] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [histories, setHistories] = useState([]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }
    return onSnapshot(
      collectionGroup(db, 'account'),
      snap => setAccounts(snap.docs.map(d => ({ uid: uidFromGroupedDoc(d), ...d.data() }))),
      err => console.error('[useAdminData] accounts failed:', err.code ?? err.message),
    );
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }
    return onSnapshot(
      collectionGroup(db, 'profile'),
      snap => setProfiles(snap.docs.map(d => ({ uid: uidFromGroupedDoc(d), ...d.data() }))),
      err => console.error('[useAdminData] profiles failed:', err.code ?? err.message),
    );
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }
    return onSnapshot(
      collectionGroup(db, 'history'),
      snap => setHistories(snap.docs.map(d => ({ uid: uidFromGroupedDoc(d), textId: d.id, ...d.data() }))),
      err => console.error('[useAdminData] histories failed:', err.code ?? err.message),
    );
  }, [isAdmin]);

  const users = useMemo(() => {
    const map = new Map();
    const ensure = (uid) => {
      if (!map.has(uid)) map.set(uid, { uid, account: null, profile: null, histories: [] });
      return map.get(uid);
    };

    accounts.forEach(account => {
      if (!account.uid) return;
      ensure(account.uid).account = account;
    });
    profiles.forEach(profile => {
      if (!profile.uid) return;
      ensure(profile.uid).profile = profile;
    });
    histories.forEach(history => {
      if (!history.uid) return;
      ensure(history.uid).histories.push(history);
    });

    if (!isAdmin) return [];

    return [...map.values()]
      .map(user => ({
        ...user,
        summary: summarizeHistory(user.histories),
        lastSeenAt: toMillis(user.account?.lastSeenAt),
      }))
      .sort((a, b) => (b.summary.lastStudiedAt || b.lastSeenAt) - (a.summary.lastStudiedAt || a.lastSeenAt));
  }, [accounts, histories, isAdmin, profiles]);

  const saveStudentCode = async (uid, code, status = 'approved') => {
    const normalized = code.trim().toUpperCase();
    await setDoc(doc(db, 'users', uid, 'account', 'main'), {
      studentCode: normalized,
      studentCodeStatus: status,
      studentCodeReviewedAt: serverTimestamp(),
      studentCodeReviewedBy: adminUser?.uid ?? '',
      studentCodeReviewedByEmail: adminUser?.email ?? '',
    }, { merge: true });
  };

  const saveProfile = async (uid, profile) => {
    await setDoc(doc(db, 'users', uid, 'profile', 'main'), {
      ...profile,
      profileUpdatedAt: serverTimestamp(),
      profileUpdatedBy: adminUser?.uid ?? '',
      profileUpdatedByEmail: adminUser?.email ?? '',
    }, { merge: true });
  };

  return { users, saveStudentCode, saveProfile };
}
