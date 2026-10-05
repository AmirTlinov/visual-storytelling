import { SceneShell, type SceneOptions } from '../scene.js';
import type { ControlDescription, ControlParameter, ControlValue } from '../controls/fields.js';
import { cueSheet, type Frame, type Script } from '../story/cues.js';
import { morphTiming, type MorphCues, type MorphTime, type MorphProgress } from './timing.js';

export interface MorphPresentation<O, F = unknown> {
  setOperation(operation: O): void;
  render(time: MorphTime, cues?: MorphCues): F;
  view?: { reset(): void; dispose(): void };
  dispose(): void;
}

export interface MorphPresenter<O, F = unknown> {
  mount(
    parent: HTMLElement,
    operation: O,
  ): MorphPresentation<O, F> | Promise<MorphPresentation<O, F>>;
  /** Reuse the renderer's existing preparation and validation before publishing story state. */
  plan?(operation: O): O;
}

export interface MorphChapter<P, O> {
  id: string;
  /** Defaults to the matching script segment's title. */
  title?: string;
  /** Defaults to action cues prefixed with id_, or the chapter's own cue. */
  cues?: MorphCues;
  /** Narrated parameters for this chapter; exploration still uses the same controls. */
  initial?: Partial<P>;
  descriptions?: Partial<Record<keyof P, ControlDescription>>;
  operation(parameters: P): O;
}

type ControlKey<P> = { [K in keyof P]: P[K] extends ControlValue ? K : never }[keyof P] & string;

export interface MorphStoryOptions<P extends Record<string, unknown>, O, F = unknown> {
  title: string;
  presenter: MorphPresenter<O, F>;
  initial: P;
  /** Values come from initial; inputs retain the shared controls' contracts. */
  parameters?: (Omit<ControlParameter, 'value'> & { key: ControlKey<P> })[];
  script: Script;
  audio?: HTMLAudioElement | null;
  captions?: SceneOptions['captions'];
  chapters: readonly MorphChapter<P, O>[];
}

const CHAPTER = '__morphChapter',
  PROGRESS = '__morphProgress';

/** Manual progress keeps the cue's physical duration and the story's motion preference. */
export function exploredMorphTime(
  frame: Frame,
  cues: readonly string[],
  progress: number,
): MorphProgress {
  const active = cues[Math.min(cues.length - 1, Math.floor(progress * cues.length))]!;
  const cue = frame.cue(active);
  const count = cues.filter((id) => id === active).length;
  return {
    progress,
    reduced: frame.reduced,
    duration: ((cue.end - cue.start) * cues.length) / count,
  };
}

/** Shared authoring path over the accepted renderers. Story is the sole clock and input owner. */
async function mount<P extends Record<string, unknown>, O, F>(
  root: HTMLElement,
  options: MorphStoryOptions<P, O, F>,
) {
  const { presenter, initial } = options;
  const sheet = cueSheet(options.script),
    script = sheet.script;
  const keys = Object.keys(initial);
  if (keys.includes(CHAPTER) || keys.includes(PROGRESS))
    throw new Error('Morph story parameter uses a reserved key');
  if (!options.chapters.length) throw new Error('A morph story needs at least one chapter');
  const known = new Set<string>();
  const chapters = options.chapters
    .map((chapter) => {
      if (!chapter.id.trim() || known.has(chapter.id))
        throw new Error(`Duplicate or empty morph chapter: ${chapter.id}`);
      known.add(chapter.id);
      const segment = script.segments?.find((segment) => segment.id === chapter.id);
      const authored =
        chapter.cues ??
        Object.keys(script.cues)
          .filter((id) => id.startsWith(`${chapter.id}_`) && script.cues[id]!.action)
          .sort((a, b) => script.cues[a]!.start - script.cues[b]!.start);
      const cues = typeof authored === 'string' ? [authored] : [...authored];
      if (!cues.length && script.cues[chapter.id]) cues.push(chapter.id);
      if (!cues.length) throw new Error(`Morph chapter "${chapter.id}" needs an action cue`);
      const ranges = cues.map((id) => sheet.get(id));
      ranges.forEach((cue, index) => {
        if (index && cues[index] !== cues[index - 1] && cue.start < ranges[index - 1]!.end)
          throw new Error(`Morph chapter "${chapter.id}" has overlapping or unordered actions`);
      });
      const first = Math.min(...ranges.map((cue) => cue.start));
      const start = segment?.start ?? script.cues[chapter.id]?.start ?? first;
      if (start > first) throw new Error(`Morph chapter "${chapter.id}" starts after its action`);
      // Repeated cues use the same stage allocation as the renderer.
      morphTiming(sheet.at(0), cues, cues.length);
      return {
        ...chapter,
        cues,
        start,
        end: Math.max(...ranges.map((cue) => cue.end)),
        title: chapter.title ?? segment?.title ?? chapter.id,
      };
    })
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < chapters.length; i++)
    if (chapters[i]!.start <= chapters[i - 1]!.start || chapters[i]!.start < chapters[i - 1]!.end)
      throw new Error('Morph chapters must finish their actions before the next chapter starts');
  for (const parameter of options.parameters ?? [])
    if (!Object.hasOwn(initial, parameter.key))
      throw new Error(`Unknown morph parameter: ${parameter.key}`);
  for (const chapter of chapters) {
    for (const key of Object.keys(chapter.initial ?? {}))
      if (!Object.hasOwn(initial, key))
        throw new Error(`Unknown initial parameter "${key}" in chapter "${chapter.id}"`);
    for (const key of Object.keys(chapter.descriptions ?? {}))
      if (!options.parameters?.some((parameter) => parameter.key === key))
        throw new Error(`Chapter "${chapter.id}" describes a missing control: ${key}`);
  }

  const prepared = new Map<string, { inputs: P; operation: O }>();
  function prepare(chapter: (typeof chapters)[number], parameters: P) {
    const previous = prepared.get(chapter.id);
    if (previous && keys.every((key) => Object.is(previous.inputs[key], parameters[key])))
      return previous;
    const candidate = chapter.operation(parameters);
    const next = {
      inputs: { ...parameters },
      operation: presenter.plan ? presenter.plan(candidate) : candidate,
    };
    prepared.set(chapter.id, next);
    return next;
  }
  const first = chapters[0]!;
  const firstOperation = prepare(first, { ...initial, ...first.initial }).operation;
  await SceneShell.ready();
  const shell = SceneShell.mount(root, {
    title: options.title,
    captions: options.captions,
    parameters: [
      ...(chapters.length > 1
        ? [
            {
              key: CHAPTER,
              type: 'select' as const,
              label: 'Глава',
              value: first.id,
              options: chapters.map((chapter) => ({ value: chapter.id, label: chapter.title })),
            },
          ]
        : []),
      ...(options.parameters ?? []).map((parameter) => ({
        ...parameter,
        value: initial[parameter.key] as ControlValue,
      })),
      {
        key: PROGRESS,
        label: 'Преобразование',
        min: 0,
        max: 1,
        step: 0.005,
        value: 0,
        format: (value) => `${Math.round(Number(value) * 100)}%`,
      },
    ],
  });
  let drawing: MorphPresentation<O, F> | undefined;
  try {
    drawing = await presenter.mount(shell.stage, firstOperation);
    if (drawing.view) shell.attachView(drawing.view);
    else shell.onDispose(drawing.dispose);
    const mounted = drawing;
    let current = firstOperation;
    let currentChapter: string | undefined;
    let rendered: F | undefined;
    const controller = shell.attachStory({
      script,
      audio: options.audio,
      stateAt(frame) {
        const chapter = chapters.findLast((chapter) => frame.time >= chapter.start) ?? first;
        return {
          ...initial,
          ...chapter.initial,
          [CHAPTER]: chapter.id,
          [PROGRESS]: morphTiming(frame, chapter.cues, chapter.cues.length).progress,
        };
      },
      derive(values) {
        const chapter = chapters.find((chapter) => chapter.id === values[CHAPTER]);
        if (!chapter) throw new Error(`Unknown morph chapter: ${values[CHAPTER]}`);
        const progress = Number(values[PROGRESS]);
        if (!Number.isFinite(progress) || progress < 0 || progress > 1)
          throw new Error('Morph progress must be between zero and one');
        const inputs = Object.fromEntries(keys.map((key) => [key, values[key]])) as P;
        return { chapter, progress, ...prepare(chapter, inputs) };
      },
      render(state, frame, mode) {
        if (currentChapter !== state.chapter.id) {
          for (const parameter of options.parameters ?? []) {
            const description = state.chapter.descriptions?.[parameter.key];
            shell.describeParameter(parameter.key, {
              label: parameter.label,
              format: parameter.format,
              disabled: parameter.disabled,
              ...description,
            });
          }
          currentChapter = state.chapter.id;
        }
        if (state.operation !== current) {
          mounted.setOperation(state.operation);
          current = state.operation;
        }
        const time =
          mode === 'story' ? frame : exploredMorphTime(frame, state.chapter.cues, state.progress);
        rendered = mounted.render(time, state.chapter.cues);
      },
    });
    const handle = root.scene!;
    handle.snapshot = () => ({
      chapter: controller.state.chapter.id,
      parameters: controller.state.inputs,
      progress: controller.state.progress,
      mode: controller.mode,
      frame: rendered,
    });
    return { shell, story: controller, presentation: mounted, dispose: shell.dispose };
  } catch (error) {
    drawing?.dispose();
    shell.dispose();
    throw error;
  }
}

export const MorphStory = { mount };
