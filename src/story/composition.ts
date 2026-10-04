import { SceneShell, type SceneOptions } from '../scene.js';
import { theme, type Theme } from '../ink/palette.js';
import type { ControlValue } from '../controls/fields.js';
import { activeCue, type Script } from './cues.js';
import { composeChapters, chapterTime, type ChapterTiming } from './composition-plan.js';
import { chapterPreviews, type MountedChapter } from './composition-previews.js';
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
  capture?(): Promise<HTMLCanvasElement> | HTMLCanvasElement;
  reset?(): void;
  focus?(ids: readonly string[]): void;
  dispose(): void;
}
export interface SceneChapter extends ChapterTiming {
  controls?: readonly string[];
  valuesAt?(frame: ChapterFrame): Record<string, ControlValue>;
  mount(parent: HTMLElement): ChapterPresentation | Promise<ChapterPresentation>;
}
export interface ChapterTransition {
  introduction: number;
  duration: number;
  mount(
    parent: HTMLElement,
    previews: readonly { start?: HTMLCanvasElement; end?: HTMLCanvasElement }[],
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
      label: 'Пример',
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
  const mounted: MountedChapter[] = [];
  let current = 0,
    latest: ChapterFrame | undefined;
  try {
    for (const chapter of options.chapters) {
      const element = document.createElement('div');
      element.dataset.chapter = chapter.id;
      Object.assign(element.style, { position: 'absolute', inset: '0' });
      shell.stage.append(element);
      const drawing = await chapter.mount(element);
      mounted.push({ element, drawing });
      shell.onDispose(() => {
        drawing.dispose();
        element.remove();
      });
      element.hidden = true;
    }
    let story: Story<Record<string, ControlValue>> | undefined;
    let transition: ReturnType<ChapterTransition['mount']> | undefined;
    let transitionState: Parameters<NonNullable<typeof transition>['render']>[0] | undefined;
    const previews = options.transition
      ? chapterPreviews(
          options.chapters,
          mounted,
          shell.stage,
          defaults,
          () => story?.update(),
          () => {
            if (transitionState) transition?.render(transitionState);
          },
        )
      : undefined;
    if (previews) {
      shell.onDispose(previews.dispose);
      await previews.refresh();
    }
    transition = options.transition?.mount(shell.stage, previews!.images);
    if (transition) shell.onDispose(transition.dispose);
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
        frame: {
          time: progress * timing.seconds,
          progress,
          reduced,
          mode: 'story' as const,
          values: defaults,
          beat: activeCue(options.chapters[index]!.script, progress * timing.seconds),
        },
      };
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
      render(values, frame, mode) {
        const state = at(frame.time, frame.reduced);
        const index =
          mode === 'explore'
            ? options.chapters.findIndex((c) => c.id === values.chapter)
            : state.index;
        if (index < 0) throw new Error(`Unknown chapter: ${values.chapter}`);
        const chapter = options.chapters[index]!,
          progress = mode === 'explore' ? Number(values.sceneTime) : state.frame.progress;
        if (!Number.isFinite(progress) || progress < 0 || progress > 1)
          throw new Error('Chapter progress must be between zero and one');
        if (index !== current) mounted[current]!.element.hidden = true;
        current = index;
        const presentation = mounted[index]!;
        presentation.element.hidden = false;
        latest = {
          ...state.frame,
          progress,
          time: progress * chapter.seconds,
          mode,
          values,
          beat: activeCue(chapter.script, progress * chapter.seconds),
          input: (changes) => story!.explore({ ...story!.values, ...changes }),
        };
        presentation.drawing.render(latest);
        if (parent.scene) {
          if (presentation.drawing.focus) parent.scene.focus = presentation.drawing.focus;
          else delete parent.scene.focus;
        }
        shell.showParameters([
          'chapter',
          'sceneTime',
          ...(chapter.controls ?? (options.parameters ?? []).map((p) => p.key)),
        ]);
        transitionState = {
          chapter: index,
          time: frame.time,
          open:
            mode === 'explore' || frame.reduced
              ? 1
              : Math.min(1, frame.time / Math.max(0.001, plan.introduction)),
          progress:
            mode === 'explore' || frame.reduced || index === 0
              ? 1
              : Math.max(
                  0,
                  Math.min(1, (frame.time - state.timing.start) / Math.max(0.001, plan.transition)),
                ),
          reduced: frame.reduced,
        };
        transition?.render(transitionState);
        for (const id of Object.keys(plan.script.cues))
          if (id === chapter.id || id.startsWith(chapter.id + '.')) {
            frame.has(id);
            frame.target(id, chapter.id);
          }
      },
    });
    const scene = parent.scene!;
    if (mounted[current]!.drawing.focus) scene.focus = mounted[current]!.drawing.focus;
    scene.snapshot = () => ({
      chapter: options.chapters[current]!.id,
      frame: latest && {
        time: latest.time,
        progress: latest.progress,
        reduced: latest.reduced,
        mode: latest.mode,
        values: latest.values,
        beat: latest.beat,
      },
      content: mounted[current]!.drawing.snapshot?.(),
    });
    scene.checkpoints = [
      ...new Set([
        0,
        ...Object.values(plan.script.cues).flatMap((c) => [c.start, (c.start + c.end) / 2, c.end]),
      ]),
    ].sort((a, b) => a - b);
    scene.setTheme = (value) => {
      colors.set(value);
      story!.update();
      return previews?.refresh();
    };
    if (previews) {
      const refresh = () => {
        try {
          void previews.refresh().catch((error) => {
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
      resize.observe(shell.stage);
      shell.onDispose(() => {
        observer.disconnect();
        resize.disconnect();
      });
    }
    shell.attachView({ reset: () => mounted[current]!.drawing.reset?.(), dispose() {} });
    return { shell, story, scene, presentations: mounted.map((m) => m.drawing) };
  } catch (error) {
    shell.dispose();
    throw error;
  }
}
export const SceneStory = { mount };
