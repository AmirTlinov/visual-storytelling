/** A small authored description compiled into the existing subject, SceneShell and Story. */
export interface ExplanationDocument {
  version: 1;
  title?: string;
  model: { id: string; kind: 'division'; count: number; divisor: number };
  views: ExplanationView[];
  score?: ExplanationBeat[];
}
export interface ExplanationView {
  id: string;
  kind: 'groups' | 'equation';
  model: string;
}
export interface ExplanationBeat {
  id: string;
  action?: 'gather' | 'group' | 'remainder';
  focus?: ('groups' | 'remainder' | 'equation')[];
  /** Deliberate time for looking or making a prediction; no visible text is required. */
  hold?: boolean;
  seconds?: number;
  text?: string;
}
export type ExplanationOperation =
  | { op: 'set-inputs'; modelId: string; values: { count?: number; divisor?: number } }
  | { op: 'set-views'; views: ExplanationView[] }
  | { op: 'set-score'; score: ExplanationBeat[] };

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path}: expected an object.`);
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: string[], path: string) => {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${path}.${unknown}: unknown field.`);
};
const id = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(value))
    throw new Error(`${path}: use a stable ID starting with a lowercase letter.`);
  return value;
};
const text = (value: unknown, path: string, length: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > length)
    throw new Error(`${path}: use 1–${length} characters.`);
  return value.trim();
};
const integer = (value: unknown, path: string, minimum: number): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${path}: expected a safe integer of at least ${minimum}.`);
  return value;
};

type UniqueId = (value: unknown, path: string) => string;
const uniqueIds = (initial: string[]): UniqueId => {
  const ids = new Set(initial);
  return (value, path) => {
    const key = id(value, path);
    if (ids.has(key)) throw new Error(`${path}: duplicate ID ${key}.`);
    ids.add(key);
    return key;
  };
};
function parseViews(sourceViews: unknown, modelId: string, unique: UniqueId): ExplanationView[] {
  if (!Array.isArray(sourceViews) || !sourceViews.length || sourceViews.length > 2)
    throw new Error('views: choose one groups view and optionally one equation view.');
  const views: ExplanationView[] = sourceViews.map((raw, index) => {
    const path = `views[${index}]`,
      view = record(raw, path);
    keys(view, ['id', 'kind', 'model'], path);
    if (view.kind !== 'groups' && view.kind !== 'equation')
      throw new Error(`${path}.kind: expected groups or equation.`);
    if (view.model !== modelId)
      throw new Error(`${path}.model: unknown model ${String(view.model)}.`);
    return { id: unique(view.id, `${path}.id`), kind: view.kind, model: modelId };
  });
  if (
    !views.some((view) => view.kind === 'groups') ||
    new Set(views.map((view) => view.kind)).size !== views.length
  )
    throw new Error('views: require one groups view, without duplicated representations.');
  return views;
}

function parseScore(sourceScore: unknown, unique: UniqueId): ExplanationBeat[] | undefined {
  let score: ExplanationBeat[] | undefined;
  if (sourceScore !== undefined) {
    if (!Array.isArray(sourceScore) || !sourceScore.length || sourceScore.length > 16)
      throw new Error('score: use 1–16 meaningful steps.');
    let grouped = false,
      duration = 0;
    score = sourceScore.map((raw, index) => {
      const path = `score[${index}]`,
        beat = record(raw, path);
      keys(beat, ['id', 'action', 'focus', 'hold', 'seconds', 'text'], path);
      if (
        beat.action !== undefined &&
        (typeof beat.action !== 'string' || !['gather', 'group', 'remainder'].includes(beat.action))
      )
        throw new Error(`${path}.action: expected gather, group or remainder.`);
      if (beat.action === 'remainder' && !grouped)
        throw new Error(`${path}: group the objects before naming the remainder.`);
      if (beat.action === 'gather') grouped = false;
      if (beat.action === 'group') grouped = true;
      if (beat.hold !== undefined && typeof beat.hold !== 'boolean')
        throw new Error(`${path}.hold: expected a boolean.`);
      if (
        beat.focus !== undefined &&
        (!Array.isArray(beat.focus) ||
          !beat.focus.length ||
          beat.focus.length > 3 ||
          new Set(beat.focus).size !== beat.focus.length ||
          beat.focus.some((target) => !['groups', 'remainder', 'equation'].includes(target)))
      )
        throw new Error(`${path}.focus: choose groups, remainder or equation.`);
      if (beat.action === undefined && !beat.hold && beat.focus === undefined)
        throw new Error(`${path}: a step needs an action, focus or deliberate hold.`);
      const seconds = beat.seconds ?? (beat.action === 'group' ? 4 : 2);
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0.2 || seconds > 30)
        throw new Error(`${path}.seconds: choose 0.2–30 seconds.`);
      duration += seconds;
      if (duration > 120)
        throw new Error('score: this short experience supports up to 120 seconds.');
      return {
        id: unique(beat.id, `${path}.id`),
        ...(beat.action !== undefined && { action: beat.action as ExplanationBeat['action'] }),
        ...(beat.focus !== undefined && {
          focus: [...(beat.focus as NonNullable<ExplanationBeat['focus']>)],
        }),
        ...(beat.hold !== undefined && { hold: beat.hold as boolean }),
        ...(beat.seconds !== undefined && { seconds }),
        ...(beat.text !== undefined && { text: text(beat.text, `${path}.text`, 90) }),
      };
    });
  }
  return score;
}

/** Complete structural defaults, then reject invalid subject data before publication. */
export function validateExplanation(value: unknown): ExplanationDocument {
  const source = record(value, 'explanation');
  keys(source, ['version', 'title', 'model', 'views', 'score'], 'explanation');
  if (source.version !== undefined && source.version !== 1)
    throw new Error('explanation.version: expected 1.');
  const model = record(source.model, 'model');
  keys(model, ['id', 'kind', 'count', 'divisor'], 'model');
  if (model.kind !== 'division') throw new Error('model.kind: choose the division recipe.');
  const modelId = id(model.id === undefined ? 'division' : model.id, 'model.id');
  const count = integer(model.count, 'model.count', 0);
  const divisor = integer(model.divisor, 'model.divisor', 1);
  // An explicit display limit, not a restriction on Euclidean division itself.
  if (count > 36 || divisor > 12)
    throw new Error(
      'groups: this drawing supports count ≤ 36 and divisor ≤ 12. Use a symbolic model for larger values.',
    );
  const unique = uniqueIds([modelId]);
  const sourceViews =
    source.views === undefined
      ? (['groups', 'equation'] as const).map((kind) => ({
          id: modelId === kind ? `${kind}.view` : kind,
          kind,
          model: modelId,
        }))
      : source.views;
  const views = parseViews(sourceViews, modelId, unique);
  const score = parseScore(source.score, unique);
  if (!views.some((view) => view.kind === 'equation'))
    for (const [index, beat] of (score ?? []).entries())
      if (beat.focus?.includes('equation'))
        throw new Error(`score[${index}].focus: the equation view is absent.`);
  return {
    version: 1,
    ...(source.title !== undefined && { title: text(source.title, 'title', 160) }),
    model: { id: modelId, kind: 'division', count, divisor },
    views,
    ...(score !== undefined && { score }),
  };
}

/** Return a new whole document; ProjectStore remains the owner of persistence and revisions. */
export function editExplanation(document: unknown, operations: unknown): ExplanationDocument {
  const initial = validateExplanation(document);
  let next = initial;
  if (!Array.isArray(operations) || !operations.length || operations.length > 16)
    throw new Error('operations: use 1–16 complete changes.');
  for (const [index, raw] of operations.entries()) {
    const path = `operations[${index}]`,
      operation = record(raw, path);
    if (operation.op === 'set-inputs') {
      keys(operation, ['op', 'modelId', 'values'], path);
      if (operation.modelId !== next.model.id) throw new Error(`${path}.modelId: unknown model.`);
      const values = record(operation.values, `${path}.values`);
      keys(values, ['count', 'divisor'], `${path}.values`);
      if (!Object.keys(values).length) throw new Error(`${path}.values: supply an input.`);
      const model = validateExplanation({ ...initial, model: { ...next.model, ...values } }).model;
      next = { ...next, model };
    } else if (operation.op === 'set-views') {
      keys(operation, ['op', 'views'], path);
      if (!Array.isArray(operation.views))
        throw new Error(`${path}.views: supply a complete list.`);
      next = {
        ...next,
        views: parseViews(operation.views, next.model.id, uniqueIds([next.model.id])),
      };
    } else if (operation.op === 'set-score') {
      keys(operation, ['op', 'score'], path);
      if (!Array.isArray(operation.score))
        throw new Error(`${path}.score: supply a complete list.`);
      next = { ...next, score: parseScore(operation.score, uniqueIds([next.model.id])) };
    } else throw new Error(`${path}.op: unknown operation.`);
  }
  // A batch replaces related representations and references atomically. Its transient
  // candidates are never published, so their cross references need not exist yet.
  return validateExplanation(next);
}
