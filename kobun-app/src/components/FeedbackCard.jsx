const JUDGEMENT_CLASS = {
  '正解': 'badge-correct',
  '部分正解': 'badge-partial',
  '不正解': 'badge-wrong',
};

function Badge({ judgement }) {
  const cls = JUDGEMENT_CLASS[judgement] ?? 'badge-mock';
  return <span className={`badge ${cls}`}>{judgement}</span>;
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="feedback-row">
      <span className="feedback-label">{label}</span>
      <span className="feedback-value">{value}</span>
    </div>
  );
}

export default function FeedbackCard({ type, data }) {
  if (!data) return null;

  if (type === 'adj') {
    const items = [
      { key: 'baseForm', label: '基本形（終止形）' },
      { key: 'conjugationType', label: '活用の種類' },
      { key: 'formInText', label: '文中の活用形' },
      { key: 'meaning', label: '意味' },
    ];
    return (
      <div className="feedback-card">
        {items.map(({ key, label }) => {
          const item = data[key];
          if (!item) return null;
          return (
            <div key={key} className="feedback-section">
              <div className="feedback-section-header">
                <span>{label}</span>
                <Badge judgement={item.judgement} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (type === 'verb') {
    const items = [
      { key: 'baseForm', label: '基本形' },
      { key: 'conjugationType', label: '活用の行と種類' },
      { key: 'formInText', label: '文中の活用形' },
    ];
    return (
      <div className="feedback-card">
        {items.map(({ key, label }) => {
          const item = data[key];
          if (!item) return null;
          return (
            <div key={key} className="feedback-section">
              <div className="feedback-section-header">
                <span>{label}</span>
                <Badge judgement={item.judgement} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (type === 'aux') {
    return (
      <div className="feedback-card">
        <div className="feedback-judgement-row">
          <Badge judgement={data.judgement} />
        </div>
      </div>
    );
  }

  // generic flat result (vocab, particle, grammar)
  const judgement = data.judgement;
  return (
    <div className="feedback-card">
      {judgement && (
        <div className="feedback-judgement-row">
          <Badge judgement={judgement} />
        </div>
      )}
      <Row label="正しい用法・訳" value={data.correctUsage ?? data.grammaticalRole ?? data.translation ?? data.modelAnswer} />
      <Row label="根拠" value={data.reason} />
      <Row label="コメント" value={data.comment} />
      <Row label="より良い答え" value={data.betterAnswer} />
      <Row label="文脈の注意点" value={data.contextPoint} />
      <Row label="不足点" value={data.missingPoints} />
      <Row label="誤訳箇所" value={data.incorrectParts} />
      <Row label="アドバイス" value={data.advice} />
    </div>
  );
}
