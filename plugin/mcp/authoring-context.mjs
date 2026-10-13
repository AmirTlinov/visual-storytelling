import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireDirectoryLock } from '../../tools/file-lock.mjs';
import { failure } from '../errors.mjs';

/** A signed reference, never a store or a grant to adopt a newer project/view. */
export async function authoringContext(data) {
  await mkdir(data, { recursive: true, mode: 0o700 });
  const file = join(data, 'authoring-context.key');
  const unlock = await acquireDirectoryLock(file + '.lock');
  let key;
  try {
    key = await readFile(file).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!key) {
      key = randomBytes(32);
      await writeFile(file, key, { mode: 0o600, flag: 'wx' });
    }
    if (key.length !== 32) throw Error('Invalid authoring context key.');
  } finally {
    await unlock();
  }
  const sign = (payload) => createHmac('sha256', key).update(payload).digest();
  return {
    encode(reference) {
      const payload = Buffer.from(JSON.stringify(reference)).toString('base64url');
      return `v1.${payload}.${sign(payload).toString('base64url')}`;
    },
    decode(context) {
      try {
        if (typeof context !== 'string' || context.length > 4096) throw Error();
        const [version, payload, signature, extra] = context.split('.');
        const actual = Buffer.from(signature ?? '', 'base64url');
        if (
          version !== 'v1' ||
          extra ||
          actual.length !== 32 ||
          !timingSafeEqual(actual, sign(payload))
        )
          throw Error();
        const value = JSON.parse(Buffer.from(payload, 'base64url'));
        if (!Array.isArray(value) || value.length !== 8) throw Error();
        return value;
      } catch {
        throw failure(
          'invalid_context',
          'This context is invalid or belongs to another installation data directory.',
          {
            field: 'context',
            action: 'story_inspect',
          },
        );
      }
    },
  };
}

const projectFields = ([projectId, sourceRevision]) => {
  if (!projectId || !sourceRevision)
    throw failure('project_context_required', 'Choose an editable project context.', {
      field: 'context',
      action: 'story_open',
    });
  return { projectId, sourceRevision };
};
const sceneFields = ([
  ,
  ,
  sessionId,
  buildRevision,
  stateRevision,
  expectedGeneration,
  expectedInstance,
]) => {
  if (!sessionId || !buildRevision || stateRevision === null)
    throw failure('scene_context_required', 'Choose an observed scene context.', {
      field: 'context',
      action: 'story_open',
    });
  return { sessionId, buildRevision, stateRevision, expectedGeneration, expectedInstance };
};

/** Translate the public contract once. Explicit revisions remain inside their existing owners. */
export function contextualRuntime(runtime, codec) {
  function reference(value, previous) {
    const project = value.project ?? value.result?.project ?? value;
    const wantedScene = value.sessionId ?? previous?.[2];
    const scene =
      value.shown?.find(
        (view) => !view.error && (!wantedScene || view.sessionId === wantedScene),
      ) ?? (value.sessionId ? value : undefined);
    const projectId =
      project.projectId ??
      (project.path && project.files ? project.id : undefined) ??
      scene?.projectId;
    const retained = projectId && projectId === previous?.[0] ? previous : [];
    const source =
      value.project?.sourceRevision ??
      value.result?.project?.sourceRevision ??
      value.authoringSourceRevision ??
      (scene && retained[0] ? retained[1] : (project.sourceRevision ?? scene?.sourceRevision));
    if (!source && !scene?.buildRevision) return;
    return [
      projectId ?? null,
      source ?? null,
      scene?.sessionId ?? retained[2] ?? null,
      scene?.buildRevision ?? (retained[2] ? retained[3] : project.buildRevision) ?? null,
      scene?.stateRevision ?? retained[4] ?? null,
      scene?.generation ?? retained[5] ?? null,
      scene?.serverInstance ?? retained[6] ?? null,
      project.runtime?.build ?? retained[7] ?? null,
    ];
  }
  function present(value, previous) {
    if (Array.isArray(value)) return value.map((entry) => present(entry));
    if (!value || typeof value !== 'object') return value;
    const next = { ...value };
    const observed =
      value.sessionId &&
      value.shown?.find((view) => !view.error && view.sessionId === value.sessionId);
    if (observed)
      for (const field of [
        'generation',
        'serverInstance',
        'stateRevision',
        'renderStatus',
        'status',
        'state',
        'checkpoint',
        'observedAt',
      ])
        if (observed[field] !== undefined) next[field] = observed[field];
    for (const field of ['project', 'result']) if (next[field]) next[field] = present(next[field]);
    for (const field of ['sessions', 'shown'])
      if (Array.isArray(next[field])) next[field] = next[field].map((entry) => present(entry));
    const bound = reference(value, previous);
    if (bound) next.context = codec.encode(bound);
    return next;
  }
  return {
    async call(method, input = {}) {
      let args = { ...input },
        previous;
      if (args.context) {
        previous = codec.decode(args.context);
        delete args.context;
        if (['edit', 'migrate', 'voice'].includes(method))
          Object.assign(args, projectFields(previous));
        else if (method === 'request') {
          const { sessionId, ...scene } = sceneFields(previous);
          args.sessionId = sessionId;
          if (args.request.op === 'control')
            args.request = { ...args.request, ...scene, authoringSourceRevision: previous[1] };
        } else if (method === 'inspect') {
          if (previous[2] && args.scope !== 'working') {
            args.sessionId = previous[2];
            method = args.file ? 'shownSource' : 'request';
            if (!args.file) args.request = { op: 'inspect', detail: args.detail };
          } else {
            Object.assign(args, projectFields(previous));
            method = 'project';
          }
        } else if (['open', 'navigate'].includes(method)) {
          if (previous[2]) args.sessionId = previous[2];
          else Object.assign(args, projectFields(previous));
        } else if (method === 'create') args.sessionId = sceneFields(previous).sessionId;
        else if (method === 'project' || method === 'help')
          Object.assign(args, projectFields(previous));
      }
      if (args.target?.context) {
        const target = codec.decode(args.target.context);
        if (['produce', 'review'].includes(method)) {
          args.target =
            args.target.kind === 'working'
              ? { kind: 'working', ...projectFields(target) }
              : {
                  kind: 'build',
                  projectId: projectFields(target).projectId,
                  buildRevision: target[3],
                };
          if (args.options?.conditions === 'current')
            args.options = { ...args.options, sessionId: sceneFields(target).sessionId };
        } else if (method === 'navigate')
          args.target = target[2]
            ? { sessionId: target[2] }
            : { projectId: projectFields(target).projectId };
      }
      let raw;
      try {
        raw = await runtime.call(method, args);
      } catch (error) {
        if (error.current) error.current = present(error.current, previous);
        throw error;
      }
      const value = present(raw, previous);
      if (
        method === 'create' ||
        method === 'edit' ||
        (method === 'request' && args.request.op === 'control')
      ) {
        value.publication =
          value.delivery ??
          (value.acknowledgement === 'rendered'
            ? 'shown'
            : (value.acknowledgement ??
              value.publication ??
              (value.authoring === 'ready'
                ? 'prepared'
                : value.authoring === 'failed'
                  ? 'failed'
                  : 'preparing')));
        const operations = args.operations ?? [];
        const commands = args.request?.commands ?? [];
        const observed =
          value.state?.snapshot ?? value.shown?.find((view) => !view.error)?.state?.snapshot;
        value.difference = {
          ...(method === 'create' &&
            args.document && {
              created: {
                ...(args.document.recipe && {
                  recipe: args.document.recipe,
                  inputs: args.document.inputs,
                }),
                ...(args.document.models && { models: args.document.models.map(({ id }) => id) }),
              },
            }),
          ...(args.undo && { undo: true }),
          ...(args.changes && { files: args.changes.map(({ path }) => path) }),
          ...(operations.length && {
            authored: operations.map((operation) => ({
              op: operation.op,
              ...(operation.modelId && { modelId: operation.modelId }),
              ...(operation.values && { values: operation.values }),
              ...(operation.views && { views: operation.views.map(({ id }) => id) }),
              ...(operation.chapters && { chapters: operation.chapters.map(({ id }) => id) }),
            })),
          }),
          ...(commands.length && { commands }),
          ...(observed && { observed }),
        };
      }
      return value;
    },
    close: () => runtime.close(),
  };
}
