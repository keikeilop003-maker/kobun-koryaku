import { useState, useEffect, useMemo, useCallback } from 'react';
import VerticalTextViewer from './components/VerticalTextViewer';
import AnswerPanel from './components/AnswerPanel';
import NormalQuestions from './components/NormalQuestions';
import ScoreBoard from './components/ScoreBoard';
import LoginScreen from './components/LoginScreen';
import AvatarIcon from './components/AvatarIcon';
import AvatarCustomizer from './components/AvatarCustomizer';
import AnalysisPanel from './components/AnalysisPanel';
import useHistory from './hooks/useHistory';
import useProfile from './hooks/useProfile';
import useAdmin from './hooks/useAdmin';
import useCustomTargets from './hooks/useCustomTargets';
import useHiddenTargets from './hooks/useHiddenTargets';
import useEditedTargets from './hooks/useEditedTargets';
import useEditedNormalQuestions from './hooks/useEditedNormalQuestions';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './services/firebase';
import { TITLE_COLOR } from './data/items';
import './styles/app.css';

const LEGEND = [
  { type: 'all',      label: '全語句',   cls: 'hl-all' },
  { type: 'vocab',    label: '重要単語', cls: 'hl-vocab' },
  { type: 'grammar',  label: '文法・句法', cls: 'hl-grammar' },
  { type: 'verb',     label: '動',       cls: 'hl-verb' },
  { type: 'adj',      label: '形',       cls: 'hl-adj' },
  { type: 'aux',      label: '助動',     cls: 'hl-aux' },
  { type: 'particle', label: '助',       cls: 'hl-particle' },
];

function pointsForType(type) {
  if (type === 'translation') return 15;
  if (type === 'content') return 10;
  return 5;
}

function targetOrder(section, target) {
  if (Number.isInteger(target.start)) return target.start;
  const idx = section.text.indexOf(target.surface);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function AppInner() {
  const { user, logout } = useAuth();
  const { isAdmin } = useAdmin(user);
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
  const [adminSelection, setAdminSelection] = useState(null);
  const [addingType, setAddingType] = useState(null);
  const [textbookOrder, setTextbookOrder] = useState([]);
  const [textbookStatuses, setTextbookStatuses] = useState({});

  const textId = textData?.id ?? selectedTextId ?? '';
  const customTargets = useCustomTargets(textId);
  const hiddenTargetKeys = useHiddenTargets(textId);
  const editedTargetMap = useEditedTargets(textId);
  const editedNormalQuestionMap = useEditedNormalQuestions(textId);
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
    () => orderedTextbooks.filter(tb => isAdmin || tb.status !== 'draft'),
    [orderedTextbooks, isAdmin],
  );

  const equipped = profile?.equipped ?? null;

  const displayTextData = useMemo(() => {
    if (!textData) return null;
    const customBySection = customTargets.reduce((acc, item) => {
      if (!item.sectionId || !item.target) return acc;
      acc[item.sectionId] = acc[item.sectionId] ?? [];
      acc[item.sectionId].push(item.target);
      return acc;
    }, {});

    return {
      ...textData,
      sections: textData.sections.map(section => {
        const baseTargets = (section.targets ?? [])
          .filter(target => !hiddenTargetKeys.has(`${section.id}:${target.id}`))
          .map(target => {
            const edit = editedTargetMap.get(`${section.id}:${target.id}`);
            return edit?.target ? { ...target, ...edit.target, edited: true } : target;
          });
        const targets = [
          ...baseTargets,
          ...(customBySection[section.id] ?? []),
        ].sort((a, b) => targetOrder(section, a) - targetOrder(section, b));
        return { ...section, targets };
      }),
      normalQuestions: (textData.normalQuestions ?? []).map(question => {
        const edit = editedNormalQuestionMap.get(question.id);
        return edit?.question ? { ...question, question: edit.question, edited: true } : question;
      }),
    };
  }, [textData, customTargets, hiddenTargetKeys, editedTargetMap, editedNormalQuestionMap]);

  const titleId = equipped?.title ?? null;
  const titleColor = titleId ? TITLE_COLOR[titleId] : null;
  const nameStyle = titleColor === 'rainbow'
    ? {}
    : titleColor ? { color: titleColor } : {};
  const nameClass = titleColor === 'rainbow' ? 'user-name title-rainbow' : 'user-name';

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
    if (textbook?.status === 'draft' && !isAdmin) return;
    setSelectedTextId(id);
    setSelectedTarget(null);
    setSelectedSection(null);
    setRightTab('knowledge');
    setActiveType('all');
    setExpandedNqId(null);
    setPinnedPhrase(null);
    setAdminSelection(null);
    setAddingType(null);
  };

  const handleMoveTextbook = async (id, direction) => {
    if (!isAdmin || !user) return;
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
    if (!isAdmin || !user) return;
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
    if (!isAdmin || !user || !textId) return;
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
  }, [isAdmin, textId, user]);

  const handleDeleteTarget = useCallback(async (target, section) => {
    if (!isAdmin || !user || !textId || !target || !section) return;
    try {
      if (target.customDocId) {
        await deleteDoc(doc(db, 'customTargets', target.customDocId));
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
      window.alert('削除しました');
    } catch (err) {
      console.error('[delete target] failed:', err);
      window.alert(`削除に失敗しました: ${err.code ?? err.message ?? 'unknown error'}`);
    }
  }, [isAdmin, textId, user]);

  const handleUpdateTarget = useCallback(async (currentTarget, currentSection, { sectionId, target, anchor }) => {
    if (!isAdmin || !user || !textId || !currentTarget || !currentSection) return;
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
  }, [isAdmin, textId, user]);

  const handleUpdateNormalQuestion = useCallback(async (question, questionText) => {
    if (!isAdmin || !user || !textId || !question || !questionText.trim()) return;
    try {
      await setDoc(doc(db, 'editedNormalQuestions', `${textId}__${question.id}`), {
        textId,
        questionId: question.id,
        question: questionText.trim(),
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: serverTimestamp(),
      });
      window.alert('問題文を更新しました');
    } catch (err) {
      console.error('[update normal question] failed:', err);
      window.alert(`問題文の更新に失敗しました: ${err.code ?? err.message ?? 'unknown error'}`);
    }
  }, [isAdmin, textId, user]);

  const isLoadingText = selectedTextId !== null && textData === null;
  const noSelection = selectedTextId === null;
  const currentTextData = displayTextData ?? textData;

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-left">
          <span className="app-title">古典ポータル</span>
          {currentTextData && (
            <>
              <button className="back-to-select-btn" onClick={handleBackToSelect}>◀ 教材選択</button>
              <span className="text-source">{currentTextData.source}</span>
              <span className="text-title">「{currentTextData.title}」</span>
            </>
          )}
        </div>
        <div className="legend">
          {LEGEND.map(l => (
            <span
              key={l.type}
              className={`legend-item ${l.cls}${activeType === l.type ? ' active' : ''}`}
              onClick={() => selectType(l.type)}
            >{l.label}</span>
          ))}
        </div>
        <div className="header-right">
          {profile && (
            <span className="header-points" title="所持ポイント">{profile.points ?? 0}pt</span>
          )}
          <button
            className="avatar-btn"
            onClick={() => setCustomizerOpen(true)}
            title="アバターカスタマイズ"
          >
            <AvatarIcon seed={avatarSeed} size={28} equipped={equipped} />
          </button>
          <span className={nameClass} style={nameStyle}>{user.displayName}</span>
          <button className="logout-btn" onClick={logout}>ログアウト</button>
        </div>
      </header>

      <div className="app-body">
        <div className="left-col">
          {noSelection ? (
            <div className="textbook-select-area">
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
                  {isAdmin && (
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
              sections={currentTextData.sections}
              selectedTarget={selectedTarget}
              onSelectTarget={(t, section) => { setSelectedTarget(t); setSelectedSection(section); }}
              activeType={rightTab === 'knowledge' ? activeType : null}
              pinnedPhrase={rightTab === 'normal' ? pinnedPhrase : null}
              selectionMode={isAdmin && Boolean(addingType)}
              selectionRange={adminSelection}
              onRangeSelect={setAdminSelection}
              showModern={isAdmin}
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
                  isAdmin={isAdmin}
                  adminSelection={adminSelection}
                  addingType={addingType}
                  onStartAdd={handleStartAdd}
                  onCancelAdd={handleCancelAdd}
                  onCreateTarget={handleCreateTarget}
                  onDeleteTarget={handleDeleteTarget}
                  onUpdateTarget={handleUpdateTarget}
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
                  onFocusTarget={(sectionId, text) => setPinnedPhrase(sectionId && text ? { sectionId, text } : null)}
                  isAdmin={isAdmin}
                  onUpdateQuestion={handleUpdateNormalQuestion}
                />
              </div>
              <div style={{ display: rightTab === 'analysis' ? 'block' : 'none' }}>
                <AnalysisPanel
                  textId={textId}
                  avatarSeed={avatarSeed}
                  equipped={equipped}
                  isAdmin={isAdmin}
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
      </div>

      {customizerOpen && (
        <AvatarCustomizer
          seed={avatarSeed}
          profile={profile}
          displayName={user.displayName}
          onUnlock={unlockItem}
          onEquip={equipItem}
          onClose={() => setCustomizerOpen(false)}
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
