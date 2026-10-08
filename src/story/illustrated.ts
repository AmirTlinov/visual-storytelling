import { SceneStory, type SceneChapter, type SceneStoryOptions } from './composition.js';
import type { Script } from './cues.js';
import {
  documentChapter,
  documentNarration,
  documentScript,
  type StoryDocument,
} from './document.js';

export interface IllustratedStoryOptions extends Omit<SceneStoryOptions, 'title' | 'chapters'> {
  document: StoryDocument;
  /** Generated narration declares its aligned timing with data-story-timeline. Explicit script wins. */
  audio?: HTMLAudioElement | null;
  /** Each authored chapter selects a presentation owned by its subject. */
  chapters: Readonly<Record<string, (chapter: ReturnType<typeof documentChapter>) => SceneChapter>>;
}

async function narrationScript(
  audio: HTMLAudioElement | null | undefined,
): Promise<Script | undefined> {
  if (!audio || audio.dataset.silent === 'true') return;
  const resource = audio.dataset.storyTimeline;
  if (!resource) return;
  const response = await fetch(new URL(resource, audio.baseURI));
  if (!response.ok) throw new Error(`Could not load narration timing: ${response.status}`);
  return response.json();
}

/** One document supplies narration and quiet timing to ordinary SceneStory chapters. */
async function mount(parent: HTMLElement, options: IllustratedStoryOptions) {
  const { document, chapters: factories, ...presentation } = options;
  documentNarration(document);
  const script = options.script ?? (await narrationScript(options.audio));
  const aligned = script && documentScript(document, script);
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
