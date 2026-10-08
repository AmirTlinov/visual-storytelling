import { SceneStory, type SceneChapter, type SceneStoryOptions } from './composition.js';
import {
  documentChapter,
  documentNarration,
  documentScript,
  type StoryDocument,
} from './document.js';

export interface IllustratedStoryOptions extends Omit<SceneStoryOptions, 'title' | 'chapters'> {
  document: StoryDocument;
  /** Each authored chapter selects a presentation owned by its subject. */
  chapters: Readonly<Record<string, (chapter: ReturnType<typeof documentChapter>) => SceneChapter>>;
}

/** One document supplies narration and quiet timing to ordinary SceneStory chapters. */
async function mount(parent: HTMLElement, options: IllustratedStoryOptions) {
  const { document, chapters: factories, ...presentation } = options;
  documentNarration(document);
  const aligned = options.script && documentScript(document, options.script);
  const chapters = document.chapters.map(({ id }) => {
    const factory = factories[id];
    if (!factory) throw new Error(`Chapter ${id} needs a presentation`);
    const authored = documentChapter(document, id, aligned);
    const chapter = factory(authored);
    if (chapter.id !== id) throw new Error(`Chapter presentation changed its authored ID: ${id}`);
    return chapter;
  });
  return SceneStory.mount(parent, {
    ...presentation,
    title: document.title,
    chapters,
    script: aligned,
  });
}
export const IllustratedStory = { mount };
