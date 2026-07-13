import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');
const sourceDir = path.join(workspaceRoot, '和歌_万葉集');
const outFile = path.join(appRoot, 'public', 'data', 'manyoshu.json');
const reportFile = path.join(workspaceRoot, '和歌_万葉集', '未設定の項目.md');

function readSource(predicate) {
  const file = fs.readdirSync(sourceDir).find(predicate);
  if (!file) throw new Error('source not found');
  return JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8').replace(/^\uFEFF/, ''));
}

const posSource = readSource((name) => name.includes('品詞分解'));

const originalSource = readSource((name) => name.includes('\u539f\u6587'));

const sections = [
  {
    id: 's1',
    title: '柿本人麻呂',
    text: '天離る鄙の長道ゆ恋ひ来れば明石の門より大和島見ゆ',
    modern: '遠い田舎の長くつづく道（海路）を通って、故郷の大和を恋しく思いながら上ってくると、明石海峡から大和の山々が見えることだ。',
  },
  {
    id: 's2',
    title: '山部赤人 長歌',
    text: '天地の分かれし時ゆ神さびて高く貴き駿河なる富士の高嶺を天の原振り放け見れば渡る日の影も隠らひ照る月の光も見えず白雲もい行きはばかり時じくそ雪は降りける語り継ぎ言ひ継ぎ行かむ富士の高嶺は',
    modern: '天と地が分かれた時から、神々しくて高く貴い、駿河にある富士の高い嶺を大空を振り仰いで見ると、空を渡る陽光も隠れ、照る月の光も見えず、白雲も行くのをためらい、季節に関係なく雪は降っているよ。語り継ぎ、言い継いでいこう、この富士の高い嶺のことは。',
  },
  {
    id: 's3',
    title: '山部赤人 反歌',
    text: '田子の浦ゆうち出でて見れば真白にそ富士の高嶺に雪は降りける',
    modern: '田子の浦を通って広々としたところに出て見ると、真っ白に、富士の高い嶺に雪が降り積もっていることだよ。',
  },
  {
    id: 's4',
    title: '額田王',
    text: 'あかねさす紫野行き標野行き野守は見ずや君が袖振る',
    modern: '紫草を栽培している標野をあちらに行きこちらに行きして、野の番人は見ていないでしょうか。いや、見ていますよ。あなたが袖を振る姿を。',
  },
  {
    id: 's5',
    title: '天武天皇',
    text: '紫草のにほへる妹をにくくあらば人妻ゆゑに我恋ひめやも',
    modern: '紫草からとれる染料のように輝くばかりに美しいあなたを憎いと思うなら、人妻なのに私は恋い慕うでしょうか。いや、恋い慕いません。',
  },
  {
    id: 's6',
    title: '山上憶良',
    text: '憶良らは今は罷らむ子泣くらむそれその母も我を待つらむそ',
    modern: '私憶良めは今はもう退出いたしましょう。家では今頃子供が泣いているだろう。ほら、その子の母も私を待っているだろうよ。',
  },
  {
    id: 's7',
    title: '大伴家持',
    text: '春の園紅にほふ桃の花下照る道に出で立つ娘子',
    modern: '春の庭園が、咲き誇る桃の花のために紅に美しく輝いている。その桃の花によって照り映えて輝いている木陰の道に出で立つ乙女よ。',
  },
  {
    id: 's8',
    title: '東歌',
    text: '多摩川にさらす手作りさらさらになにそこの児のここだかなしき',
    modern: '多摩川にさらす手織りの布のように、さらにさらにどうしてこの娘がこんなにいとおしいのか。',
  },
  {
    id: 's9',
    title: '防人の歌',
    text: '防人に行くはたが背と問ふ人を見るがともしさ物思ひもせず',
    modern: '防人に行くのは誰の夫かと尋ねる人を見ることのうらやましさよ。その人は物思いもしないで。',
  },
];

const paragraphSection = new Map([
  [1, 's1'], [2, 's1'],
  [4, 's2'], [5, 's2'],
  [8, 's3'],
  [10, 's4'], [11, 's4'],
  [13, 's5'], [14, 's5'],
  [16, 's6'], [17, 's6'],
  [18, 's7'], [19, 's7'],
  [21, 's8'], [22, 's8'],
  [24, 's9'], [25, 's9'],
]);

const sectionById = new Map(sections.map((section) => [section.id, section]));

function findSpan(section, surface, from = 0) {
  const start = section.text.indexOf(surface, from);
  if (start < 0) return { start: undefined, end: undefined };
  return { start, end: start + surface.length };
}

const counters = {};
const searchCursor = {};
function makeId(type, sectionId) {
  const key = `${type}-${sectionId}`;
  counters[key] = (counters[key] ?? 0) + 1;
  return `${type}-${sectionId}-${counters[key]}`;
}

function addTarget(sectionId, target) {
  const section = sectionById.get(sectionId);
  if (!section.targets) section.targets = [];
  const cursorKey = `${sectionId}:${target.surface}`;
  const span = findSpan(section, target.surface, searchCursor[cursorKey] ?? 0);
  if (span.start !== undefined) searchCursor[cursorKey] = span.end;
  section.targets.push({ ...target, ...span, sectionId });
}

const sourceRubyParagraphSection = new Map([
  [35, 's1'],
  [38, 's2'], [39, 's2'], [40, 's2'], [41, 's2'],
  [44, 's3'],
  [47, 's4'],
  [50, 's5'],
  [53, 's6'],
  [56, 's7'],
  [59, 's8'],
  [62, 's9'],
]);

function hasKanji(value) {
  return /\p{Script=Han}/u.test(String(value ?? ''));
}

function normalizeReading(value) {
  return String(value ?? '').trim();
}

function addReadingTargets() {
  const seen = new Set();
  for (const paragraph of originalSource.paragraphs ?? []) {
    const sectionId = sourceRubyParagraphSection.get(paragraph.index);
    if (!sectionId) continue;
    const section = sectionById.get(sectionId);
    if (!section) continue;
    for (const field of paragraph.fields ?? []) {
      const surface = String(field.text ?? '').trim();
      const answer = normalizeReading(field.annotation);
      if (!surface || !answer || !hasKanji(surface)) continue;
      const span = findSpan(section, surface, 0);
      if (span.start === undefined) continue;
      const key = `${sectionId}:${surface}:${answer}:${span.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!section.targets) section.targets = [];
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
  ['s1', '鄙', '田舎。', '名詞'],
  ['s1', '見ゆ', '見える。見られる。', '動詞'],
  ['s5', 'にほふ', '美しく輝く。色づく。', '動詞'],
  ['s5', '妹', '男性から妻や恋人など親しい女性を呼ぶ語。ここでは恋しいあなた。', '名詞'],
  ['s6', '罷る', '退出する。目上の人のもとから離れる意の謙譲語。', '動詞'],
  ['s8', 'ここだ', 'たいへん。たくさん。', '副詞'],
  ['s8', 'かなしき', 'いとおしい。かわいい。', '形容詞'],
  ['s9', '背', '夫。女性から夫や恋人など親しい男性を呼ぶ語。', '名詞'],
  ['s9', 'ともしさ', 'うらやましさ。', '形容詞'],
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
  });
}

function targetTypeForToken(token) {
  if (token.partOfSpeech === '動詞') return 'verb';
  if (token.partOfSpeech === '形容詞' || token.partOfSpeech === '形容動詞') return 'adj';
  if (token.partOfSpeech === '助動詞') return 'aux';
  if (String(token.partOfSpeech ?? '').includes('助詞')) return 'particle';
  return null;
}

const unsetItems = [];
for (const token of posSource.tokens ?? []) {
  const sectionId = paragraphSection.get(token.paragraphIndex);
  const type = targetTypeForToken(token);
  if (!sectionId || !type) continue;
  const section = sectionById.get(sectionId);
  if (!section.targets) section.targets = [];
  const span = findSpan(section, token.word, 0);
  const baseTarget = {
    id: makeId(type, sectionId),
    type,
    surface: token.word,
    answer: token.expansion,
    explanation: `${token.grammarLabel}：${token.expansion}`,
    grammarLabel: token.grammarLabel,
    source: '【ソース】品詞分解_万葉集.json',
    ...span,
    sectionId,
  };
  if (type === 'verb' || type === 'adj') {
    baseTarget.baseForm = token.word;
    baseTarget.conjugationType = token.conjugationType === '未記載' ? '' : token.conjugationType;
    baseTarget.formInText = token.conjugationForm === '未記載' ? '' : token.conjugationForm;
    if (!baseTarget.baseForm || !baseTarget.conjugationType || !baseTarget.formInText) {
      unsetItems.push(`- ${sectionId}「${token.word}」：基本形・活用情報の一部が品詞分解ソース内に不足`);
    }
  }
  if (type === 'aux' || type === 'particle') {
    baseTarget.answer = token.expansion;
  }
  section.targets.push(baseTarget);
}

const rhetoricItems = [
  ['s1', '天離る', '「天離る」は何か。', '枕詞。「鄙」にかかる。'],
  ['s2', '渡る日の影も隠らひ照る月の光も見えず', '対句表現を抜き出し、その効果を説明しなさい。', '「渡る日の影も隠らひ／照る月の光も見えず」。富士山の大きさや神々しさを強調する。'],
  ['s2', '語り継ぎ言ひ継ぎ行かむ富士の高嶺は', 'この部分の表現上の特徴を答えなさい。', '倒置。富士の高嶺を永く語り継ごうとする思いを強めている。'],
  ['s3', '田子の浦', '古来歌に詠み込まれてきた名所を何というか。', '歌枕。'],
  ['s3', '田子の浦ゆうち出でて見れば真白にそ富士の高嶺に雪は降りける', '長歌に伴い、その内容を反復・要約する短歌を何というか。', '反歌。'],
  ['s4', 'あかねさす', '「あかねさす」は何か。', '枕詞。「紫」にかかる。'],
  ['s4', '袖振る', '「袖振る」はどのような意味を持つ行為か。', '相手を好きだと表す愛情表現。'],
  ['s7', '娘子', '体言止めの効果を説明しなさい。', '娘子の美しさが強調され、感動が余韻として残る。'],
  ['s8', '多摩川にさらす手作り', 'この部分は何か。', '序詞。「さらさら」を導き出す。'],
  ['s8', 'さらす手作りさらさらに', 'この表現の特徴を答えなさい。', '同音の繰り返し。'],
  ['s8', '多摩川にさらす手作りさらさらになにそこの児のここだかなしき', 'この歌の種類を答えなさい。', '東歌。'],
  ['s9', '防人に行くはたが背と問ふ人を見るがともしさ物思ひもせず', 'この歌の種類を答えなさい。', '防人の歌。'],
];

for (const [sectionId, surface, questionText, answer] of rhetoricItems) {
  addTarget(sectionId, {
    id: makeId('rhetoric', sectionId),
    type: 'rhetoric',
    surface,
    questionSurface: surface,
    questionText,
    answer,
    explanation: answer,
    gradingMode: 'ai',
  });
}

const normalQuestions = [
  {
    id: 'content-1',
    type: 'content',
    title: '内容読解1',
    question: '「恋ひ来れば」という動作の対象は何か。',
    targetText: '恋ひ来れば',
    sectionId: 's1',
    answer: '故郷である大和。また大和にいる妻、恋人。',
    explanation: '',
  },
  {
    id: 'content-2',
    type: 'content',
    title: '内容読解2',
    question: '作者はどこから「大和島」を見ているのか。',
    targetText: '大和島見ゆ',
    sectionId: 's1',
    answer: '明石海峡の船の上。',
    explanation: '',
  },
  {
    id: 'translation-1',
    type: 'translation',
    title: '現代語訳1',
    question: '傍線部を現代語訳しなさい。',
    targetText: '鄙の長道ゆ',
    sectionId: 's1',
    answer: '田舎の長くつづく道を通って。',
    explanation: '',
  },
  {
    id: 'content-3',
    type: 'content',
    title: '内容読解3',
    question: '富士の山のどのような点をたたえているのか、具体的に答えなさい。',
    targetText: '富士の高嶺',
    sectionId: 's2',
    answer: '神々しく高く貴い美しさ、太陽も月も隠れてしまう大きさ、季節を超越している偉大さ。',
    explanation: '',
  },
  {
    id: 'content-4',
    type: 'content',
    inputType: 'choice',
    title: '内容読解4',
    question: '長歌「富士の山を望む歌」の説明として最も適当なものを選びなさい。',
    choices: [
      '「神さびて」から富士山の自然環境への恐怖が読み取れる。',
      '「渡る日の影」と「照る月の光」は、影と光という対義語を効果的に用いた対句表現である。',
      '「白雲もい行きはばかり」は、白雲がぶつかって渦巻く様子を表す。',
      '「語り継ぎ言ひ継ぎ行かむ」と「富士の高嶺は」とは倒置の関係にある。',
    ],
    sectionId: 's2',
    answer: '「語り継ぎ言ひ継ぎ行かむ」と「富士の高嶺は」とは倒置の関係にある。',
    explanation: '',
  },
  {
    id: 'translation-2',
    type: 'translation',
    title: '現代語訳2',
    question: '傍線部を現代語訳しなさい。',
    targetText: 'なにそこの児のここだかなしき',
    sectionId: 's8',
    answer: 'どうしてこの娘がこんなにいとおしいのか。',
    explanation: '',
  },
  {
    id: 'content-5',
    type: 'content',
    title: '内容読解5',
    question: '「ともしさ」とあるのはなぜか。',
    targetText: 'ともしさ',
    sectionId: 's9',
    answer: '「防人に行くのは誰の夫なのか」と第三者として、何の心配もせずにいられるから。',
    explanation: '',
  },
  {
    id: 'content-6',
    type: 'content',
    title: '内容読解6',
    question: '『万葉集』の三大分類（部立）を答えなさい。',
    targetText: '万葉集',
    sectionId: 's1',
    answer: '雑歌、相聞歌、挽歌。',
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
    body: '奈良時代特有の助詞「ゆ」、枕詞、序詞、反歌、東歌、防人の歌などに注目する。',
  },
  {
    title: '愛するよりも愛されたい',
    body: '授業参考資料PDF。',
    pdf: 'assets/manyoshu/aisuru-yori-aisaretai.pdf',
  },
];

const data = {
  id: 'manyoshu',
  title: '和歌_万葉集',
  source: '万葉集',
  genre: '古文',
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
  '## 品詞分解由来',
  '',
  unsetItems.length ? unsetItems.join('\n') : '- なし',
  '',
  '## 今回の分類方針で文法タブから除外したもの',
  '',
  '- 動詞・形容詞・助動詞・助詞の単独項目は、それぞれ専用タブに分類しました。',
  '- 語句意味は「語句」タブに分類し、AI採点対象にしました。',
].join('\n');

fs.writeFileSync(reportFile, `${report}\n`, 'utf8');
console.log(`wrote ${outFile}`);
console.log(`wrote ${reportFile}`);
