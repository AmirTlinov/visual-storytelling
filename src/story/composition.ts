import { SceneShell, type SceneOptions, type SceneView } from '../scene.js';
import { theme, type Theme } from '../ink/palette.js';
import type { ControlValue } from '../controls/fields.js';
import { activeCue, type Frame, type Script } from './cues.js';
import {
  composeChapters,
  chapterTime,
  chapterPosition,
  type ChapterTiming,
  type ChapterIntroduction,
} from './composition-plan.js';
import { chapterPreviews } from './composition-previews.js';
import { chapterPresentations } from './composition-presentations.js';
import type { Story } from './story.js';

export interface ChapterFrame {
  time: number;
  progress: number;
  reduced: boolean;
  mode: 'story' | 'explore';
  values: Readonly<Record<string, ControlValue>>;
  /** Latest started local cue; narration alignment supplies its boundaries. */
  beat?: { id: string; progress: number };
  /** A live drawing can manipulate the same model controls as the shell. */
  input?(values: Record<string, ControlValue>): void;
}
export interface ChapterPresentation {
  render(frame: ChapterFrame): void;
  snapshot?(): unknown;
  /** Freeze the current frame before returning; decoding its boundary image may be asynchronous. */
  capture?(viewport?: { aspect: number }): Promise<HTMLCanvasElement> | HTMLCanvasElement;
  /** Logical view belongs to the chapter; its disposal stays with the presentation. */
  view?: Omit<SceneView, 'dispose'>;
  dispose(): void;
}
export interface SceneChapter extends ChapterTiming {
  controls?: readonly string[];
  /** Authored inputs, also used when entering this chapter through a user edit. */
  valuesAt?(frame: ChapterFrame): Record<string, ControlValue>;
  /** Cancel resource work when the selected chapter changes; release partial resources on failure. */
  mount(
    parent: HTMLElement,
    signal: AbortSignal,
  ): ChapterPresentation | Promise<ChapterPresentation>;
}
export interface ChapterTransition {
  introduction?: ChapterIntroduction;
  duration: number | ((index: number) => number);
  captureAspect?: number;
  mount(
    parent: HTMLElement,
    previews: readonly {
      start?: HTMLCanvasElement;
      end?: HTMLCanvasElement;
      surface?: HTMLCanvasElement;
    }[],
  ): {
    render(state: {
      chapter: number;
      time: number;
      open: number;
      progress: number;
      reduced: boolean;
    }): void;
    dispose(): void;
  };
}
export interface SceneStoryOptions {
  title: string;
  chapters: readonly SceneChapter[];
  parameters?: SceneOptions['parameters'];
  frame?: SceneOptions['frame'];
  captions?: SceneOptions['captions'];
  script?: Script;
  audio?: HTMLAudioElement | null;
  theme?: Theme;
  transition?: ChapterTransition;
}

/** Compose existing presentations. Story still owns time, parameters, playback and captions. */
async function mount(parent: HTMLElement, options: SceneStoryOptions) {
  const plan = composeChapters(options.chapters, {
    script: options.script,
    introduction: options.transition?.introduction,
    transition: options.transition?.duration,
  });
  const reserved = ['chapter', 'sceneTime'];
  if (options.parameters?.some((p) => reserved.includes(p.key)))
    throw new Error('Composition controls reserve chapter and sceneTime');
  const parameters: NonNullable<SceneOptions['parameters']> = [
    {
      key: 'chapter',
      label: 'Глава',
      type: 'select',
      value: options.chapters[0]!.id,
      options: options.chapters.map((c) => ({ value: c.id, label: c.title })),
    },
    {
      key: 'sceneTime',
      label: 'Момент',
      value: 0,
      min: 0,
      max: 1,
      step: 0.005,
      format: (v) => `${Math.round(Number(v) * 100)}%`,
    },
    ...(options.parameters ?? []),
  ];
  const defaults = Object.fromEntries(parameters.map((p) => [p.key, p.value]));
  for (const c of options.chapters)
    for (const key of c.controls ?? [])
      if (!Object.hasOwn(defaults, key))
        throw new Error(`Unknown control ${key} in chapter ${c.id}`);
  await SceneShell.ready();
  const colors = theme(parent, options.theme ?? 'auto');
  const shell = SceneShell.mount(parent, {
    title: options.title,
    paper: false,
    parameters,
    frame: options.frame ?? { width: 960, height: 640 },
    captions: options.captions,
  });
  shell.onDispose(colors.dispose);
  const presentations = chapterPresentations(options.chapters, shell.stage);
  shell.onDispose(presentations.dispose);
  let current = 0,
    latest: ChapterFrame | undefined;
  try {
    let story: Story<Record<string, ControlValue>> | undefined;
    let transition: ReturnType<ChapterTransition['mount']> | undefined;
    const previews = options.transition
      ? chapterPreviews(
          options.chapters,
          shell.stage,
          defaults,
          presentations.get,
          () => {
            if (latest) presentations.active?.drawing.render(latest);
          },
          options.transition.captureAspect,
        )
      : undefined;
    if (previews) {
      shell.onDispose(previews.dispose);
    }
    transition = options.transition?.mount(shell.stage, previews!.images);
    if (transition) shell.onDispose(transition.dispose);
    const localFrame = (index: number, progress: number, reduced: boolean): ChapterFrame => {
      const chapter = options.chapters[index]!;
      return {
        time: progress * chapter.seconds,
        progress,
        reduced,
        mode: 'story',
        values: defaults,
        beat: activeCue(chapter.script, progress * chapter.seconds),
      };
    };
    const at = (time: number, reduced: boolean) => {
      const index = Math.max(
          0,
          plan.timings.findLastIndex((t) => t.start <= time),
        ),
        timing = plan.timings[index]!;
      const progress = chapterTime(timing, time) / timing.seconds;
      return {
        index,
        timing,
        frame: localFrame(index, progress, reduced),
      };
    };
    const selection = (
      values: Record<string, ControlValue>,
      frame: Frame,
      mode: 'story' | 'explore',
    ) => {
      const state = at(frame.time, frame.reduced);
      const index =
        mode === 'explore'
          ? options.chapters.findIndex((chapter) => chapter.id === values.chapter)
          : state.index;
      if (index < 0) throw new Error(`Unknown chapter: ${values.chapter}`);
      const chapter = options.chapters[index]!,
        progress = mode === 'explore' ? Number(values.sceneTime) : state.frame.progress;
      if (!Number.isFinite(progress) || progress < 0 || progress > 1)
        throw new Error('Chapter progress must be between zero and one');
      const transition = {
        chapter: index,
        time: frame.time,
        open:
          mode === 'explore' || frame.reduced || plan.introduction === 0
            ? 1
            : Math.min(1, frame.time / Math.max(0.001, plan.introduction)),
        progress:
          mode === 'explore' || frame.reduced || index === 0 || frame.time >= state.timing.content
            ? 1
            : Math.max(
                0,
                Math.min(
                  1,
                  (frame.time - state.timing.start) / Math.max(0.001, state.timing.transition),
                ),
              ),
        reduced: frame.reduced,
      };
      return { state, index, chapter, progress, transition };
    };
    story = shell.attachStory({
      script: plan.script,
      audio: options.audio,
      stateAt(frame) {
        const state = at(frame.time, frame.reduced),
          chapter = options.chapters[state.index]!;
        return {
          ...defaults,
          ...chapter.valuesAt?.(state.frame),
          chapter: chapter.id,
          sceneTime: state.frame.progress,
        };
      },
      resolveInput(patch, current, frame) {
        const id = patch.chapter ?? current.values.chapter;
        const index = options.chapters.findIndex((chapter) => chapter.id === id);
        if (index < 0) throw new Error(`Unknown chapter: ${id}`);
        const chapter = options.chapters[index]!,
          changed = id !== current.values.chapter,
          progress = Number(patch.sceneTime ?? (changed ? 0 : current.values.sceneTime));
        if (!Number.isFinite(progress) || progress < 0 || progress > 1)
          throw new Error('Chapter progress must be between zero and one');
        const authored = changed
          ? { ...defaults, ...chapter.valuesAt?.(localFrame(index, progress, frame.reduced)) }
          : current.values;
        return {
          values: { ...authored, ...patch, chapter: chapter.id, sceneTime: progress },
          time:
            changed || patch.sceneTime !== undefined
              ? chapterPosition(plan.timings[index]!, progress * chapter.seconds)
              : current.time,
        };
      },
      chapterAt(moment) {
        if (moment.mode !== 'explore') return;
        const timing = plan.timings.find((chapter) => chapter.id === moment.values.chapter);
        if (!timing) return;
        // At a shared end/start boundary the selected drawing owns its last paragraph.
        const segments = plan.script.segments
          ?.filter(
            (segment) =>
              segment.title && segment.start >= timing.start && segment.start < timing.end,
          )
          .toSorted((a, b) => a.start - b.start);
        return (
          segments?.findLast((segment) => segment.start <= moment.time)?.id ?? segments?.[0]?.id
        );
      },
      prepare(values, frame, mode, signal) {
        const selected = selection(values, frame, mode);
        const boundary = Boolean(
          previews && (selected.transition.open < 1 || selected.transition.progress < 1),
        );
        const capture = boundary && !previews!.has(selected.index);
        if (presentations.get(selected.index) && !capture) return;
        shell.stage.setAttribute('aria-busy', 'true');
        const indices =
          capture && selected.index ? [selected.index - 1, selected.index] : [selected.index];
        return presentations
          .prepare(
            indices,
            signal,
            capture ? () => previews!.prepare(selected.index, signal) : undefined,
          )
          .catch((cause) => {
            if (!signal.aborted) shell.stage.removeAttribute('aria-busy');
            throw cause;
          });
      },
      render(values, frame, mode) {
        const {
          state,
          index,
          chapter,
          progress,
          transition: nextTransition,
        } = selection(values, frame, mode);
        current = index;
        const presentation = presentations.show(index);
        shell.stage.removeAttribute('aria-busy');
        latest = {
          ...state.frame,
          progress,
          time: progress * chapter.seconds,
          mode,
          values,
          beat: activeCue(chapter.script, progress * chapter.seconds),
          input: shell.input,
        };
        presentation.drawing.render(latest);
        shell.showParameters([
          'chapter',
          'sceneTime',
          ...(chapter.controls ?? (options.parameters ?? []).map((p) => p.key)),
        ]);
        // A covered page is still rendered for the transition, but cannot receive input or focus.
        presentation.element.inert = Boolean(
          transition && (nextTransition.open < 1 || nextTransition.progress < 1),
        );
        transition?.render(nextTransition);
        for (const id of Object.keys(plan.script.cues))
          if (id === chapter.id || id.startsWith(chapter.id + '.')) {
            frame.has(id);
            frame.target(id, chapter.id);
          }
      },
    });
    const scene = parent.scene!;
    scene.snapshot = () =>
      story!.presented && {
        chapter: options.chapters[current]!.id,
        frame: latest && {
          time: latest.time,
          progress: latest.progress,
          reduced: latest.reduced,
          mode: latest.mode,
          values: latest.values,
          beat: latest.beat,
        },
        content: presentations.active?.drawing.snapshot?.(),
      };
    scene.checkpoints = [
      ...new Set([
        0,
        ...Object.values(plan.script.cues).flatMap((c) => [c.start, (c.start + c.end) / 2, c.end]),
      ]),
    ].sort((a, b) => a - b);
    scene.setTheme = (value) => {
      colors.set(value);
      previews?.refresh();
      story!.update();
      return story!.ready();
    };
    if (previews) {
      const refresh = () => {
        try {
          if (!previews.refresh()) return;
          story!.update();
          void story!.ready().catch((error) => {
            shell.status.textContent = error.message;
          });
        } catch (error) {
          shell.status.textContent = error instanceof Error ? error.message : String(error);
        }
      };
      const observer = new MutationObserver(refresh);
      for (let node: HTMLElement | null = parent; node; node = node.parentElement)
        observer.observe(node, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme'],
        });
      const resize = new ResizeObserver(refresh);
      resize.observe(shell.stage.closest('[data-scene-frame]') ?? shell.stage);
      shell.onDispose(() => {
        observer.disconnect();
        resize.disconnect();
      });
    }
    shell.attachView({
      get transition() {
        return presentations.active?.drawing.view?.transition;
      },
      get focus() {
        const view = presentations.active?.drawing.view;
        return view?.focus ? (ids: readonly string[]) => view.focus!(ids) : undefined;
      },
      validateFocus(ids) {
        presentations.active?.drawing.view?.validateFocus?.(ids);
      },
      reset(settings) {
        const from = settings?.from as { chapter?: string; state?: unknown } | undefined;
        presentations.active?.drawing.view?.reset({
          animate: settings?.animate,
          from: from?.chapter === options.chapters[current]!.id ? from?.state : undefined,
        });
      },
      capture() {
        const state = presentations.active?.drawing.view?.capture?.();
        return state === undefined ? undefined : { chapter: options.chapters[current]!.id, state };
      },
      restore(value: unknown) {
        const saved = value as { chapter?: string; state?: unknown } | undefined;
        const view = presentations.active?.drawing.view;
        return Boolean(
          saved?.chapter === options.chapters[current]!.id &&
            view?.restore &&
            view.restore(saved.state) !== false,
        );
      },
      dispose() {},
    });
    await story.ready();
    return { shell, story, scene };
  } catch (error) {
    shell.dispose();
    throw error;
  }
}
export const SceneStory = { mount };
