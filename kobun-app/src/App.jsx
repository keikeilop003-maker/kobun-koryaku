import { useState, useEffect, useMemo, useCallback } from 'react';
import VerticalTextViewer from './components/VerticalTextViewer';
import AnswerPanel from './components/AnswerPanel';
import NormalQuestions from './components/NormalQuestions';
import ScoreBoard from './components/ScoreBoard';
import LoginScreen from './components/LoginScreen';
import WhisperPanel from './components/WhisperPanel';
import AvatarIcon from './components/AvatarIcon';
import useHistory from './hooks/useHistory';
import useWhispers from './hooks/useWhispers';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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

function AppInner() {
  const { user, logout } = useAuth();
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
  const [whisperContext, setWhisperContext] = useState(null);

  const textId = textData?.id ?? selectedTextId ?? '';
  const { entries, record, clearAll } = useHistory(textId, user?.uid);
  const { whispers } = useWhispers(textId);
  const entryCount = useMemo(() => Object.keys(entries).length, [entries]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/index.json`)
      .then(r => r.json())
      .then(list => {
        setTextbooks(list);
        if (list.length > 0) setSelectedTextId(list[0].id);
      })
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
    setWhisperContext(null);
  };

  const selectType = (type) => {
    setActiveType(type);
    setSelectedTarget(null);
    setSelectedSection(null);
    setRightTab('knowledge');
  };

  const handleJump = useCallback((entry) => {
    if (!textData) return;
    if (entry.questionId) {
      setRightTab('normal');
      setExpandedNqId(entry.questionId);
      return;
    }
    if (entry.targetId) {
      const section = textData.sections.find(s => s.id === entry.sectionId);
      const target = section?.targets?.find(t => t.id === entry.targetId);
      if (!section || !target) return;
      setActiveType(entry.type);
      setSelectedSection(section);
      setSelectedTarget(target);
      setRightTab('knowledge');
    }
  }, [textData]);

  const handleWhisper = useCallback((questionId, questionTitle) => {
    setWhisperContext({ questionId, questionTitle });
    setRightTab('whisper');
  }, []);

  if (!textData) {
    return <div className="loading">読み込み中…</div>;
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-left">
          <span className="app-title">古典ポータル</span>
          <span className="text-source">{textData.source}</span>
          <span className="text-title">「{textData.title}」</span>
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
          <AvatarIcon seed={avatarSeed} size={28} />
          <span className="user-name">{user.displayName}</span>
          <button className="logout-btn" onClick={logout}>ログアウト</button>
        </div>
      </header>

      <div className="app-body">
        <div className="left-col">
          <VerticalTextViewer
            sections={textData.sections}
            selectedTarget={selectedTarget}
            onSelectTarget={(t, section) => { setSelectedTarget(t); setSelectedSection(section); }}
            activeType={rightTab === 'knowledge' ? activeType : null}
            pinnedPhrase={rightTab === 'normal' ? pinnedPhrase : null}
          />
          {textbooks.length > 1 && (
            <div className="textbook-nav">
              <span className="textbook-nav-label">教材：</span>
              {textbooks.map(tb => (
                <button
                  key={tb.id}
                  className={`textbook-nav-btn${tb.id === selectedTextId ? ' active' : ''}`}
                  onClick={() => handleSelectTextbook(tb.id)}
                >
                  {tb.title}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="right-col">
          <div className="tab-bar">
            <button className={rightTab === 'knowledge' ? 'active' : ''} onClick={() => setRightTab('knowledge')}>知識問題</button>
            <button className={rightTab === 'normal' ? 'active' : ''} onClick={() => setRightTab('normal')}>
              読解問題 <span className="tab-count">{textData.normalQuestions?.length ?? 0}</span>
            </button>
            <button className={rightTab === 'score' ? 'active' : ''} onClick={() => setRightTab('score')}>
              学習記録 <span className="tab-count">{entryCount}</span>
            </button>
            <button className={rightTab === 'whisper' ? 'active' : ''} onClick={() => setRightTab('whisper')}>
              つぶやき <span className="tab-count">{whispers.length}</span>
            </button>
          </div>

          <div style={{ display: rightTab === 'knowledge' ? 'block' : 'none' }}>
            <AnswerPanel
              activeType={activeType}
              sections={textData.sections}
              selectedTarget={selectedTarget}
              selectedSection={selectedSection}
              onFocusTarget={(t, section) => { setSelectedTarget(t); setSelectedSection(section); }}
              historyEntries={entries}
              onRecord={record}
            />
          </div>
          <div style={{ display: rightTab === 'normal' ? 'block' : 'none' }}>
            <NormalQuestions
              questions={textData.normalQuestions}
              sections={textData.sections}
              historyEntries={entries}
              onRecord={record}
              expandedNqId={expandedNqId}
              onExpandHandled={() => setExpandedNqId(null)}
              onFocusTarget={(sectionId, text) => setPinnedPhrase(sectionId && text ? { sectionId, text } : null)}
              onWhisper={handleWhisper}
            />
          </div>
          <div style={{ display: rightTab === 'score' ? 'block' : 'none' }}>
            <ScoreBoard
              entries={entries}
              onJump={handleJump}
              onClear={clearAll}
              textData={textData}
            />
          </div>
          <div style={{ display: rightTab === 'whisper' ? 'block' : 'none' }}>
            <WhisperPanel
              textId={textId}
              uid={user?.uid}
              context={whisperContext}
              onContextUsed={() => setWhisperContext(null)}
            />
          </div>
        </div>
      </div>
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
