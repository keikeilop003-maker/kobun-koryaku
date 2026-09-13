export function splitParallelViewLines(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map(line => line.trim());
}

export function splitViewLineEntries(value) {
  const text = String(value ?? '');
  const entries = [];
  let cursor = 0;
  text.split(/\r?\n/).forEach((rawLine) => {
    const leading = rawLine.match(/^\s*/u)?.[0]?.length ?? 0;
    const trimmed = rawLine.trim();
    const lineStart = cursor + leading;
    if (trimmed) entries.push({ text: trimmed, start: lineStart, end: lineStart + trimmed.length });
    cursor += rawLine.length + 1;
  });
  return entries;
}

function snapViewSplit(chars, target, min, max) {
  const punctuation = /[\u3001\u3002\uff0c\uff0e\uff1f\uff01\u300d\u300f]/u;
  for (let offset = 0; offset <= 16; offset += 1) {
    const forward = target + offset;
    if (forward >= min && forward <= max && punctuation.test(chars[forward - 1] ?? '')) return forward;
    const backward = target - offset;
    if (backward >= min && backward <= max && punctuation.test(chars[backward - 1] ?? '')) return backward;
  }
  return Math.min(Math.max(target, min), max);
}

export function splitModernForSourceLines(modernText, sourceLines) {
  const explicitLines = splitParallelViewLines(modernText);
  if (explicitLines.length !== 1 || sourceLines.length <= 1) return explicitLines;

  const chars = Array.from(explicitLines[0]);
  const sourceLengths = sourceLines.map(line => Math.max(Array.from(line).length, 1));
  const totalSourceLength = sourceLengths.reduce((sum, length) => sum + length, 0);
  const chunks = [];
  let sourceCursor = 0;
  let modernCursor = 0;

  sourceLengths.forEach((length, index) => {
    if (index === sourceLengths.length - 1) {
      chunks.push(chars.slice(modernCursor).join('').trim());
      return;
    }
    sourceCursor += length;
    const proportionalTarget = Math.round((chars.length * sourceCursor) / totalSourceLength);
    const remainingLines = sourceLengths.length - index - 1;
    const min = Math.min(chars.length, modernCursor + 1);
    const max = Math.max(min, chars.length - remainingLines);
    const end = snapViewSplit(chars, proportionalTarget, min, max);
    chunks.push(chars.slice(modernCursor, end).join('').trim());
    modernCursor = end;
  });

  return chunks;
}

export function editorInitialParallelText(value, sourceText) {
  const raw = String(value ?? '');
  const sourceLines = splitViewLineEntries(sourceText).map(entry => entry.text);
  const explicitLines = splitParallelViewLines(raw);
  // Explicit line breaks are authored alignment, even when row counts differ.
  // Rebalancing saved text here silently replaced an editor's previous work.
  if (sourceLines.length <= 1 || explicitLines.length > 1) return raw;
  return splitModernForSourceLines(raw, sourceLines).join('\n');
}

