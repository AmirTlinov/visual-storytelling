import { characterStage } from '../characters/stage.js';
import { characterRenderer, type CharacterRenderer } from '../characters/renderer.js';
import { compileScore } from '../characters/score.js';
import type { CharacterPack, CharacterStageOptions } from '../characters/types.js';
import { SceneStory, type SceneChapter, type SceneStoryOptions } from '../story/composition.js';
import { bookChapters } from './chapters.js';
import { notebookWorld, notebookSource, studySource } from './world.js';
import type { NotebookSource } from './opening.js';

export interface CastChapter
  extends Omit<CharacterStageOptions, 'pack' | 'background'>,
    Pick<SceneChapter, 'controls' | 'valuesAt'> {
  id: string;
  title: string;
  text?: string;
}
export interface StorybookOptions
  extends Omit<SceneStoryOptions, 'title' | 'chapters' | 'transition'> {
  topic: string;
  pack?: CharacterPack;
  chapters: readonly (CastChapter | SceneChapter)[];
}
/** Character, measured and arbitrary chapters retain their original rendering owners. */
async function mount(parent: HTMLElement, options: StorybookOptions) {
  let graphics: CharacterRenderer | undefined;
  try {
    const worlds = options.chapters.map((chapter) => !('mount' in chapter));
    let introduction = worlds[0] ? undefined : await studySource(parent);
    let incoming: { index: number; source: NotebookSource } | undefined;
    const chapters: SceneChapter[] = options.chapters.map((chapter, index) => {
      if ('mount' in chapter) return chapter;
      if (!options.pack) throw new Error('Character chapters need a character pack');
      const notebook = notebookWorld(chapter.set);
      const entry = {
          ...chapter,
          set: notebook.set,
          description: chapter.description ?? chapter.text ?? chapter.title,
          pack: options.pack,
        },
        score = compileScore(entry);
      return {
        id: chapter.id,
        title: chapter.title,
        text: chapter.text ?? chapter.title,
        seconds: score.script.duration,
        script: score.script,
        controls: chapter.controls ?? [],
        valuesAt: chapter.valuesAt,
        async mount(host) {
          graphics ??= await characterRenderer(entry.pack);
          const drawing = await characterStage(host, entry, score, graphics);
          let latestTime = 0,
            revision = 0;
          return {
            render(frame) {
              latestTime = frame.time;
              drawing.show(true);
              drawing.render(frame.time, frame.reduced, frame);
            },
            snapshot: drawing.snapshot,
            focus: drawing.focus,
            reset: drawing.reset,
            capture() {
              if (
                index < worlds.length - 1 &&
                !worlds[index + 1] &&
                latestTime >= score.script.duration
              ) {
                const current = ++revision;
                return Promise.all([
                  drawing.capture(),
                  notebookSource(drawing, notebook.bookId),
                ]).then(([image, source]) => {
                  if (revision === current) incoming = { index: index + 1, source };
                  return image;
                });
              }
              return drawing.capture();
            },
            dispose() {
              revision++;
              drawing.dispose();
            },
          };
        },
      };
    });
    const result = await SceneStory.mount(parent, {
      ...options,
      title: options.topic,
      chapters,
      transition: bookChapters(options.topic, worlds, (index) =>
        index === 0 ? introduction : incoming?.index === index ? incoming.source : undefined,
      ),
    });
    result.shell.onDispose(() => {
      incoming = undefined;
      introduction = undefined;
      graphics?.dispose();
    });
    return result;
  } catch (error) {
    graphics?.dispose();
    throw error;
  }
}
export const Storybook = { mount };
