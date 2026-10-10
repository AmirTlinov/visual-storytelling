import type { SceneHandle } from './scene-handle.js';
import type { ControlParameter, ControlValue } from './controls/fields.js';
import type { SceneAccessOwner } from './scene-access.js';

export interface SceneCaptureOptions {
  /** Presented is the visible frame; requested records accepted conditions while loading. */
  basis?: 'presented' | 'requested';
}
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
  /** Opaque subject inputs when standard parameters cannot express the experiment. */
  subject?: unknown;
  view?: unknown;
}

/** The model owner restores its inputs and position together, before publishing a frame. */
export interface SceneSubject {
  capture(options: SceneCaptureOptions): unknown;
  /** Accept inputs synchronously. A returned promise may wait for preparation, never defer acceptance. */
  restore(
    value: unknown,
    position: { time: number; mode: 'story' | 'explore' },
  ): void | Promise<void>;
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
  code:
    | 'cue-missing'
    | 'objects-missing'
    | 'parameters-changed'
    | 'subject-incompatible'
    | 'view-incompatible';
  message: string;
  ids?: string[];
  chapter?: string;
}

function copySubject(value: unknown, parents = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  // An embedded SVG owns another realm's Object.prototype. Accept its plain JSON objects.
  const plain =
    prototype === null ||
    (Object.getPrototypeOf(prototype) === null &&
      typeof constructor === 'function' &&
      Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object));
  if (
    typeof value !== 'object' ||
    !value ||
    parents.has(value) ||
    (!Array.isArray(value) && !plain)
  )
    throw new Error('A scene subject checkpoint must contain finite JSON values.');
  parents.add(value);
  try {
    return Array.isArray(value)
      ? Array.from(value, (item) => copySubject(item, parents))
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, copySubject(item, parents)]),
        );
  } finally {
    parents.delete(value);
  }
}

function chapterAt(review: ReturnType<SceneHandle['review']>, time: number) {
  return [...review.segments].sort((a, b) => a.start - b.start).findLast((c) => c.start <= time);
}

function compatible(parameter: ControlParameter, value: ControlValue | undefined) {
  return (
    typeof parameter.value === typeof value &&
    (typeof value !== 'number' ||
      (Number.isFinite(value) &&
        value >= (parameter.min ?? -Infinity) &&
        value <= (parameter.max ?? Infinity))) &&
    (!parameter.options || parameter.options.some((option) => option.value === value))
  );
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

export function captureScene(
  handle: SceneHandle,
  view?: SceneView,
  { basis = 'presented' }: SceneCaptureOptions = {},
): SceneCheckpoint {
  if (basis !== 'presented' && basis !== 'requested')
    throw new Error('Unknown scene capture basis');
  const state = handle.inspect({ presentation: false });
  const moment = state.rendering?.[basis];
  if (state.rendering && !moment)
    throw Object.assign(
      new Error('The scene has no completed frame to capture. Await scene.ready().'),
      {
        code: 'scene_not_presented',
      },
    );
  const time = moment?.time ?? state.time;
  const mode = moment?.mode ?? state.mode;
  const visible = !state.rendering || basis === 'presented' || state.rendering.phase === 'ready';
  const chapter =
    state.review.segments.find((chapter) => chapter.id === moment?.chapter) ??
    chapterAt(state.review, time);
  const atOwnedEnd = moment?.chapter !== undefined && chapter?.end === time;
  const cue = state.review.cues
    .filter(
      (c) =>
        c.start <= time &&
        c.end > c.start &&
        (atOwnedEnd
          ? c.start < time && time <= c.end
          : time < c.end || (time === state.duration && c.end === state.duration)),
    )
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  return {
    time,
    cue: cue?.id,
    chapter: chapter?.id,
    chapters: state.review.segments.map((chapter) => chapter.id),
    progress: cue ? (time - cue.start) / (cue.end - cue.start) : 0,
    mode,
    muted: state.muted,
    rate: state.rate,
    selected: visible ? state.selected : undefined,
    values: Object.fromEntries(
      state.parameters.map((p) => [p.key, moment?.values[p.key] ?? p.value]),
    ),
    subject:
      mode === 'explore' && handle.subject
        ? copySubject(handle.subject.capture({ basis }))
        : undefined,
    view: visible ? view?.capture?.() : undefined,
  };
}

/** Restore compatible inputs through their owner; temporary UI locks do not erase a condition. */
export async function restoreScene(
  handle: SceneHandle,
  state: SceneCheckpoint,
  view?: SceneView,
  owner?: SceneAccessOwner,
) {
  if (
    !state ||
    !Number.isFinite(state.time) ||
    !Number.isFinite(state.progress) ||
    !['story', 'explore'].includes(state.mode)
  )
    throw new Error('Invalid scene checkpoint');
  const capabilities = handle.inspect({ presentation: false }).capabilities;
  // Story's immutable request includes opaque subject inputs that flat controls cannot expose.
  const condition = () => handle.condition ?? JSON.stringify(handle.rendering?.requested);
  let acceptedCondition = condition();
  const assertCurrent = () => {
    owner?.assertLive();
    if (acceptedCondition !== condition())
      throw Object.assign(new Error('Scene restoration was superseded by a newer condition.'), {
        code: 'scene_restore_superseded',
      });
  };
  const complete = async (work?: void | Promise<unknown>) => {
    // Every owner accepts synchronously; readiness must not adopt a later user's input.
    acceptedCondition = condition();
    try {
      await work;
      assertCurrent();
      await handle.ready?.();
    } finally {
      assertCurrent();
    }
  };
  const notices: SceneRestoreNotice[] = [];
  const review = handle.review();
  const subject =
    state.mode === 'explore' && state.subject !== undefined ? handle.subject : undefined;
  if (state.subject !== undefined && !subject)
    notices.push({
      code: 'subject-incompatible',
      message: 'Предметные условия изменились. Сохранены условия новой сцены.',
    });
  async function restorePlayback() {
    assertCurrent();
    if (state.muted !== undefined && state.muted !== handle.muted && capabilities.includes('mute'))
      await complete(handle.control([{ type: 'mute', value: state.muted }]));
    if (state.rate !== undefined && state.rate !== handle.rate && capabilities.includes('rate'))
      await complete(handle.control([{ type: 'rate', value: state.rate }]));
    if (capabilities.includes('pause')) handle.pause!();
  }
  // Stop playback without waiting for the preparation this restoration will replace.
  if (!subject && !owner?.restoreValues && capabilities.includes('pause')) handle.pause!();
  async function restorePosition(time: number) {
    assertCurrent();
    if (subject) {
      await complete(subject.restore(copySubject(state.subject), { time, mode: state.mode }));
    } else if (capabilities.includes('seek'))
      await complete(handle.control([{ type: 'seek', time }]));
  }
  const cue =
    state.cue && capabilities.includes('cue') && review.cues.find((c) => c.id === state.cue);
  let time = Math.min(handle.duration ?? 0, Math.max(0, state.time));
  if (cue) time = cue.start + (cue.end - cue.start) * Math.min(1, Math.max(0, state.progress));
  else if (subject || capabilities.includes('seek')) {
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
  }
  async function restoreConditions() {
    assertCurrent();
    // A subject codec owns its whole model. Flat controls are only its visible projection.
    if (subject) return [];
    if (capabilities.includes('mode'))
      await complete(handle.control([{ type: 'mode', value: state.mode }]));
    if (state.mode !== 'explore' || !capabilities.includes('parameters')) return [];
    const pending = new Map(Object.entries(state.values ?? {}));
    // A chapter selector can change the bounds and availability of the next field.
    while (pending.size) {
      const parameter = handle.inspect().parameters.find((p) => {
        const value = pending.get(p.key);
        return pending.has(p.key) && (!p.disabled || owner?.setValues) && compatible(p, value);
      });
      if (!parameter) break;
      const value = pending.get(parameter.key)!;
      pending.delete(parameter.key);
      const values = { [parameter.key]: value };
      if (owner?.setValues) await complete(owner.setValues(values, { restoring: true }));
      else await complete(handle.control([{ type: 'parameters', values }]));
    }
    return [...pending.keys()];
  }
  async function restoreStoryInputs() {
    assertCurrent();
    const position = { time, mode: state.mode };
    if (state.mode !== 'explore') {
      await complete(owner!.restoreValues!({}, position));
      return [];
    }
    const chapter =
      review.segments.find((chapter) => chapter.id === state.chapter) ?? chapterAt(review, time);
    // Only the target presentation owns its dynamic descriptions. Enter it before
    // checking saved fields against its bounds, including an owned chapter end.
    if (chapter && chapter.id !== handle.rendering?.presented?.chapter)
      await complete(owner!.restoreValues!({}, { time: chapter.start, mode: 'story' }));
    const pending = new Map(Object.entries(state.values ?? {}));
    let first = true;
    while (first || pending.size) {
      const values: Record<string, ControlValue> = {};
      for (const p of handle.inspect({ presentation: false }).parameters) {
        const value = pending.get(p.key);
        if (pending.has(p.key) && compatible(p, value)) {
          values[p.key] = value!;
          pending.delete(p.key);
        }
      }
      if (!first && !Object.keys(values).length) break;
      assertCurrent();
      await complete(
        first
          ? owner!.restoreValues!(values, position)
          : owner!.setValues!(values, { restoring: true }),
      );
      first = false;
    }
    return [...pending.keys()];
  }
  let changedParameters: string[];
  if (!subject && owner?.restoreValues) changedParameters = await restoreStoryInputs();
  else {
    if (subject || capabilities.includes('seek')) await restorePosition(time);
    changedParameters = await restoreConditions();
  }
  await restorePlayback();
  // A subject may appear only after its chapter and experimental conditions are restored.
  const known = new Set(handle.objects?.().map((o) => o.id));
  const missing = state.selected?.filter((id) => !known.has(id)) ?? [];
  let chapter;
  if (missing.length && capabilities.includes('seek')) {
    chapter = nearestChapter(review, state);
    const time = chapter?.start ?? 0;
    if (handle.currentTime !== time) {
      await restorePosition(time);
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
  assertCurrent();
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
    await complete(
      handle.control([
        {
          type: 'select',
          ids: state.selected.filter((id) => handle.objects?.().some((o) => o.id === id)),
        },
      ]),
    );
  assertCurrent();
  return { ...handle.inspect(), restoreNotices: notices };
}
