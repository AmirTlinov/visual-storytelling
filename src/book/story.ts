import { SceneShell } from '../scene.js';
import { theme, type Theme } from '../ink/palette.js';
import { BookStage, type BookState } from './stage.js';
import type { BookPage } from './paper.js';
import type { Cue, Chapter } from '../story/cues.js';
import type { ControlParameter } from '../controls/fields.js';

export interface BookStoryOptions {
  topic: string;
  pages: readonly BookPage[];
  parameters?: (ControlParameter & { key: string })[];
  theme?: Theme;
}
/** Existing story/explore controls own the model. The book only accompanies transitions. */
async function mount(parent: HTMLElement, options: BookStoryOptions) {
  if (!options.pages.length) throw new Error('A book needs at least one page');
  const ids = new Set<string>();
  for (const page of options.pages) {
    if (!page.id || ids.has(page.id) || page.id === 'book-open')
      throw new Error(`Invalid book page ID: ${page.id}`);
    ids.add(page.id);
    if (!(page.seconds > 0) || !Number.isFinite(page.seconds))
      throw new Error('A page duration must be positive');
  }
  if (options.parameters?.some((p) => p.key === 'chapter'))
    throw new Error('Book parameter "chapter" is reserved');
  const parameters = [
    {
      key: 'chapter',
      label: 'Пример',
      type: 'select' as const,
      value: options.pages[0]!.id,
      options: options.pages.map((p) => ({ value: p.id, label: p.title })),
    },
    ...(options.parameters ?? []),
  ];
  const parameterNames = new Set(parameters.map((p) => p.key));
  for (const page of options.pages)
    for (const key of page.controls ?? [])
      if (!parameterNames.has(key)) throw new Error(`Unknown page control: ${page.id}.${key}`);
  const defaults = Object.fromEntries(parameters.map((p) => [p.key, p.value]));
  await SceneShell.ready();
  const colors = theme(parent, options.theme ?? 'auto');
  const shell = SceneShell.mount(parent, {
    title: options.topic,
    paper: false,
    frame: { width: 960, height: 640 },
    parameters,
  });
  shell.onDispose(colors.dispose);
  try {
    const book = BookStage.mount(shell.stage, { ...options, values: defaults });
    shell.onDispose(book.dispose);
    const cues: Record<string, Cue> = {
        'book-open': { start: 0, end: 4.2, action: 'Открывается тайная книга.' },
      },
      starts: number[] = [];
    let duration = 4.2;
    for (const [index, page] of options.pages.entries()) {
      starts.push(duration);
      cues[page.id] = {
        start: duration,
        end: duration + page.seconds + (index ? 1.1 : 0),
        action: page.text,
      };
      duration = cues[page.id]!.end;
    }
    const segments: Chapter[] = [
      {
        id: 'book-open',
        ...cues['book-open']!,
        title: options.topic,
        text: options.topic,
      },
      ...options.pages.map((page) => ({
        id: page.id,
        ...cues[page.id]!,
        title: page.title,
        text: page.text,
      })),
    ];
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const at = (time: number, reduced: boolean): BookState => {
      const page = Math.max(
          0,
          starts.findLastIndex((start) => start <= time),
        ),
        start = starts[page]!,
        lead = page ? 1.1 : 0;
      return {
        page,
        time: Math.max(0, time - start - lead),
        progress: clamp((time - start - lead) / options.pages[page]!.seconds),
        reduced,
        open: clamp((time - 0.4) / 1.8),
        focus: clamp((time - 2.2) / 2),
        turn: page ? clamp((time - start) / lead) : 1,
      };
    };
    const story = shell.attachStory({
      script: { duration, cues, segments },
      stateAt(frame) {
        const state = at(frame.time, frame.reduced),
          page = options.pages[state.page]!;
        return { ...defaults, ...page.valuesAt?.(state), chapter: page.id };
      },
      render(values, frame, mode) {
        const state = at(frame.time, frame.reduced);
        if (mode === 'explore') {
          state.page = options.pages.findIndex((p) => p.id === values.chapter);
          if (state.page < 0) throw new Error(`Unknown book chapter: ${values.chapter}`);
          state.time = options.pages[state.page]!.seconds;
          state.progress = 1;
          state.open = state.focus = state.turn = 1;
        }
        const controls = options.pages[state.page]!.controls;
        shell.showParameters(controls ? ['chapter', ...controls] : undefined);
        book.render({ ...state, values, mode });
        for (const id of Object.keys(cues)) {
          frame.has(id);
          frame.target(id, 'explanation');
        }
      },
    });
    parent.scene!.setTheme = (value) => {
      colors.set(value);
      story.update();
    };
    parent.scene!.snapshot = book.snapshot;
    parent.scene!.checkpoints = [
      0,
      1.6,
      4.2,
      ...starts.slice(1).flatMap((t) => [t, t + 0.55, t + 1.1]),
    ];
    return { shell, story, scene: parent.scene! };
  } catch (error) {
    shell.dispose();
    throw error;
  }
}
export const BookStory = { mount };
