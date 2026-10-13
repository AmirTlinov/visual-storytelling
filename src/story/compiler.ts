import { composeChapters } from './composition-plan.js';
import {
  documentChapter,
  documentNarration,
  documentScript,
  validateStoryDocument,
  type StoryDocument,
} from './document.js';
import type { Script } from './cues.js';

/** Retained narration assets must not make an explicitly quiet revision speak. */
export function hasStorySpeech(document: StoryDocument) {
  return document.chapters.some((chapter) =>
    chapter.beats.some((beat) => (beat.say ?? beat.text ?? '').trim()),
  );
}

/** Reusing audio is valid only for the spoken runs that produced its acoustic marks. */
export function validateStoryNarration(
  document: StoryDocument,
  aligned: Script,
  prepared?: StoryDocument,
) {
  const expected = documentNarration(document).segments;
  const actual = aligned.segments ?? [];
  const spoken = (text: string) =>
    text
      .replace(/<\|[a-z]+:[a-z_]+\|>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const signature = (document: StoryDocument) =>
    JSON.stringify({
      voice: document.narration?.voice,
      beats: document.chapters.flatMap((chapter) =>
        chapter.beats
          .filter((beat) => (beat.say ?? beat.text ?? '').trim())
          .map((beat) => [
            `${chapter.id}.${beat.id}`,
            (beat.say ?? beat.text ?? '').replace(/\s+/g, ' ').trim(),
          ]),
      ),
    });
  if (
    (prepared && signature(document) !== signature(prepared)) ||
    actual.length !== expected.length ||
    expected.some(
      (segment, index) =>
        segment.id !== actual[index]?.id ||
        typeof actual[index]?.text !== 'string' ||
        spoken(segment.text) !== spoken(actual[index]!.text),
    )
  )
    throw new Error(
      'Narration no longer matches the spoken story. Prepare new audio and acoustic timing before publishing this revision.',
    );
}

/** A document compiles into the existing chapter/cue contract; static subjects have no clock. */
export function compileStoryDocument(source: unknown, aligned?: Script) {
  const document = validateStoryDocument(source);
  if (!document.chapters.length) {
    if (aligned) throw new Error('A static document cannot attach a narration timeline.');
    return { document, chapters: [], script: undefined };
  }
  const narration = aligned && documentScript(document, aligned);
  const chapters = document.chapters.map((chapter) =>
    documentChapter(document, chapter.id, narration),
  );
  return { document, chapters, script: composeChapters(chapters, { script: narration }).script };
}

/** Load only the prepared timing named by the supplied audio; quiet documents need no media. */
export async function storyNarrationScript(
  audio?: HTMLAudioElement | null,
): Promise<Script | undefined> {
  if (!audio || audio.dataset.silent === 'true') return;
  const resource = audio.dataset.storyTimeline;
  if (!resource) return;
  const response = await fetch(new URL(resource, audio.baseURI));
  if (!response.ok) throw new Error(`Could not load narration timing: ${response.status}`);
  return response.json();
}

/** The supported prepared subject; custom chapter factories retain their own model owner. */
export function divisionSubject(document: StoryDocument) {
  const model = document.models[0];
  if (!model || model.kind !== 'division')
    throw new Error('This document needs its chapter presentation factories.');
  return model;
}
