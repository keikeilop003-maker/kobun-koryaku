const TYPE_LABEL = { vocab: '単語', aux: '助動詞', verb: '動詞', particle: '助詞', grammar: '文法', translation: '現代語訳', content: '内容読解' };

export default function ScoreBoard({ history }) {
  const correct = history.filter(h => h.judgement === '正解').length;
  const partial = history.filter(h => h.judgement === '部分正解').length;
  const wrong = history.filter(h => h.judgement === '不正解').length;
  const total = history.length;

  return (
    <div className="scoreboard">
      <div className="score-title">学習記録</div>
      <div className="score-counts">
        <div className="score-item correct"><span>{correct}</span><small>正解</small></div>
        <div className="score-item partial"><span>{partial}</span><small>部分正解</small></div>
        <div className="score-item wrong"><span>{wrong}</span><small>不正解</small></div>
        <div className="score-item total"><span>{total}</span><small>合計</small></div>
      </div>
      {history.length > 0 && (
        <div className="score-history">
          {[...history].reverse().map((h, i) => (
            <div key={i} className={`history-item ${h.judgement === '正解' ? 'correct' : h.judgement === '部分正解' ? 'partial' : 'wrong'}`}>
              <span className="history-type">{TYPE_LABEL[h.type] ?? h.type}</span>
              <span className="history-surface">「{h.surface}」</span>
              <span className="history-badge">{h.judgement}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
