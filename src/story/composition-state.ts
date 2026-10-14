import type { ControlValue } from '../controls/fields.js';
import { activeCue, type Frame } from './cues.js';
import type { ChapterFrame, SceneStoryOptions } from './composition.js';
import { composeChapters, chapterTime, chapterPosition } from './composition-plan.js';

/** One composition projection resolves chapter position, shared inputs and pure subject state. */
export function compositionFrames(
  options: SceneStoryOptions,
  plan: ReturnType<typeof composeChapters>,
  defaults: Record<string, ControlValue>,
  input: ChapterFrame['input'],
) {
  const localFrame = (index: number, progress: number, reduced: boolean): ChapterFrame => {
    const chapter = options.chapters[index]!;
    return {
      chapter: chapter.id,
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
  return {
    stateAt(frame: Frame) {
      const state = at(frame.time, frame.reduced),
        chapter = options.chapters[state.index]!;
      return {
        ...defaults,
        ...chapter.valuesAt?.(state.frame),
        chapter: chapter.id,
        sceneTime: state.frame.progress,
      };
    },
    derive(values: Record<string, ControlValue>, frame: Frame, mode: 'story' | 'explore') {
      const selected = selection(values, frame, mode);
      const local: ChapterFrame = {
        chapter: selected.chapter.id,
        time: selected.progress * selected.chapter.seconds,
        progress: selected.progress,
        reduced: frame.reduced,
        mode,
        values,
        beat: activeCue(selected.chapter.script, selected.progress * selected.chapter.seconds),
        input,
      };
      local.subject = options.subjectAt?.(local);
      return { values, selected, frame: local };
    },
    resolveInput(
      patch: Partial<Record<string, ControlValue>>,
      current: { values: Record<string, ControlValue>; time: number },
      frame: Frame,
    ) {
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
      if (changed)
        for (const key of options.sharedControls ?? [])
          if (Object.hasOwn(current.values, key)) authored[key] = current.values[key]!;
      return {
        values: { ...authored, ...patch, chapter: chapter.id, sceneTime: progress },
        time:
          changed || patch.sceneTime !== undefined
            ? chapterPosition(plan.timings[index]!, progress * chapter.seconds)
            : current.time,
      };
    },
  };
}

export type ComposedMoment = ReturnType<ReturnType<typeof compositionFrames>['derive']>;
