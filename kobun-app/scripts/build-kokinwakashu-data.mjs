import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');
const sourceDir = path.join(workspaceRoot, '教材', '和歌_古今和歌集');
const outFile = path.join(appRoot, 'public', 'data', 'kokinwakashu.json');
const reportFile = path.join(sourceDir, '未設定の項目.md');

function readSource(keyword) {
  const file = fs.readdirSync(sourceDir).find((name) => name.includes(keyword) && name.endsWith('.json'));
  if (!file) throw new Error(`source not found: ${keyword}`);
  return JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8').replace(/^\uFEFF/, ''));
}

const originalSource = readSource('原文');
const posSource = readSource('品詞分解');

const sections = [
  {
    id: 's1',
    title: '紀貫之',
    heading: '春立ちける日よめる',
    text: '袖ひちてむすびし水のこほれるを春立つけふの風やとくらむ',
    modern: '（去年の夏）袖が濡れるような状態で手ですくった水が、（秋が過ぎ冬が来て）凍っているのを、立春の今日の風が、今頃溶かしているのだろうか。',
  },
  {
    id: 's2',
    title: 'よみ人しらず',
    heading: '題しらず',
    text: '五月まつ花たちばなの香をかげば昔の人の袖の香ぞする',
    modern: '五月を待って咲く橘の花の香りをかぐと、昔親しんだ恋人の袖の香りがすることだ。',
  },
  {
    id: 's3',
    title: '藤原敏行',
    heading: '秋立つ日よめる',
    text: '秋来ぬと目にはさやかに見えねども風の音にぞおどろかれぬる',
    modern: '秋がやってきたと、目にははっきりと見えないけれど、（吹く）風の音に（秋が来たのだなあと）はっと気づかされたことだ。',
  },
  {
    id: 's4',
    title: '源宗于',
    heading: '冬の歌とてよめる',
    text: '山里は冬ぞさびしさまさりける人目も草もかれぬと思へば',
    modern: '山里は（ただでさえ寂しいのに）とりわけ冬に寂しさがまさることよ。人の訪れもなくなり、草も枯れてしまうと思うと。',
  },
  {
    id: 's5',
    title: '小野小町',
    heading: '題しらず',
    text: '思ひつつ寝ればや人の見えつらむ夢と知りせば覚めざらましを',
    modern: '（あの人のことを）恋い慕いながら寝たので、あの人が（夢に）現れたのだろうか。夢と知っていたならば目を覚まさなかっただろうに。',
  },
  {
    id: 's6',
    title: '在原業平',
    heading: '弥生の一日より、忍びに人にものら言ひて後に、雨のそほ降りけるに、よみて遣はしける',
    text: '起きもせず寝もせで夜を明かしては春の物とてながめ暮らしつ',
    modern: '（あなたのことを思って昨夜は）起きているでもなし、寝るでもなし、といった状態で夜を明かして、（今日は一日）春のものである長雨をぼんやりと物思いにふけって眺めながら一日を過ごしてしまったことだ。',
  },
];

const sectionById = new Map(sections.map((section) => [section.id, section]));
const counters = {};
const searchCursor = {};
const unsetItems = [];

function makeId(type, sectionId) {
  const key = `${type}-${sectionId}`;
  counters[key] = (counters[key] ?? 0) + 1;
  return `${type}-${sectionId}-${counters[key]}`;
}

function findSpan(section, surface, from = 0) {
  const start = section.text.indexOf(surface, from);
  if (start < 0) return { start: undefined, end: undefined };
  return { start, end: start + surface.length };
}

function addTarget(sectionId, target) {
  const section = sectionById.get(sectionId);
  if (!section) throw new Error(`unknown section: ${sectionId}`);
  if (!section.targets) section.targets = [];
  const cursorKey = `${sectionId}:${target.type}:${target.surface}`;
  const span = findSpan(section, target.surface, searchCursor[cursorKey] ?? 0);
  if (span.start !== undefined) searchCursor[cursorKey] = span.end;
  section.targets.push({ ...target, ...span, sectionId });
  if (span.start === undefined && target.surface) {
    unsetItems.push(`- ${sectionId}「${target.surface}」：本文中の位置を自動特定できませんでした。`);
  }
}

function hasKanji(value) {
  return /\p{Script=Han}/u.test(String(value ?? ''));
}

const sourceRubyParagraphSection = new Map([
  [22, 's1'], [23, 's1'],
  [25, 's2'], [26, 's2'],
  [28, 's3'], [29, 's3'],
  [31, 's4'], [32, 's4'],
  [34, 's5'], [35, 's5'],
  [37, 's6'], [38, 's6'],
]);

function addReadingTargets() {
  const seen = new Set();
  for (const paragraph of originalSource.paragraphs ?? []) {
    const sectionId = sourceRubyParagraphSection.get(paragraph.index);
    if (!sectionId) continue;
    const section = sectionById.get(sectionId);
    for (const field of paragraph.fields ?? []) {
      const surface = String(field.text ?? '').trim();
      const answer = String(field.annotation ?? '').trim();
      if (!surface || !answer || !hasKanji(surface)) continue;
      const span = findSpan(section, surface, 0);
      if (span.start === undefined) continue;
      const key = `${sectionId}:${surface}:${answer}:${span.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      section.targets ??= [];
      section.targets.push({
        id: makeId('reading', sectionId),
        type: 'reading',
        surface,
        answer,
        explanation: answer,
        questionText: `「${surface}」の読みを現代仮名遣いで答えなさい。`,
        questionSurface: surface,
        gradingMode: 'local',
        ...span,
        sectionId,
      });
    }
  }
}

addReadingTargets();

const vocabItems = [
  ['s1', 'ひち', '濡れる。水につかる。', '動詞'],
  ['s1', 'むすび', '手で水をすくう。', '動詞'],
  ['s3', 'さやかに', 'はっきりと。', '形容動詞'],
  ['s3', 'おどろか', 'はっと気づく。', '動詞'],
  ['s5', '思ひ', '恋い慕う。', '動詞'],
  ['s6', 'ながめ', 'ぼんやりと物思いにふける。ぼんやりと見る。', '動詞'],
  ['s6', '暮らし', '一日を過ごす。', '動詞'],
];

for (const [sectionId, surface, answer, pos] of vocabItems) {
  addTarget(sectionId, {
    id: makeId('vocab', sectionId),
    type: 'vocab',
    surface,
    pos,
    answer,
    explanation: answer,
    gradingMode: 'ai',
    source: '【ソース】漢字・語句_古今和歌集.json／【ソース】重要語意味調べ_古今和歌集.json',
  });
}

function targetTypeForToken(token) {
  const pos = String(token.partOfSpeech ?? '');
  const label = String(token.grammarLabel ?? '');
  if (pos === '動詞') return 'verb';
  if (pos === '形容詞' || pos === '形容動詞' || label.startsWith('ナリ') || label.startsWith('ク・') || label.startsWith('シク・')) return 'adj';
  if (pos === '助動詞' || /^(過|完|存|打|自|現推|現原推|反仮|詠|意)/.test(label)) return 'aux';
  if (pos.includes('助詞')) return 'particle';
  return null;
}

const posParagraphSection = new Map([
  [2, 's1'],
  [5, 's2'],
  [8, 's3'],
  [11, 's4'],
  [14, 's5'],
  [17, 's6'],
]);

for (const paragraph of posSource.paragraphs ?? []) {
  const sectionId = posParagraphSection.get(paragraph.index);
  if (!sectionId) continue;
  for (const token of paragraph.tokens ?? []) {
    const type = targetTypeForToken(token);
    if (!type) continue;
    const section = sectionById.get(sectionId);
    const span = findSpan(section, token.word, 0);
    const baseTarget = {
      id: makeId(type, sectionId),
      type,
      surface: token.word,
      answer: token.expansion,
      explanation: `${token.grammarLabel}：${token.expansion}`,
      grammarLabel: token.grammarLabel,
      source: '【ソース】品詞分解_古今和歌集.json',
      ...span,
      sectionId,
    };
    if (type === 'verb' || type === 'adj') {
      baseTarget.baseForm = token.word;
      baseTarget.conjugationType = token.conjugationType === '未記載' ? '' : token.conjugationType;
      baseTarget.formInText = token.conjugationForm === '未記載' ? '' : token.conjugationForm;
      if (!baseTarget.baseForm || !baseTarget.conjugationType || !baseTarget.formInText) {
        unsetItems.push(`- ${sectionId}「${token.word}」：基本形・活用情報の一部が品詞分解ソース内に不足しています。`);
      }
    }
    if (span.start === undefined) {
      unsetItems.push(`- ${sectionId}「${token.word}」：品詞分解トークンの本文位置を自動特定できませんでした。`);
    }
    section.targets ??= [];
    section.targets.push(baseTarget);
  }
}

const grammarItems = [
  ['s1', '春立つけふの風やとくらむ', '「や」に対する結びの語を終止形で答えなさい。', 'らむ', '係り結び。「や」によって文末の「らむ」が連体形になっている。'],
  ['s2', '香をかげば', '「ば」の働きを答えなさい。', '順接の確定条件（偶然条件）。', '已然形＋ば。'],
  ['s2', '昔の人の袖の香ぞする', '「ぞ」に対する結びの語を終止形で答えなさい。', 'す', '係り結び。「ぞ」によって「する」が連体形になっている。'],
  ['s3', '目にはさやかに見えねども', '「ども」の働きを答えなさい。', '逆接の確定条件。', '已然形＋ども。'],
  ['s3', '風の音にぞおどろかれぬる', '「ぞ」に対する結びの語を終止形で答えなさい。', 'ぬ', '係り結び。「ぞ」によって「ぬる」が連体形になっている。'],
  ['s4', '冬ぞさびしさまさりける', '「ぞ」に対する結びの語を終止形で答えなさい。', 'けり', '係り結び。「ぞ」によって「ける」が連体形になっている。'],
  ['s4', '思へば', '「ば」の働きを答えなさい。', '順接の確定条件（偶然条件）。', '已然形＋ば。'],
  ['s5', '寝れば', '「寝れば」を文法的に説明しなさい。', 'ナ行下二段活用動詞「寝」の已然形＋接続助詞「ば」。', 'ここでは「寝たので」と訳す。'],
  ['s5', '見えつらむ', '助動詞「らむ」の意味を答えなさい。', '現在の原因推量。', '「見えたのだろうか」と訳す。'],
  ['s6', '起きもせず寝もせで', 'この表現の文法上の特徴を説明しなさい。', '「起きもせず」と「寝もせで」が並列され、どちらでもない状態を表している。', '「起きているでもなし、寝るでもなし」と訳す。'],
];

for (const [sectionId, surface, questionText, answer, explanation] of grammarItems) {
  addTarget(sectionId, {
    id: makeId('grammar', sectionId),
    type: 'grammar',
    surface,
    questionSurface: surface,
    questionText,
    answer,
    explanation,
    gradingMode: 'ai',
  });
}

const rhetoricItems = [
  ['s1', ['むすび', 'とく'], '「袖ひちて」の歌に用いられている掛詞を指摘しなさい。', '「むすび」に「掬び」と「結び」、「とく」に「溶く」と「解く」が掛けられている。', '掛詞'],
  ['s1', ['袖', 'むすび', 'とく'], '「袖ひちて」の歌に用いられている縁語を指摘しなさい。', '「袖」「結び」「解く」が縁語である。', '縁語'],
  ['s4', ['かれ'], '「かれ」は何と何の掛詞か答えなさい。', '「離れ」と「枯れ」。', '掛詞'],
  ['s4', ['山里は冬ぞさびしさまさりける'], '「山里は」の歌は何句切れか答えなさい。', '三句切れ。', '句切れ'],
  ['s6', ['ながめ'], '「ながめ」は何と何の掛詞か答えなさい。', '「眺め」と「長雨」。', '掛詞'],
];

for (const [sectionId, surfaces, questionText, answer, label] of rhetoricItems) {
  const surface = surfaces[0];
  addTarget(sectionId, {
    id: makeId('rhetoric', sectionId),
    type: 'rhetoric',
    surface,
    targetSurfaces: surfaces,
    questionSurface: surface,
    questionText,
    answer,
    explanation: `${label}。${answer}`,
    gradingMode: 'ai',
  });
}

const normalQuestions = [
  {
    id: 'content-1',
    type: 'content',
    title: '内容読解1',
    question: '「春立ちける日」とはいつか。',
    targetText: '春立ちける日',
    sectionId: 's1',
    answer: '立春。',
    explanation: '',
  },
  {
    id: 'content-2',
    type: 'content',
    title: '内容読解2',
    question: '「袖ひちて」の歌に含まれている季節を挙げなさい。',
    targetText: '袖ひちて',
    sectionId: 's1',
    answer: '夏、冬、春。',
    explanation: '',
  },
  {
    id: 'content-3',
    type: 'content',
    title: '内容読解3',
    question: '「袖ひちて」の歌の理知的な点を説明しなさい。',
    targetText: '袖ひちてむすびし水のこほれるを春立つけふの風やとくらむ',
    sectionId: 's1',
    answer: '暦や中国の文献『礼記』の記述を踏まえ、昨夏すくった水が冬の間に凍り、立春の風が溶かすだろうと想像を巡らしている点。',
    explanation: '',
  },
  {
    id: 'content-4',
    type: 'content',
    title: '内容読解4',
    question: '陰暦五月は現代の暦ではいつ頃にあたるか。',
    targetText: '五月まつ',
    sectionId: 's2',
    answer: '六月から七月頃。',
    explanation: '',
  },
  {
    id: 'content-5',
    type: 'content',
    title: '内容読解5',
    question: '「昔の人」とはどのような人か。',
    targetText: '昔の人',
    sectionId: 's2',
    answer: '昔親しんだ恋人。',
    explanation: '',
  },
  {
    id: 'content-6',
    type: 'content',
    title: '内容読解6',
    question: '「秋来ぬ」の読みを答えなさい。',
    targetText: '秋来ぬ',
    sectionId: 's3',
    answer: 'あききぬ。',
    explanation: '',
  },
  {
    id: 'content-7',
    type: 'content',
    title: '内容読解7',
    question: '「秋来ぬと」の歌の鑑賞として、どのような点に知的な趣があるか説明しなさい。',
    targetText: '秋来ぬと目にはさやかに見えねども風の音にぞおどろかれぬる',
    sectionId: 's3',
    answer: '秋の訪れを視覚ではなく聴覚によってとらえた点。',
    explanation: '',
  },
  {
    id: 'content-8',
    type: 'content',
    title: '内容読解8',
    question: '山里で冬に寂しさが募るのはなぜか。',
    targetText: '人目も草もかれぬと思へば',
    sectionId: 's4',
    answer: '人の訪れもなくなり、草も枯れてしまうから。',
    explanation: '',
  },
  {
    id: 'content-9',
    type: 'content',
    title: '内容読解9',
    question: '「人」は誰のことか。',
    targetText: '人の見えつらむ',
    sectionId: 's5',
    answer: '恋人。',
    explanation: '',
  },
  {
    id: 'translation-1',
    type: 'translation',
    title: '現代語訳1',
    question: '「夢と知りせば覚めざらましを」を現代語訳しなさい。',
    targetText: '夢と知りせば覚めざらましを',
    sectionId: 's5',
    answer: '夢と知っていたならば目を覚まさなかっただろうに。',
    explanation: '',
  },
  {
    id: 'content-10',
    type: 'content',
    title: '内容読解10',
    question: '「起きもせず寝もせで夜を明かし」たのはなぜか。',
    targetText: '起きもせず寝もせで夜を明かしては',
    sectionId: 's6',
    answer: '恋人のことを思って寝られなかったから。',
    explanation: '',
  },
  {
    id: 'translation-2',
    type: 'translation',
    title: '現代語訳2',
    question: '下の句を掛詞に注意して現代語訳しなさい。',
    targetText: '春の物とてながめ暮らしつ',
    sectionId: 's6',
    answer: '春のものである長雨をぼんやりと物思いにふけって眺めながら一日を過ごしてしまったことだ。',
    explanation: '',
  },
  {
    id: 'knowledge-1',
    type: 'content',
    title: '文学史1',
    question: '『古今和歌集』について、わが国最初の何和歌集か答えなさい。',
    targetText: '古今和歌集',
    sectionId: 's1',
    answer: '勅撰和歌集。',
    explanation: '',
  },
  {
    id: 'knowledge-2',
    type: 'content',
    title: '文学史2',
    question: '「六歌仙」に含まれる人物を、この教材の歌人の中からすべて答えなさい。',
    targetText: '小野小町　在原業平',
    sectionId: 's5',
    answer: '小野小町、在原業平。',
    explanation: '',
  },
];

const notes = [
  {
    title: '学習',
    body: 'それぞれの歌について、どのような感動・心情が歌われているかを確認する。',
  },
  {
    title: 'ことばと表現',
    body: '掛詞、縁語、句切れ、係り結び、確定条件などに注目する。',
  },
];

const data = {
  id: 'kokinwakashu',
  title: '和歌_古今和歌集',
  source: '古今和歌集',
  genre: '古文',
  sectionNumberStart: 10,
  notes,
  sections,
  normalQuestions,
};

fs.writeFileSync(outFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

const report = [
  '# 未設定の項目',
  '',
  '分類に迷った項目、またはソースだけではページ用データとして不足が残る項目です。',
  '',
  '## 自動位置特定・活用情報',
  '',
  unsetItems.length ? [...new Set(unsetItems)].join('\n') : '- なし',
  '',
  '## 本文外のため問題化しなかった語',
  '',
  '- 「遣はす」：重要語意味調べにありますが、歌本文ではなく詞書に含まれる語のため、本文連動型の語句問題からは外しました。',
  '',
  '## 今回の分類方針',
  '',
  '- 語句意味は「語句」タブに分類し、AI採点対象にしました。',
  '- 係り結び、確定条件、複数語の組み合わせによる文法事項は「文法」タブに分類しました。',
  '- 掛詞、縁語、句切れは「修辞」タブに分類しました。',
  '- 動詞・形容詞・助動詞・助詞の単独項目は、それぞれ専用タブに分類しました。',
].join('\n');

fs.writeFileSync(reportFile, `${report}\n`, 'utf8');
console.log(`wrote ${outFile}`);
console.log(`wrote ${reportFile}`);
