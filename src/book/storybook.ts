import { characterStage } from '../characters/stage.js';
import { characterRenderer, type CharacterRenderer } from '../characters/renderer.js';
import { compileScore } from '../characters/score.js';
import type { CharacterPack, CharacterStageOptions } from '../characters/types.js';
import { SceneStory, type SceneChapter, type SceneStoryOptions } from '../story/composition.js';
import { bookChapters } from './chapters.js';
import { notebookWorld, notebookSupport, studySource } from './world.js';
import { furnitureParts } from '../characters/staging/furniture.js';
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
    const entries: (NotebookSource | undefined)[] = [];
    if (!worlds[0]) entries[0] = await studySource(parent);
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
                const current = ++revision,
                  book = drawing.restingBook(notebook.bookId);
                if (!book)
                  throw new Error(
                    `Put ${notebook.bookId} on a support before entering a paper chapter`,
                  );
                const camera = (drawing.snapshot() as { camera: NotebookSource['camera'] }).camera,
                  support = notebookSupport(entry.set, book);
                if (!support)
                  throw new Error(
                    `Place ${notebook.bookId} on furniture before entering a paper chapter`,
                  );
                const result = drawing.capture(),
                  background = drawing.capture({
                    camera: { x: 0, y: 0, width: entry.set.width, height: entry.set.height },
                    omit: [
                      notebook.bookId,
                      ...(furnitureParts(support[1], entry.set.staging!.projection).length
                        ? [support[0]]
                        : []),
                    ],
                  });
                return Promise.all([result, background]).then(([image, room]) => {
                  if (revision === current)
                    entries[index + 1] = {
                      image: room,
                      width: entry.set.width,
                      height: entry.set.height,
                      camera,
                      projection: entry.set.staging!.projection,
                      book,
                      support: support[1],
                    };
                  return image;
                });
              }
              return drawing.capture();
            },
            dispose: drawing.dispose,
          };
        },
      };
    });
    const result = await SceneStory.mount(parent, {
      ...options,
      title: options.topic,
      chapters,
      transition: bookChapters(options.topic, worlds, entries),
    });
    result.shell.onDispose(() => graphics?.dispose());
    return result;
  } catch (error) {
    graphics?.dispose();
    throw error;
  }
}
export const Storybook = { mount };
