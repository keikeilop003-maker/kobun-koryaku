import { useMemo, useState, useRef } from 'react';
import { exportCsv } from '../services/export';

const TYPE_LABEL = {
  vocab: '単語', aux: '助動詞', verb: '動詞', adj: '形容詞', particle: '助詞',
  grammar: '文法・句法', kundoku: '書き下し', kaeriten: '返り点', translation: '現代語訳', content: '内容読解',
};

const TYPE_ORDER = ['vocab', 'grammar', 'kundoku', 'kaeriten', 'verb', 'adj', 'aux', 'particle', 'translation', 'content'];

const JUDGE_ICON = { '正解': '○', '部分正解': '△', '不正解': '✕' };
const JUDGE_CLASS = { '正解': 'correct', '部分正解': 'partial', '不正解': 'wrong' };

function relativeTime(at) {
  const diff = Date.now() - at;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  return `${day}日前`;
}

function deriveStats(entry) {
  const attempts = entry.attempts ?? [];
  const first = attempts[0]?.judgement ?? null;
  const last = attempts.at(-1)?.judgement ?? null;
  const wrongCount = attempts.filter(a => a.judgement === '不正解').length;
  const partialCount = attempts.filter(a => a.judgement === '部分正解').length;
  const correctCount = attempts.filter(a => a.judgement === '正解').length;
  return {
    first, last,
    wrongCount, partialCount, correctCount,
    attemptCount: attempts.length,
    lastAt: attempts.at(-1)?.at ?? 0,
    needsReview: first !== '正解' || last !== '正解',
  };
}

function AttemptTrace({ attempts }) {
  return (
    <span className="attempt-trace">
      {attempts.map((a, i) => (
        <span key={i} className={`attempt-chip ${JUDGE_CLASS[a.judgement] ?? ''}`}>
          {JUDGE_ICON[a.judgement] ?? '?'}
        </span>
      ))}
    </span>
  );
}

function HistoryRow({ entry, stats, onJump, showStatus }) {
  return (
    <div
      className={`history-item ${JUDGE_CLASS[stats.last] ?? ''}`}
      onClick={() => onJump?.(entry)}
      role="button"
      tabIndex={0}
    >
      <span className={`type-badge type-${entry.type}`}>{TYPE_LABEL[entry.type] ?? entry.type}</span>
      <span className="history-surface">「{entry.surface}」</span>
      <AttemptTrace attempts={entry.attempts} />
      {showStatus && (
        <span className={`review-status-badge ${stats.last === '正解' ? 'reached' : 'unreached'}`}>
          {stats.last === '正解' ? '最終✓' : '未到達'}
        </span>
      )}
      <span className="history-time">{relativeTime(stats.lastAt)}</span>
    </div>
  );
}

function ExportSection({ entries, textData }) {
  const [done, setDone] = useState(false);
  const timerRef = useRef(null);

  const handleExport = () => {
    exportCsv(entries, textData);
    setDone(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDone(false), 4000);
  };

  return (
    <div className="export-section">
      <div className="export-header">
        <button className="export-btn" onClick={handleExport}>
          CSV エクスポート ↓
        </button>
        {done && <span className="export-done">ダウンロードしました ✓</span>}
      </div>

      <details className="export-details">
        <summary>活用方法</summary>
        <div className="export-guide">
          <div className="export-guide-block">
            <div className="export-guide-title">📊 Excel に取り込む</div>
            <ol className="export-guide-steps">
              <li>Excel を開き、「データ」タブをクリック</li>
              <li>「テキストまたは CSV から」を選択</li>
              <li>ダウンロードした CSV ファイルを選択</li>
              <li>文字コードを <strong>UTF-8</strong> に設定してインポート</li>
            </ol>
          </div>
          <div className="export-guide-block">
            <div className="export-guide-title">🃏 フラッシュカードアプリで復習</div>
            <p className="export-guide-desc">CSV をそのまま取り込んで単語カードを自動生成できます。</p>
            <div className="export-app-links">
              <a
                href="https://apps.ankiweb.net/"
                target="_blank"
                rel="noopener noreferrer"
                className="export-app-link anki"
              >
                Anki（無料・PC/スマホ）
              </a>
              <a
                href="https://quizlet.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="export-app-link quizlet"
              >
                Quizlet（無料・ブラウザ）
              </a>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

export default function ScoreBoard({ entries, onJump, onClear, textData }) {
  const [filter, setFilter] = useState('all');

  const enriched = useMemo(() => {
    return Object.values(entries ?? {}).map(e => ({ entry: e, stats: deriveStats(e) }));
  }, [entries]);

  const total = enriched.length;
  const firstCorrect = enriched.filter(x => x.stats.first === '正解').length;
  const lastCorrect = enriched.filter(x => x.stats.last === '正解').length;
  const firstAccuracy = total ? Math.round((firstCorrect / total) * 100) : 0;
  const lastAccuracy = total ? Math.round((lastCorrect / total) * 100) : 0;

  const totalCorrectAttempts = enriched.reduce((s, x) => s + x.stats.correctCount, 0);
  const totalPartialAttempts = enriched.reduce((s, x) => s + x.stats.partialCount, 0);
  const totalWrongAttempts = enriched.reduce((s, x) => s + x.stats.wrongCount, 0);
  const totalAttempts = totalCorrectAttempts + totalPartialAttempts + totalWrongAttempts;
  const avgAttempts = total ? (totalAttempts / total).toFixed(1) : '0.0';

  const byType = useMemo(() => {
    const buckets = {};
    for (const { entry, stats } of enriched) {
      const t = entry.type;
      if (!buckets[t]) buckets[t] = { total: 0, firstCorrect: 0 };
      buckets[t].total++;
      if (stats.first === '正解') buckets[t].firstCorrect++;
    }
    return TYPE_ORDER
      .filter(t => buckets[t])
      .map(t => ({
        type: t,
        ...buckets[t],
        rate: Math.round((buckets[t].firstCorrect / buckets[t].total) * 100),
      }));
  }, [enriched]);

  const reviewList = useMemo(() => {
    return enriched
      .filter(x => x.stats.needsReview)
      .sort((a, b) => b.stats.lastAt - a.stats.lastAt);
  }, [enriched]);

  const fullList = useMemo(() => {
    let list = enriched;
    if (filter === 'first-correct') list = list.filter(x => x.stats.first === '正解');
    if (filter === 'first-partial') list = list.filter(x => x.stats.first === '部分正解');
    if (filter === 'first-wrong')   list = list.filter(x => x.stats.first === '不正解');
    return [...list].sort((a, b) => b.stats.lastAt - a.stats.lastAt);
  }, [enriched, filter]);

  const handleClear = () => {
    if (window.confirm('学習記録をすべて削除しますか？')) onClear?.();
  };

  if (total === 0) {
    return (
      <div className="scoreboard">
        <div className="score-header">
          <div className="score-title">学習記録</div>
        </div>
        <div className="score-empty">問題に挑戦すると記録が表示されます</div>
      </div>
    );
  }

  return (
    <div className="scoreboard">
      <div className="score-header">
        <div className="score-title">学習記録</div>
        <button className="score-clear-btn" onClick={handleClear}>全消去</button>
      </div>

      <div className="score-summary-grid">
        <div className="score-summary-card primary">
          <div className="summary-label">初回正答率</div>
          <div className="summary-value">{firstAccuracy}%</div>
          <div className="summary-sub">{firstCorrect} / {total} 問</div>
        </div>
        <div className="score-summary-card">
          <div className="summary-label">最終到達率</div>
          <div className="summary-value">{lastAccuracy}%</div>
          <div className="summary-sub">{lastCorrect} / {total} 問</div>
        </div>
      </div>

      <div className="score-breakdown">
        <span className="breakdown-item correct">○ {totalCorrectAttempts}</span>
        <span className="breakdown-item partial">△ {totalPartialAttempts}</span>
        <span className="breakdown-item wrong">✕ {totalWrongAttempts}</span>
        <span className="breakdown-meta">計 {totalAttempts} 試行 / 平均 {avgAttempts} 試行/問</span>
      </div>

      {byType.length > 0 && (
        <div className="score-section">
          <div className="score-section-title">品詞別 初回正答率</div>
          <div className="type-bars">
            {byType.map(b => (
              <div key={b.type} className="type-bar-row">
                <span className="type-bar-label">{TYPE_LABEL[b.type] ?? b.type}</span>
                <div className="type-bar-track">
                  <div className="type-bar-fill" style={{ width: `${b.rate}%` }} />
                </div>
                <span className="type-bar-value">{b.rate}%</span>
                <span className="type-bar-count">({b.firstCorrect}/{b.total})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {reviewList.length > 0 && (
        <div className="score-section review-section">
          <div className="score-section-title">復習リスト ({reviewList.length}問)</div>
          <div className="score-section-hint">クリックで該当問題に移動</div>
          <div className="score-history">
            {reviewList.map(({ entry, stats }) => (
              <HistoryRow key={entry.id} entry={entry} stats={stats} onJump={onJump} showStatus />
            ))}
          </div>
        </div>
      )}

      <div className="score-section">
        <div className="score-section-title">全履歴</div>
        <div className="score-filter">
          {[
            { k: 'all', label: '全' },
            { k: 'first-correct', label: '初回○' },
            { k: 'first-partial', label: '初回△' },
            { k: 'first-wrong',   label: '初回✕' },
          ].map(o => (
            <button
              key={o.k}
              className={filter === o.k ? 'active' : ''}
              onClick={() => setFilter(o.k)}
            >{o.label}</button>
          ))}
        </div>
        <div className="score-history">
          {fullList.map(({ entry, stats }) => (
            <HistoryRow key={entry.id} entry={entry} stats={stats} onJump={onJump} />
          ))}
          {fullList.length === 0 && <div className="score-empty">該当する記録がありません</div>}
        </div>
      </div>

      <ExportSection entries={entries} textData={textData} />
    </div>
  );
}
