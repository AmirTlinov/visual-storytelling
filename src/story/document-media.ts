import { documentNarration, type StoryDocument, type StoryDocumentOptions } from './document.js';
import type { Script } from './cues.js';

/** Retained assets must not make a deliberately quiet revision speak. */
export function hasStorySpeech(document: StoryDocument) {
  return document.chapters.some((chapter) =>
    chapter.beats.some((beat) => (beat.say ?? beat.text ?? '').trim()),
  );
}

/** The acoustic marks belong to the spoken runs that produced the accepted recording. */
export function validateStoryNarration(
  document: StoryDocument,
  aligned: Script,
  prepared?: StoryDocument,
  options: StoryDocumentOptions = {},
) {
  const expected = documentNarration(document, options).segments;
  const actual = aligned.segments ?? [];
  const spoken = (text: string) =>
    text
      .replace(/<\|[a-z]+:[a-z_]+\|>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const signature = (document: StoryDocument) => {
    const recording = documentNarration(document, options);
    return JSON.stringify({
      voice: recording.voice,
      music: recording.music,
      intro: recording.intro,
      outro: recording.outro,
      // These gaps also include silent actions and reserved observation time.
      // Matching words alone cannot validate the accepted waveform's layout.
      pauses: recording.segments.map((segment) => [segment.id, segment.pause_after]),
      beats: document.chapters.flatMap((chapter) =>
        chapter.beats
          .filter((beat) => (beat.say ?? beat.text ?? '').trim())
          .map((beat) => [
            `${chapter.id}.${beat.id}`,
            (beat.say ?? beat.text ?? '').replace(/\s+/g, ' ').trim(),
          ]),
      ),
    });
  };
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

export async function storyNarrationScript(
  audio?: HTMLAudioElement | null,
): Promise<Script | undefined> {
  if (!audio || audio.dataset.silent === 'true' || !audio.dataset.storyTimeline) return;
  const response = await fetch(new URL(audio.dataset.storyTimeline, audio.baseURI));
  if (!response.ok) throw new Error(`Could not load narration timing: ${response.status}`);
  return response.json();
}
