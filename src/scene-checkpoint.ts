import type { SceneHandle } from './scene-handle.js';
import type { ControlValue } from './controls/fields.js';

/** A portable position in a scene; playback remains owned by the mounted runtime. */
export interface SceneCheckpoint {
  time: number;
  cue?: string;
  chapter?: string;
  /** Original order lets a revised story find a surviving neighbour by identity. */
  chapters?: readonly string[];
  progress: number;
  mode: 'story' | 'explore';
  muted?: boolean;
  rate?: number;
  selected?: readonly string[];
  values: Record<string, ControlValue>;
  view?: unknown;
}

export interface SceneView {
  readonly transition?: 'running' | 'idle';
  validateFocus?(ids: readonly string[]): void;
  focus?(ids: readonly string[]): void;
  reset(options?: { animate?: boolean; from?: unknown }): void;
  dispose(): void;
  capture?(): unknown;
  restore?(state: unknown): void | boolean;
}

export interface SceneRestoreNotice {
  code: 'cue-missing' | 'objects-missing' | 'parameters-changed' | 'view-incompatible';
  message: string;
  ids?: string[];
  chapter?: string;
}

function chapterAt(review: ReturnType<SceneHandle['review']>, time: number) {
  return [...review.segments].sort((a, b) => a.start - b.start).findLast((c) => c.start <= time);
}

function nearestChapter(review: ReturnType<SceneHandle['review']>, state: SceneCheckpoint) {
  const order = state.chapters ?? [];
  const origin = order.indexOf(state.chapter ?? '');
  const time = Math.min(review.duration, Math.max(0, state.time));
  return (
    review.segments.find((c) => c.id === state.chapter) ??
    (origin >= 0
      ? review.segments
          .filter((c) => order.includes(c.id))
          .sort(
            (a, b) =>
              Math.abs(order.indexOf(a.id) - origin) - Math.abs(order.indexOf(b.id) - origin) ||
              order.indexOf(a.id) - order.indexOf(b.id),
          )[0]
      : undefined) ??
    [...review.segments].sort((a, b) => Math.abs(a.start - time) - Math.abs(b.start - time))[0]
  );
}

export function captureScene(handle: SceneHandle, view?: SceneView): SceneCheckpoint {
  const state = handle.inspect({ presentation: false });
  const cue = state.review.cues
    .filter(
      (c) =>
        c.start <= state.time &&
        c.end > c.start &&
        (state.time < c.end || (state.time === state.duration && c.end === state.duration)),
    )
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  return {
    time: state.time,
    cue: cue?.id,
    chapter: chapterAt(state.review, state.time)?.id,
    chapters: state.review.segments.map((chapter) => chapter.id),
    progress: cue ? (state.time - cue.start) / (cue.end - cue.start) : 0,
    mode: state.mode,
    muted: state.muted,
    rate: state.rate,
    selected: state.selected,
    values: Object.fromEntries(
      state.parameters.filter((p) => !p.disabled).map((p) => [p.key, p.value]),
    ),
    view: view?.capture?.(),
  };
}

/** Restore through the same validated controls as human and agent input. */
export async function restoreScene(handle: SceneHandle, state: SceneCheckpoint, view?: SceneView) {
  if (!state || !Number.isFinite(state.time) || !Number.isFinite(state.progress))
    throw new Error('Invalid scene checkpoint');
  const capabilities = handle.inspect({ presentation: false }).capabilities;
  const notices: SceneRestoreNotice[] = [];
  const review = handle.review();
  if (state.muted !== undefined && capabilities.includes('mute'))
    await handle.control([{ type: 'mute', value: state.muted }]);
  if (state.rate !== undefined && capabilities.includes('rate'))
    await handle.control([{ type: 'rate', value: state.rate }]);
  if (capabilities.includes('pause')) await handle.control([{ type: 'pause' }]);
  if (state.cue && capabilities.includes('cue') && review.cues.some((c) => c.id === state.cue))
    await handle.control([
      { type: 'cue', id: state.cue, progress: Math.min(1, Math.max(0, state.progress)) },
    ]);
  else if (capabilities.includes('seek')) {
    let time = Math.min(handle.duration ?? 0, Math.max(0, state.time));
    if (state.cue) {
      const chapter = nearestChapter(review, state);
      time = chapter?.start ?? 0;
      notices.push({
        code: 'cue-missing',
        chapter: chapter?.id,
        ids: [state.cue],
        message: chapter
          ? `Момент изменился. Открыто начало главы «${chapter.title ?? chapter.id}».`
          : 'Момент изменился. Рассказ открыт с начала.',
      });
    }
    await handle.control([{ type: 'seek', time }]);
  }
  async function restoreConditions() {
    if (capabilities.includes('mode')) await handle.control([{ type: 'mode', value: state.mode }]);
    if (state.mode !== 'explore' || !capabilities.includes('parameters')) return [];
    const pending = new Map(Object.entries(state.values ?? {}));
    // A chapter selector can change the bounds and availability of the next field.
    while (pending.size) {
      const parameter = handle.inspect().parameters.find((p) => {
        const value = pending.get(p.key);
        return (
          pending.has(p.key) &&
          !p.disabled &&
          typeof p.value === typeof value &&
          (typeof value !== 'number' ||
            (Number.isFinite(value) &&
              value >= (p.min ?? -Infinity) &&
              value <= (p.max ?? Infinity))) &&
          (!p.options || p.options.some((o) => o.value === value))
        );
      });
      if (!parameter) break;
      const value = pending.get(parameter.key)!;
      pending.delete(parameter.key);
      await handle.control([{ type: 'parameters', values: { [parameter.key]: value } }]);
    }
    return [...pending.keys()];
  }
  let changedParameters = await restoreConditions();
  // A subject may appear only after its chapter and experimental conditions are restored.
  const known = new Set(handle.objects?.().map((o) => o.id));
  const missing = state.selected?.filter((id) => !known.has(id)) ?? [];
  let chapter;
  if (missing.length && capabilities.includes('seek')) {
    chapter = nearestChapter(review, state);
    const time = chapter?.start ?? 0;
    if (handle.currentTime !== time) {
      await handle.control([{ type: 'seek', time }]);
      // Seeking restores authored values; retain the compatible experiment at the new position.
      changedParameters = await restoreConditions();
    }
  }
  if (changedParameters.length)
    notices.push({
      code: 'parameters-changed',
      ids: changedParameters,
      message: 'Часть условий изменилась. Для них сохранены значения новой сцены.',
    });
  if (state.view !== undefined && (!view?.restore || view.restore(state.view) === false)) {
    view?.reset();
    notices.push({
      code: 'view-incompatible',
      message: 'Вид сцены изменился. Восстановлен авторский ракурс.',
    });
  }
  if (missing.length)
    notices.push({
      code: 'objects-missing',
      ids: missing,
      chapter: chapter?.id,
      message: chapter
        ? `Выбранные объекты изменились. Открыто начало главы «${chapter.title ?? chapter.id}».`
        : capabilities.includes('seek')
          ? 'Выбранные объекты изменились. Рассказ открыт с начала.'
          : 'Выбранные объекты изменились. Недоступные выделения сняты.',
    });
  if (state.selected && handle.inspect({ presentation: false }).capabilities.includes('select'))
    await handle.control([
      {
        type: 'select',
        ids: state.selected.filter((id) => handle.objects?.().some((o) => o.id === id)),
      },
    ]);
  return { ...handle.inspect(), restoreNotices: notices };
}
