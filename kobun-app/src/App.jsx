import { useState, useEffect } from 'react';
import VerticalTextViewer from './components/VerticalTextViewer';
import AnswerPanel from './components/AnswerPanel';
import NormalQuestions from './components/NormalQuestions';
import ScoreBoard from './components/ScoreBoard';
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

export default function App() {
  const [textData, setTextData] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [history, setHistory] = useState([]);
  const [rightTab, setRightTab] = useState('knowledge'); // 'knowledge' | 'normal' | 'score'
  const [activeType, setActiveType] = useState('all');

  const selectType = (type) => {
    setActiveType(type);
    setSelectedTarget(null);
    setSelectedSection(null);
  };


  useEffect(() => {
    fetch('/data/konosorane.json')
      .then(r => r.json())
      .then(setTextData)
      .catch(console.error);
  }, []);

  if (!textData) {
    return <div className="loading">読み込み中…</div>;
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-left">
          <span className="app-title">古文テスト対策</span>
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
            activeType={activeType}
          />
        </div>

        <div className="right-col">
          <div className="tab-bar">
            <button className={rightTab === 'knowledge' ? 'active' : ''} onClick={() => setRightTab('knowledge')}>知識問題</button>
            <button className={rightTab === 'normal' ? 'active' : ''} onClick={() => setRightTab('normal')}>
              読解問題 <span className="tab-count">{textData.normalQuestions?.length ?? 0}</span>
            </button>
            <button className={rightTab === 'score' ? 'active' : ''} onClick={() => setRightTab('score')}>
              学習記録 <span className="tab-count">{history.length}</span>
            </button>
          </div>

          {rightTab === 'knowledge' && (
            <AnswerPanel
              activeType={activeType}
              sections={textData.sections}
              selectedTarget={selectedTarget}
              selectedSection={selectedSection}
              onFocusTarget={(t, section) => { setSelectedTarget(t); setSelectedSection(section); }}
            />
          )}
          {rightTab === 'normal' && (
            <NormalQuestions
              questions={textData.normalQuestions}
              sections={textData.sections}
            />
          )}
          {rightTab === 'score' && (
            <ScoreBoard history={history} />
          )}
        </div>
      </div>
    </div>
  );
}
