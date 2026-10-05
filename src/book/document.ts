import type { Beat } from '../characters/types.js';
import { cueSheet, type CueTiming, type Script } from '../story/cues.js';
import { bookTiming, bookBoundary } from './timing.js';

/** One authored thought owns both its spoken words and its visible action. */
export interface AuthoredBeat extends Beat {
  say: string;
  /** Action window; until accepts a local beat ID or a fully qualified chapter.beat ID. */
  timing?: CueTiming;
}
export interface StoryDocument {
  title: string;
  chapters: readonly {
    id: string;
    title: string;
    view?: 'cast' | 'paper';
    beats: readonly AuthoredBeat[];
  }[];
  narration?: {
    enabled?: boolean;
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
    text: chapter.beats.map((b) => b.say).join(' '),
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
    intro: spec.intro ?? bookTiming.introduction,
    outro: spec.outro ?? 0.8,
    music: spec.music ? structuredClone(spec.music) : null,
    ...(spec.captionAliases ? { captionAliases: { ...spec.captionAliases } } : {}),
    segments: document.chapters.map((chapter, index) => {
      if (
        !/^[a-z][a-z0-9_-]*$/.test(chapter.id) ||
        ids.has(chapter.id) ||
        !chapter.title?.trim() ||
        !chapter.beats.length
      )
        throw new Error(`Invalid chapter: ${chapter.id}`);
      ids.add(chapter.id);
      const tokens = chapter.beats.flatMap((beat) => spokenWords(beat.say ?? ''));
      let wordStart = 0;
      const cues = chapter.beats.map((beat) => {
        const id = `${chapter.id}.${beat.id}`;
        if (
          typeof beat.id !== 'string' ||
          !/^[a-z][a-z0-9_.-]*$/.test(beat.id) ||
          ids.has(id) ||
          !beat.say?.trim() ||
          !beat.text?.trim()
        )
          throw new Error(`Beat ${id} needs unique ID, say and visible text`);
        ids.add(id);
        const quote = spokenWords(beat.say);
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
          quote: beat.say,
          occurrence,
          action: beat.text,
          ...(timing !== undefined ? { timing } : {}),
        };
      });
      return {
        id: chapter.id,
        title: chapter.title,
        text: chapter.beats.map((b) => b.say).join(' '),
        pause_after: Math.max(
          spec.pause ?? 1.6,
          index < document.chapters.length - 1
            ? bookBoundary(chapter.view === 'cast', document.chapters[index + 1]!.view === 'cast')
            : 0,
        ),
        cues,
      };
    }),
  };
}
/** Make the page transition use the pause preceding speech; words and action cues retain their times. */
export function documentScript(
  document: StoryDocument,
  aligned: Script,
  transition: number | ((index: number) => number) = (index) =>
    bookBoundary(
      document.chapters[index - 1]?.view === 'cast',
      document.chapters[index]?.view === 'cast',
    ),
): Script {
  aligned = cueSheet(aligned).script;
  const cues = { ...aligned.cues };
  let end = 0;
  for (const [index, chapter] of document.chapters.entries()) {
    const segment = aligned.segments?.find((s) => s.id === chapter.id);
    if (!segment) throw new Error(`Aligned narration needs chapter ${chapter.id}`);
    const delay = index ? (typeof transition === 'function' ? transition(index) : transition) : 0;
    const start = segment.start - delay;
    if (start < end)
      throw new Error(
        `Narration needs ${delay}s before chapter ${chapter.id} for its page transition`,
      );
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
