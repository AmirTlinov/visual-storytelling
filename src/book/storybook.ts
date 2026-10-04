import { CharacterStage } from '../characters/stage.js';
import { compileScore } from '../characters/score.js';
import type { CharacterPack, CharacterStageOptions } from '../characters/types.js';
import { BookStory, type BookStoryOptions } from './story.js';
import type { BookPage } from './paper.js';

export interface CastChapter extends Omit<CharacterStageOptions, 'pack' | 'background'> {
  id: string;
  title: string;
  text?: string;
}
export interface StorybookOptions extends Omit<BookStoryOptions, 'pages'> {
  pack: CharacterPack;
  chapters: readonly (BookPage | CastChapter)[];
}
/** One Story/Book owner combines prepared character stages and measured, interactive pages. */
async function mount(parent: HTMLElement, options: StorybookOptions) {
  if (options.parameters?.some((p) => p.key === 'sceneTime'))
    throw new Error('sceneTime is reserved for character exploration');
  const scenes = options.chapters.filter((p): p is CastChapter => 'set' in p);
  if (!scenes.length) throw new Error('Use BookStory for a story made only of measured pages');
  if (scenes.some((p) => Object.keys({ ...p.set.props, ...p.props }).length))
    throw new Error(
      'Storybook character chapters use prepared objects; external SVG props belong in CharacterStory',
    );
  const entries = scenes.map((p) => ({ ...p, pack: options.pack }));
  const scores = entries.map(compileScore);
  const host = document.createElement('div');
  host.hidden = true;
  parent.append(host);
  let cast: Awaited<ReturnType<typeof CharacterStage.mountMany>> | undefined;
  try {
    cast = await CharacterStage.mountMany(host, entries);
    const snapshots = new Map<string, unknown>();
    const pages: BookPage[] = options.chapters.map((chapter) => {
      if (!('set' in chapter)) return chapter;
      const index = scenes.indexOf(chapter),
        seconds = scores[index]!.script.duration;
      return {
        id: chapter.id,
        title: chapter.title,
        text: chapter.text ?? chapter.title,
        seconds,
        paper: false,
        controls: ['sceneTime'],
        valuesAt: (frame) => ({ sceneTime: frame.progress }),
        describe: (frame) => {
          const time =
            frame.mode === 'explore' ? Number(frame.values?.sceneTime ?? 1) * seconds : frame.time;
          const beat =
            chapter.beats.findLast((b) => scores[index]!.script.cues[b.id]!.start <= time) ??
            chapter.beats[0]!;
          return beat.text;
        },
        draw(page, frame) {
          const time =
            frame.mode === 'explore' ? Number(frame.values?.sceneTime ?? 1) * seconds : frame.time;
          const stage = cast!.render(index, time, frame.reduced);
          // Character camera has already fitted all subjects. Preserve that frame on the page.
          const ratio = chapter.set.width / chapter.set.height;
          const width = Math.min(page.size.width, page.size.height * ratio),
            height = width / ratio;
          const box = {
            x: (page.size.width - width) / 2,
            y: (page.size.height - height) / 2,
            width,
            height,
          };
          page.bounds(chapter.id, box);
          stage.paintTo(page.context, box);
          snapshots.set(chapter.id, stage.snapshot());
        },
      };
    });
    const result = await BookStory.mount(parent, {
      ...options,
      pages,
      parameters: [
        {
          key: 'sceneTime',
          label: 'Момент действия',
          value: 0,
          min: 0,
          max: 1,
          step: 0.005,
          format: (value: unknown) => `${Math.round(Number(value) * 100)}%`,
        },
        ...(options.parameters ?? []),
      ],
    });
    result.shell.onDispose(() => {
      cast!.dispose();
      host.remove();
    });
    const bookSnapshot = result.scene.snapshot;
    result.scene.snapshot = () => {
      const book = bookSnapshot() as { state: { page: number } };
      return { ...book, characters: snapshots.get(pages[book.state.page]!.id) };
    };
    result.scene.checkpoints = [
      ...(result.scene.checkpoints ?? []),
      ...scenes.flatMap((p, index) => {
        const start =
          result.story.sheet.script.cues[p.id]!.end -
          pages.find((page) => page.id === p.id)!.seconds;
        return Object.values(scores[index]!.script.cues).flatMap((cue) => [
          start + cue.start,
          start + (cue.start + cue.end) / 2,
        ]);
      }),
    ].sort((a, b) => a - b);
    return result;
  } catch (error) {
    cast?.dispose();
    host.remove();
    throw error;
  }
}
export const Storybook = { mount };
