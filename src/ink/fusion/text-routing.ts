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
  inputs: readonly FusionShape[],
  outputs: readonly FusionShape[],
): InkRoute[] {
  function flatten(shapes: readonly FusionShape[]) {
    let glyphOffset = 0,
      wordOffset = 0,
      pathOffset = 0;
    const records = shapes.map((shape, owner) => {
      const glyphs = shape.text!.glyphs.map((glyph) => ({
        glyph,
        owner,
        shape,
        word: glyph.word + wordOffset,
        pathOffset,
      }));
      const words = shape.text!.words.map((word) => ({
        value: word.value,
        glyphs: word.glyphs.map((i) => i + glyphOffset),
      }));
      glyphOffset += glyphs.length;
      wordOffset += words.length;
      pathOffset += shape.paths.length;
      return { glyphs, words };
    });
    return { glyphs: records.flatMap((r) => r.glyphs), words: records.flatMap((r) => r.words) };
  }
  const incoming = flatten(inputs),
    outgoing = flatten(outputs);
  const source = incoming.glyphs,
    sourceWords = incoming.words;
  const targetRecords = outgoing.glyphs,
    targetWords = outgoing.words;
  const targets = targetRecords.map(({ glyph, word }) => ({ ...glyph, word }));
  const wordCenters = (words: typeof sourceWords, glyphs: typeof source) =>
    words.map((word): readonly [number, number] => [
      word.glyphs.reduce((sum, i) => sum + glyphs[i]!.glyph.center[0], 0) / word.glyphs.length,
      word.glyphs.reduce((sum, i) => sum + glyphs[i]!.glyph.center[1], 0) / word.glyphs.length,
    ]);
  const fromWords = wordCenters(sourceWords, source),
    toWords = wordCenters(targetWords, targetRecords);
  const normalize = (text: string) =>
    text
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const candidates = orderedPairs(
    sourceWords.map((word) => normalize(word.value)),
    targetWords.map((word) => normalize(word.value)),
  );
  // Match preserved words across all inputs first. Only the remaining ink supplies
  // new words; independently covering the whole result from each input creates echoes.
  const wordPairs = candidates.filter(
    ([a, b]) => normalize(sourceWords[a]!.value) === normalize(targetWords[b]!.value),
  );
  const claimedSources = new Set(wordPairs.map(([a]) => a)),
    claimedTargets = new Set(wordPairs.map(([, b]) => b));
  const remainingSources = sourceWords.map((_, i) => i).filter((i) => !claimedSources.has(i)),
    remainingTargets = targetWords.map((_, i) => i).filter((i) => !claimedTargets.has(i));
  const preferred = new Map<number, number>();
  // Align word spans by their amount of ink, not by item count. A short inserted
  // conjunction must not receive a complete long word and become a dense blot.
  const totalSource = remainingSources.reduce((sum, i) => sum + sourceWords[i]!.glyphs.length, 0),
    totalTarget = remainingTargets.reduce((sum, i) => sum + targetWords[i]!.glyphs.length, 0);
  let a = 0,
    b = 0,
    startA = 0,
    startB = 0,
    bestOverlap = 0;
  while (a < remainingSources.length && b < remainingTargets.length) {
    const from = remainingSources[a]!,
      to = remainingTargets[b]!;
    const endA = startA + sourceWords[from]!.glyphs.length * totalTarget,
      endB = startB + targetWords[to]!.glyphs.length * totalSource;
    const overlap = Math.min(endA, endB) - Math.max(startA, startB);
    wordPairs.push([from, to]);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      preferred.set(from, to);
    }
    if (endA <= endB) {
      a++;
      startA = endA;
      bestOverlap = 0;
    }
    if (endB <= endA) {
      b++;
      startB = endB;
    }
  }
  // With only insertions or deletions, attach the unclaimed item to one supplying
  // word. Its primary destination keeps the word; additional destinations grow from points.
  for (const a of remainingSources)
    if (!wordPairs.some(([from]) => from === a))
      wordPairs.push(candidates.find(([from]) => from === a)!);
  for (const b of remainingTargets)
    if (!wordPairs.some(([, to]) => to === b))
      wordPairs.push(candidates.find(([, to]) => to === b)!);
  // A supplying word remains whole. Extra destination words grow from its ink;
  // distributing the original letters across receivers would tear sentences apart.
  const assigned = targetWords.map(() => [] as number[]);
  const primaryWords: number[] = [];
  sourceWords.forEach((word, i) => {
    const receivers = [...new Set(wordPairs.filter(([a]) => a === i).map(([, b]) => b))];
    primaryWords[i] =
      receivers.find((j) => normalize(word.value) === normalize(targetWords[j]!.value)) ??
      preferred.get(i) ??
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
      return normalize(sourceWords[source[j]!.word]!.value) === normalize(word.value);
    });
    // Unchanged words retain their letters. A new word uses the combined ink of
    // the suppliers instead of growing two complete copies before they meet.
    const suppliers = anchored
      ? inputs.map((_, owner) => originals.filter((j) => source[j]!.owner === owner))
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
    () => [] as { path: InkPath; owner: number; glyph: FusionGlyph; id: number; seed: boolean }[],
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
    const word = source[i]!.word;
    const primaryReceivers = receivers.filter((j) => targets[j]!.word === primaryWords[word]);
    const primary =
      primaryReceivers.find((j) => normalize(glyph.value) === normalize(targets[j]!.value)) ??
      primaryReceivers[0]!;
    // Keep the supplying letter intact. Additional letters grow from points on it,
    // rather than transporting detached pieces of one glyph across the sentence.
    const pieces = receivers.map((j) =>
      j === primary ? local : [[local[0]![0]!, local[0]![0]!] as InkPath],
    );
    receivers.forEach((j, k) =>
      pieces[k]!.forEach((path) =>
        received[j]!.push({ path, owner, glyph, id: i, seed: j !== primary }),
      ),
    );
  });
  return targets.flatMap((glyph, index) => {
    const records = received[index]!.toSorted((a, b) => a.owner - b.owner);
    const destination = targetRecords[index]!;
    const local = glyph.paths.map((i) =>
      destination.shape.paths[i]!.map(
        (p): InkPoint => [
          ((p[0] - glyph.center[0]) * 100) / glyph.size,
          ((p[1] - glyph.center[1]) * 100) / glyph.size,
          (p[2] * 100) / glyph.size,
        ],
      ),
    );
    return inkRoutes(
      inputs.map((_, owner) =>
        records.filter((record) => record.owner === owner).map((record) => record.path),
      ),
      [local],
      true,
    ).flatMap((route) => {
      const original = records[route.origin]!;
      // A seed carries no original ink. If it did not acquire a final contour,
      // transporting it would add a free-floating dot with nothing to build.
      if (original.seed && route.attachment !== undefined) return [];
      const expand = (p: InkPoint, glyph: FusionGlyph): InkPoint => [
        (p[0] * glyph.size) / 100 + glyph.center[0],
        (p[1] * glyph.size) / 100 + glyph.center[1],
        (p[2] * glyph.size) / 100,
      ];
      return [
        {
          ...route,
          destination: destination.owner,
          target: destination.pathOffset + glyph.paths[route.target]!,
          from: route.from.map((p) => expand(p, original.glyph)),
          to: route.to.map((p) => expand(p, glyph)),
          text: {
            from: original.glyph.center,
            glyph: index,
            origin: original.id,
            same: original.glyph.value === glyph.value,
            word: glyph.word,
            originWord: source[original.id]!.word,
            wordSame:
              normalize(sourceWords[source[original.id]!.word]!.value) ===
              normalize(targetWords[glyph.word]!.value),
            fromWord: fromWords[source[original.id]!.word]!,
            toWord: toWords[glyph.word]!,
          },
        },
      ];
    });
  });
}
