import type { Chapter, Script } from './cues.js';

export interface Caption {
  start: number;
  end: number;
  text: string;
}
export interface CaptionOptions {
  /** Soft character limit; a word is never cut in half. */
  maxChars?: number;
  maxSeconds?: number;
  /** Two balanced lines at most; indivisible words may exceed this soft limit. */
  lineChars?: number;
  /** Reading-time target; aligned starts and pauses are preserved. */
  minSeconds?: number;
}
export interface CaptionTrack {
  readonly segments: readonly Caption[];
  at(time: number): string;
  serialize(format: 'srt' | 'vtt'): string;
}
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]/gu, '');

const aliasKey = (text: string) =>
  text.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/gu, ' ');
function aliasMatcher(aliases: Script['captionAliases']) {
  if (aliases === undefined) return;
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases))
    throw new Error('captionAliases must map spoken phrases to plain display text');
  const values = new Map<string, string>();
  for (const [spoken, display] of Object.entries(aliases)) {
    if (
      [spoken, display].some(
        (value) => typeof value !== 'string' || !value.trim() || /[<>\u0000-\u001f]/u.test(value),
      )
    )
      throw new Error('captionAliases needs non-empty plain spoken phrases and display text');
    const key = aliasKey(spoken);
    if (values.has(key)) throw new Error(`Duplicate captionAliases phrase: ${spoken}`);
    values.set(key, display.trim());
  }
  if (!values.size) return;
  const phrases = [...values.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) =>
      key
        .split(' ')
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+'),
    );
  return {
    values,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${phrases.join('|')})(?![\\p{L}\\p{N}])`, 'giu'),
  };
}

function timedWords(chapter: Chapter) {
  const words = chapter.words;
  if (!words?.length) return [{ start: chapter.start, end: chapter.end, text: chapter.text }];
  // Preserve source punctuation by matching aligned words to character spans, not word counts.
  const tokens = [...chapter.text.matchAll(/[\p{L}\p{N}]/gu)];
  let token = 0,
    boundary = 0,
    previousEnd = chapter.start;
  const result: Caption[] = [];
  for (const word of words) {
    const wanted = normalize(word.text);
    if (!wanted) continue;
    if (
      !Number.isFinite(word.start) ||
      !Number.isFinite(word.end) ||
      word.start < previousEnd - 0.001 ||
      word.end <= word.start ||
      word.end > chapter.end + 0.001
    )
      throw new Error(`Invalid caption time in ${chapter.id}`);
    previousEnd = word.end;
    let match = '',
      end = token;
    while (end < tokens.length && match.length < wanted.length)
      match += normalize(tokens[end++]![0]);
    if (match !== wanted)
      throw new Error(
        `Captions in ${chapter.id}: aligned word "${word.text}" does not match the source. Rebuild narration.`,
      );
    const next = tokens[end]?.index ?? chapter.text.length;
    const piece = chapter.text.slice(boundary, next),
      previous = result.at(-1);
    if (previous && !/\s$/u.test(previous.text)) {
      previous.text += piece;
      previous.end = word.end;
    } else result.push({ start: word.start, end: word.end, text: piece });
    boundary = next;
    token = end;
  }
  if (token !== tokens.length)
    throw new Error(
      `Captions in ${chapter.id}: alignment does not cover the source. Rebuild narration.`,
    );
  return result;
}

function displayWords(chapter: Chapter, aliases: ReturnType<typeof aliasMatcher>) {
  const words = timedWords(chapter);
  if (!aliases) return words;
  const matches = [...chapter.text.replace(/ё/giu, 'е').matchAll(aliases.pattern)];
  if (!matches.length) return words;
  // Without alignment the chapter remains one timed unit; never invent word times.
  if (!chapter.words?.length) {
    let text = '',
      offset = 0;
    for (const match of matches) {
      text += chapter.text.slice(offset, match.index) + aliases.values.get(aliasKey(match[0]))!;
      offset = match.index + match[0].length;
    }
    return [{ ...words[0]!, text: text + chapter.text.slice(offset) }];
  }
  let offset = 0;
  const spans = words.map((word) => {
    const start = offset;
    offset += word.text.length;
    return { word, from: start, to: offset };
  });
  const result: Caption[] = [];
  let index = 0;
  for (const match of matches) {
    const from = match.index,
      to = from + match[0].length;
    while (spans[index]!.to <= from) result.push(spans[index++]!.word);
    const first = spans[index]!;
    while (spans[index]!.to < to) index++;
    const last = spans[index++]!;
    const prefix = chapter.text.slice(first.from, from),
      suffix = chapter.text.slice(to, last.to);
    if (/[\p{L}\p{N}]/u.test(prefix + suffix))
      throw new Error(
        `captionAliases in ${chapter.id}: "${match[0]}" must cover complete aligned words`,
      );
    result.push({
      start: first.word.start,
      end: last.word.end,
      text: prefix + aliases.values.get(aliasKey(match[0]))! + suffix,
    });
  }
  result.push(...spans.slice(index).map((span) => span.word));
  return result;
}
const stamp = (time: number, separator: string) => {
  const ms = Math.round(time * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
};

function lines(text: string, width: number) {
  text = text.trim().replace(/\s+/gu, ' ');
  if (text.length <= width) return text;
  let best = text,
    cost = Infinity;
  for (const match of text.matchAll(/ /gu)) {
    const left = text.slice(0, match.index),
      right = text.slice(match.index + 1),
      overflow = Math.max(0, left.length - width, right.length - width),
      score =
        overflow * 1000 + Math.abs(left.length - right.length) - (/[,;:—]$/u.test(left) ? 8 : 0);
    if (score < cost) {
      cost = score;
      best = left + '\n' + right;
    }
  }
  return best;
}

function groupWords(words: Caption[], options: Required<CaptionOptions>, end: number) {
  const { maxChars, maxSeconds, minSeconds, lineChars } = options;
  const text = (group: Caption[]) => group.map((word) => word.text).join('');
  const duration = (group: Caption[]) => group.at(-1)!.end - group[0]!.start;
  const fits = (group: Caption[]) =>
    group.length === 1 ||
    (text(group).trim().length <= maxChars &&
      duration(group) <= maxSeconds &&
      lines(text(group), lineChars)
        .split('\n')
        .every((line) => line.length <= lineChars || !line.includes(' ')));
  const groups: Caption[][] = [];
  let current: Caption[] = [];
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
  };
  for (const word of words) {
    if (current.length && (!fits([...current, word]) || word.start - current.at(-1)!.end > 0.65))
      flush();
    current.push(word);
    if (/[.!?…][»”"')]*$/u.test(word.text.trimEnd())) flush();
  }
  flush();

  // A hard length cut must not strand the last word of a sentence in a brief flash.
  // Repartition adjacent groups using their original word times, without crossing a pause.
  const shortfall = (group: Caption[]) => Math.max(0, minSeconds - duration(group) - 1e-6) ** 2;
  for (let i = 0; i < groups.length - 1; i++) {
    const left = groups[i]!,
      right = groups[i + 1]!;
    if ((!shortfall(left) && !shortfall(right)) || right[0]!.start - left.at(-1)!.end > 0.65)
      continue;
    const both = [...left, ...right];
    if (fits(both)) {
      groups.splice(i, 2, both);
      i = Math.max(-1, i - 2);
      continue;
    }
    let cut = left.length,
      best = (shortfall(left) + shortfall(right)) * 1000;
    for (let split = 1; split < both.length; split++) {
      const a = both.slice(0, split),
        b = both.slice(split);
      const score = (shortfall(a) + shortfall(b)) * 1000 + Math.abs(split - left.length);
      if (score < best - 1e-9 && fits(a) && fits(b)) {
        cut = split;
        best = score;
      }
    }
    groups.splice(i, 2, both.slice(0, cut), both.slice(cut));
  }
  return groups.map((group, i) => ({
    start: group[0]!.start,
    end: Math.max(
      group.at(-1)!.end,
      Math.min(group[0]!.start + minSeconds, groups[i + 1]?.[0]?.start ?? end),
    ),
    text: lines(text(group), lineChars),
  }));
}

/** One optional caption track for playback, video, SRT and VTT. Times are absolute. */
export function captionTrack(
  script: Pick<Script, 'segments' | 'captionAliases'>,
  options: CaptionOptions = {},
): CaptionTrack {
  const maxChars = options.maxChars ?? 76,
    maxSeconds = options.maxSeconds ?? 5,
    lineChars = options.lineChars ?? 42,
    requestedMinimum = options.minSeconds ?? 0.8,
    minSeconds = Math.min(requestedMinimum, maxSeconds);
  if (
    [maxChars, maxSeconds, lineChars, requestedMinimum].some(
      (value) => !Number.isFinite(value) || value <= 0,
    ) ||
    maxChars < 1 ||
    lineChars < 1
  )
    throw new Error('Caption limits must be positive');
  const segments: Caption[] = [];
  const aliases = aliasMatcher(script.captionAliases);
  let previousEnd = 0;
  for (const [index, chapter] of (script.segments ?? []).entries()) {
    const words = displayWords(chapter, aliases);
    for (const word of words) {
      if (
        !Number.isFinite(word.start) ||
        !Number.isFinite(word.end) ||
        word.start < 0 ||
        word.end <= word.start ||
        word.start < previousEnd - 0.001
      )
        throw new Error(`Invalid caption time in ${chapter.id}`);
      previousEnd = word.end;
    }
    segments.push(
      ...groupWords(
        words,
        { maxChars, maxSeconds, lineChars, minSeconds },
        Math.min(chapter.end, script.segments?.[index + 1]?.start ?? Infinity),
      ),
    );
  }
  return {
    segments,
    at(time) {
      return segments.find((s) => time >= s.start && time < s.end)?.text ?? '';
    },
    serialize(format) {
      const vtt = format === 'vtt';
      return (
        (vtt ? 'WEBVTT\n\n' : '') +
        segments
          .map(
            (s, i) =>
              `${vtt ? '' : `${i + 1}\n`}${stamp(s.start, vtt ? '.' : ',')} --> ${stamp(s.end, vtt ? '.' : ',')}\n${s.text}`,
          )
          .join('\n\n') +
        '\n'
      );
    },
  };
}
