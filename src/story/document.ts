import type { Beat } from '../characters/types.js';
import type { Script } from './cues.js';

/** One authored thought owns both its spoken words and its visible action. */
export interface AuthoredBeat extends Beat {
  say: string;
}
export interface StoryDocument {
  title: string;
  chapters: readonly { id: string; title: string; beats: readonly AuthoredBeat[] }[];
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
    beats: chapter.beats.map(({ say, ...beat }) => ({ ...beat, text: beat.text || say })),
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
    intro: spec.intro ?? 4.2,
    outro: spec.outro ?? 0.8,
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
        return { id, quote: beat.say, occurrence, action: beat.text };
      });
      return {
        id: chapter.id,
        title: chapter.title,
        text: chapter.beats.map((b) => b.say).join(' '),
        pause_after: spec.pause ?? 1.6,
        cues,
      };
    }),
  };
}
/** Make the page transition use the pause preceding speech; words and action cues retain their times. */
export function documentScript(document: StoryDocument, aligned: Script, transition = 1.1): Script {
  const cues = { ...aligned.cues };
  let end = 0;
  for (const [index, chapter] of document.chapters.entries()) {
    const segment = aligned.segments?.find((s) => s.id === chapter.id);
    if (!segment) throw new Error(`Aligned narration needs chapter ${chapter.id}`);
    const start = segment.start - (index ? transition : 0);
    if (start < end)
      throw new Error(
        `Narration needs ${transition}s before chapter ${chapter.id} for its page transition`,
      );
    cues[chapter.id] = {
      start,
      end: segment.end,
      action: chapter.beats.map((b) => b.text).join(' '),
    };
    end = segment.end;
  }
  return { ...aligned, cues };
}
