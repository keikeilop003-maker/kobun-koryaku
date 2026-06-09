import fs from 'node:fs';

const mdPath = new URL('../../../筒井筒/作成.md', import.meta.url);
const jsonPath = new URL('../public/data/tsutsuizutsu.json', import.meta.url);

const md = fs.readFileSync(mdPath, 'utf8');
const existing = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

function sectionBlock(title, nextTitle) {
  const start = md.indexOf(title);
  if (start < 0) throw new Error(`missing section ${title}`);
  const end = nextTitle ? md.indexOf(nextTitle, start + title.length) : md.length;
  if (end < 0) throw new Error(`missing next section ${nextTitle}`);
  return md.slice(start + title.length, end);
}

function extractSectionText(block, label) {
  const marker = `  - ${label}`;
  const start = block.indexOf(marker);
  if (start < 0) throw new Error(`missing ${label}`);
  const next = block.slice(start + marker.length).search(/\n  - 第[一二三]段/);
  const raw = next < 0
    ? block.slice(start + marker.length)
    : block.slice(start + marker.length, start + marker.length + next);
  return raw
    .split(/\r?\n/)
    .map(line => line.replace(/^\u3000/, '').trimEnd())
    .filter(line => line.trim())
    .join('\n');
}

function parsePosEntries(block, label) {
  const text = extractSectionText(block, label);
  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(.+?)（(.+)）$/);
      if (!match) throw new Error(`bad pos line: ${line}`);
      return { surface: match[1], raw: match[2] };
    });
}

function classify(raw) {
  if (raw.includes('活用')) {
    if (raw.includes('ク活用') || raw.includes('シク活用') || raw.includes('ナリ活用') || raw.includes('タリ活用')) return 'adj';
    return 'verb';
  }
  if (raw.includes('助動詞')) return 'aux';
  if (raw.includes('助詞')) return 'particle';
  return 'skip';
}

function splitRaw(raw, type) {
  const parts = raw.split('・');
  const form = parts.find(part => /^(未然形|連用形|終止形|連体形|已然形|命令形)/.test(part));
  if (type === 'verb') {
    const conj = parts.find(part => part.includes('活用')) ?? parts[0];
    return { conjugationType: conj, formInText: form };
  }
  if (type === 'adj') {
    const conj = parts.find(part => part.includes('活用')) ?? parts[0];
    return { conjugationType: `${conj}${conj.includes('形容') ? '' : '形容詞'}`, formInText: form };
  }
  if (type === 'aux') {
    return { formInText: form };
  }
  return {};
}

const prefix = { verb: 'verb', adj: 'adj', aux: 'aux', particle: 'particle', vocab: 'vocab' };

function buildTargets(section, entries) {
  const counts = {};
  let cursor = 0;
  const targets = [];
  const locatedEntries = [];
  for (const entry of entries) {
    const start = section.text.indexOf(entry.surface, cursor);
    if (start < 0) {
      const context = section.text.slice(Math.max(0, cursor - 30), Math.min(section.text.length, cursor + 80));
      throw new Error(`${section.id}: could not locate "${entry.surface}" after ${cursor}. context=${context}`);
    }
    cursor = start + entry.surface.length;
    const type = classify(entry.raw);
    locatedEntries.push({ ...entry, start, end: start + entry.surface.length, sectionId: section.id, parsedType: type });
    if (type === 'skip') continue;
    counts[type] = (counts[type] ?? 0) + 1;
    const parsed = splitRaw(entry.raw, type);
    targets.push({
      id: `${prefix[type]}-${section.id}-${counts[type]}`,
      type,
      surface: entry.surface,
      ...parsed,
      answer: entry.raw,
      explanation: entry.raw,
      start,
      end: start + entry.surface.length,
      sectionId: section.id,
      ...(type === 'particle' ? { particleQuestionType: 'usage' } : {}),
    });
  }
  return { targets, locatedEntries };
}

const sourceBlock = sectionBlock('## 原文', '## 書き下し文');
const modernBlock = sectionBlock('## 現代語訳', '## 備考');
const posBlock = sectionBlock('## 品詞', '## 重要語句');
const vocabBlock = sectionBlock('## 重要語句', '## 文法・句法');
const readingBlock = sectionBlock('## 読解問題', '### 問題タイプまとめ');

function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/\*\*/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();
}

function parseImportantVocab(block) {
  return block
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('|') && !line.includes('---') && !line.includes('語句 | 品詞'))
    .map(line => line.split('|').slice(1, -1).map(cell => stripMarkdown(cell)))
    .filter(cells => cells.length >= 5)
    .map(([term, pos, conjugation, meaning, detail]) => ({
      term,
      pos,
      conjugation: conjugation === '—' ? '' : conjugation,
      meaning,
      detail,
    }));
}

const importantVocab = parseImportantVocab(vocabBlock);

function selectedMeaning(meaning) {
  const text = stripMarkdown(meaning);
  const marker = text.match(/※ここでは([①②③④⑤⑥⑦⑧⑨⑩])/);
  if (!marker) return text.replace(/※ここでは[①②③④⑤⑥⑦⑧⑨⑩].*$/, '').trim();
  const number = marker[1];
  const numbered = [...text.matchAll(/([①②③④⑤⑥⑦⑧⑨⑩])([^①②③④⑤⑥⑦⑧⑨⑩※]+)/g)];
  const match = numbered.find(item => item[1] === number);
  return (match?.[2] ?? text)
    .replace(/※ここでは[①②③④⑤⑥⑦⑧⑨⑩].*$/, '')
    .trim();
}

function otherMeanings(meaning) {
  const text = stripMarkdown(meaning);
  const marker = text.match(/※ここでは([①②③④⑤⑥⑦⑧⑨⑩])/);
  if (!marker) return '';
  const number = marker[1];
  return [...text.matchAll(/([①②③④⑤⑥⑦⑧⑨⑩])([^①②③④⑤⑥⑦⑧⑨⑩※]+)/g)]
    .filter(item => item[1] !== number)
    .map(item => `${item[1]}${item[2].trim()}`)
    .join(' ');
}

const IMPORTANT_SURFACE_MAP = {
  '心にくし': [{ surface: '心にくく' }],
  'かなし': [{ surface: 'かなし' }],
  'ながむ': [{ surface: 'うちながめ' }],
  '前栽': [{ surface: '前栽' }],
  'けしき': [{ surface: 'けしき' }],
  'さり': [{ surface: 'さり' }],
  'いふかひなし': [{ surface: 'いふかひなく' }],
  '頼り': [{ surface: '頼り' }],
  '年ごろ': [{ surface: '年ごろ' }],
  '本意': [{ surface: '本意' }],
  'あふ': [{ surface: 'あひ' }],
  'ものの': [{ surface: 'ものの' }],
  '頼む': [{ surface: '頼ま' }],
  'な…そ': [{ sectionId: 's3', surface: 'な' }, { sectionId: 's3', surface: 'そ' }],
  '心うし': [{ surface: '心うがり' }],
  '手づから': [{ surface: '手づから' }],
};

const IMPORTANT_ANSWER_OVERRIDES = {
  '心にくし': { answer: '奥ゆかしい', alternatives: ['優れている', '立派だ'] },
  'かなし': { answer: 'いとおしい', alternatives: ['かわいい', '愛しい'] },
  'ながむ': { answer: '物思いにふける', alternatives: ['ぼんやりと物思いにふける', 'ぼんやりと見る'] },
  '前栽': { answer: '庭先に植えた草木', alternatives: ['庭の草木', '庭園'] },
  'けしき': { answer: '様子', alternatives: ['機嫌', '意向'] },
  'さり': { answer: 'そうである', alternatives: ['そのようである'] },
  'いふかひなし': { answer: 'みじめだ', alternatives: ['みっともない'] },
  '頼り': { answer: 'よるべ', alternatives: ['縁', 'よりどころ'] },
  '年ごろ': { answer: 'ここ数年', alternatives: ['数年来'] },
  '本意': { answer: '本来の志', alternatives: ['目的', '本当の願い'] },
  'あふ': { answer: '結婚する', alternatives: ['男女が結婚する', '親しくつきあう'] },
  'ものの': { answer: 'けれども', alternatives: ['のに'] },
  '頼む': { answer: 'あてにする', alternatives: ['頼みにする'] },
  'な…そ': { answer: 'するな', alternatives: ['しないでください'] },
  '心うし': { answer: '嫌だ', alternatives: ['不愉快だ'] },
  '手づから': { answer: '自分の手で', alternatives: ['自ら'] },
};

function applyImportantVocab(sections) {
  const byTerm = new Map(importantVocab.map(item => [item.term, item]));
  for (const section of sections) {
    const counts = {
      vocab: section.targets.filter(target => target.type === 'vocab').length,
    };
    for (const entry of section.locatedEntries ?? []) {
      for (const [term, matches] of Object.entries(IMPORTANT_SURFACE_MAP)) {
        if (!matches.some(match => entry.surface === match.surface && (!match.sectionId || section.id === match.sectionId))) continue;
        const item = byTerm.get(term);
        if (!item) continue;
        const override = IMPORTANT_ANSWER_OVERRIDES[term];
        const answer = override?.answer ?? selectedMeaning(item.meaning);
        const alternativeAnswers = override?.alternatives ?? [];
        counts.vocab += 1;
        section.targets.push({
          id: `vocab-${section.id}-${counts.vocab}`,
          type: 'vocab',
          surface: entry.surface,
          answer,
          ...(alternativeAnswers.length ? { alternativeAnswers } : {}),
          explanation: [item.detail, otherMeanings(item.meaning) ? `その他の意味: ${otherMeanings(item.meaning)}` : ''].filter(Boolean).join('\n'),
          start: entry.start,
          end: entry.end,
          sectionId: section.id,
          important: true,
          vocabTerm: term,
          meaning: answer,
          allMeanings: item.meaning,
          detail: [item.detail, otherMeanings(item.meaning) ? `その他の意味: ${otherMeanings(item.meaning)}` : ''].filter(Boolean).join('\n'),
          vocabPos: item.pos,
          ...(item.conjugation ? { vocabConjugation: item.conjugation } : {}),
        });
      }
    }
    delete section.locatedEntries;
  }
}

function parseReadingQuestions(block) {
  const fence = block.match(/```json\s*([\s\S]*?)```/);
  if (!fence) return null;
  try {
    const questions = JSON.parse(fence[1]);
    const serialized = JSON.stringify(questions);
    if (/訳す原文|模範解答|問題文/.test(serialized)) return null;
    return questions;
  } catch {
    return null;
  }
}

const labels = ['第一段', '第二段', '第三段'];
const sections = labels.map((label, index) => {
  const id = `s${index + 1}`;
  const text = extractSectionText(sourceBlock, label);
  const modern = extractSectionText(modernBlock, label);
  const entries = parsePosEntries(posBlock, label);
  const section = { id, title: label, text, modern, notes: '' };
  const { targets, locatedEntries } = buildTargets(section, entries);
  return { ...section, targets, locatedEntries };
});

applyImportantVocab(sections);

const lessonViewSections = Object.fromEntries(
  sections.map(section => [
    section.id,
    {
      section: { text: section.text, modern: section.modern, kundoku: '' },
      published: true,
    },
  ])
);

const data = {
  ...existing,
  sections,
  normalQuestions: parseReadingQuestions(readingBlock) ?? existing.normalQuestions,
  lessonViewSections,
  lessonViewPublished: true,
};

fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
