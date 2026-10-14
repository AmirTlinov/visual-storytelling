import {
  SceneShell,
  type SceneOptions,
  type SceneView,
  type SceneFramePresentation,
} from '../scene.js';
import { theme, type Theme } from '../ink/palette.js';
import type { ControlValue } from '../controls/fields.js';
import type { Script } from './cues.js';
import { compositionFrames, type ComposedMoment } from './composition-state.js';
import { compositionView } from './composition-view.js';
import {
  composeChapters,
  type ChapterTiming,
  type ChapterIntroduction,
} from './composition-plan.js';
import { chapterPreviews } from './composition-previews.js';
import { chapterPresentations } from './composition-presentations.js';
import type { Story } from './story.js';

export interface ChapterFrame {
  chapter: string;
  time: number;
  progress: number;
  reduced: boolean;
  mode: 'story' | 'explore';
  values: Readonly<Record<string, ControlValue>>;
  /** Latest started local cue; narration alignment supplies its boundaries. */
  beat?: { id: string; progress: number };
  /** A live drawing can manipulate the same model controls as the shell. */
  input?(values: Record<string, ControlValue>): void;
  /** Pure subject projection supplied by the composition; geometry never owns this state. */
  subject?: unknown;
}
export interface ChapterPresentation {
  render(frame: ChapterFrame): void;
  /** Finish the first queued paint while the candidate is still concealed. */
  ready?(signal: AbortSignal): void | Promise<unknown>;
  snapshot?(): unknown;
  /** Freeze the current frame before returning; decoding its boundary image may be asynchronous. */
  capture?(viewport?: { aspect: number }): Promise<HTMLCanvasElement> | HTMLCanvasElement;
  /** Logical view belongs to the chapter; its disposal stays with the presentation. */
  view?: Omit<SceneView, 'dispose'>;
  dispose(): void;
}
export interface SceneChapter extends ChapterTiming {
  /** The published chapter owns its frame; preparation leaves the previous frame intact. */
  presentation?: SceneFramePresentation;
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
  resources?: SceneOptions['resources'];
  frame?: SceneOptions['frame'];
  captions?: SceneOptions['captions'];
  heading?: SceneOptions['heading'];
  script?: Script;
  audio?: HTMLAudioElement | null;
  theme?: Theme;
  transition?: ChapterTransition;
  /** Derive the subject once before accepting a frame or preparing its presentation. */
  subjectAt?(frame: ChapterFrame): unknown;
  /** These controls belong to a continuous subject and survive chapter switches in exploration. */
  sharedControls?: readonly string[];
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
  if (
    options.sharedControls?.some((key) => !key.trim() || reserved.includes(key)) ||
    new Set(options.sharedControls).size !== (options.sharedControls?.length ?? 0)
  )
    throw new Error('Shared controls need unique subject input keys.');
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
    heading: options.heading ?? 'navigation',
    presentation: options.chapters[0]?.presentation,
    parameters,
    resources: options.resources,
    frame: options.frame,
    captions: options.captions,
  });
  shell.onDispose(colors.dispose);
  const presentations = chapterPresentations(options.chapters, shell.stage);
  shell.onDispose(presentations.dispose);
  let current = 0,
    latest: ChapterFrame | undefined;
  try {
    let story: Story<Record<string, ControlValue>, string, ComposedMoment> | undefined;
    let staged: ComposedMoment | undefined;
    const view = compositionView(
      presentations,
      () => options.chapters[current]!.id,
      () => story?.requested.mode ?? 'story',
    );
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
          options.subjectAt,
        )
      : undefined;
    if (previews) {
      shell.onDispose(previews.dispose);
    }
    const frames = compositionFrames(options, plan, defaults, shell.input);
    story = shell.attachStory<Record<string, ControlValue>, string, ComposedMoment>({
      script: plan.script,
      audio: options.audio,
      stateAt: frames.stateAt,
      derive: frames.derive,
      resolveInput: frames.resolveInput,
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
      prepare(moment, _frame, _mode, signal) {
        const { selected } = moment;
        const boundary = Boolean(
          previews && (selected.transition.open < 1 || selected.transition.progress < 1),
        );
        const capture = boundary && !previews!.has(selected.index);
        if (
          presentations.active &&
          presentations.get(selected.index) === presentations.active &&
          !capture
        )
          return;
        shell.stage.setAttribute('aria-busy', 'true');
        const indices =
          capture && selected.index ? [selected.index - 1, selected.index] : [selected.index];
        return presentations
          .prepare(indices, signal, async () => {
            if (capture) await previews!.prepare(selected.index, signal);
            signal.throwIfAborted();
            const candidate = presentations.get(selected.index)!;
            if (candidate === presentations.active) return;
            // First render is preparation: keep the accepted chapter visible on failure.
            candidate.element.dataset.chapterPending = '';
            candidate.element.hidden = false;
            candidate.element.style.clipPath = 'inset(100%)';
            try {
              candidate.drawing.render(moment.frame);
              view.prepare(selected.index);
              await candidate.drawing.ready?.(signal);
              if (options.transition)
                presentations.prepareTransition(
                  selected.index,
                  options.transition,
                  previews!.images,
                  selected.transition,
                );
              staged = moment;
            } finally {
              candidate.element.hidden = true;
              candidate.element.style.removeProperty('clip-path');
              delete candidate.element.dataset.chapterPending;
            }
          })
          .catch((cause) => {
            if (!signal.aborted) shell.stage.removeAttribute('aria-busy');
            throw cause;
          });
      },
      render(moment, frame, _mode) {
        const { index, chapter, transition: nextTransition } = moment.selected;
        const presentation = presentations.get(index)!;
        if (staged !== moment) {
          presentation.drawing.render(moment.frame);
          presentations.renderTransition(index, nextTransition);
        }
        staged = undefined;
        presentations.show(index);
        current = index;
        shell.setPresentation(chapter.presentation ?? 'explanation');
        shell.stage.removeAttribute('aria-busy');
        latest = moment.frame;
        shell.showParameters([
          'chapter',
          'sceneTime',
          ...(chapter.controls ?? (options.parameters ?? []).map((p) => p.key)),
        ]);
        // A covered page is still rendered for the transition, but cannot receive input or focus.
        presentation.element.inert = Boolean(
          options.transition && (nextTransition.open < 1 || nextTransition.progress < 1),
        );
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
    shell.attachView(view.owner);
    await story.ready();
    return { shell, story, scene };
  } catch (error) {
    shell.dispose();
    throw error;
  }
}
export const SceneStory = { mount };
