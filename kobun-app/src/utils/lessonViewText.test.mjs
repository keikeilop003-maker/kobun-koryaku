import test from 'node:test';
import assert from 'node:assert/strict';
import { editorInitialParallelText, splitModernForSourceLines } from './lessonViewText.js';

test('preserves a saved translation with more rows than the source', () => {
  const source = '昔、男ありけり。\nその男、身をえうなきものに思ひなして。';
  const saved = '昔、男がいた。\nその男は、自分自身を\n必要のない者と思い込んで。';
  assert.equal(editorInitialParallelText(saved, source), saved);
  assert.deepEqual(splitModernForSourceLines(saved, source.split('\n')), saved.split('\n'));
});

test('preserves fewer rows, blank rows, spacing and CRLF on reopen', () => {
  const source = '一\n二\n三\n四\n五';
  for (const saved of ['訳の一行目\n訳の二行目', ' 訳の一行目 \n\n訳の三行目\n', '訳の一行目\r\n訳の二行目']) {
    assert.equal(editorInitialParallelText(saved, source), saved);
  }
});

test('repeated save/reload cycles do not rebalance authored text', () => {
  const source = '原文一\n原文二';
  const original = '訳一\n\n訳三\n訳四';
  let stored = original;
  for (let i = 0; i < 3; i++) stored = editorInitialParallelText(JSON.parse(JSON.stringify(stored)), source);
  assert.equal(stored, original);
});

test('still aligns an unformatted single paragraph for initial editing', () => {
  const source = '昔、男ありけり。\n京にはあらじ。';
  const translation = '昔、男がいた。京には住むまい。';
  const initialized = editorInitialParallelText(translation, source);
  assert.equal(initialized.split('\n').length, 2);
  assert.equal(initialized.replace(/\n/g, ''), translation);
  assert.equal(editorInitialParallelText(initialized, source), initialized);
});
