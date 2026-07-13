import { useMemo, useState, useRef } from 'react';
import { exportCsv } from '../services/export';

const TYPE_LABEL = {
  reading: '読み',
  rhetoric: '修辞',
  vocab: '語句',
  aux: '助動詞',
  verb: '動詞',
  adj: '形容詞',
  particle: '助詞',
  grammar: '文法',
  kundoku: '書き下し',
  kaeriten: '返り点',
  translation: '現代語訳',
  content: '内容読解',
};

const TYPE_ORDER = ['vocab', 'grammar', 'reading', 'rhetoric', 'kundoku', 'kaeriten', 'verb', 'adj', 'aux', 'particle', 'translation', 'content'];
const KNOWLEDGE_TYPES = ['vocab', 'grammar', 'reading', 'rhetoric', 'kundoku', 'kaeriten', 'verb', 'adj', 'aux', 'particle'];
const CORRECT = '正解';
const PARTIAL = '部分正解';
const WRONG = '不正解';

const JUDGE_ICON = { [CORRECT]: '○', [PARTIAL]: '△', [WRONG]: '×' };
const JUDGE_CLASS = { [CORRECT]: 'correct', [PARTIAL]: 'partial', [WRONG]: 'wrong' };

function pointsForType(type) {
  if (type === 'translation') return 15;
  if (type === 'content') return 10;
  return 5;
}

function percent(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

function itemKey(kind, id) {
  return `${kind}:${id}`;
}

function uniqueKnowledgeTargets(sections) {
  const seen = new Set();
  const baseTargets = (sections ?? [])
    .flatMap(section => (section.targets ?? []).map(target => ({ section, target })))
    .filter(({ target }) => KNOWLEDGE_TYPES.includes(target.type))
    .filter(({ target }) => {
      const key = target.groupId ? `group:${target.groupId}` : itemKey('target', target.id);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const generatedSyntaxTargets = (sections ?? [])
    .flatMap(section => syntaxQuestionsForSection(section));
  return [...baseTargets, ...generatedSyntaxTargets];
}

function parseKanbunSyntaxForQuestions(value) {
  if (value && typeof value === 'object') {
    return Array.isArray(value.items) ? value.items : [value];
  }
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed?.items) ? parsed.items : [parsed];
    } catch {
      return [];
    }
  }
  return [];
}

function kanbunSyntaxAnswer(item) {
  const usage = String(item?.usage ?? item?.function ?? '').trim();
  const translation = String(item?.translation ?? item?.meaning ?? '').trim();
  if (!usage && !translation) return '';
  if (usage && translation) return `用法：${usage}。訳し方：${translation}`;
  return usage || translation;
}

function syntaxAlternativeAnswers(item, keys) {
  return keys
    .flatMap(key => Array.isArray(item?.[key]) ? item[key] : [])
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

function syntaxQuestionsForSection(section) {
  const syntaxValue = section?.kanbunSyntax ?? section?.syntaxGuide ?? section?.syntax;
  return parseKanbunSyntaxForQuestions(syntaxValue)
    .map((item, itemIndex) => {
      const surface = String(item?.base ?? item?.text ?? '').trim();
      const answer = kanbunSyntaxAnswer(item);
      if (!surface) return null;
      const usage = String(item?.usage ?? item?.function ?? '').trim();
      const translation = String(item?.translation ?? item?.meaning ?? '').trim();
      const usageAlternativeAnswers = syntaxAlternativeAnswers(item, ['usageAlternativeAnswers', 'usageAlternatives', 'functionAlternativeAnswers', 'functionAlternatives']);
      const translationAlternativeAnswers = syntaxAlternativeAnswers(item, ['translationAlternativeAnswers', 'translationAlternatives', 'meaningAlternativeAnswers', 'meaningAlternatives']);
      return {
        section,
        target: {
          id: `kanbun-syntax-${section.id}-${itemIndex}`,
          type: 'grammar',
          surface,
          answer,
          syntaxUsage: usage,
          syntaxTranslation: translation,
          usageAlternativeAnswers,
          translationAlternativeAnswers,
        },
      };
    })
    .filter(Boolean);
}

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
  const wrongCount = attempts.filter(a => a.judgement === WRONG).length;
  const partialCount = attempts.filter(a => a.judgement === PARTIAL).length;
  const correctCount = attempts.filter(a => a.judgement === CORRECT).length;
  return {
    first,
    last,
    wrongCount,
    partialCount,
    correctCount,
    attemptCount: attempts.length,
    lastAt: attempts.at(-1)?.at ?? 0,
    needsReview: first !== CORRECT || last !== CORRECT,
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
        <span className={`review-status-badge ${stats.last === CORRECT ? 'reached' : 'unreached'}`}>
          {stats.last === CORRECT ? '最終正解' : '未到達'}
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
          CSV エクスポート
        </button>
        {done && <span className="export-done">ダウンロードしました ○</span>}
      </div>

      <details className="export-details">
        <summary>活用方法</summary>
        <div className="export-guide">
          <div className="export-guide-block">
            <div className="export-guide-title">Excel に取り込む</div>
            <ol className="export-guide-steps">
              <li>Excel を開き、「データ」タブをクリック</li>
              <li>「テキストまたは CSV から」を選択</li>
              <li>ダウンロードした CSV ファイルを選択</li>
              <li>文字コードを <strong>UTF-8</strong> に設定してインポート</li>
            </ol>
          </div>
          <div className="export-guide-block">
            <div className="export-guide-title">フラッシュカードアプリで復習</div>
            <p className="export-guide-desc">CSV をそのまま取り込んで単語カードを作成できます。</p>
            <div className="export-app-links">
              <a href="https://apps.ankiweb.net/" target="_blank" rel="noopener noreferrer" className="export-app-link anki">
                Anki・無料・PC/スマホ
              </a>
              <a href="https://quizlet.com/" target="_blank" rel="noopener noreferrer" className="export-app-link quizlet">
                Quizlet・無料・ブラウザ
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

  const courseProgress = useMemo(() => {
    const knowledgeItems = uniqueKnowledgeTargets(textData?.sections);
    const normalItems = (textData?.normalQuestions ?? []).map(question => ({ question }));
    const itemByKey = new Map();

    for (const { target } of knowledgeItems) {
      itemByKey.set(itemKey('target', target.id), {
        type: target.type,
        points: pointsForType(target.type),
        kind: 'knowledge',
      });
    }
    for (const { question } of normalItems) {
      itemByKey.set(itemKey('question', question.id), {
        type: question.type,
        points: pointsForType(question.type),
        kind: 'normal',
      });
    }

    const answeredKeys = new Set();
    const correctKeys = new Set();
    for (const { entry, stats } of enriched) {
      const key = entry.questionId
        ? itemKey('question', entry.questionId)
        : entry.targetId
          ? itemKey('target', entry.targetId)
          : itemByKey.has(itemKey('target', entry.id)) ? itemKey('target', entry.id) : null;
      if (!key || !itemByKey.has(key)) continue;
      if (stats.attemptCount > 0) answeredKeys.add(key);
      if (stats.correctCount > 0) correctKeys.add(key);
    }

    const maxPoints = [...itemByKey.values()].reduce((sum, item) => sum + item.points, 0);
    const earnedPoints = [...correctKeys].reduce((sum, key) => sum + (itemByKey.get(key)?.points ?? 0), 0);
    const questionTotal = itemByKey.size;

    const byKnowledgeType = KNOWLEDGE_TYPES
      .map(type => {
        const items = knowledgeItems.filter(({ target }) => target.type === type);
        const total = items.length;
        const answered = items.filter(({ target }) => answeredKeys.has(itemKey('target', target.id))).length;
        const correct = items.filter(({ target }) => correctKeys.has(itemKey('target', target.id))).length;
        return { type, total, answered, correct, rate: percent(answered, total) };
      })
      .filter(item => item.total > 0);

    return {
      maxPoints,
      earnedPoints,
      pointRate: percent(earnedPoints, maxPoints),
      questionTotal,
      answeredTotal: answeredKeys.size,
      answerRate: percent(answeredKeys.size, questionTotal),
      knowledgeTotal: knowledgeItems.length,
      knowledgeAnswered: knowledgeItems.filter(({ target }) => answeredKeys.has(itemKey('target', target.id))).length,
      normalTotal: normalItems.length,
      normalAnswered: normalItems.filter(({ question }) => answeredKeys.has(itemKey('question', question.id))).length,
      byKnowledgeType,
    };
  }, [enriched, textData]);

  const total = enriched.length;
  const firstCorrect = enriched.filter(x => x.stats.first === CORRECT).length;
  const lastCorrect = enriched.filter(x => x.stats.last === CORRECT).length;
  const firstAccuracy = percent(firstCorrect, total);
  const lastAccuracy = percent(lastCorrect, total);

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
      if (stats.first === CORRECT) buckets[t].firstCorrect++;
    }
    return TYPE_ORDER
      .filter(t => buckets[t])
      .map(t => ({
        type: t,
        ...buckets[t],
        rate: percent(buckets[t].firstCorrect, buckets[t].total),
      }));
  }, [enriched]);

  const reviewList = useMemo(() => {
    return enriched
      .filter(x => x.stats.needsReview)
      .sort((a, b) => b.stats.lastAt - a.stats.lastAt);
  }, [enriched]);

  const fullList = useMemo(() => {
    let list = enriched;
    if (filter === 'first-correct') list = list.filter(x => x.stats.first === CORRECT);
    if (filter === 'first-partial') list = list.filter(x => x.stats.first === PARTIAL);
    if (filter === 'first-wrong') list = list.filter(x => x.stats.first === WRONG);
    return [...list].sort((a, b) => b.stats.lastAt - a.stats.lastAt);
  }, [enriched, filter]);

  const handleClear = () => {
    if (window.confirm('学習記録をすべて削除しますか？')) onClear?.();
  };

  return (
    <div className="scoreboard">
      <div className="score-header">
        <div className="score-title">学習記録</div>
        {total > 0 && <button className="score-clear-btn" onClick={handleClear}>全消去</button>}
      </div>

      <div className="score-summary-grid">
        <div className="score-summary-card primary">
          <div className="summary-label">ポイント獲得率</div>
          <div className="summary-value">{courseProgress.pointRate}%</div>
          <div className="summary-sub">{courseProgress.earnedPoints} / {courseProgress.maxPoints} pt</div>
        </div>
        <div className="score-summary-card">
          <div className="summary-label">問題解答率</div>
          <div className="summary-value">{courseProgress.answerRate}%</div>
          <div className="summary-sub">{courseProgress.answeredTotal} / {courseProgress.questionTotal} 問</div>
        </div>
        <div className="score-summary-card">
          <div className="summary-label">初回正答率</div>
          <div className="summary-value">{firstAccuracy}%</div>
          <div className="summary-sub">{firstCorrect} / {total} 問</div>
        </div>
        <div className="score-summary-card">
          <div className="summary-label">最終正答率</div>
          <div className="summary-value">{lastAccuracy}%</div>
          <div className="summary-sub">{lastCorrect} / {total} 問</div>
        </div>
      </div>

      <div className="score-section course-progress-section">
        <div className="score-section-title">教材全体の進行度</div>
        <div className="course-progress-grid">
          <div className="course-progress-card">
            <span className="course-progress-label">知識問題</span>
            <strong>{percent(courseProgress.knowledgeAnswered, courseProgress.knowledgeTotal)}%</strong>
            <span>{courseProgress.knowledgeAnswered} / {courseProgress.knowledgeTotal} 問</span>
          </div>
          <div className="course-progress-card">
            <span className="course-progress-label">読解問題</span>
            <strong>{percent(courseProgress.normalAnswered, courseProgress.normalTotal)}%</strong>
            <span>{courseProgress.normalAnswered} / {courseProgress.normalTotal} 問</span>
          </div>
        </div>
        {courseProgress.byKnowledgeType.length > 0 && (
          <div className="type-bars knowledge-progress-bars">
            {courseProgress.byKnowledgeType.map(item => (
              <div key={item.type} className="type-bar-row">
                <span className="type-bar-label">{TYPE_LABEL[item.type] ?? item.type}</span>
                <div className="type-bar-track">
                  <div className="type-bar-fill" style={{ width: `${item.rate}%` }} />
                </div>
                <span className="type-bar-value">{item.rate}%</span>
                <span className="type-bar-count">({item.answered}/{item.total})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="score-breakdown">
        <span className="breakdown-item correct">○ {totalCorrectAttempts}</span>
        <span className="breakdown-item partial">△ {totalPartialAttempts}</span>
        <span className="breakdown-item wrong">× {totalWrongAttempts}</span>
        <span className="breakdown-meta">計 {totalAttempts} 試行 / 平均 {avgAttempts} 試行・問</span>
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

      {total === 0 && <div className="score-empty">問題に解答すると記録が表示されます</div>}

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
            { k: 'first-wrong', label: '初回×' },
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
