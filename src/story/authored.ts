import { divisionState } from '../math/division.js';
import type { Beat as CharacterBeat } from '../characters/types.js';
import type { CueTiming } from './cues.js';

/** Model inputs are authored data; drawings and staging never own their numerical result. */
export interface StoryModel {
  id: string;
  kind: 'division';
  inputs: { count: number; divisor: number };
}
export interface StoryView {
  id: string;
  kind: 'groups' | 'equation';
  model: string;
}
export interface BeatStaging {
  model: string;
  operation?: 'gather' | 'group' | 'remainder';
  focus?: ('groups' | 'remainder' | 'equation')[];
}
/** One beat owns its wording and timing; staging refers to an existing subject. */
export interface AuthoredBeat extends Pick<CharacterBeat, 'actors' | 'props' | 'perform' | 'shot'> {
  id: string;
  text?: string;
  title?: string;
  seconds?: number;
  /** An empty string explicitly keeps a beat silent. */
  say?: string;
  /** Review descriptions, not executable instructions. */
  action?: string;
  hold?: string;
  timing?: CueTiming;
  staging?: BeatStaging;
}
export interface AuthoredChapter {
  id: string;
  title: string;
  beats: readonly AuthoredBeat[];
}
export interface StoryDocument {
  version: 1;
  title?: string;
  models: readonly StoryModel[];
  views: readonly StoryView[];
  /** An empty sequence is a static model, with no transport or invented duration. */
  chapters: readonly AuthoredChapter[];
  narration?: {
    voice?: Record<string, unknown>;
    intro?: number;
    outro?: number;
    pause?: number;
    music?: unknown;
    captionAliases?: Record<string, string>;
  };
}
export type StoryOperation =
  | { op: 'set-inputs'; modelId: string; values: { count?: number; divisor?: number } }
  | { op: 'set-views'; views: StoryView[] }
  | { op: 'set-chapters'; chapters: AuthoredChapter[] };

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path}: expected an object.`);
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: readonly string[], path: string) => {
  const key = Object.keys(value).find((key) => !allowed.includes(key));
  if (key) throw new Error(`${path}.${key}: unknown field.`);
};
const id = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(value))
    throw new Error(`${path}: use a stable ID starting with a lowercase letter.`);
  return value;
};
const wording = (value: unknown, path: string, maximum = 20000): string => {
  if (typeof value !== 'string' || value.length > maximum)
    throw new Error(`${path}: expected text of at most ${maximum} characters.`);
  return value;
};
const positive = (value: unknown, path: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new Error(`${path}: expected a positive finite duration.`);
  return value;
};
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}: supply a complete list.`);
  return value;
}
function parseInputs(value: unknown, path: string): StoryModel['inputs'] {
  const inputs = record(value, path);
  keys(inputs, ['count', 'divisor'], path);
  for (const key of ['count', 'divisor'] as const)
    if (!Number.isSafeInteger(inputs[key]) || Number(inputs[key]) < (key === 'count' ? 0 : 1))
      throw new Error(
        `${path}.${key}: expected a safe integer of at least ${key === 'count' ? 0 : 1}.`,
      );
  const state = divisionState(inputs.count as number, inputs.divisor as number);
  return { count: state.count, divisor: state.divisor };
}
function parseViews(value: unknown): StoryView[] {
  return list(value, 'views').map((raw, index) => {
    const path = `views[${index}]`,
      view = record(raw, path);
    keys(view, ['id', 'kind', 'model'], path);
    if (view.kind !== 'groups' && view.kind !== 'equation')
      throw new Error(`${path}.kind: expected groups or equation.`);
    return {
      id: id(view.id, `${path}.id`),
      kind: view.kind,
      model: id(view.model, `${path}.model`),
    };
  });
}
function parseChapters(value: unknown): AuthoredChapter[] {
  return list(value, 'chapters').map((raw, index) => {
    const path = `chapters[${index}]`,
      chapter = record(raw, path);
    keys(chapter, ['id', 'title', 'beats'], path);
    const title = wording(chapter.title, `${path}.title`, 160);
    if (!title.trim()) throw new Error(`${path}.title: supply a title.`);
    const beats = list(chapter.beats, `${path}.beats`).map((raw, index) => {
      const at = `${path}.beats[${index}]`,
        beat = record(raw, at);
      keys(
        beat,
        [
          'id',
          'text',
          'title',
          'seconds',
          'say',
          'action',
          'hold',
          'timing',
          'staging',
          'actors',
          'props',
          'perform',
          'shot',
        ],
        at,
      );
      const result = structuredClone(beat) as unknown as AuthoredBeat;
      result.id = id(beat.id, `${at}.id`);
      for (const key of ['text', 'say', 'title', 'action', 'hold'] as const)
        if (beat[key] !== undefined) result[key] = wording(beat[key], `${at}.${key}`);
      if (beat.action !== undefined && beat.hold !== undefined)
        throw new Error(`${at}: provide either a non-empty action or hold.`);
      for (const key of ['action', 'hold'] as const)
        if (result[key] !== undefined && !result[key]!.trim())
          throw new Error(`${at}.${key}: supply a non-empty description.`);
      if (beat.seconds !== undefined) result.seconds = positive(beat.seconds, `${at}.seconds`);
      if (beat.timing !== undefined) {
        const timing = record(beat.timing, `${at}.timing`);
        keys(timing, ['duration', 'until', 'delay'], `${at}.timing`);
        if ('duration' in timing === 'until' in timing)
          throw new Error(`${at}.timing: provide duration or until.`);
        if (timing.duration !== undefined) positive(timing.duration, `${at}.timing.duration`);
        if (timing.until !== undefined) id(timing.until, `${at}.timing.until`);
        if (
          timing.delay !== undefined &&
          (typeof timing.delay !== 'number' || !Number.isFinite(timing.delay) || timing.delay < 0)
        )
          throw new Error(`${at}.timing.delay: expected a non-negative finite duration.`);
      }
      if (beat.staging !== undefined) {
        const stage = record(beat.staging, `${at}.staging`);
        keys(stage, ['model', 'operation', 'focus'], `${at}.staging`);
        const model = id(stage.model, `${at}.staging.model`);
        if (
          stage.operation !== undefined &&
          !['gather', 'group', 'remainder'].includes(stage.operation as string)
        )
          throw new Error(`${at}.staging.operation: expected gather, group or remainder.`);
        if (
          stage.focus !== undefined &&
          (!Array.isArray(stage.focus) ||
            !stage.focus.length ||
            new Set(stage.focus).size !== stage.focus.length ||
            stage.focus.some((target) => !['groups', 'remainder', 'equation'].includes(target)))
        )
          throw new Error(`${at}.staging.focus: choose groups, remainder or equation.`);
        if (stage.operation === undefined && stage.focus === undefined)
          throw new Error(`${at}.staging: supply an operation or focus.`);
        result.staging = {
          model,
          ...(stage.operation !== undefined && {
            operation: stage.operation as BeatStaging['operation'],
          }),
          ...(stage.focus !== undefined && {
            focus: [...(stage.focus as NonNullable<BeatStaging['focus']>)],
          }),
        };
      }
      return result;
    });
    if (!beats.length) throw new Error(`${path}.beats: supply at least one beat.`);
    return { id: id(chapter.id, `${path}.id`), title, beats };
  });
}

/** Strict canonical input. Legacy files belong only to the explicit project migration. */
export function validateStoryDocument(value: unknown): StoryDocument {
  const source = record(value, 'story');
  keys(source, ['version', 'title', 'models', 'views', 'chapters', 'narration'], 'story');
  if (source.version !== 1) throw new Error('story.version: expected 1.');
  const models = list(source.models, 'models').map((raw, index): StoryModel => {
    const path = `models[${index}]`,
      model = record(raw, path);
    keys(model, ['id', 'kind', 'inputs'], path);
    if (model.kind !== 'division') throw new Error(`${path}.kind: expected division.`);
    return {
      id: id(model.id, `${path}.id`),
      kind: 'division',
      inputs: parseInputs(model.inputs, `${path}.inputs`),
    };
  });
  if (models.length > 1)
    throw new Error('models: this release prepares one division subject per document.');
  const views = parseViews(source.views),
    chapters = parseChapters(source.chapters);
  if (!models.length && !chapters.length)
    throw new Error('A story needs a visible model or authored chapters.');
  const ids = new Set<string>();
  const unique = (value: string) => {
    if (ids.has(value)) throw new Error(`Duplicate ID: ${value}`);
    ids.add(value);
  };
  for (const model of models) unique(model.id);
  for (const view of views) {
    unique(view.id);
    if (!models.some((model) => model.id === view.model))
      throw new Error(`View ${view.id}: unknown model ${view.model}.`);
  }
  for (const model of models) {
    const selected = views.filter((view) => view.model === model.id);
    if (
      !selected.some((view) => view.kind === 'groups') ||
      new Set(selected.map((view) => view.kind)).size !== selected.length
    )
      throw new Error(
        `Model ${model.id}: require one groups view, without duplicated representations.`,
      );
    if (model.inputs.count > 36 || model.inputs.divisor > 12)
      throw new Error('groups: this drawing supports count ≤ 36 and divisor ≤ 12.');
  }
  const cueIds = new Set<string>();
  const grouped = new Set<string>();
  for (const chapter of chapters) {
    if (cueIds.has(chapter.id)) throw new Error(`Invalid chapter: duplicate ID ${chapter.id}`);
    cueIds.add(chapter.id);
    for (const beat of chapter.beats) {
      const cue = `${chapter.id}.${beat.id}`;
      if (cueIds.has(cue)) throw new Error(`Beat ${cue}: duplicate ID`);
      cueIds.add(cue);
      const stage = beat.staging;
      if (!stage) continue;
      if (!models.some((model) => model.id === stage.model))
        throw new Error(`Beat ${cue}: unknown model ${stage.model}.`);
      if (stage.operation === 'remainder' && !grouped.has(stage.model))
        throw new Error(`Beat ${cue}: group the objects before naming the remainder.`);
      if (stage.operation === 'gather') grouped.delete(stage.model);
      if (stage.operation === 'group') grouped.add(stage.model);
      if (
        stage.focus?.includes('equation') &&
        !views.some((view) => view.model === stage.model && view.kind === 'equation')
      )
        throw new Error(`Beat ${cue}: the equation view is absent.`);
      if (beat.text !== undefined) wording(beat.text, `Beat ${cue}.text`, 90);
      if (beat.seconds !== undefined && (beat.seconds < 0.2 || beat.seconds > 30))
        throw new Error(`Beat ${cue}.seconds: choose 0.2–30 seconds.`);
    }
  }
  for (const chapter of chapters)
    for (const beat of chapter.beats) {
      if (!beat.timing?.until) continue;
      const target = chapter.beats.some((other) => other.id === beat.timing!.until)
        ? `${chapter.id}.${beat.timing.until}`
        : beat.timing.until;
      if (!cueIds.has(target) || target === `${chapter.id}.${beat.id}`)
        throw new Error(
          `Beat ${chapter.id}.${beat.id}: unknown or self-referencing timing target ${target}.`,
        );
    }
  if (source.narration !== undefined) {
    const narration = record(source.narration, 'narration');
    keys(narration, ['voice', 'intro', 'outro', 'pause', 'music', 'captionAliases'], 'narration');
    for (const key of ['intro', 'outro', 'pause'] as const)
      if (
        narration[key] !== undefined &&
        (typeof narration[key] !== 'number' ||
          !Number.isFinite(narration[key]) ||
          narration[key] < 0)
      )
        throw new Error(`narration.${key}: expected a non-negative duration.`);
  }
  return {
    version: 1,
    ...(source.title !== undefined && { title: wording(source.title, 'title', 160) }),
    models,
    views,
    chapters,
    ...(source.narration !== undefined && {
      narration: structuredClone(source.narration) as StoryDocument['narration'],
    }),
  };
}

/** Short author input is normalized once at creation; persisted documents are always canonical. */
export function normalizeStoryDocument(value: unknown): StoryDocument {
  const source = record(value, 'story');
  if ('version' in source || 'models' in source) return validateStoryDocument(source);
  keys(source, ['model', 'title', 'chapters'], 'story');
  const model = record(source.model, 'model');
  keys(model, ['id', 'kind', 'count', 'divisor'], 'model');
  if (model.kind !== 'division') throw new Error('model.kind: expected division.');
  const modelId = model.id === undefined ? 'division' : id(model.id, 'model.id');
  const inputs = parseInputs({ count: model.count, divisor: model.divisor }, 'model');
  const views = (['groups', 'equation'] as const).map((kind) => ({
    id: modelId === kind ? `${kind}.view` : kind,
    kind,
    model: modelId,
  }));
  const chapters =
    source.chapters === undefined
      ? [
          {
            id: modelId,
            title: 'Деление с остатком',
            beats: [
              {
                id: 'gather',
                say: '',
                seconds: 1.2,
                staging: { model: modelId, operation: 'gather' },
              },
              { id: 'group', say: '', seconds: 4, staging: { model: modelId, operation: 'group' } },
              {
                id: 'remainder',
                say: '',
                seconds: 2.8,
                staging: { model: modelId, operation: 'remainder', focus: ['remainder'] },
              },
            ],
          },
        ]
      : source.chapters;
  return validateStoryDocument({
    version: 1,
    ...(source.title !== undefined && { title: source.title }),
    models: [{ id: modelId, kind: 'division', inputs }],
    views,
    chapters,
  });
}

/** Validate each edit and publish cross-references only after the complete atomic batch. */
export function editStoryDocument(document: unknown, operations: unknown): StoryDocument {
  let next = validateStoryDocument(document);
  if (!Array.isArray(operations) || !operations.length || operations.length > 16)
    throw new Error('operations: use 1–16 complete changes.');
  for (const [index, raw] of operations.entries()) {
    const path = `operations[${index}]`,
      operation = record(raw, path);
    if (operation.op === 'set-inputs') {
      keys(operation, ['op', 'modelId', 'values'], path);
      const model = next.models.find((model) => model.id === operation.modelId);
      if (!model) throw new Error(`${path}.modelId: unknown model.`);
      const patch = record(operation.values, `${path}.values`);
      keys(patch, ['count', 'divisor'], `${path}.values`);
      if (!Object.keys(patch).length) throw new Error(`${path}.values: supply an input.`);
      const inputs = parseInputs({ ...model.inputs, ...patch }, `${path}.values`);
      if (inputs.count > 36 || inputs.divisor > 12)
        throw new Error('groups: this drawing supports count ≤ 36 and divisor ≤ 12.');
      next = {
        ...next,
        models: next.models.map((current) => (current === model ? { ...model, inputs } : current)),
      };
    } else if (operation.op === 'set-views') {
      keys(operation, ['op', 'views'], path);
      next = { ...next, views: parseViews(operation.views) };
    } else if (operation.op === 'set-chapters') {
      keys(operation, ['op', 'chapters'], path);
      next = { ...next, chapters: parseChapters(operation.chapters) };
    } else throw new Error(`${path}.op: unknown operation.`);
  }
  return validateStoryDocument(next);
}
