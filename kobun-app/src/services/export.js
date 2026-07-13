const TYPE_LABEL = {
  reading: '読み',
  rhetoric: '修辞',
  vocab: '語句', aux: '助動詞', verb: '動詞', adj: '形容詞',
  particle: '助詞', grammar: '文法', kundoku: '書き下し', kaeriten: '返り点', translation: '現代語訳', content: '内容読解',
};

function escape(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function lookupAnswer(entry, sections, normalQuestions) {
  if (entry.targetId) {
    for (const sec of sections ?? []) {
      const t = sec.targets?.find(t => t.id === entry.targetId);
      if (t) return t.answer ?? '';
    }
  }
  if (entry.questionId) {
    const q = (normalQuestions ?? []).find(q => q.id === entry.questionId);
    if (q) return q.answer ?? '';
  }
  return '';
}

export function exportCsv(entries, textData) {
  const { sections = [], normalQuestions = [] } = textData ?? {};
  const rows = [['タイプ', '語句／問題', '模範解答', '最後の解答', '初回判定', '最終判定', '試行回数']];

  for (const entry of Object.values(entries)) {
    const attempts = entry.attempts ?? [];
    if (!attempts.length) continue;
    const first = attempts[0].judgement ?? '';
    const last = attempts.at(-1).judgement ?? '';
    const lastAnswer = attempts.at(-1).feedback?.userAnswer ?? '';
    const correctAnswer = lookupAnswer(entry, sections, normalQuestions);
    rows.push([
      TYPE_LABEL[entry.type] ?? entry.type,
      entry.surface,
      correctAnswer,
      lastAnswer,
      first,
      last,
      attempts.length,
    ]);
  }

  const csv = rows.map(r => r.map(escape).join(',')).join('\r\n');
  const bom = '﻿';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kobun-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
