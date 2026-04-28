import { useState } from 'react';
import FeedbackCard from './FeedbackCard';
import { reviewTranslation, reviewContent } from '../services/gemini';

function QuestionItem({ q, sections }) {
  const [ans, setAns] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const section = sections.find(s => s.id === q.sectionId);

  const submit = async () => {
    if (!ans.trim()) return;
    setLoading(true);
    setFeedback(null);
    let res;
    if (q.type === 'translation') {
      res = await reviewTranslation({ targetText: q.targetText, sentence: section?.text ?? '', userAnswer: ans, correctAnswer: q.answer, explanation: q.explanation });
    } else {
      res = await reviewContent({ question: q.question, userAnswer: ans, correctAnswer: q.answer, explanation: q.explanation });
    }
    setLoading(false);
    setFeedback(res);
  };

  return (
    <div className="normal-question-card">
      <div className="nq-header" onClick={() => setOpen(o => !o)}>
        <span className={`type-badge type-${q.type}`}>{q.type === 'translation' ? '現代語訳' : '内容読解'}</span>
        <span className="nq-title">{q.title}</span>
        <span className="nq-toggle">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="nq-body">
          <p className="nq-question">{q.question}</p>
          {q.targetText && (
            <div className="nq-target-text">「{q.targetText}」</div>
          )}
          <textarea
            value={ans}
            onChange={e => setAns(e.target.value)}
            rows={4}
            placeholder="ここに答えを入力…"
          />
          <button onClick={submit} disabled={loading}>
            {loading ? '添削中…' : '添削する'}
          </button>
          {feedback && <FeedbackCard type={q.type} data={feedback} />}
        </div>
      )}
    </div>
  );
}

export default function NormalQuestions({ questions, sections }) {
  if (!questions?.length) return null;
  return (
    <div className="normal-questions">
      <div className="nq-section-title">通常問題</div>
      {questions.map(q => (
        <QuestionItem key={q.id} q={q} sections={sections} />
      ))}
    </div>
  );
}
