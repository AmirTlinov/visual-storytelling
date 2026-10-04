import { cueSheet, type Script, type Cue, type Chapter } from './cues.js';

export interface ChapterTiming {
  id: string;
  title: string;
  text: string;
  seconds: number;
  /** Local cues are namespaced as chapterId.cueId in the composed story. */
  script?: Script;
}
export interface ChapterSpan {
  id: string;
  start: number;
  content: number;
  end: number;
  seconds: number;
  clock: { local: number; global: number }[];
}
function interpolate(
  clock: ChapterSpan['clock'],
  value: number,
  source: 'local' | 'global',
  edge: 'start' | 'end' = 'start',
) {
  const target = source === 'local' ? 'global' : 'local';
  // A narration pause holds one local pose. Starts follow the pause, ends precede it.
  const exact = clock.filter((point) => Math.abs(point[source] - value) < 1e-8);
  if (exact.length) return (edge === 'start' ? exact.at(-1)! : exact[0]!)[target];
  if (value < clock[0]![source]) return clock[0]![target];
  for (let i = 1; i < clock.length; i++) {
    const a = clock[i - 1]!,
      b = clock[i]!;
    if (value <= b[source])
      return a[target] + ((b[target] - a[target]) * (value - a[source])) / (b[source] - a[source]);
  }
  return clock.at(-1)![target];
}
export const chapterTime = (span: ChapterSpan, globalTime: number) =>
  interpolate(span.clock, globalTime, 'global');

/** Resolve chapter timing once. Narrated cue boundaries retime the existing local animation. */
export function composeChapters(
  chapters: readonly ChapterTiming[],
  options: {
    script?: Script;
    introduction?: number;
    transition?: number;
  } = {},
) {
  if (!chapters.length) throw new Error('A composition needs at least one chapter');
  const lead = options.introduction ?? 0,
    transition = options.transition ?? 0;
  if (![lead, transition].every((n) => Number.isFinite(n) && n >= 0))
    throw new Error('Chapter transitions need non-negative durations');
  if (options.script) cueSheet(options.script);
  const cues: Record<string, Cue> = Object.create(null),
    segments: Chapter[] = [],
    ids = new Set<string>();
  let cursor = lead;
  const timings: ChapterSpan[] = chapters.map((chapter, index) => {
    if (!chapter.id || chapter.id === 'book-open' || ids.has(chapter.id))
      throw new Error(`Invalid chapter ID: ${chapter.id}`);
    ids.add(chapter.id);
    if (!(chapter.seconds > 0) || !Number.isFinite(chapter.seconds))
      throw new Error(`Invalid chapter duration: ${chapter.id}`);
    const supplied =
      options.script?.cues[chapter.id] ??
      options.script?.segments?.find((s) => s.id === chapter.id);
    if (options.script && !supplied) throw new Error(`Narration needs chapter cue: ${chapter.id}`);
    const start = supplied?.start ?? cursor,
      content = start + (index ? transition : 0),
      end = supplied?.end ?? content + chapter.seconds;
    if (content >= end) throw new Error(`Chapter ${chapter.id} has no time after its transition`);
    if (index && start < cursor) throw new Error('Composed chapters overlap');
    cursor = end;
    const clock = [
      { local: 0, global: content },
      { local: chapter.seconds, global: end },
    ];
    const anchors = new Map<number, Partial<Record<'start' | 'end', number>>>();
    if (chapter.script) {
      cueSheet(chapter.script);
      for (const [id, local] of Object.entries(chapter.script.cues)) {
        const spoken = options.script?.cues[`${chapter.id}.${id}`];
        if (spoken) {
          if (spoken.start < content || spoken.end > end)
            throw new Error(`Narrated cue ${chapter.id}.${id} is outside its chapter content`);
          for (const boundary of ['start', 'end'] as const) {
            const time = (local[boundary] * chapter.seconds) / chapter.script.duration;
            const group = anchors.get(time) ?? {};
            if (
              group[boundary] !== undefined &&
              Math.abs(group[boundary]! - spoken[boundary]) > 1e-8
            )
              throw new Error(`Conflicting narrated boundaries in ${chapter.id}`);
            group[boundary] = spoken[boundary];
            anchors.set(time, group);
            clock.push({ local: time, global: spoken[boundary] });
          }
        }
      }
    }
    for (const group of anchors.values())
      if (group.start !== undefined && group.end !== undefined && group.start < group.end)
        throw new Error(`Narrated cues change order in ${chapter.id}`);
    clock.sort((a, b) => a.global - b.global || a.local - b.local);
    const unique: typeof clock = [];
    for (const point of clock) {
      const previous = unique.at(-1);
      if (previous && Math.abs(point.global - previous.global) < 1e-8) {
        if (Math.abs(point.local - previous.local) > 1e-8)
          throw new Error(`Conflicting narrated boundaries in ${chapter.id}`);
      } else {
        if (previous && point.local < previous.local - 1e-8)
          throw new Error(`Narrated cues change order in ${chapter.id}`);
        unique.push(point);
      }
    }
    return { id: chapter.id, start, content, end, seconds: chapter.seconds, clock: unique };
  });
  const introduction = Math.min(lead, timings[0]!.start);
  if (introduction) {
    cues['book-open'] = { start: 0, end: introduction, action: 'Открывается тайная книга.' };
    segments.push({
      id: 'book-open',
      ...cues['book-open'],
      text: 'Открывается тайная книга.',
      title: 'Tlinov',
    });
  }
  for (const [index, chapter] of chapters.entries()) {
    const span = timings[index]!;
    cues[chapter.id] = { start: span.start, end: span.end, action: chapter.text };
    if (chapter.script) {
      const map = (time: number, edge: 'start' | 'end') =>
        interpolate(span.clock, (time * chapter.seconds) / chapter.script!.duration, 'local', edge);
      const range = (cue: Cue) => {
        const start = map(cue.start, 'start');
        return { start, end: cue.end === cue.start ? start : map(cue.end, 'end') };
      };
      for (const [id, cue] of Object.entries(chapter.script.cues)) {
        const key = `${chapter.id}.${id}`;
        if (ids.has(key) || Object.hasOwn(cues, key))
          throw new Error(`Composed cue ID collides: ${key}`);
        cues[key] = { ...cue, ...range(cue) };
      }
      for (const s of chapter.script.segments ?? [])
        segments.push({
          ...s,
          id: `${chapter.id}.${s.id}`,
          ...range(s),
          words: s.words?.map((w) => ({ ...w, ...range(w) })),
        });
    }
    if (!chapter.script?.segments?.length)
      segments.push({
        id: chapter.id,
        ...cues[chapter.id]!,
        title: chapter.title,
        text: chapter.text,
      });
  }
  const script: Script = {
    duration: options.script?.duration ?? cursor,
    ...options.script,
    cues: { ...cues, ...options.script?.cues },
    segments: options.script?.segments ?? segments,
    captionAliases: Object.assign(
      {},
      ...chapters.map((c) => c.script?.captionAliases),
      options.script?.captionAliases,
    ),
  };
  cueSheet(script);
  return { script, timings, introduction, transition };
}
