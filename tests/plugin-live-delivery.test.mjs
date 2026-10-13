import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { setTimeout as delay } from 'node:timers/promises';
import { connectRuntime } from '../plugin/runtime/client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const report = (stateRevision, count = 11) => ({
  stateRevision,
  renderStatus: 'rendered',
  state: { time: 0, playing: false, parameters: [{ key: 'count', value: count }] },
  checkpoint: { time: 0, progress: 0, mode: 'story', values: { count, divisor: 3 } },
});

test(
  'saved live edits retry refused and empty delivery without rewriting source, and old receipts never replay over newer work',
  { timeout: 30000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'story-live-delivery-'));
    const release = join(temporary, 'release'),
      directory = join(release, 'plugin/dist'),
      data = join(temporary, 'data');
    let runtime, pid;
    t.after(async () => {
      runtime?.close();
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      await rm(temporary, { recursive: true, force: true });
    });
    // This explicitly executed development package remains inside the normal trust
    // boundary; the shipped live bundle and production installation are untouched.
    await cp(join(root, '.plugin-release'), release, { recursive: true });
    await build({
      entryPoints: [join(root, 'plugin/runtime/kernel.mjs')],
      outfile: join(directory, 'kernel.mjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      plugins: [
        {
          name: 'creation-session-pin-fault',
          setup(builder) {
            builder.onLoad({ filter: /tools\/storage\.mjs$/ }, async ({ path }) => {
              const source = await readFile(path, 'utf8');
              const entry = 'export async function writeJSON(file, value) {';
              assert.ok(source.includes(entry));
              return {
                contents: source.replace(
                  entry,
                  entry +
                    `
              if (file.endsWith('/projects.json') && Array.isArray(value) && value.some(p => p.creation?.sessionId)) {
                const marker = file + '.reject-session-pin';
                const reject = await readFile(marker).then(() => true, error => {if(error.code === 'ENOENT') return false; throw error});
                if (reject) { await rm(marker); throw Object.assign(new Error('Injected registry session pin write failure'), {code:'EIO'}); }
              }
            `,
                ),
                loader: 'js',
              };
            });
          },
        },
      ],
    });
    await mkdir(data);
    const connect = async () => {
      const previous = process.env.VISUAL_STORY_DATA_DIR;
      process.env.VISUAL_STORY_DATA_DIR = data;
      try {
        runtime = await connectRuntime(directory);
      } finally {
        if (previous === undefined) delete process.env.VISUAL_STORY_DATA_DIR;
        else process.env.VISUAL_STORY_DATA_DIR = previous;
      }
      pid = (await runtime.call('hello')).pid;
    };
    await connect();
    const creation = {
      path: join(temporary, 'project'),
      title: 'Delivery retry',
      requestId: randomUUID(),
      document: { recipe: 'division', inputs: { count: 11, divisor: 3 } },
    };
    // A real checkpoint write failure happens after the source and session choice.
    await writeFile(join(data, 'sessions'), 'blocked checkpoint directory');
    await writeFile(
      join(data, 'projects.json.reject-session-pin'),
      'fail once at the registry boundary',
    );
    await assert.rejects(runtime.call('create', creation), /session pin write failure/);
    assert.deepEqual(
      await runtime.call('list'),
      [],
      'a refused durable session pin opens no orphan session',
    );
    assert.equal(
      JSON.parse(await readFile(join(data, 'projects.json'), 'utf8'))[0].creation.sessionId,
      undefined,
    );
    await assert.rejects(runtime.call('create', creation), /EEXIST|ENOTDIR/);
    const [pendingCreation] = JSON.parse(await readFile(join(data, 'projects.json'), 'utf8'));
    const pendingSession = pendingCreation.creation.sessionId;
    assert.ok(pendingSession);
    const sourceFile = join(creation.path, 'story.json');
    const initialStat = await stat(sourceFile);
    process.kill(pid, 'SIGKILL');
    runtime.close();
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') break;
        throw error;
      }
      await delay(10);
    }
    pid = undefined;
    await rm(join(data, 'sessions'));
    await connect();
    const created = await runtime.call('create', creation);
    assert.equal(created.sessionId, pendingSession);
    assert.equal((await runtime.call('list')).length, 1);
    assert.equal((await stat(sourceFile)).mtimeMs, initialStat.mtimeMs);
    assert.deepEqual(await runtime.call('create', creation), created);
    let project = created.project;
    const renderer = randomUUID();
    let view, appliedAuthor;
    const attach = async (stateRevision, count) => {
      const attached = await runtime.call('attach', { sessionId: created.sessionId, renderer });
      assert.match(attached.html, /<html/, 'view loading hydrates the saved render payload');
      view = { sessionId: created.sessionId, renderer, generation: attached.generation };
      appliedAuthor = undefined;
      await runtime.call('exchange', {
        ...view,
        report: report(stateRevision, count),
        wait: false,
      });
    };
    await attach(0, 11);
    // The kernel accepts an internal zero-budget fixture without changing the public preferences schema.
    await runtime.call('preferences', { patch: { cacheLimitMB: 0 } });
    const poll = async (op) => {
      const response = await runtime.call('exchange', view);
      assert.equal(response.commands.length, 1, JSON.stringify(response));
      assert.equal(response.commands[0].op, op);
      return response.commands[0];
    };
    const ack = (command, { stale, ...response } = {}) => {
      const identity =
        command.op === 'author' && !response.error
          ? {
              requestId: command.requestId,
              commandId: command.id,
              buildRevision: command.nextBuildRevision,
              sourceRevision: command.sourceRevision,
            }
          : appliedAuthor;
      if (command.op === 'author' && !response.error && !stale) appliedAuthor = identity;
      return runtime.call('exchange', {
        ...view,
        wait: false,
        ...response,
        ...(response.report && { report: { ...response.report, authoring: identity } }),
        acknowledgements: [
          {
            id: command.id,
            ...(response.error
              ? { error: response.error }
              : {
                  result:
                    command.op === 'author'
                      ? {
                          buildRevision: command.nextBuildRevision,
                          sourceRevision: command.sourceRevision,
                        }
                      : { validated: true },
                }),
          },
        ],
      });
    };
    const args = (count) => ({
      projectId: project.id,
      sourceRevision: project.sourceRevision,
      requestId: randomUUID(),
      operations: [{ op: 'set-inputs', modelId: 'division', values: { count } }],
    });
    const start = async (request) => {
      const result = runtime.call('edit', request);
      const preflight = await poll('author-validate');
      assert.deepEqual(preflight.authoredInputs, ['count']);
      await ack(preflight);
      return { result, command: await poll('author') };
    };
    const firstArgs = args(14);
    const first = await start(firstArgs);
    assert.deepEqual(first.command.authoredInputs, ['count']);
    await ack(first.command, {
      report: report(1, 11),
      error: 'Renderer refused the prepared frame.',
    });
    const refused = await first.result;
    assert.equal(refused.delivery, 'failed');
    assert.match(refused.shown[0].error.message, /refused/);
    assert.notEqual(refused.project.sourceRevision, firstArgs.sourceRevision);
    const savedStat = await stat(sourceFile),
      savedSource = await readFile(sourceFile, 'utf8');
    await runtime.call('detach', view);
    const empty = await runtime.call('edit', firstArgs);
    assert.equal(empty.delivery, 'pending');
    assert.deepEqual(empty.shown, []);
    await attach(1, 11);
    const retry = runtime.call('edit', firstArgs);
    const secondCommand = await poll('author');
    assert.notEqual(secondCommand.id, first.command.id);
    await ack(first.command, { report: report(99, 99), stale: true });
    const beforeRetry = (await runtime.call('list'))[0];
    assert.equal(beforeRetry.buildRevision, created.buildRevision);
    assert.equal(beforeRetry.stateRevision, 1);
    await ack(secondCommand, { report: report(2, 14) });
    const delivered = await retry;
    assert.equal(delivered.delivery, 'shown');
    assert.equal(delivered.project.sourceRevision, refused.project.sourceRevision);
    assert.equal(delivered.shown[0].shownSourceRevision, refused.project.sourceRevision);
    assert.equal((await stat(sourceFile)).mtimeMs, savedStat.mtimeMs);
    assert.equal(await readFile(sourceFile, 'utf8'), savedSource);
    assert.deepEqual(
      (await readdir(join(project.path, '.vstory/history'))).sort(),
      [creation.requestId + '.json', firstArgs.requestId + '.json'].sort(),
    );
    project = delivered.project;
    const nextArgs = args(17),
      next = await start(nextArgs);
    await ack(next.command, { report: { ...report(3, 17), renderStatus: 'prepared' } });
    const prepared = await next.result;
    assert.equal(prepared.delivery, 'prepared');
    const preparedStat = await stat(sourceFile);
    const observePrepared = runtime.call('edit', nextArgs);
    const inspection = await poll('inspect');
    await ack(inspection, { report: { ...report(3, 17), renderStatus: 'failed' } });
    assert.equal((await observePrepared).delivery, 'failed');
    const recoverPrepared = runtime.call('edit', nextArgs);
    const reinspection = await poll('inspect');
    await ack(reinspection, { report: report(3, 17) });
    const newer = await recoverPrepared;
    assert.equal(newer.delivery, 'shown');
    assert.equal((await stat(sourceFile)).mtimeMs, preparedStat.mtimeMs);
    project = newer.project;
    await runtime.call('exchange', {
      ...view,
      wait: false,
      report: { ...report(4, 18), authoring: appliedAuthor },
    });
    const unchangedArgs = args(17),
      unchanged = await start(unchangedArgs);
    assert.equal(unchanged.command.nextBuildRevision, newer.buildRevision);
    await ack(unchanged.command, { report: report(5, 17) });
    const reset = await unchanged.result;
    assert.equal(
      reset.delivery,
      'shown',
      'new explicit intent executes even when authored source is unchanged',
    );
    assert.equal(reset.project.sourceRevision, project.sourceRevision);
    project = reset.project;
    assert.deepEqual(
      await runtime.call('edit', firstArgs),
      delivered,
      'a successful historical receipt needs no new delivery',
    );
    const olderArgs = args(20),
      older = await start(olderArgs);
    await ack(older.command, { error: 'Transient renderer refusal.' });
    project = (await older.result).project;
    const newestArgs = args(21),
      newest = await start(newestArgs);
    await ack(newest.command, { report: report(6, 21) });
    const accepted = await newest.result;
    assert.equal(accepted.delivery, 'shown');
    const superseded = await runtime.call('edit', olderArgs);
    assert.equal(superseded.delivery, 'superseded');
    assert.equal(
      (await runtime.call('project', { projectId: project.id })).sourceRevision,
      accepted.project.sourceRevision,
    );
    const [shown] = await runtime.call('list');
    assert.equal(shown.buildRevision, accepted.buildRevision);
    assert.equal(shown.stateRevision, 6);
    assert.deepEqual((await runtime.call('exchange', view)).commands, []);
    project = accepted.project;
    const appliedArgs = args(22),
      applied = await start(appliedArgs);
    const identity = {
      requestId: applied.command.requestId,
      commandId: applied.command.id,
      buildRevision: applied.command.nextBuildRevision,
      sourceRevision: applied.command.sourceRevision,
    };
    await runtime.call('exchange', {
      ...view,
      wait: false,
      report: { ...report(7, 22), renderStatus: 'failed', authoring: identity },
      acknowledgements: [
        { id: applied.command.id, error: 'Viewer input cancelled observation after replacement.' },
      ],
    });
    const interrupted = await applied.result;
    assert.equal(interrupted.delivery, 'failed');
    assert.notEqual(interrupted.shown[0].shownSourceRevision, identity.sourceRevision);
    await runtime.call('exchange', {
      ...view,
      wait: false,
      report: { ...report(8, 23), authoring: identity },
    });
    const reconciled = await runtime.call('edit', appliedArgs);
    assert.equal(reconciled.delivery, 'shown');
    assert.equal(
      reconciled.shown[0].state.parameters[0].value,
      23,
      'retry observes the user input rather than replaying the applied intent',
    );
    assert.deepEqual((await runtime.call('exchange', view)).commands, []);
    const saved = JSON.parse(
      await readFile(join(data, 'sessions', created.sessionId + '.json'), 'utf8'),
    );
    assert.equal(saved.buildRevision, identity.buildRevision);
    assert.equal(saved.checkpoint.values.count, 23);
    let retainedBuilds;
    for (let attempt = 0; attempt < 100; attempt++) {
      retainedBuilds = await readdir(join(data, 'builds'));
      if (retainedBuilds.length === 1) break;
      await delay(10);
    }
    assert.deepEqual(retainedBuilds, [identity.buildRevision + '.json']);
    assert.deepEqual(
      await runtime.call('edit', firstArgs),
      delivered,
      'collection preserves historical edit receipts',
    );
    process.kill(pid, 'SIGKILL');
    runtime.close();
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') break;
        throw error;
      }
      await delay(10);
    }
    pid = undefined;
    await connect();
    const restoredRenderer = randomUUID();
    const restored = await runtime.call('attach', {
      sessionId: created.sessionId,
      renderer: restoredRenderer,
    });
    assert.match(restored.html, /<html/, 'restart hydrates the retained build');
    assert.equal(restored.buildRevision, identity.buildRevision);
    assert.equal(restored.authoredDocument.models[0].inputs.count, 22);
    assert.equal(restored.checkpoint.values.count, 23);
    assert.equal(
      restored.authoring,
      undefined,
      'a restart mounts the saved build in a fresh generation',
    );
    view = {
      sessionId: created.sessionId,
      renderer: restoredRenderer,
      generation: restored.generation,
    };
    appliedAuthor = undefined;
    await runtime.call('exchange', { ...view, wait: false, report: report(9, 23) });
    const undo = await start({
      projectId: project.id,
      sourceRevision: reconciled.project.sourceRevision,
      requestId: randomUUID(),
      undo: true,
    });
    await ack(undo.command, { report: report(10, 21) });
    assert.equal((await undo.result).delivery, 'shown');
    assert.equal(
      JSON.parse(await readFile(sourceFile, 'utf8')).models[0].inputs.count,
      21,
      'undo reconstructs the previous source after its build was collected',
    );
  },
);
