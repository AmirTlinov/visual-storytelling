/** Public document API: validation and projection share the same schema owner. */
export * from './document-schema.js';
export { divisionStory } from '../recipes/division-story.js';
export {
  authoredChapter,
  documentNarration,
  documentScript,
  documentChapter,
} from './document-timing.js';
export { prepareStoryDocument, documentTimeline, documentModelsAt } from './document-model.js';

export { prepareIllustratedDocument } from './document-subject.js';
