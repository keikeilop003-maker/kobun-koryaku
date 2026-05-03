import { useState, useEffect, useMemo, useCallback } from 'react';
import VerticalTextViewer from './components/VerticalTextViewer';
import AnswerPanel from './components/AnswerPanel';
import NormalQuestions from './components/NormalQuestions';
import ScoreBoard from './components/ScoreBoard';
import TextbookSelector from './components/TextbookSelector';
import useHistory from './hooks/useHistory';
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

function historyKeys() {
  const keys = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('kobun-history:')) keys.add(k.slice('kobun-history:'.length));
  }
  return keys;
}

export default function App() {
  const [textbooks, setTextbooks] = useState(null);
  const [selectedTextId, setSelectedTextId] = useState(null);
  const [textData, setTextData] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [rightTab, setRightTab] = useState('knowledge');
  const [activeType, setActiveType] = useState('all');
  const [expandedNqId, setExpandedNqId] = useState(null);
  const [pinnedPhrase, setPinnedPhrase] = useState(null);

  const textId = textData?.id ?? selectedTextId ?? '';
  const { entries, record, clearAll } = useHistory(textId);
  const entryCount = useMemo(() => Object.keys(entries).length, [entries]);

  // 教材一覧を取得
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/index.json`)
      .then(r => r.json())
      .then(setTextbooks)
      .catch(console.error);
  }, []);

  // 教材選択時にテキストデータを取得
  useEffect(() => {
    if (!selectedTextId) { setTextData(null); return; }
    fetch(`${import.meta.env.BASE_URL}data/${selectedTextId}.json`)
      .then(r => r.json())
      .then(setTextData)
      .catch(console.error);
  }, [selectedTextId]);

  const handleSelectTextbook = (id) => {
    setSelectedTextId(id);
    setSelectedTarget(null);
    setSelectedSection(null);
    setRightTab('knowledge');
    setActiveType('all');
    setExpandedNqId(null);
    setPinnedPhrase(null);
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

  // 教材一覧ロード中
  if (!textbooks) {
    return <div className="loading">読み込み中…</div>;
  }

  // ホーム画面（教材未選択 or 教材データロード中）
  if (!selectedTextId || !textData) {
    return (
      <TextbookSelector
        textbooks={textbooks}
        historyKeys={historyKeys()}
        onSelect={handleSelectTextbook}
      />
    );
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-left">
          <button className="back-btn" onClick={() => setSelectedTextId(null)}>◀ 教材</button>
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
        </div>
      </div>
    </div>
  );
}
