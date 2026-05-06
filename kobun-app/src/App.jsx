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
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './services/firebase';
import { TITLE_COLOR } from './data/items';
import './styles/app.css';

const LEGEND = [
  { type: 'all',      label: '全語句',   cls: 'hl-all' },
  { type: 'vocab',    label: '重要単語', cls: 'hl-vocab' },
  { type: 'grammar',  label: '重要文法', cls: 'hl-grammar' },
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

  const textId = textData?.id ?? selectedTextId ?? '';
  const customTargets = useCustomTargets(textId);
  const hiddenTargetKeys = useHiddenTargets(textId);
  const { entries, record, clearAll } = useHistory(textId, user?.uid);
  const { profile, awardPoints, unlockItem, equipItem } = useProfile(user?.uid);
  const entryCount = useMemo(() => Object.keys(entries).length, [entries]);

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
          .filter(target => !hiddenTargetKeys.has(`${section.id}:${target.id}`));
        const targets = [
          ...baseTargets,
          ...(customBySection[section.id] ?? []),
        ].sort((a, b) => targetOrder(section, a) - targetOrder(section, b));
        return { ...section, targets };
      }),
    };
  }, [textData, customTargets, hiddenTargetKeys]);

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
    if (!selectedTextId) return;
    setTextData(null);
    fetch(`${import.meta.env.BASE_URL}data/${selectedTextId}.json`)
      .then(r => r.json())
      .then(setTextData)
      .catch(console.error);
  }, [selectedTextId]);

  const handleSelectTextbook = (id) => {
    if (id === selectedTextId) return;
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
    if (!window.confirm(`「${target.surface}」を削除しますか。`)) return;

    if (target.customDocId) {
      await deleteDoc(doc(db, 'customTargets', target.customDocId));
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
              {textbooks.map(tb => (
                <button
                  key={tb.id}
                  className="textbook-card-btn"
                  onClick={() => handleSelectTextbook(tb.id)}
                >
                  <span className="tc-title">{tb.title}</span>
                  <span className="tc-source">{tb.source}</span>
                </button>
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
                />
              </div>
              <div style={{ display: rightTab === 'analysis' ? 'block' : 'none' }}>
                <AnalysisPanel
                  textId={textId}
                  avatarSeed={avatarSeed}
                  equipped={equipped}
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
