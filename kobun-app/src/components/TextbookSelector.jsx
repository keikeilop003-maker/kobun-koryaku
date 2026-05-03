export default function TextbookSelector({ textbooks, historyKeys, onSelect }) {
  return (
    <div className="textbook-selector-root">
      <header className="ts-header">
        <span className="app-title">古典ポータル</span>
      </header>
      <main className="ts-main">
        <h2 className="ts-heading">教材を選択</h2>
        <div className="ts-grid">
          {textbooks.map(tb => (
            <button
              key={tb.id}
              className="ts-card"
              onClick={() => onSelect(tb.id)}
            >
              <span className="ts-source">{tb.source}</span>
              <span className="ts-title">「{tb.title}」</span>
              {historyKeys.has(tb.id) && (
                <span className="ts-badge">学習記録あり</span>
              )}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
