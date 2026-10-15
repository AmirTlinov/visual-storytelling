import type { StoryDocument, StoryDocumentOptions } from './document-schema.js';
import type { Script } from './cues.js';

const accepted = new Map<string, true>();
const capacity = 64;

/** Only registered pure models can reuse a boundary proof. Opaque authored code is replayed. */
export function checkDocumentBoundaries(
  document: StoryDocument,
  script: Script | undefined,
  options: StoryDocumentOptions,
  check: (time: number | undefined) => void,
) {
  const moments = script
    ? [...new Set([0, ...Object.values(script.cues).flatMap((cue) => [cue.start, cue.end])])]
    : [undefined];
  const opaque = Object.keys(options.modules ?? {}).length > 0;
  const key = JSON.stringify({
    models: document.models,
    views: document.views,
    chapters: document.chapters.map(({ id, views, beats }) => ({
      id,
      views,
      beats: beats.map(({ id, operation, focus, awaitInput }) => ({
        id,
        operation,
        focus,
        awaitInput,
      })),
    })),
    cues: script && Object.entries(script.cues).map(([id, cue]) => [id, cue.start, cue.end]),
  });
  const reused = !opaque && accepted.has(key);
  if (!reused) {
    for (const time of moments) check(time);
    if (!opaque) {
      accepted.set(key, true);
      if (accepted.size > capacity) accepted.delete(accepted.keys().next().value!);
    }
  }
  return {
    execution: reused ? ('reused' as const) : opaque ? ('opaque' as const) : ('checked' as const),
    evaluated: reused ? 0 : moments.length,
    moments: moments.map((time) => ({
      time: time ?? 0,
      cues: script
        ? Object.entries(script.cues)
            .filter(([, cue]) => cue.start === time || cue.end === time)
            .map(([id]) => id)
        : [],
      models: document.models.map(({ id }) => id),
    })),
  };
}
