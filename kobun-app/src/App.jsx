import { useState, useEffect, useMemo, useCallback } from 'react';
import VerticalTextViewer from './components/VerticalTextViewer';
import AnswerPanel from './components/AnswerPanel';
import NormalQuestions from './components/NormalQuestions';
import ScoreBoard from './components/ScoreBoard';
import LoginScreen from './components/LoginScreen';
import AvatarIcon from './components/AvatarIcon';
import AvatarCustomizer from './components/AvatarCustomizer';
import AnalysisPanel from './components/AnalysisPanel';
import AdminDashboard from './components/AdminDashboard';
import UserMessageModal from './components/UserMessageModal';
import RegistrationScreen from './components/RegistrationScreen';
import AccountSettingsModal from './components/AccountSettingsModal';
import useHistory from './hooks/useHistory';
import useProfile from './hooks/useProfile';
import useAdmin from './hooks/useAdmin';
import useAccount from './hooks/useAccount';
import useCustomTargets from './hooks/useCustomTargets';
import useHiddenTargets from './hooks/useHiddenTargets';
import useEditedTargets from './hooks/useEditedTargets';
import useEditedSections from './hooks/useEditedSections';
import useEditedNormalQuestions from './hooks/useEditedNormalQuestions';
import useHiddenNormalQuestions from './hooks/useHiddenNormalQuestions';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './services/firebase';
import { TITLE_COLOR, normalizeEquipped } from './data/items';
import './styles/app.css';

const SECTIONLESS_CUSTOM_SECTION_ID = '__custom_sectionless__';
const AVATAR_CUSTOMIZER_ENABLED = false;

const LEGEND = [
  { type: 'all',      label: '全語句',   cls: 'hl-all' },
  { type: 'vocab',    label: '重要単語', cls: 'hl-vocab' },
  { type: 'grammar',  label: '文法・句法', cls: 'hl-grammar' },
  { type: 'verb',     label: '動',       cls: 'hl-verb' },
  { type: 'adj',      label: '形',       cls: 'hl-adj' },
  { type: 'aux',      label: '助動',     cls: 'hl-aux' },
  { type: 'particle', label: '助',       cls: 'hl-particle' },
  { type: 'kaeriten', label: '返り点',   cls: 'hl-kaeriten' },
];

const KANBUN_HIDDEN_TYPES = new Set(['verb', 'adj', 'aux', 'particle']);

function isKanbunText(text) {
  const normalized = String(text ?? '').replace(/[\s、。，．・「」『』（）()〈〉《》！？!?]/g, '');
  return normalized.length > 0 && /^[\p{Script=Han}]+$/u.test(normalized);
}

function isKanbunTextData(data) {
  return (data?.sections ?? [])
    .filter(section => !section.sectionless)
    .some(section => isKanbunText(section.text));
}

function pointsForType(type) {
  if (type === 'translation') return 15;
  if (type === 'content') return 10;
  return 5;
}

function normalQuestionPinnedPhrase(question) {
  if (!['translation', 'content'].includes(question?.type)) return null;
  const targetText = question.targetText?.trim();
  if (targetText) return targetText;
  const quoted = question.question?.match(/「([^」]+)」/)?.[1]?.trim();
  return quoted || null;
}

function targetOrder(section, target) {
  if (Number.isInteger(target.start)) return target.start;
  if (!target.surface) return Number.MAX_SAFE_INTEGER;
  const idx = section.text.indexOf(target.surface);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function AppInner() {
  const { user, logout } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin(user);
  const { account, loading: accountLoading, registerAccount, updatePublicProfile } = useAccount(user);
  const avatarSeed = user?.uid ? user.uid.substring(0, 8) : 'anon';

  const [textbooks, setTextbooks] = useState([]);
  const [selectedTextId, setSelectedTextId] = useState(null);
  const [textData, setTextData] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [rightTab, setRightTab] = useState('knowledge');
  const [activeType, setActiveType] = useState('all');
  const [expandedNqId, setExpandedNqId] = useState(null);
  const [pinnedPhrase, setPinnedPhrase] = useState(null);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [viewAsStudent, setViewAsStudent] = useState(false);
  const [adminSelection, setAdminSelection] = useState(null);
  const [addingType, setAddingType] = useState(null);
  const [textbookOrder, setTextbookOrder] = useState([]);
  const [textbookStatuses, setTextbookStatuses] = useState({});
  const [lastDeletedTarget, setLastDeletedTarget] = useState(null);
  const effectiveIsAdmin = isAdmin && !viewAsStudent;

  const textId = textData?.id ?? selectedTextId ?? '';
  const customTargets = useCustomTargets(textId);
  const hiddenTargetKeys = useHiddenTargets(textId);
  const editedTargetMap = useEditedTargets(textId);
  const editedSectionMap = useEditedSections(textId);
  const editedNormalQuestionMap = useEditedNormalQuestions(textId);
  const hiddenNormalQuestionIds = useHiddenNormalQuestions(textId);
  const { entries, record, clearAll } = useHistory(textId, user?.uid);
  const { profile, awardPoints, unlockItem, equipItem } = useProfile(user?.uid);
  const entryCount = useMemo(() => Object.keys(entries).length, [entries]);
  const statusTextbooks = useMemo(
    () => textbooks.map(tb => ({ ...tb, status: textbookStatuses[tb.id] ?? tb.status ?? 'draft' })),
    [textbooks, textbookStatuses],
  );
  const orderedTextbooks = useMemo(() => {
    const orderIndex = new Map(textbookOrder.map((id, index) => [id, index]));
    return [...statusTextbooks].sort((a, b) => {
      const aIndex = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return statusTextbooks.findIndex(tb => tb.id === a.id) - statusTextbooks.findIndex(tb => tb.id === b.id);
    });
  }, [statusTextbooks, textbookOrder]);
  const visibleTextbooks = useMemo(
    () => orderedTextbooks.filter(tb => effectiveIsAdmin || tb.status !== 'draft'),
    [orderedTextbooks, effectiveIsAdmin],
  );

  const equipped = profile?.equipped ? normalizeEquipped(profile.equipped) : null;

  const displayTextData = useMemo(() => {
    if (!textData) return null;
    const customBySection = customTargets.reduce((acc, item) => {
      if (!item.target) return acc;
      const sectionId = item.sectionId || SECTIONLESS_CUSTOM_SECTION_ID;
      acc[sectionId] = acc[sectionId] ?? [];
      const orderStart = Number.isInteger(item.target.start)
        ? item.target.start
        : Number.isInteger(item.anchor?.start) ? item.anchor.start : undefined;
      acc[sectionId].push({
        ...item.target,
        ...(Number.isInteger(orderStart) ? { start: orderStart } : {}),
      });
      return acc;
    }, {});
    const sectionlessTargets = customBySection[SECTIONLESS_CUSTOM_SECTION_ID] ?? [];

    return {
      ...textData,
      sections: [
        ...textData.sections.map(section => {
          const sectionEdit = editedSectionMap.get(section.id)?.section;
          const displaySection = sectionEdit
            ? {
                ...section,
                ...(typeof sectionEdit.text === 'string' ? { text: sectionEdit.text } : {}),
                ...(typeof sectionEdit.kundoku === 'string' ? { kundoku: sectionEdit.kundoku } : {}),
                ...(typeof sectionEdit.notes === 'string' ? { notes: sectionEdit.notes } : {}),
                ...(typeof sectionEdit.kanbunSyntax === 'string' ? { kanbunSyntax: sectionEdit.kanbunSyntax } : {}),
              }
            : section;
          const baseTargets = (section.targets ?? [])
            .filter(target => !hiddenTargetKeys.has(`${section.id}:${target.id}`))
            .map(target => {
              const edit = editedTargetMap.get(`${section.id}:${target.id}`);
              if (!edit?.target) return target;
              const editedTarget = { ...target, ...edit.target, edited: true };
              if (!Number.isInteger(editedTarget.start) && Number.isInteger(edit.anchor?.start)) {
                editedTarget.start = edit.anchor.start;
              }
              return editedTarget;
            });
          const targets = [
            ...baseTargets,
            ...(customBySection[section.id] ?? []),
          ].sort((a, b) => targetOrder(displaySection, a) - targetOrder(displaySection, b));
          return { ...displaySection, targets, editedSection: Boolean(sectionEdit) };
        }),
        ...(sectionlessTargets.length > 0
          ? [{
              id: SECTIONLESS_CUSTOM_SECTION_ID,
              title: '追加問題',
              text: '',
              sectionless: true,
              targets: sectionlessTargets,
            }]
          : []),
      ],
      normalQuestions: (textData.normalQuestions ?? [])
        .filter(question => !hiddenNormalQuestionIds.has(question.id))
        .map(question => {
          const edit = editedNormalQuestionMap.get(question.id);
          if (!edit) return question;
          return {
            ...question,
            ...(edit.question ? { question: edit.question } : {}),
            ...(edit.answer ? { answer: edit.answer } : {}),
            ...(Array.isArray(edit.alternativeAnswers) ? { alternativeAnswers: edit.alternativeAnswers } : {}),
            edited: true,
          };
        }),
    };
  }, [textData, customTargets, hiddenTargetKeys, editedTargetMap, editedSectionMap, editedNormalQuestionMap, hiddenNormalQuestionIds]);
  const currentTextData = displayTextData ?? textData;
  const currentIsKanbun = isKanbunTextData(currentTextData);
  const visibleLegend = useMemo(() => LEGEND.filter(item => {
    if (!currentTextData) return true;
    if (currentIsKanbun) return !KANBUN_HIDDEN_TYPES.has(item.type);
    return item.type !== 'kaeriten';
  }), [currentIsKanbun, currentTextData]);

  useEffect(() => {
    if (!visibleLegend.some(item => item.type === activeType)) {
      setActiveType('all');
    }
  }, [activeType, visibleLegend]);

  const titleId = equipped?.title ?? null;
  const titleColor = titleId ? TITLE_COLOR[titleId] : null;
  const nameStyle = titleColor === 'rainbow'
    ? {}
    : titleColor ? { color: titleColor } : {};
  const nameClass = titleColor === 'rainbow' ? 'user-name title-rainbow' : 'user-name';
  const accountLoginId = account?.loginId || user.email?.split('@')[0] || '';
  const publicDisplayName = account?.username?.trim() || accountLoginId || user.displayName || 'ユーザー';
  const publicBio = account?.bio?.trim() ?? '';

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/index.json`)
      .then(r => r.json())
      .then(setTextbooks)
      .catch(console.error);
  }, []);

  useEffect(() => {
    return onSnapshot(
      doc(db, 'appSettings', 'textbookOrder'),
      snap => {
        const order = snap.data()?.order;
        setTextbookOrder(Array.isArray(order) ? order : []);
      },
      err => { console.error('[textbook order] load failed:', err.code); },
    );
  }, []);

  useEffect(() => {
    return onSnapshot(
      doc(db, 'appSettings', 'textbookStatus'),
      snap => {
        const statuses = snap.data()?.statuses;
        setTextbookStatuses(statuses && typeof statuses === 'object' ? statuses : {});
      },
      err => { console.error('[textbook status] load failed:', err.code); },
    );
  }, []);

  useEffect(() => {
    if (!selectedTextId) return;
    setTextData(null);
    fetch(`${import.meta.env.BASE_URL}data/${selectedTextId}.json`)
      .then(r => r.json())
      .then(setTextData)
      .catch(console.error);
  }, [selectedTextId]);

  const handleSelectTextbook = (id) => {
    if (id === selectedTextId) return;
    const textbook = statusTextbooks.find(tb => tb.id === id);
    if (textbook?.status === 'draft' && !effectiveIsAdmin) return;
    setShowAdminDashboard(false);
    setSelectedTextId(id);
    setSelectedTarget(null);
    setSelectedSection(null);
    setRightTab('knowledge');
    setActiveType('all');
    setExpandedNqId(null);
    setPinnedPhrase(null);
    setAdminSelection(null);
    setAddingType(null);
    setLastDeletedTarget(null);
  };

  const handleMoveTextbook = async (id, direction) => {
    if (!effectiveIsAdmin || !user) return;
    const currentOrder = orderedTextbooks.map(tb => tb.id);
    const index = currentOrder.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return;
    const nextOrder = [...currentOrder];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    setTextbookOrder(nextOrder);
    try {
      await setDoc(doc(db, 'appSettings', 'textbookOrder'), {
        order: nextOrder,
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('[textbook order] save failed:', err);
      window.alert(`並び替えの保存に失敗しました: ${err.code ?? err.message ?? 'unknown error'}`);
    }
  };

  const handleToggleTextbookStatus = async (id) => {
    if (!effectiveIsAdmin || !user) return;
    const currentStatus = textbookStatuses[id] ?? textbooks.find(tb => tb.id === id)?.status ?? 'draft';
    const nextStatus = currentStatus === 'draft' ? 'published' : 'draft';
    const nextStatuses = { ...textbookStatuses, [id]: nextStatus };
    setTextbookStatuses(nextStatuses);
    try {
      await setDoc(doc(db, 'appSettings', 'textbookStatus'), {
        statuses: nextStatuses,
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('[textbook status] save failed:', err);
      window.alert(`公開状態の保存に失敗しました: ${err.code ?? err.message ?? 'unknown error'}`);
    }
  };

  const handleBackToSelect = () => {
    setShowAdminDashboard(false);
    setSelectedTextId(null);
    setTextData(null);
    setSelectedTarget(null);
    setSelectedSection(null);
    setRightTab('knowledge');
    setActiveType('all');
    setExpandedNqId(null);
    setPinnedPhrase(null);
    setAdminSelection(null);
    setAddingType(null);
  };

  const selectType = (type) => {
    setActiveType(type);
    setSelectedTarget(null);
    setSelectedSection(null);
    setRightTab('knowledge');
    setAddingType(null);
    setAdminSelection(null);
    setLastDeletedTarget(null);
  };

  const handleJump = useCallback((entry) => {
    if (!displayTextData) return;
    if (entry.questionId) {
      setRightTab('normal');
      setExpandedNqId(entry.questionId);
      return;
    }
    if (entry.targetId) {
      const section = displayTextData.sections.find(s => s.id === entry.sectionId);
      const target = section?.targets?.find(t => t.id === entry.targetId);
      if (!section || !target) return;
      setActiveType(entry.type);
      setSelectedSection(section);
      setSelectedTarget(target);
      setRightTab('knowledge');
    }
  }, [displayTextData]);

  const handleRecord = useCallback((entry) => {
    if (entry.judgement === '正解') {
      const existing = entries[entry.id];
      const wasCorrect = existing?.attempts?.some(a => a.judgement === '正解');
      if (!wasCorrect) {
        awardPoints(pointsForType(entry.type)).catch(console.error);
      }
    }
    record(entry);
  }, [entries, awardPoints, record]);

  const handleStartAdd = useCallback((type) => {
    setAddingType(type);
    setAdminSelection(null);
    setSelectedTarget(null);
    setSelectedSection(null);
    setRightTab('knowledge');
  }, []);

  const handleCancelAdd = useCallback(() => {
    setAddingType(null);
    setAdminSelection(null);
  }, []);

  const handleCreateTarget = useCallback(async ({ sectionId, target, anchor }) => {
    if (!effectiveIsAdmin || !user || !textId) return;
    await addDoc(collection(db, 'customTargets'), {
      textId,
      sectionId,
      target,
      anchor,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: serverTimestamp(),
    });
    setAddingType(null);
    setAdminSelection(null);
  }, [effectiveIsAdmin, textId, user]);

  const handleDeleteTarget = useCallback(async (target, section) => {
    if (!effectiveIsAdmin || !user || !textId || !target || !section) return;
    try {
      if (target.customDocId) {
        await deleteDoc(doc(db, 'customTargets', target.customDocId));
        setLastDeletedTarget({
          kind: 'custom',
          docId: target.customDocId,
          sectionId: section.id,
          target,
        });
        window.alert('削除しました');
        return;
      }

      await setDoc(doc(db, 'hiddenTargets', `${textId}__${section.id}__${target.id}`), {
        textId,
        sectionId: section.id,
        targetId: target.id,
        hiddenBy: user.uid,
        hiddenByEmail: user.email,
        createdAt: serverTimestamp(),
      });
      setLastDeletedTarget({
        kind: 'base',
        sectionId: section.id,
        target,
      });
      window.alert('削除しました');
    } catch (err) {
      console.error('[delete target] failed:', err);
      window.alert(`削除に失敗しました: ${err.code ?? err.message ?? 'unknown error'}`);
    }
  }, [effectiveIsAdmin, textId, user]);

  const handleUndoDeleteTarget = useCallback(async () => {
    if (!effectiveIsAdmin || !user || !textId || !lastDeletedTarget) return;
    try {
      if (lastDeletedTarget.kind === 'custom') {
        const { customDocId, docId: _docId, ...restoredTarget } = lastDeletedTarget.target;
        await setDoc(doc(db, 'customTargets', lastDeletedTarget.docId), {
          textId,
          sectionId: lastDeletedTarget.sectionId,
          target: { ...restoredTarget, custom: true },
          anchor: {
            sectionId: lastDeletedTarget.sectionId,
            text: lastDeletedTarget.target.surface,
            start: Number.isInteger(lastDeletedTarget.target.start) ? lastDeletedTarget.target.start : null,
            end: Number.isInteger(lastDeletedTarget.target.end) ? lastDeletedTarget.target.end : null,
          },
          createdBy: user.uid,
          createdByEmail: user.email,
          createdAt: serverTimestamp(),
        });
      } else {
        await deleteDoc(doc(db, 'hiddenTargets', `${textId}__${lastDeletedTarget.sectionId}__${lastDeletedTarget.target.id}`));
      }
      setLastDeletedTarget(null);
      window.alert('元に戻しました');
    } catch (err) {
      console.error('[undo delete target] failed:', err);
      window.alert(`元に戻せませんでした: ${err.code ?? err.message ?? 'unknown error'}`);
    }
  }, [effectiveIsAdmin, lastDeletedTarget, textId, user]);

  const handleUpdateTarget = useCallback(async (currentTarget, currentSection, { sectionId, target, anchor }) => {
    if (!effectiveIsAdmin || !user || !textId || !currentTarget || !currentSection) return;
    try {
      if (currentTarget.customDocId) {
        await updateDoc(doc(db, 'customTargets', currentTarget.customDocId), {
          sectionId,
          target: { ...target, customDocId: currentTarget.customDocId, custom: true },
          anchor,
          updatedBy: user.uid,
          updatedByEmail: user.email,
          updatedAt: serverTimestamp(),
        });
        window.alert('更新しました');
        return;
      }

      await setDoc(doc(db, 'editedTargets', `${textId}__${currentSection.id}__${currentTarget.id}`), {
        textId,
        sectionId: currentSection.id,
        targetId: currentTarget.id,
        target: {
          ...target,
          id: currentTarget.id,
          type: currentTarget.type,
          custom: false,
        },
        anchor,
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: serverTimestamp(),
      });
      window.alert('更新しました');
    } catch (err) {
      console.error('[update target] failed:', err);
      window.alert(`更新に失敗しました: ${err.code ?? err.message ?? 'unknown error'}`);
    }
  }, [effectiveIsAdmin, textId, user]);

  const handleUpdateSection = useCallback(async (section, updates) => {
    if (!effectiveIsAdmin || !user || !textId || !section?.id) return;
    await setDoc(doc(db, 'editedSections', `${textId}__${section.id}`), {
      textId,
      sectionId: section.id,
      section: {
        text: Object.prototype.hasOwnProperty.call(updates, 'text') ? updates.text : (section.text ?? ''),
        kundoku: Object.prototype.hasOwnProperty.call(updates, 'kundoku') ? updates.kundoku : (section.kundoku ?? ''),
        notes: Object.prototype.hasOwnProperty.call(updates, 'notes') ? updates.notes : (section.notes ?? ''),
        kanbunSyntax: Object.prototype.hasOwnProperty.call(updates, 'kanbunSyntax') ? updates.kanbunSyntax : (section.kanbunSyntax ?? ''),
      },
      updatedBy: user.uid,
      updatedByEmail: user.email,
      updatedAt: serverTimestamp(),
    });
  }, [effectiveIsAdmin, textId, user]);

  const handleUpdateNormalQuestion = useCallback(async (question, updates) => {
    const payload = typeof updates === 'string' ? { question: updates } : (updates ?? {});
    const questionText = payload.question?.trim();
    const answerText = payload.answer?.trim();
    const alternativeAnswers = (payload.alternativeAnswers ?? []).map(item => item.trim()).filter(Boolean).slice(0, 5);
    if (!effectiveIsAdmin || !user || !textId || !question || !questionText) return;
    if (question.type === 'translation' && !answerText) return;
    try {
      await setDoc(doc(db, 'editedNormalQuestions', `${textId}__${question.id}`), {
        textId,
        questionId: question.id,
        question: questionText,
        ...(question.type === 'translation' ? {
          answer: answerText,
          alternativeAnswers,
        } : {}),
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: serverTimestamp(),
      });
      window.alert('問題文を更新しました');
    } catch (err) {
      console.error('[update normal question] failed:', err);
      window.alert(`問題文の更新に失敗しました: ${err.code ?? err.message ?? 'unknown error'}`);
    }
  }, [effectiveIsAdmin, textId, user]);

  const handleDeleteNormalQuestion = useCallback(async (question) => {
    if (!effectiveIsAdmin || !user || !textId || !question?.id) {
      window.alert('削除に必要な情報を取得できませんでした。ページを再読み込みしてからもう一度お試しください。');
      return;
    }
    try {
      await setDoc(doc(db, 'hiddenNormalQuestions', `${textId}__${question.id}`), {
        textId,
        questionId: question.id,
        hiddenBy: user.uid,
        hiddenByEmail: user.email,
        createdAt: serverTimestamp(),
      });
      window.alert('読解問題を削除しました');
    } catch (err) {
      console.error('[delete normal question] failed:', err);
      window.alert(`読解問題の削除に失敗しました: ${err.code ?? err.message ?? 'unknown error'}`);
    }
  }, [effectiveIsAdmin, textId, user]);

  const isLoadingText = selectedTextId !== null && textData === null;
  const noSelection = selectedTextId === null;
  const toggleStudentView = () => {
    setViewAsStudent(next => {
      const enabled = !next;
      if (enabled) {
        setShowAdminDashboard(false);
        setAddingType(null);
        setAdminSelection(null);
        setLastDeletedTarget(null);
        const selectedTextbook = statusTextbooks.find(tb => tb.id === selectedTextId);
        if (selectedTextbook?.status === 'draft') {
          setSelectedTextId(null);
          setTextData(null);
          setSelectedTarget(null);
          setSelectedSection(null);
          setRightTab('knowledge');
          setActiveType('all');
          setExpandedNqId(null);
          setPinnedPhrase(null);
        }
      }
      return enabled;
    });
  };

  if (accountLoading || adminLoading) return <div className="loading">読み込み中…</div>;
  if (!isAdmin && account && !account.registrationCompleted && !account.studentCode) {
    return (
      <RegistrationScreen
        user={user}
        onRegister={registerAccount}
        onLogout={logout}
      />
    );
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-left">
          <span className="app-title">古典ポータル</span>
          {currentTextData && (
            <>
              <span className="text-source">{currentTextData.source}</span>
              <span className="text-title">「{currentTextData.title}」</span>
            </>
          )}
        </div>
        <div className="legend">
          {visibleLegend.map(l => (
            <span
              key={l.type}
              className={`legend-item ${l.cls}${activeType === l.type ? ' active' : ''}`}
              onClick={() => selectType(l.type)}
            >{l.label}</span>
          ))}
        </div>
        <div className="header-right">
          {isAdmin && (
            <button
              className={`view-mode-toggle${viewAsStudent ? ' active' : ''}`}
              onClick={toggleStudentView}
              title="管理者アカウントのまま表示モードを切り替えます"
            >
              {viewAsStudent ? '管理者Viewへ' : '一般ユーザーView'}
            </button>
          )}
          {account?.studentCode && (
            <span className="header-student-code" title="利用番号">{account.studentCode}</span>
          )}
          {!currentTextData && (
            <button className="contact-admin-btn" onClick={() => setContactOpen(true)}>管理者へ連絡</button>
          )}
          {profile && (
            <span className="header-points" title="所持ポイント">{profile.points ?? 0}pt</span>
          )}
          <button
            className="avatar-btn"
            onClick={() => {
              if (AVATAR_CUSTOMIZER_ENABLED) setCustomizerOpen(true);
            }}
            disabled={!AVATAR_CUSTOMIZER_ENABLED}
            title="アバターカスタマイズ"
          >
            <AvatarIcon seed={avatarSeed} size={28} equipped={equipped} />
          </button>
          <button
            className="profile-settings-btn"
            onClick={() => setAccountSettingsOpen(true)}
            title="プロフィール設定"
          >
            <span className={nameClass} style={nameStyle}>{publicDisplayName}</span>
            {publicBio && <span className="user-bio">{publicBio}</span>}
          </button>
          <button className="logout-btn" onClick={logout}>ログアウト</button>
        </div>
      </header>

      <div className="app-body">
        {isAdmin && !viewAsStudent && showAdminDashboard ? (
          <AdminDashboard
            isAdmin={isAdmin}
            currentUser={user}
            textbooks={textbooks}
            onClose={() => setShowAdminDashboard(false)}
          />
        ) : (
        <>
        <div className="left-col">
          {noSelection ? (
            <div className="textbook-select-area">
              {effectiveIsAdmin && (
                <button className="admin-open-dashboard-btn" onClick={() => setShowAdminDashboard(true)}>
                  管理者ページ
                </button>
              )}
              {visibleTextbooks.map(tb => (
                <div
                  key={tb.id}
                  role="button"
                  tabIndex={0}
                  className={`textbook-card-btn textbook-card-btn--${tb.status === 'draft' ? 'draft' : 'published'}`}
                  onClick={() => handleSelectTextbook(tb.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectTextbook(tb.id);
                    }
                  }}
                >
                  {effectiveIsAdmin && (
                    <div className="textbook-admin-tools" onClick={e => e.stopPropagation()}>
                      <div className="textbook-order-tools">
                        <button
                          title="上へ"
                          onClick={() => handleMoveTextbook(tb.id, -1)}
                          disabled={orderedTextbooks[0]?.id === tb.id}
                        >↑</button>
                        <button
                          title="下へ"
                          onClick={() => handleMoveTextbook(tb.id, 1)}
                          disabled={orderedTextbooks.at(-1)?.id === tb.id}
                        >↓</button>
                      </div>
                      <button
                        className="textbook-status-toggle"
                        onClick={() => handleToggleTextbookStatus(tb.id)}
                      >
                        {tb.status === 'draft' ? '公開にする' : '作成中にする'}
                      </button>
                    </div>
                  )}
                  <span className={`tc-status tc-status--${tb.status === 'draft' ? 'draft' : 'published'}`}>
                    {tb.status === 'draft' ? '作成中' : '公開中'}
                  </span>
                  <span className="tc-title">{tb.title}</span>
                  <span className="tc-source">{tb.source}</span>
                </div>
              ))}
            </div>
          ) : currentTextData ? (
            <VerticalTextViewer
              textId={textId}
              notes={currentTextData.notes}
              sections={currentTextData.sections}
              selectedTarget={selectedTarget}
              onSelectTarget={(t, section) => { setSelectedTarget(t); setSelectedSection(section); }}
              activeType={rightTab === 'knowledge' ? activeType : null}
              pinnedPhrase={rightTab === 'normal' ? pinnedPhrase : null}
              selectionMode={effectiveIsAdmin && Boolean(addingType)}
              selectionRange={adminSelection}
              onRangeSelect={setAdminSelection}
              showModern={effectiveIsAdmin}
              isAdmin={effectiveIsAdmin}
              onUpdateSection={handleUpdateSection}
              onUpdateTarget={handleUpdateTarget}
              onRecord={handleRecord}
              onCreateTarget={handleCreateTarget}
              onBackToSelect={handleBackToSelect}
              onContactAdmin={() => setContactOpen(true)}
            />
          ) : null}
        </div>

        <div className="right-col">
          {noSelection ? null : isLoadingText ? (
            <div className="loading">読み込み中…</div>
          ) : (
            <>
              <div className="tab-bar">
                <button className={rightTab === 'knowledge' ? 'active' : ''} onClick={() => setRightTab('knowledge')}>知識問題</button>
                <button className={rightTab === 'normal' ? 'active' : ''} onClick={() => setRightTab('normal')}>
                  読解問題 <span className="tab-count">{currentTextData.normalQuestions?.length ?? 0}</span>
                </button>
                <button className={rightTab === 'score' ? 'active' : ''} onClick={() => setRightTab('score')}>
                  学習記録 <span className="tab-count">{entryCount}</span>
                </button>
                <button className={rightTab === 'analysis' ? 'active' : ''} onClick={() => setRightTab('analysis')}>分析研究</button>
              </div>

              <div style={{ display: rightTab === 'knowledge' ? 'block' : 'none' }}>
                <AnswerPanel
                  activeType={activeType}
                  sections={currentTextData.sections}
                  selectedTarget={selectedTarget}
                  selectedSection={selectedSection}
                  onFocusTarget={(t, section) => { setSelectedTarget(t); setSelectedSection(section); }}
                  historyEntries={entries}
                  onRecord={handleRecord}
                  isAdmin={effectiveIsAdmin}
                  adminSelection={adminSelection}
                  addingType={addingType}
                  onStartAdd={handleStartAdd}
                  onCancelAdd={handleCancelAdd}
                  onCreateTarget={handleCreateTarget}
                  onDeleteTarget={handleDeleteTarget}
                  onUpdateTarget={handleUpdateTarget}
                  deletedTargetNotice={lastDeletedTarget}
                  onUndoDelete={handleUndoDeleteTarget}
                />
              </div>
              <div style={{ display: rightTab === 'normal' ? 'block' : 'none' }}>
                <NormalQuestions
                  questions={currentTextData.normalQuestions}
                  sections={currentTextData.sections}
                  historyEntries={entries}
                  onRecord={handleRecord}
                  expandedNqId={expandedNqId}
                  onExpandHandled={() => setExpandedNqId(null)}
                  onOpenQuestionChange={(question) => {
                    const phrase = normalQuestionPinnedPhrase(question);
                    setPinnedPhrase(question?.sectionId && phrase ? { sectionId: question.sectionId, text: phrase } : null);
                  }}
                  isAdmin={effectiveIsAdmin}
                  onUpdateQuestion={handleUpdateNormalQuestion}
                  onDeleteQuestion={handleDeleteNormalQuestion}
                />
              </div>
              <div style={{ display: rightTab === 'analysis' ? 'block' : 'none' }}>
                <AnalysisPanel
                  textId={textId}
                  avatarSeed={avatarSeed}
                  equipped={equipped}
                  isAdmin={effectiveIsAdmin}
                />
              </div>
              <div style={{ display: rightTab === 'score' ? 'block' : 'none' }}>
                <ScoreBoard
                  entries={entries}
                  onJump={handleJump}
                  onClear={clearAll}
                  textData={currentTextData}
                />
              </div>
            </>
          )}
        </div>
        </>
        )}
      </div>

      {AVATAR_CUSTOMIZER_ENABLED && customizerOpen && (
        <AvatarCustomizer
          seed={avatarSeed}
          profile={profile}
          displayName={publicDisplayName}
          onUnlock={unlockItem}
          onEquip={equipItem}
          onClose={() => setCustomizerOpen(false)}
        />
      )}
      {accountSettingsOpen && (
        <AccountSettingsModal
          account={account}
          fallbackName={accountLoginId || user.displayName}
          onSave={updatePublicProfile}
          onClose={() => setAccountSettingsOpen(false)}
        />
      )}
      {contactOpen && (
        <UserMessageModal
          user={user}
          onClose={() => setContactOpen(false)}
        />
      )}
    </div>
  );
}

function AuthGate() {
  const { user } = useAuth();
  if (user === undefined) return <div className="loading">読み込み中…</div>;
  if (user === null) return <LoginScreen />;
  return <AppInner />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
