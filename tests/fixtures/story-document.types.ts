import {
  documentChapter,
  documentNarration,
  type StoryDocument,
} from '../../src/story/document.js';

/** The same canonical document accepts subject factories and built-in model staging. */
export function checkStoryDocumentTypes() {
  const characters: StoryDocument = {
    version: 1,
    models: [],
    views: [],
    chapters: [
      {
        id: 'room',
        title: 'В мастерской',
        beats: [
          {
            id: 'point',
            say: 'Проследим цепь.',
            perform: [{ action: 'point', actor: 'hero', target: 'board.content' }],
            actors: { hero: 'idea' },
            props: { lamp: { values: { active: 1 } } },
            shot: { focus: ['board.content'], framing: 'detail' },
          },
        ],
      },
    ],
  };
  const staticModel: StoryDocument = {
    version: 1,
    models: [{ id: 'division', kind: 'division', inputs: { count: 23, divisor: 3 } }],
    views: [{ id: 'groups', kind: 'groups', model: 'division' }],
    chapters: [],
  };
  // @ts-expect-error Model and view collections are part of the canonical authored source.
  const legacy: StoryDocument = { title: 'Old document', chapters: [] };
  return {
    chapter: documentChapter(characters, 'room'),
    speech: documentNarration(staticModel),
    legacy,
  };
}
