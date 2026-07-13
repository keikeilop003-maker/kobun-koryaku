import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');
const sourceDir = path.join(workspaceRoot, '教材', '和歌_新古今和歌集');
const outFile = path.join(appRoot, 'public', 'data', 'shinkokinwakashu.json');
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
    title: '後鳥羽院',
    heading: '水郷の春望',
    text: '見わたせば山もとかすむ水無瀬河ゆふべは秋となに思ひけむ',
    modern: '見渡すと山の麓はかすみ、水無瀬川が流れているよ。（なんともすばらしいことだ。）夕暮れ（の眺め）は秋が一番だと、どうして思ったのだろうか、いや、秋が一番とは思わない。（春の景色もすばらしい。）',
  },
  {
    id: 's2',
    title: '藤原定家',
    heading: '守覚法親王、五十首歌よませ侍りけるに',
    text: '春の夜の夢の浮橋とだえして峰にわかるる横雲の空',
    modern: '春の夜の、浮橋のようにはかない夢がふととだえて、（目が覚めて外を見やると、）山の峰に別れを告げて離れていく雲がたなびく曙の空だよ。',
  },
  {
    id: 's3',
    title: '藤原俊成',
    heading: 'ほととぎすの歌',
    text: '昔思ふ草の庵の夜の雨に涙な添へそ山ほととぎす',
    modern: 'しみじみと昔を思う。（すると、かつてのはなやかだった頃が思い出されてきて）この草庵で夜一人五月雨の音を聞きながら私は涙に暮れている、（この上さらに鳴いて）お前まで涙を添えてくれるなよ、山ほととぎすよ。',
  },
  {
    id: 's4',
    title: '西行',
    heading: '題しらず',
    text: '心なき身にもあはれは知られけり鴫たつ沢の秋の夕暮れ',
    modern: '情趣を解さない（出家した）この身にも、しみじみとした情趣は自然と感じられるのだなあ。鴫が飛び立っていく沢の秋の夕暮れよ。',
  },
  {
    id: 's5',
    title: '藤原家隆',
    heading: '湖上の冬の月',
    text: '志賀の浦や遠ざかりゆく浪間よりこほりて出づる有明の月',
    modern: '志賀の浦よ。（波打ち際から氷が張るにつれ、しだいに岸から）遠ざかっていく波間から氷のように冷たく光りながら上ってくる有明の月よ。',
  },
  {
    id: 's6',
    title: '式子内親王',
    heading: '忍ぶる恋を',
    text: '玉の緒よ絶えなば絶えねながらへば忍ぶることの弱りもぞする',
    modern: 'わが命よ。絶えてしまうならば絶えてしまってもかまわない。もしこのまま生きながらえるなら、（恋心を）隠し通そうとしている気持ちが弱ると困るから。',
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
  section.targets ??= [];
  const cursorKey = `${sectionId}:${target.type}:${target.surface}`;
  let span = findSpan(section, target.surface, searchCursor[cursorKey] ?? 0);
  if (span.start === undefined) span = findSpan(section, target.surface, 0);
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
  ['s4', '心なき', '情趣を解さない。', '形容詞'],
  ['s4', 'あはれ', 'しみじみとした情趣。', '名詞'],
  ['s5', '有明の月', '夜が明けてもまだ空に残っている月。陰暦十六日以降の月。', '名詞'],
  ['s6', '玉の緒', '命。', '名詞'],
  ['s6', 'ながらへ', '生きながらえる。', '動詞'],
  ['s6', '忍ぶる', '人目を避ける。隠す。', '動詞'],
  ['s6', 'もぞ', '…すると困る。…するといけない。', '係助詞＋係助詞'],
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
    source: '【ソース】漢字・語句_新古今和歌集.json／【ソース】重要語意味調べ_新古今和歌集.json',
  });
}

function targetTypeForToken(token) {
  const pos = String(token.partOfSpeech ?? '');
  const label = String(token.grammarLabel ?? '');
  if (pos === '動詞') return 'verb';
  if (pos === '形容詞' || pos === '形容動詞' || label.startsWith('ナリ') || label.startsWith('ク・') || label.startsWith('シク・')) return 'adj';
  if (pos === '助動詞' || /^(過|完|存|打|自|現推|現原推|過原推|反仮|詠|意|使)/.test(label)) return 'aux';
  if (pos.includes('助詞')) return 'particle';
  return null;
}

const posParagraphSection = new Map([
  [2, 's1'],
  [5, 's2'],
  [8, 's3'],
  [11, 's4'],
  [14, 's5'],
  [16, 's6'],
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
      source: '【ソース】品詞分解_新古今和歌集.json',
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
  ['s1', '見わたせば', '「ば」の働きを答えなさい。', '順接の確定条件（偶然条件）。', '已然形＋ば。'],
  ['s1', 'なに思ひけむ', '助動詞「けむ」の意味と活用形を答えなさい。', '過去の原因推量・連体形。', '反語の気持ちを含み、「どうして思ったのだろうか」と訳す。'],
  ['s3', '涙な添へそ', '「な…そ」が表す意味を漢字二字で答えなさい。', '禁止。', '「な…そ」で禁止を表す。'],
  ['s4', '知られけり', '「れ」「けり」を文法的に説明しなさい。', '「れ」は自発の助動詞「る」の連用形。「けり」は詠嘆の助動詞「けり」の終止形。', '自然と感じられるのだなあ、という意味になる。'],
  ['s6', '絶えなば絶えね', '助動詞「な」「ね」を文法的に説明しなさい。', '「な」は完了の助動詞「ぬ」の未然形。「ね」は完了の助動詞「ぬ」の命令形。', '「絶えてしまうならば絶えてしまってもかまわない」と訳す。'],
  ['s6', '弱りもぞする', '「もぞ」の働きを答え、現代語訳しなさい。', '心配・危惧の意を表す。弱ると困る。', '「もぞ」は危惧を表す。'],
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
  ['s1', ['水無瀬河'], '「水無瀬河」のように、和歌によく詠み込まれる名所を何というか。', '歌枕。', '歌枕'],
  ['s1', ['ゆふべは秋'], '「ゆふべは秋」は、先行するどの文学作品の表現を踏まえているか。', '『枕草子』の「秋は夕暮れ」。', '本説・本文取り'],
  ['s2', ['夢の浮橋'], '「夢の浮橋」が連想させる作品を答えなさい。', '『源氏物語』最終巻「夢の浮橋」。', '本説・本文取り'],
  ['s2', ['夢の浮橋', 'とだえ'], '「春の夜の」の歌に用いられている縁語を指摘しなさい。', '「橋」と「とだえ」が縁語である。', '縁語'],
  ['s2', ['峰にわかるる横雲の空'], '「峰にわかるる横雲の空」の表現技法を答えなさい。', '擬人法。', '擬人法'],
  ['s2', ['横雲の空'], '末尾を体言で結ぶ技法を何というか。', '体言止め。', '体言止め'],
  ['s3', ['昔思ふ草の庵の夜の雨に涙な添へそ山ほととぎす'], 'この歌で、昔の著名な歌の表現や趣向を取り入れている技法を何というか。', '本歌取り。', '本歌取り'],
  ['s3', ['昔思ふ草の庵の夜の雨に'], '白居易の『白氏文集』の一節を踏まえている技法を何というか。', '本説取り。', '本説取り'],
  ['s3', ['山ほととぎす'], '末尾を体言で結ぶ技法を何というか。', '体言止め。', '体言止め'],
  ['s4', ['秋の夕暮れ'], '「秋の夕暮れ」で終わるこの歌の表現技法を答えなさい。', '体言止め。', '体言止め'],
  ['s5', ['志賀の浦'], '「志賀の浦」のように、和歌によく詠み込まれる名所を何というか。', '歌枕。', '歌枕'],
  ['s5', ['志賀の浦や遠ざかりゆく浪間よりこほりて出づる有明の月'], 'この歌で、昔の著名な歌の表現や趣向を取り入れている技法を何というか。', '本歌取り。', '本歌取り'],
  ['s5', ['有明の月'], '末尾を体言で結ぶ技法を何というか。', '体言止め。', '体言止め'],
  ['s6', ['玉の緒', '絶え', 'ながらへ', '弱り'], '「玉の緒よ」の歌に用いられている縁語を説明しなさい。', '「絶ゆ」「ながらふ」「弱る」が「緒」の縁語である。', '縁語'],
];

for (const [sectionId, surfaces, questionText, answer, label] of rhetoricItems) {
  const surface = surfaces[0];
  addTarget(sectionId, {
    id: makeId('rhetoric', sectionId),
    type: 'rhetoric',
    surface,
    targetSurfaces: surfaces.slice(0, 3),
    questionSurface: surface,
    questionText,
    answer,
    explanation: `${label}。${answer}`,
    gradingMode: 'ai',
  });
}

const normalQuestions = [
  { id: 'content-1', type: 'content', title: '内容読解1', question: '「見わたせば」、どのような情景が見えるのか。', targetText: '見わたせば山もとかすむ水無瀬河', sectionId: 's1', answer: '眼前に水無瀬川が流れ、その向こうの山には霞がかかっているという情景。', explanation: '' },
  { id: 'content-2', type: 'content', title: '内容読解2', question: '春の歌であることがわかる表現を抜き出しなさい。', targetText: '山もとかすむ', sectionId: 's1', answer: 'かすむ。', explanation: '' },
  { id: 'content-3', type: 'content', title: '内容読解3', question: '下の句に込められている気持ちを説明しなさい。', targetText: 'ゆふべは秋となに思ひけむ', sectionId: 's1', answer: '春の夕暮れの眺めはこんなにもすばらしいものなのだという感動。', explanation: '' },
  { id: 'content-4', type: 'content', title: '内容読解4', question: '「春の夜の夢の浮橋」とあるが、どのような夢を見ていたと考えられるか。', targetText: '春の夜の夢の浮橋', sectionId: 's2', answer: '恋人に会う夢。', explanation: '' },
  { id: 'content-5', type: 'content', title: '内容読解5', question: '「春の夜の」の歌からどのような気分が伝わってくるか。', targetText: '春の夜の夢の浮橋とだえして峰にわかるる横雲の空', sectionId: 's2', answer: 'はかなさ、せつなさ、けだるさ、甘美な気分など。', explanation: '' },
  { id: 'translation-1', type: 'translation', title: '現代語訳1', question: '「涙な添へそ」を現代語訳しなさい。', targetText: '涙な添へそ', sectionId: 's3', answer: '涙を添えてくれるなよ。', explanation: '' },
  { id: 'content-6', type: 'content', title: '内容読解6', question: '「涙な添へそ」とあるが、誰の涙か。', targetText: '涙な添へそ山ほととぎす', sectionId: 's3', answer: 'ほととぎす、作者。', explanation: '' },
  { id: 'content-7', type: 'content', title: '内容読解7', question: '作者はなぜ泣いているのか。', targetText: '昔思ふ草の庵の夜の雨に涙な添へそ', sectionId: 's3', answer: '昔の自分を思い出し、懐旧の念があふれてきたから。', explanation: '' },
  { id: 'content-8', type: 'content', title: '内容読解8', question: '「心なき身」とはどういうことか。', targetText: '心なき身', sectionId: 's4', answer: '情趣を解さない自分自身。', explanation: '' },
  { id: 'content-9', type: 'content', title: '内容読解9', question: '「あはれ」は具体的にどのような感慨か。', targetText: 'あはれ', sectionId: 's4', answer: '深い寂寥感。', explanation: '' },
  { id: 'content-10', type: 'content', title: '内容読解10', question: '秋の夕暮れの静寂を引き立てているものは何か。', targetText: '鴫たつ沢', sectionId: 's4', answer: '鴫が飛び立ったときの大きな羽音。', explanation: '' },
  { id: 'content-11', type: 'content', title: '内容読解11', question: '何が「遠ざかりゆく」のか。また、それはなぜか。', targetText: '遠ざかりゆく浪間', sectionId: 's5', answer: '波。湖水が岸から沖へ凍って行くから。', explanation: '' },
  { id: 'content-12', type: 'content', title: '内容読解12', question: '「有明の月」はどのような形をしているか。', targetText: '有明の月', sectionId: 's5', answer: '下弦の月。', explanation: '' },
  { id: 'content-13', type: 'content', title: '内容読解13', question: '「玉の緒」とは何のことか。', targetText: '玉の緒', sectionId: 's6', answer: '命。', explanation: '' },
  { id: 'translation-2', type: 'translation', title: '現代語訳2', question: '上二句を現代語訳しなさい。', targetText: '玉の緒よ絶えなば絶えね', sectionId: 's6', answer: 'わが命よ。絶えてしまうならば絶えてしまってもかまわない。', explanation: '' },
  { id: 'content-14', type: 'content', title: '内容読解14', question: '上二句のように考えるのはなぜか。', targetText: 'ながらへば忍ぶることの弱りもぞする', sectionId: 's6', answer: 'これ以上生きていたら忍ぶ恋心をおさえきれなくなり、人に知られてしまうから。', explanation: '' },
  { id: 'knowledge-1', type: 'content', title: '文学史1', question: '「心なき」の歌は、寂蓮法師・藤原定家の歌とともに何と呼ばれているか。', targetText: '秋の夕暮れ', sectionId: 's4', answer: '三夕の歌。', explanation: '' },
  { id: 'knowledge-2', type: 'content', title: '文学史2', question: '『新古今和歌集』の撰者に含まれる人物を、この教材の歌人の中からすべて答えなさい。', targetText: '藤原定家　藤原家隆', sectionId: 's2', answer: '藤原定家、藤原家隆。', explanation: '' },
];

const notes = [
  { title: '学習', body: 'それぞれの歌について、主題と余情表現を確認する。' },
  { title: 'ことばと表現', body: '本歌取り、本説取り、歌枕、体言止め、擬人法、縁語、句切れに注目する。' },
];

const data = {
  id: 'shinkokinwakashu',
  title: '和歌_新古今和歌集',
  source: '新古今和歌集',
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
  '## 自動位置特定・活用情報',
  '',
  unsetItems.length ? [...new Set(unsetItems)].join('\n') : '- なし',
  '',
  '## 今回の分類方針',
  '',
  '- 語句意味は「語句」タブに分類し、AI採点対象にしました。',
  '- 係り結び、禁止表現、危惧表現などは「文法」タブに分類しました。',
  '- 本歌取り、本説取り、歌枕、体言止め、擬人法、縁語、句切れは「修辞」タブに分類しました。',
  '- 動詞・形容詞・助動詞・助詞の単独項目は、それぞれ専用タブに分類しました。',
].join('\n');

fs.writeFileSync(reportFile, `${report}\n`, 'utf8');
console.log(`wrote ${outFile}`);
console.log(`wrote ${reportFile}`);
