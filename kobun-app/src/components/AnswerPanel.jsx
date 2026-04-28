import { useState } from 'react';
import FeedbackCard from './FeedbackCard';
import { reviewVocab, reviewAux, reviewVerb, reviewParticle, reviewGrammar } from '../services/gemini';

const TYPE_LABEL = {
  vocab: '古文単語の意味',
  aux: '助動詞の用法',
  verb: '動詞の文法事項',
  particle: '助詞の用法',
  grammar: '重要文法',
};

function HintReveal({ answer, explanation, show }) {
  if (!show) return null;
  return (
    <>
      <div className="hint">模範解答：<em>{answer}</em></div>
      {explanation && <div className="explanation">{explanation}</div>}
    </>
  );
}

function VerbHintReveal({ target, show }) {
  if (!show) return null;
  return (
    <>
      <div className="hint">
        模範：{target.baseForm}／{target.conjugationType}／{target.formInText}
      </div>
      {target.explanation && <div className="explanation">{target.explanation}</div>}
    </>
  );
}

function VocabForm({ target, section, onResult }) {
  const [ans, setAns] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submit = async () => {
    if (!ans.trim()) return;
    setLoading(true);
    const res = await reviewVocab({ surface: target.surface, sentence: section.text, userAnswer: ans, correctAnswer: target.answer, explanation: target.explanation });
    setLoading(false);
    setSubmitted(true);
    onResult(res);
  };
  return (
    <div className="form-group">
      <label>「{target.surface}」の意味を答えなさい。</label>
      <textarea value={ans} onChange={e => setAns(e.target.value)} rows={3} placeholder="ここに答えを入力…" />
      <button onClick={submit} disabled={loading}>{loading ? '添削中…' : '添削する'}</button>
      <HintReveal answer={target.answer} explanation={target.explanation} show={submitted} />
    </div>
  );
}

function AuxForm({ target, section, onResult }) {
  const [ans, setAns] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submit = async () => {
    if (!ans.trim()) return;
    setLoading(true);
    const res = await reviewAux({ surface: target.surface, sentence: section.text, userAnswer: ans, correctAnswer: target.answer, explanation: target.explanation });
    setLoading(false);
    setSubmitted(true);
    onResult(res);
  };
  return (
    <div className="form-group">
      <label>助動詞「{target.surface}」の用法を答えなさい。</label>
      <input value={ans} onChange={e => setAns(e.target.value)} placeholder="例：過去、推量、完了…" />
      <button onClick={submit} disabled={loading}>{loading ? '添削中…' : '添削する'}</button>
      <HintReveal answer={target.answer} explanation={target.explanation} show={submitted} />
    </div>
  );
}

function VerbForm({ target, section, onResult }) {
  const [base, setBase] = useState('');
  const [conj, setConj] = useState('');
  const [form, setForm] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submit = async () => {
    setLoading(true);
    const res = await reviewVerb({ surface: target.surface, sentence: section.text, userBaseForm: base, userConjugationType: conj, userFormInText: form, target });
    setLoading(false);
    setSubmitted(true);
    onResult(res);
  };
  return (
    <div className="form-group">
      <label>「{target.surface}」の文法事項を答えなさい。</label>
      <div className="verb-fields">
        <div className="field-row">
          <span>基本形</span>
          <input value={base} onChange={e => setBase(e.target.value)} placeholder="例：思ふ" />
        </div>
        <div className="field-row">
          <span>活用の行と種類</span>
          <input value={conj} onChange={e => setConj(e.target.value)} placeholder="例：ハ行四段活用" />
        </div>
        <div className="field-row">
          <span>文中の活用形</span>
          <input value={form} onChange={e => setForm(e.target.value)} placeholder="例：連用形" />
        </div>
      </div>
      <button onClick={submit} disabled={loading}>{loading ? '添削中…' : '添削する'}</button>
      <VerbHintReveal target={target} show={submitted} />
    </div>
  );
}

function ParticleForm({ target, section, onResult }) {
  const [ans, setAns] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submit = async () => {
    if (!ans.trim()) return;
    setLoading(true);
    const res = await reviewParticle({ surface: target.surface, sentence: section.text, userAnswer: ans, correctAnswer: target.answer, explanation: target.explanation });
    setLoading(false);
    setSubmitted(true);
    onResult(res);
  };
  return (
    <div className="form-group">
      <label>助詞「{target.surface}」の用法と訳し方を答えなさい。</label>
      <textarea value={ans} onChange={e => setAns(e.target.value)} rows={3} placeholder="用法と訳し方を入力…" />
      <button onClick={submit} disabled={loading}>{loading ? '添削中…' : '添削する'}</button>
      <HintReveal answer={target.answer} explanation={target.explanation} show={submitted} />
    </div>
  );
}

function GrammarForm({ target, section, onResult }) {
  const [ans, setAns] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submit = async () => {
    if (!ans.trim()) return;
    setLoading(true);
    const res = await reviewGrammar({ surface: target.surface, sentence: section.text, userAnswer: ans, correctAnswer: target.answer, explanation: target.explanation });
    setLoading(false);
    setSubmitted(true);
    onResult(res);
  };
  return (
    <div className="form-group">
      <label>「{target.surface}」の文法的な働きと訳し方を答えなさい。</label>
      <textarea value={ans} onChange={e => setAns(e.target.value)} rows={3} placeholder="文法的な働きと訳し方を入力…" />
      <button onClick={submit} disabled={loading}>{loading ? '添削中…' : '添削する'}</button>
      <HintReveal answer={target.answer} explanation={target.explanation} show={submitted} />
    </div>
  );
}

export default function AnswerPanel({ selectedTarget, selectedSection }) {
  const [feedback, setFeedback] = useState(null);

  const key = selectedTarget?.id ?? 'none';

  if (!selectedTarget) {
    return (
      <div className="answer-panel empty">
        <div className="empty-message">
          <span className="empty-icon">📖</span>
          <p>左の本文から<br />ハイライトされた語を<br />選んでください</p>
        </div>
      </div>
    );
  }

  const typeLabel = TYPE_LABEL[selectedTarget.type] ?? '問題';

  return (
    <div className="answer-panel" key={key}>
      <div className="panel-header">
        <span className={`type-badge type-${selectedTarget.type}`}>{typeLabel}</span>
        <span className="selected-surface">「{selectedTarget.surface}」</span>
      </div>

      <div className="context-text">
        <span className="context-label">本文</span>
        <span className="context-content">{selectedSection?.text}</span>
      </div>

      {selectedTarget.type === 'vocab' && (
        <VocabForm target={selectedTarget} section={selectedSection} onResult={r => { setFeedback(null); setTimeout(() => setFeedback(r), 0); }} />
      )}
      {selectedTarget.type === 'aux' && (
        <AuxForm target={selectedTarget} section={selectedSection} onResult={r => { setFeedback(null); setTimeout(() => setFeedback(r), 0); }} />
      )}
      {selectedTarget.type === 'verb' && (
        <VerbForm target={selectedTarget} section={selectedSection} onResult={r => { setFeedback(null); setTimeout(() => setFeedback(r), 0); }} />
      )}
      {selectedTarget.type === 'particle' && (
        <ParticleForm target={selectedTarget} section={selectedSection} onResult={r => { setFeedback(null); setTimeout(() => setFeedback(r), 0); }} />
      )}
      {selectedTarget.type === 'grammar' && (
        <GrammarForm target={selectedTarget} section={selectedSection} onResult={r => { setFeedback(null); setTimeout(() => setFeedback(r), 0); }} />
      )}

      {feedback && <FeedbackCard type={selectedTarget.type} data={feedback} />}
    </div>
  );
}
