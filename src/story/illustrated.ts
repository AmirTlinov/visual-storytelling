import { SceneStory, type SceneChapter, type SceneStoryOptions } from './composition.js';
import { documentChapter, type StoryDocument } from './document.js';
import {
  compileStoryDocument,
  hasStorySpeech,
  storyNarrationScript,
  validateStoryNarration,
} from './compiler.js';

export interface IllustratedStoryOptions extends Omit<SceneStoryOptions, 'title' | 'chapters'> {
  document: StoryDocument;
  /** Generated narration declares its aligned timing with data-story-timeline. Explicit script wins. */
  audio?: HTMLAudioElement | null;
  /** Each authored chapter selects a presentation owned by its subject. */
  chapters: Readonly<Record<string, (chapter: ReturnType<typeof documentChapter>) => SceneChapter>>;
}

/** One document supplies narration and quiet timing to ordinary SceneStory chapters. */
async function mount(parent: HTMLElement, options: IllustratedStoryOptions) {
  const { document, chapters: factories, ...presentation } = options;
  const audio = hasStorySpeech(document) ? options.audio : undefined;
  const script = options.script ?? (await storyNarrationScript(audio));
  if (audio && audio.dataset.silent !== 'true' && script) validateStoryNarration(document, script);
  const compiled = compileStoryDocument(document, script);
  if (!compiled.chapters.length)
    throw new Error(
      'A static subject mounts through mountStoryDocument without chapter factories.',
    );
  const chapters = compiled.chapters.map((authored) => {
    const { id } = authored;
    const factory = factories[id];
    if (!factory) throw new Error(`Chapter ${id} needs a presentation`);
    const chapter = factory(authored);
    if (chapter.id !== id) throw new Error(`Chapter presentation changed its authored ID: ${id}`);
    return chapter;
  });
  return SceneStory.mount(parent, {
    ...presentation,
    audio,
    title: document.title ?? compiled.chapters[0]!.title,
    chapters,
    script: script ? compiled.script : undefined,
  });
}
export const IllustratedStory = { mount };
