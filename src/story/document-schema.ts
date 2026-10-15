import { record, keys, id, text, array, seconds } from './document-fields.js';
import { validateStoryResources, type StoryResource } from './resources.js';
export type { StoryResource } from './resources.js';
import type { CueTiming } from './cues.js';
import type { Beat } from '../characters/types.js';
import { storyModelOwners, storyRecipes } from '../recipes/story-models.js';
import type { StoryModel, StoryModules, StoryView } from './model.js';
import type { SpeechConditions } from './speech-condition.js';
import { authoredSpeech, validateDocumentSpeech } from './document-speech.js';
export type {
  StoryModel,
  StoryModelModule,
  StoryModules,
  StoryView,
  ModelValues,
  ModelState,
} from './model.js';

/** One authored beat owns its action, staging and optional speech. */
export interface AuthoredBeat extends Beat {
  say?: string;
  /** One thought freezes its wording's model applicability; a spoken thought may own a cached take. */
  speech?: { id: string; when: SpeechConditions; seed?: number; delivery?: string };
  timing?: CueTiming;
  /** Name an ordinary registered JS operation; replay always starts from the model inputs. */
  operation?: { model: string; name: string };
  focus?: readonly string[];
  /** Automatic playback waits for the named model's accepted attempt; explicit seek stays available. */
  awaitInput?: { model: string };
}
export interface AuthoredChapter {
  id: string;
  title: string;
  beats: readonly AuthoredBeat[];
  /** Select declared representations while keeping their model and semantic identities. */
  views?: readonly string[];
}
export interface StoryDocument {
  version: 2;
  resources?: readonly StoryResource[];
  title?: string;
  models: readonly StoryModel[];
  views: readonly StoryView[];
  /** Empty means a static experiment, with no narrative clock or playback capabilities. */
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
export type StoryDocumentOperation =
  | { op: 'set-inputs'; modelId: string; values: Record<string, unknown> }
  | { op: 'set-resources'; resources: readonly StoryResource[] }
  | { op: 'set-views'; views: readonly StoryView[] }
  | { op: 'set-chapters'; chapters: readonly AuthoredChapter[] };
export interface StoryDocumentOptions {
  modules?: StoryModules;
}
/** Complete authoring sugar once, then validate the one normalized document. */
export function validateStoryDocument(
  value: unknown,
  options: StoryDocumentOptions = {},
): StoryDocument {
  return validate(value, options, true);
}
function validate(
  value: unknown,
  options: StoryDocumentOptions,
  references: boolean,
): StoryDocument {
  let source = record(value, 'document');
  if (source.recipe !== undefined) {
    const recipe =
      typeof source.recipe === 'string' && Object.hasOwn(storyRecipes, source.recipe)
        ? storyRecipes[source.recipe]
        : undefined;
    if (!recipe) throw new Error('document.recipe: unknown prepared recipe.');
    source = recipe(source) as unknown as Record<string, unknown>;
  }
  keys(
    source,
    ['version', 'title', 'models', 'views', 'chapters', 'narration', 'resources'],
    'document',
  );
  if (source.version !== 2)
    throw new Error('document.version: expected 2; migrate older documents explicitly.');
  const modules = storyModelOwners(options.modules);
  const unique = new Set<string>();
  const identity = (value: unknown, path: string) => {
    const name = id(value, path);
    if (unique.has(name)) throw new Error(`${path}: duplicate ID ${name}.`);
    unique.add(name);
    return name;
  };
  const resources = validateStoryResources(source.resources, identity);
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const models: StoryModel[] = array(
    source.models === undefined ? [] : source.models,
    'models',
  ).map((raw, index) => {
    const path = `models[${index}]`,
      model = record(raw, path);
    keys(model, ['id', 'module', 'inputs', 'resources'], path);
    const refs =
      model.resources === undefined
        ? undefined
        : array(model.resources, `${path}.resources`).map((value) =>
            id(value, `${path}.resources`),
          );
    if (refs && (new Set(refs).size !== refs.length || refs.some((ref) => !resourceIds.has(ref))))
      throw new Error(`${path}.resources: reference a unique declared resource.`);
    const name = text(model.module, `${path}.module`);
    const module = Object.hasOwn(modules, name) ? modules[name] : undefined;
    if (!module) throw new Error(`${path}.module: unregistered model module ${name}.`);
    return {
      id: identity(model.id, `${path}.id`),
      module: name,
      inputs: module.validateInputs(model.inputs),
      ...(refs && { resources: refs }),
    };
  });
  const views: StoryView[] = array(source.views === undefined ? [] : source.views, 'views').map(
    (raw, index) => {
      const path = `views[${index}]`,
        view = record(raw, path);
      keys(view, ['id', 'kind', 'model'], path);
      if (!models.some((model) => model.id === view.model))
        throw new Error(`${path}.model: unknown model.`);
      return {
        id: identity(view.id, `${path}.id`),
        kind: text(view.kind, `${path}.kind`),
        model: view.model as string,
      };
    },
  );
  const targets = new Set<string>();
  for (const model of models) {
    const module = modules[model.module]!;
    const selected = views.filter((view) => view.model === model.id);
    module.validateViews(selected);
    for (const target of module.focusTargets(model, selected)) targets.add(target);
  }
  const chapters: AuthoredChapter[] = array(
    source.chapters === undefined ? [] : source.chapters,
    'chapters',
  ).map((raw, index) => {
    const path = `chapters[${index}]`,
      chapter = record(raw, path);
    keys(chapter, ['id', 'title', 'beats', 'views'], path);
    const chapterId = identity(chapter.id, `${path}.id`);
    const selected =
      chapter.views === undefined
        ? undefined
        : array(chapter.views, `${path}.views`).map((value) => id(value, `${path}.views`));
    if (
      selected &&
      (!selected.length ||
        new Set(selected).size !== selected.length ||
        (references && selected.some((id) => !views.some((view) => view.id === id))))
    )
      throw new Error(`${path}.views: select unique declared views.`);
    if (selected && references)
      for (const model of models) {
        const active = views.filter(
          (view) => view.model === model.id && selected.includes(view.id),
        );
        if (active.length) modules[model.module]!.validateViews(active);
      }
    const chapterTargets = selected
      ? new Set(
          models.flatMap((model) => {
            const active = views.filter(
              (view) => view.model === model.id && selected.includes(view.id),
            );
            return active.length ? modules[model.module]!.focusTargets(model, active) : [];
          }),
        )
      : targets;
    const beats = array(chapter.beats, `${path}.beats`).map((raw, index): AuthoredBeat => {
      const path = `${chapterId}.beats[${index}]`,
        beat = record(raw, path);
      keys(
        beat,
        [
          'id',
          'text',
          'title',
          'seconds',
          'say',
          'speech',
          'action',
          'hold',
          'timing',
          'operation',
          'focus',
          'awaitInput',
          'actors',
          'props',
          'perform',
          'shot',
        ],
        path,
      );
      const beatId = id(beat.id, `${path}.id`);
      identity(`${chapterId}.${beatId}`, `${path}.id`);
      for (const field of ['text', 'title', 'say', 'action', 'hold'])
        if (beat[field] !== undefined)
          text(beat[field], `${path}.${field}`, !['action', 'hold'].includes(field));
      if (beat.action !== undefined && beat.hold !== undefined)
        throw new Error(`${path}: choose action or hold.`);
      if (beat.seconds !== undefined) seconds(beat.seconds, `${path}.seconds`, Number.MIN_VALUE);
      if (beat.timing !== undefined) {
        const timing = record(beat.timing, `${path}.timing`);
        keys(timing, ['duration', 'until', 'delay'], `${path}.timing`);
        if ((timing.duration !== undefined) === (timing.until !== undefined))
          throw new Error(`${path}.timing: choose duration or until.`);
        if (timing.duration !== undefined)
          seconds(timing.duration, `${path}.timing.duration`, Number.MIN_VALUE);
        if (timing.delay !== undefined) seconds(timing.delay, `${path}.timing.delay`);
        if (timing.until !== undefined) id(timing.until, `${path}.timing.until`);
      }
      if (beat.operation !== undefined) {
        const operation = record(beat.operation, `${path}.operation`);
        keys(operation, ['model', 'name'], `${path}.operation`);
        const model = models.find((model) => model.id === operation.model);
        if (!model) throw new Error(`${path}.operation.model: unknown model.`);
        if (
          typeof operation.name !== 'string' ||
          !Object.hasOwn(modules[model.module]!.operations, operation.name)
        )
          throw new Error(`${path}.operation.name: unknown operation ${String(operation.name)}.`);
      }
      if (beat.focus !== undefined)
        for (const target of array(beat.focus, `${path}.focus`))
          if (typeof target !== 'string' || (references && !chapterTargets.has(target)))
            throw new Error(`${path}.focus: unknown target ${String(target)}.`);
      for (const field of ['actors', 'props', 'shot'])
        if (beat[field] !== undefined) record(beat[field], `${path}.${field}`);
      if (beat.perform !== undefined) array(beat.perform, `${path}.perform`);
      const normalized = structuredClone(beat) as unknown as AuthoredBeat;
      if (beat.awaitInput !== undefined) {
        const gate = record(beat.awaitInput, `${path}.awaitInput`);
        keys(gate, ['model'], `${path}.awaitInput`);
        const model = models.find((model) => model.id === gate.model);
        if (!model || !modules[model.module]?.canContinue)
          throw new Error(`${path}.awaitInput: name a model with canContinue.`);
      }
      const speech = authoredSpeech(normalized, chapterId, models, modules, path);
      if (speech) normalized.speech = speech;
      return normalized;
    });
    if (!beats.length) throw new Error(`${path}.beats: provide at least one beat.`);
    return {
      id: chapterId,
      title: text(chapter.title, `${path}.title`),
      beats,
      ...(selected && { views: selected }),
    };
  });
  if (references)
    for (const chapter of chapters)
      for (const [index, beat] of chapter.beats.entries()) {
        const until = beat.timing?.until;
        if (!until) continue;
        const target = chapter.beats.findIndex(
          (candidate) => candidate.id === until || `${chapter.id}.${candidate.id}` === until,
        );
        if (target < 0)
          throw new Error(
            `${chapter.id}.${beat.id}.timing.until: reference a later beat in the same chapter; cross-chapter timing is unsupported (${until}).`,
          );
        if (target <= index)
          throw new Error(
            `${chapter.id}.${beat.id}.timing.until: reference a later beat in the same chapter.`,
          );
      }
  validateDocumentSpeech({ chapters });
  for (const model of models)
    modules[model.module]!.validateSequence?.(
      chapters.flatMap((chapter) =>
        chapter.beats
          .filter((beat) => beat.operation?.model === model.id)
          .map((beat) => beat.operation!.name),
      ),
    );
  if (source.narration !== undefined) {
    const narration = record(source.narration, 'narration');
    keys(narration, ['voice', 'intro', 'outro', 'pause', 'music', 'captionAliases'], 'narration');
    for (const key of ['intro', 'outro', 'pause'])
      if (narration[key] !== undefined) seconds(narration[key], `narration.${key}`);
    if (narration.voice !== undefined) record(narration.voice, 'narration.voice');
    if (narration.captionAliases !== undefined)
      for (const value of Object.values(
        record(narration.captionAliases, 'narration.captionAliases'),
      ))
        text(value, 'narration.captionAliases');
  }
  return {
    version: 2,
    ...(source.title !== undefined && { title: text(source.title, 'title') }),
    models,
    views,
    chapters,
    ...(source.resources !== undefined && { resources }),
    ...(source.narration !== undefined && {
      narration: structuredClone(source.narration) as StoryDocument['narration'],
    }),
  };
}

/** One atomic candidate; references are checked after related lists have been replaced. */
export function editStoryDocument(
  document: unknown,
  operations: unknown,
  options: StoryDocumentOptions = {},
): StoryDocument {
  const initial = validateStoryDocument(document, options);
  let next = structuredClone(initial);
  const changes = array(operations, 'operations');
  if (!changes.length || changes.length > 64)
    throw new Error('operations: use 1–64 complete changes.');
  for (const [index, raw] of changes.entries()) {
    const path = `operations[${index}]`,
      operation = record(raw, path);
    if (operation.op === 'set-inputs') {
      keys(operation, ['op', 'modelId', 'values'], path);
      const model = next.models.find((model) => model.id === operation.modelId);
      if (!model) throw new Error(`${path}.modelId: unknown model.`);
      const values = record(operation.values, `${path}.values`);
      if (!Object.keys(values).length) throw new Error(`${path}.values: supply an input.`);
      model.inputs = storyModelOwners(options.modules)[model.module]!.validateInputs({
        ...model.inputs,
        ...values,
      });
    } else if (operation.op === 'set-resources') {
      keys(operation, ['op', 'resources'], path);
      next = { ...next, resources: validateStoryResources(operation.resources) };
    } else if (operation.op === 'set-views') {
      keys(operation, ['op', 'views'], path);
      const views = array(operation.views, `${path}.views`) as StoryView[];
      validate({ ...next, views, chapters: [] }, options, false);
      next = { ...next, views };
    } else if (operation.op === 'set-chapters') {
      keys(operation, ['op', 'chapters'], path);
      const chapters = array(operation.chapters, `${path}.chapters`) as AuthoredChapter[];
      validate({ ...next, chapters }, options, false);
      next = { ...next, chapters };
    } else throw new Error(`${path}.op: unknown operation.`);
  }
  return validateStoryDocument(next, options);
}

/** The one binding rule shared by authoring delivery and chapter controls. */
export function authoredInputKeys(
  document: Pick<StoryDocument, 'models'>,
  modelId: string,
  values: Record<string, unknown>,
): string[] {
  if (!document.models.some((model) => model.id === modelId))
    throw new Error(`Unknown model: ${modelId}`);
  return Object.keys(values).map((key) =>
    document.models.length === 1 ? key : `${modelId}.${key}`,
  );
}
