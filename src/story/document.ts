import { cueSheet, type CueTiming, type Script } from './cues.js';

/** One authored thought owns both its spoken words and its visible action. */
export interface AuthoredBeat {
  id: string;
  text: string;
  title?: string;
  seconds?: number;
  /** Spoken wording may differ from the visible action; defaults to text. */
  say?: string;
  /** Action window; until accepts a local beat ID or a fully qualified chapter.beat ID. */
  timing?: CueTiming;
}
export interface StoryDocument {
  title: string;
  chapters: readonly {
    id: string;
    title: string;
    beats: readonly AuthoredBeat[];
  }[];
  narration?: {
    voice?: Record<string, unknown>;
    intro?: number;
    outro?: number;
    pause?: number;
    music?: unknown;
    captionAliases?: Record<string, string>;
  };
}
// Match the speech aligner's Russian word contract, including ё and non-breaking hyphens.
// Count positions in the complete spoken chapter, not repeated source strings.
const spokenWords = (text: string) =>
  (text.match(/[А-Яа-яЁё]+(?:[-‑][А-Яа-яЁё]+)*/g) ?? []).map((word) =>
    word.toLowerCase().replaceAll('ё', 'е').replaceAll('‑', '-'),
  );
export function authoredChapter(document: StoryDocument, id: string) {
  const chapter = document.chapters.find((c) => c.id === id);
  if (!chapter) throw new Error(`Unknown authored chapter: ${id}`);
  return {
    id: chapter.id,
    title: chapter.title,
    text: chapter.beats.map((b) => b.say ?? b.text).join(' '),
    beats: chapter.beats.map(({ say, timing: _timing, ...beat }) => ({
      ...beat,
      text: beat.text || say,
    })),
  };
}
/** Feed the existing cached speech/alignment owner, without copying phrases into narration.json. */
export function documentNarration(document: StoryDocument) {
  if (!document.title?.trim() || !document.chapters?.length)
    throw new Error('Story document needs a title and chapters');
  const ids = new Set<string>();
  const spec = document.narration ?? {};
  return {
    version: 3,
    voice: { ...(spec.voice ?? { seed: 42 }) },
    intro: spec.intro ?? 0,
    outro: spec.outro ?? 0.6,
    music: spec.music ? structuredClone(spec.music) : null,
    ...(spec.captionAliases ? { captionAliases: { ...spec.captionAliases } } : {}),
    segments: document.chapters.map((chapter) => {
      if (
        !/^[a-z][a-z0-9_-]*$/.test(chapter.id) ||
        ids.has(chapter.id) ||
        !chapter.title?.trim() ||
        !chapter.beats.length
      )
        throw new Error(`Invalid chapter: ${chapter.id}`);
      ids.add(chapter.id);
      const tokens = chapter.beats.flatMap((beat) => spokenWords(beat.say ?? beat.text ?? ''));
      let wordStart = 0;
      const cues = chapter.beats.map((beat) => {
        const id = `${chapter.id}.${beat.id}`;
        if (
          typeof beat.id !== 'string' ||
          !/^[a-z][a-z0-9_.-]*$/.test(beat.id) ||
          ids.has(id) ||
          !(beat.say ?? beat.text)?.trim() ||
          !beat.text?.trim()
        )
          throw new Error(`Beat ${id} needs a unique ID and visible text`);
        ids.add(id);
        const quote = spokenWords(beat.say ?? beat.text);
        let occurrence = quote.length ? 0 : 1;
        for (let start = 0; quote.length && start <= wordStart; start++)
          if (quote.every((word, index) => tokens[start + index] === word)) occurrence++;
        wordStart += quote.length;
        let timing = beat.timing;
        if (typeof timing?.until === 'string') {
          const until = timing.until;
          timing = {
            ...timing,
            until: chapter.beats.some((b) => b.id === until) ? `${chapter.id}.${until}` : until,
          };
        }
        return {
          id,
          quote: beat.say ?? beat.text,
          occurrence,
          action: beat.text,
          ...(timing !== undefined ? { timing } : {}),
        };
      });
      return {
        id: chapter.id,
        title: chapter.title,
        text: chapter.beats.map((b) => b.say ?? b.text).join(' '),
        pause_after: spec.pause ?? 0.6,
        cues,
      };
    }),
  };
}
/** Aligned words and authored actions share chapter boundaries without imposed transitions. */
export function documentScript(document: StoryDocument, aligned: Script): Script {
  aligned = cueSheet(aligned).script;
  const cues = { ...aligned.cues };
  let end = 0;
  for (const chapter of document.chapters) {
    const segment = aligned.segments?.find((s) => s.id === chapter.id);
    if (!segment) throw new Error(`Aligned narration needs chapter ${chapter.id}`);
    const start = segment.start;
    if (start < end)
      throw new Error(`Narrated chapter ${chapter.id} overlaps the preceding action`);
    const finish = Math.max(
      segment.end,
      ...chapter.beats.map((beat) => cues[`${chapter.id}.${beat.id}`]?.end ?? segment.end),
    );
    cues[chapter.id] = {
      start,
      end: finish,
      action: chapter.beats.map((b) => b.text).join(' '),
    };
    end = finish;
  }
  return { ...aligned, cues };
}

/** Local speech/action clock, also available before any voice has been installed. */
export function documentChapter(document: StoryDocument, id: string, aligned?: Script) {
  const chapter = document.chapters.find((chapter) => chapter.id === id);
  if (!chapter) throw new Error(`Unknown authored chapter: ${id}`);
  const authored = authoredChapter(document, id);
  const span = aligned?.cues[id];
  if (aligned && !span) throw new Error(`Missing aligned chapter: ${id}`);
  const script: Script = { duration: 0, cues: {}, segments: [] };
  if (span) {
    script.duration = span.end - span.start;
    script.captionAliases = aligned!.captionAliases;
    for (const beat of chapter.beats) {
      const cue = aligned!.cues[`${id}.${beat.id}`];
      if (!cue) throw new Error(`Missing spoken action ${id}.${beat.id}`);
      script.cues[beat.id] = {
        ...cue,
        start: cue.start - span.start,
        end: cue.end - span.start,
        ...(cue.speech
          ? { speech: { start: cue.speech.start - span.start, end: cue.speech.end - span.start } }
          : {}),
      };
    }
    script.segments = aligned!.segments
      ?.filter((segment) => segment.id === id)
      .map((segment) => ({
        ...segment,
        start: segment.start - span.start,
        end: segment.end - span.start,
        words: segment.words?.map((word) => ({
          ...word,
          start: word.start - span.start,
          end: word.end - span.start,
        })),
      }));
  } else {
    let time = 0;
    const segments: NonNullable<Script['segments']>[number][] = [];
    for (const beat of chapter.beats) {
      const words = (beat.say ?? beat.text).trim().split(/\s+/).length;
      const seconds = beat.seconds ?? Math.max(2.5, words / 2.5 + 0.6);
      if (!Number.isFinite(seconds) || seconds <= 0)
        throw new Error(`Invalid duration for ${id}.${beat.id}`);
      const span = { start: time, end: time + seconds };
      const timing =
        typeof beat.timing?.until === 'string' && beat.timing.until.startsWith(`${id}.`)
          ? { ...beat.timing, until: beat.timing.until.slice(id.length + 1) }
          : beat.timing;
      script.cues[beat.id] = { ...span, action: beat.text, ...(timing ? { timing } : {}) };
      segments.push({
        id: beat.id,
        ...span,
        text: beat.say ?? beat.text,
        title: beat.title ?? beat.text,
      });
      time += Math.max(
        seconds,
        beat.timing && 'duration' in beat.timing
          ? (beat.timing.delay ?? 0) + beat.timing.duration!
          : 0,
      );
    }
    script.duration = time;
    script.segments = segments;
  }
  return { ...authored, seconds: script.duration, script: cueSheet(script).script };
}
