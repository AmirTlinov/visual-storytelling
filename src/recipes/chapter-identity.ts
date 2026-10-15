import type { AuthoredChapter } from '../story/document-schema.js';

/** Generated chapters reserve both their own ID and every qualified beat ID. */
export function defaultChapter(
  chapter: AuthoredChapter,
  occupied: Iterable<unknown>,
): AuthoredChapter {
  const reserved = new Set(occupied);
  let id = chapter.id;
  while (reserved.has(id) || chapter.beats.some((beat) => reserved.has(`${id}.${beat.id}`)))
    id += '.story';
  return { ...chapter, id };
}
