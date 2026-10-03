import { inkRoutes, type InkPath, type InkPoint, type InkRoute } from './transport.js';
import type { FusionGlyph, FusionShape } from './shape.js';

/** Exact anchors keep their identity; replacement runs retain their reading order. */
export function orderedPairs(
  a: readonly string[],
  b: readonly string[],
  preserveMatches = true,
): [number, number][] {
  if (!a.length || !b.length) return [];
  const columns = b.length + 1,
    table = new Uint16Array((a.length + 1) * columns);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * columns + j] =
        preserveMatches && a[i] === b[j]
          ? table[(i + 1) * columns + j + 1]! + 1
          : Math.max(table[(i + 1) * columns + j]!, table[i * columns + j + 1]!);
  const anchors: [number, number][] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (preserveMatches && a[i] === b[j]) {
      anchors.push([i++, j++]);
    } else if (table[(i + 1) * columns + j]! >= table[i * columns + j + 1]!) i++;
    else j++;
  }
  const pairs: [number, number][] = [];
  let from = 0,
    to = 0;
  for (const [endA, endB] of [...anchors, [a.length, b.length]] as [number, number][]) {
    const n = endA - from,
      m = endB - to;
    if (n && m) {
      if (n >= m)
        for (let k = 0; k < n; k++)
          pairs.push([from + k, to + Math.min(m - 1, Math.floor(((k + 0.5) * m) / n))]);
      else
        for (let k = 0; k < m; k++)
          pairs.push([from + Math.min(n - 1, Math.floor(((k + 0.5) * n) / m)), to + k]);
    } else if (n) for (let k = from; k < endA; k++) pairs.push([k, Math.min(to, b.length - 1)]);
    else if (m) for (let k = to; k < endB; k++) pairs.push([Math.min(from, a.length - 1), k]);
    if (endA < a.length) pairs.push([endA, endB]);
    from = endA + 1;
    to = endB + 1;
  }
  return pairs;
}
export function textRoutes(
  first: FusionShape,
  second: FusionShape,
  target: FusionShape,
): InkRoute[] {
  const inputs = [first, second] as const;
  const wordCenters = (shape: FusionShape) =>
    shape.text!.words.map((word): readonly [number, number] => [
      word.glyphs.reduce((sum, i) => sum + shape.text!.glyphs[i]!.center[0], 0) /
        word.glyphs.length,
      word.glyphs.reduce((sum, i) => sum + shape.text!.glyphs[i]!.center[1], 0) /
        word.glyphs.length,
    ]);
  const fromWords = inputs.map(wordCenters),
    toWords = wordCenters(target);
  const source = inputs.flatMap((shape, owner) =>
    shape.text!.glyphs.map((glyph) => ({ glyph, owner: owner as 0 | 1, shape })),
  );
  const sourceWords = inputs.flatMap((shape, owner) =>
    shape.text!.words.map((word) => ({
      value: word.value,
      glyphs: word.glyphs.map((i) => i + (owner ? first.text!.glyphs.length : 0)),
    })),
  );
  const targetWords = target.text!.words,
    targets = target.text!.glyphs;
  const normalize = (text: string) =>
    text
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  // Each incoming text covers the destination. Concatenating both sources before
  // alignment would squeeze whole intervening sentences into a single short word.
  const wordPairs = inputs.flatMap((shape, owner) =>
    orderedPairs(
      shape.text!.words.map((w) => normalize(w.value)),
      targetWords.map((w) => normalize(w.value)),
    ).map(([a, b]): [number, number] => [a + (owner ? first.text!.words.length : 0), b]),
  );
  // A supplying word remains whole. Extra destination words grow from its ink;
  // distributing the original letters across receivers would tear sentences apart.
  const assigned = targetWords.map(() => [] as number[]);
  const primaryWords: number[] = [];
  sourceWords.forEach((word, i) => {
    const receivers = [...new Set(wordPairs.filter(([a]) => a === i).map(([, b]) => b))];
    primaryWords[i] =
      receivers.find((j) => normalize(word.value) === normalize(targetWords[j]!.value)) ??
      receivers.reduce((best, j) =>
        Math.abs(targetWords[j]!.glyphs.length - word.glyphs.length) <
        Math.abs(targetWords[best]!.glyphs.length - word.glyphs.length)
          ? j
          : best,
      );
    receivers.forEach((j) =>
      assigned[j]!.push(
        ...(j === primaryWords[i]
          ? word.glyphs
          : [word.glyphs[Math.floor(word.glyphs.length / 2)]!]),
      ),
    );
  });
  const glyphPairs: [number, number][] = [];
  targetWords.forEach((word, i) => {
    const originals = [...new Set(assigned[i]!)].sort((a, b) => a - b);
    const anchored = originals.some((j) => {
      const { glyph, owner } = source[j]!;
      return normalize(inputs[owner].text!.words[glyph.word]!.value) === normalize(word.value);
    });
    // Unchanged words retain their letters. A new word uses the combined ink of
    // both suppliers instead of growing two complete copies before they meet.
    const suppliers = anchored
      ? [0, 1].map((owner) => originals.filter((j) => source[j]!.owner === owner))
      : [originals];
    for (const incoming of suppliers) {
      for (const [a, b] of orderedPairs(
        incoming.map((j) => normalize(source[j]!.glyph.value)),
        word.glyphs.map((j) => normalize(targets[j]!.value)),
        anchored,
      ))
        glyphPairs.push([incoming[a]!, word.glyphs[b]!]);
    }
  });
  const received = targets.map(
    () => [] as { path: InkPath; owner: 0 | 1; glyph: FusionGlyph; id: number }[],
  );
  source.forEach(({ glyph, owner, shape }, i) => {
    const receivers = [...new Set(glyphPairs.filter(([a]) => a === i).map(([, b]) => b))].sort(
      (a, b) => a - b,
    );
    if (!receivers.length) throw new Error('Text routing lost a source glyph');
    const local = glyph.paths.map((index) =>
      shape.paths[index]!.map(
        (p): InkPoint => [
          ((p[0] - glyph.center[0]) * 100) / glyph.size,
          ((p[1] - glyph.center[1]) * 100) / glyph.size,
          (p[2] * 100) / glyph.size,
        ],
      ),
    );
    const word = glyph.word + (owner ? first.text!.words.length : 0);
    const primaryReceivers = receivers.filter((j) => targets[j]!.word === primaryWords[word]);
    const primary =
      primaryReceivers.find((j) => normalize(glyph.value) === normalize(targets[j]!.value)) ??
      primaryReceivers[0]!;
    // Keep the supplying letter intact. Additional letters grow from points on it,
    // rather than transporting detached pieces of one glyph across the sentence.
    const pieces = receivers.map((j) =>
      j === primary ? local : local.map((path): InkPath => [path[0]!, path[0]!]),
    );
    receivers.forEach((j, k) =>
      pieces[k]!.forEach((path) => received[j]!.push({ path, owner, glyph, id: i })),
    );
  });
  return targets.flatMap((glyph, index) => {
    const records = [
      ...received[index]!.filter((p) => p.owner === 0),
      ...received[index]!.filter((p) => p.owner === 1),
    ];
    const local = glyph.paths.map((i) =>
      target.paths[i]!.map(
        (p): InkPoint => [
          ((p[0] - glyph.center[0]) * 100) / glyph.size,
          ((p[1] - glyph.center[1]) * 100) / glyph.size,
          (p[2] * 100) / glyph.size,
        ],
      ),
    );
    return inkRoutes(
      records.filter((p) => p.owner === 0).map((p) => p.path),
      records.filter((p) => p.owner === 1).map((p) => p.path),
      local,
      true,
    ).map((route) => {
      const original = records[route.origin]!;
      const expand = (p: InkPoint, glyph: FusionGlyph): InkPoint => [
        (p[0] * glyph.size) / 100 + glyph.center[0],
        (p[1] * glyph.size) / 100 + glyph.center[1],
        (p[2] * glyph.size) / 100,
      ];
      return {
        ...route,
        target: glyph.paths[route.target]!,
        from: route.from.map((p) => expand(p, original.glyph)),
        to: route.to.map((p) => expand(p, glyph)),
        text: {
          from: original.glyph.center,
          to: glyph.center,
          glyph: index,
          origin: original.id,
          same: original.glyph.value === glyph.value,
          word: glyph.word,
          originWord: original.glyph.word + (original.owner ? first.text!.words.length : 0),
          wordSame:
            normalize(inputs[original.owner].text!.words[original.glyph.word]!.value) ===
            normalize(target.text!.words[glyph.word]!.value),
          fromWord: fromWords[original.owner]![original.glyph.word]!,
          toWord: toWords[glyph.word]!,
        },
      };
    });
  });
}
