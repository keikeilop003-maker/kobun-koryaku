import { useState, useEffect } from 'react';
import VerticalTextViewer from './components/VerticalTextViewer';
import AnswerPanel from './components/AnswerPanel';
import NormalQuestions from './components/NormalQuestions';
import ScoreBoard from './components/ScoreBoard';
import './styles/app.css';

const LEGEND = [
  { type: 'vocab',    label: '古文単語',  cls: 'hl-vocab' },
  { type: 'aux',      label: '助動詞',    cls: 'hl-aux' },
  { type: 'verb',     label: '動詞',      cls: 'hl-verb' },
  { type: 'particle', label: '助詞',      cls: 'hl-particle' },
  { type: 'grammar',  label: '重要文法',  cls: 'hl-grammar' },
];

export default function App() {
  const [textData, setTextData] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('text');
  const [activeTypes, setActiveTypes] = useState(() => new Set(LEGEND.map(l => l.type)));

  const toggleType = (type) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  useEffect(() => {
    fetch('/data/konosorane.json')
      .then(r => r.json())
      .then(setTextData)
      .catch(console.error);
  }, []);

  const handleSelectTarget = (target, section) => {
    setSelectedTarget(target);
    setSelectedSection(section);
  };

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
              className={`legend-item ${l.cls}${activeTypes.has(l.type) ? '' : ' inactive'}`}
              onClick={() => toggleType(l.type)}
            >{l.label}</span>
          ))}
        </div>
      </header>

      <div className="app-body">
        <div className="left-col">
          <div className="tab-bar">
            <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>原文</button>
            <button className={tab === 'normal' ? 'active' : ''} onClick={() => setTab('normal')}>
              通常問題 <span className="tab-count">{textData.normalQuestions?.length ?? 0}</span>
            </button>
            <button className={tab === 'score' ? 'active' : ''} onClick={() => setTab('score')}>
              学習記録 <span className="tab-count">{history.length}</span>
            </button>
          </div>

          {tab === 'text' && (
            <VerticalTextViewer
              sections={textData.sections}
              selectedTarget={selectedTarget}
              onSelectTarget={handleSelectTarget}
              activeTypes={activeTypes}
            />
          )}
          {tab === 'normal' && (
            <NormalQuestions
              questions={textData.normalQuestions}
              sections={textData.sections}
            />
          )}
          {tab === 'score' && (
            <ScoreBoard history={history} />
          )}
        </div>

        <div className="right-col">
          <AnswerPanel
            selectedTarget={selectedTarget}
            selectedSection={selectedSection}
            onScore={(judgement) => {
              if (!selectedTarget) return;
              setHistory(h => [...h, {
                surface: selectedTarget.surface,
                type: selectedTarget.type,
                judgement,
              }]);
            }}
          />
        </div>
      </div>
    </div>
  );
}
