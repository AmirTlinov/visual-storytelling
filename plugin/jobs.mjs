import { fork } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { readJSON, writeJSON } from './runtime/storage.mjs';
import { digest } from './project-files.mjs';
import { contentDigest } from '../tools/build-info.mjs';
import { failure } from './errors.mjs';

const processGroups = process.platform !== 'win32';
function signalWorker(child, signal) {
  if (!child?.pid) return;
  try {
    if (processGroups) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function releaseWorker(child) {
  if (!child?.pid || !processGroups) return;
  // The worker can exit before a renderer, encoder or generator it spawned.
  signalWorker(child, 'SIGKILL');
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(-child.pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(20);
  }
  throw new Error('Preparation processes did not release their resources after cancellation.');
}

/** One bounded preparation queue; a worker keeps compilation and video off the MCP event loop. */
export class JobRunner {
  constructor(data, entry, onComplete = (_, result) => result, { toolchainRoot } = {}) {
    this.data = data;
    this.entry = entry;
    this.onComplete = onComplete;
    this.toolchainRoot = toolchainRoot;
    this.toolchains = new Map();
    this.jobs = new Map();
    this.queue = [];
    this.active = null;
    this.saves = new Map();
    this.enqueues = Promise.resolve();
    this.closed = false;
  }
  toolchain() {
    if (!this.toolchains.has(this.entry)) {
      // An installed release is immutable. Hash it once per runtime, never while polling jobs.
      const identity = Promise.all([
        contentDigest(dirname(this.entry), [basename(this.entry)]),
        contentDigest(dirname(process.execPath), [basename(process.execPath)]),
        this.toolchainRoot
          ? contentDigest(
              this.toolchainRoot,
              [
                'dist',
                'tools',
                'package.json',
                'package-lock.json',
                'plugin.json',
                'release.json',
                'plugin/runtime/worker.mjs',
                'plugin/runtime/storage.mjs',
                'plugin/workflows.mjs',
                'plugin/project-files.mjs',
                'plugin/environment.mjs',
                'runtime/npm/package.json',
                'runtime/npm/bin',
                'runtime/npm/lib',
              ],
              (path) => path.split('/').includes('node_modules'),
            )
          : undefined,
      ]).then(([worker, runtime, tools]) => ({
        digest: digest(
          JSON.stringify({
            worker,
            runtime,
            tools,
            platform: process.platform,
            arch: process.arch,
            os: release(),
          }),
        ),
        node: process.version,
      }));
      this.toolchains.set(this.entry, identity);
    }
    return this.toolchains.get(this.entry);
  }
  async requireToolchain(job) {
    const current = await this.toolchain();
    if (job.toolchain?.digest !== current.digest)
      throw failure(
        'toolchain_changed',
        'The preparation tools changed or were not recorded for this job. Start a new preparation from the project’s current revision with the current tools.',
        {
          field: 'toolchain',
          current,
          action: {
            create: 'story_create',
            produce: 'story_produce',
            review: 'story_review',
            migrate: 'story_migrate',
            build: 'story_open',
          }[job.kind],
        },
      );
    return current;
  }
  async start() {
    const names = await readdir(join(this.data, 'jobs')).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const job = await readJSON(join(this.data, 'jobs', name));
      if (['running', 'queued', 'cancelling'].includes(job.status)) {
        job.status = 'interrupted';
        job.stage = 'Подготовка была прервана. Можно повторить.';
        job.finishedAt = new Date().toISOString();
        await this.save(job);
      }
      this.jobs.set(job.id, job);
    }
  }
  get busy() {
    return Boolean(this.active || this.queue.length);
  }
  describe(job) {
    const { input, signature, requestIds, ...visible } = job;
    return visible;
  }
  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown job.');
    return this.describe(job);
  }
  forRequest(requestId) {
    return [...this.jobs.values()].find(
      (j) => j.requestId === requestId || j.requestIds?.includes(requestId),
    );
  }
  list(projectId) {
    return [...this.jobs.values()]
      .filter((j) => !projectId || j.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30)
      .map((j) => this.describe(j));
  }
  snapshotLeases() {
    const projectIds = new Set([...this.jobs.values()].map((job) => job.projectId));
    const recent = new Set([...projectIds].flatMap((id) => this.list(id).map((job) => job.id)));
    return [
      ...new Set(
        [...this.jobs.values()].flatMap((job) =>
          ['queued', 'running', 'cancelling'].includes(job.status) ||
          (recent.has(job.id) &&
            (['failed', 'cancelled', 'interrupted'].includes(job.status) ||
              (job.kind === 'review' && job.status === 'succeeded')))
            ? [job.id, job.input.resumeFrom].filter(Boolean)
            : [],
        ),
      ),
    ];
  }
  save(job) {
    const copy = structuredClone(job),
      id = job.id;
    const next = (this.saves.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(() => writeJSON(join(this.data, 'jobs', id + '.json'), copy));
    this.saves.set(id, next);
    void next
      .finally(() => {
        if (this.saves.get(id) === next) this.saves.delete(id);
      })
      .catch(() => {});
    return next;
  }
  enqueue(kind, input, requestId) {
    const next = this.enqueues.catch(() => {}).then(() => this.add(kind, input, requestId));
    this.enqueues = next;
    return next;
  }
  async add(kind, input, requestId) {
    if (this.closed) throw new Error('Preparation queue is shutting down.');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId))
      throw new Error('Supply a stable requestId for this preparation.');
    const signature = digest(JSON.stringify({ kind, input }));
    const previous = this.forRequest(requestId);
    if (previous) {
      if (previous.signature !== signature)
        throw new Error('requestId already belongs to another preparation.');
      return this.describe(previous);
    }
    const same = [...this.jobs.values()].find(
      (j) => j.signature === signature && ['queued', 'running'].includes(j.status),
    );
    if (same) {
      (same.requestIds ??= []).push(requestId);
      try {
        await this.save(same);
      } catch (error) {
        same.requestIds.pop();
        throw error;
      }
      return this.describe(same);
    }
    const job = {
      id: randomUUID(),
      requestId,
      kind,
      signature,
      input,
      projectId: input.projectId,
      sourceRevision: input.sourceRevision,
      toolchain: await this.toolchain(),
      status: 'queued',
      stage: 'Ожидает подготовки',
      createdAt: new Date().toISOString(),
    };
    await this.save(job);
    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.pump();
    return this.describe(job);
  }
  async cancel(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown job.');
    if (job.status === 'queued') {
      this.queue = this.queue.filter((j) => j !== job);
      job.status = 'cancelled';
      job.stage = 'Отменено';
      job.finishedAt = new Date().toISOString();
      await this.save(job);
    } else if (job.status === 'running' && !this.active?.completing) {
      job.status = 'cancelling';
      job.stage = 'Останавливаю подготовку…';
      const active = this.active;
      if (active?.child) {
        if (active.child.connected) active.child.send({ type: 'cancel' }, () => {});
        active.timer = setTimeout(() => {
          signalWorker(active.child, 'SIGTERM');
          active.timer = setTimeout(() => signalWorker(active.child, 'SIGKILL'), 1000);
        }, 2000);
      }
      await this.save(job);
    }
    return this.describe(job);
  }
  async retry(id, requestId) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown job.');
    if (!['failed', 'cancelled', 'interrupted'].includes(job.status))
      throw new Error('Only stopped preparations can be resumed.');
    await this.requireToolchain(job);
    return this.enqueue(
      job.kind,
      { ...job.input, resumeFrom: job.input.resumeFrom ?? job.id },
      requestId,
    );
  }
  pump() {
    if (this.closed || this.active || !this.queue.length) return;
    const job = this.queue.shift();
    this.active = { job, child: null };
    this.running = this.run(job).finally(() => {
      clearTimeout(this.active.timer);
      this.active = null;
      this.running = null;
      this.pump();
    });
    void this.running.catch((error) => console.error(error.message));
  }
  async run(job) {
    try {
      await this.requireToolchain(job);
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      await this.save(job);
      if (job.status !== 'cancelling') {
        const { terminal, tail, code } = await new Promise((resolve) => {
          const child = fork(this.entry, [], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: process.env,
            detached: processGroups,
          });
          this.active.child = child;
          let terminal,
            tail = '';
          const log = (chunk) => {
            tail = (tail + chunk).slice(-6000);
          };
          child.stdout.on('data', log);
          child.stderr.on('data', log);
          child.on('error', (error) => {
            terminal = { error: error.message };
          });
          child.on('message', (message) => {
            if (message?.type === 'progress' && job.status === 'running' && !terminal) {
              job.stage = message.stage;
              job.progress = message.progress;
              void this.save(job).catch((error) => console.error(error.message));
            }
            if (message?.type === 'result' || message?.type === 'error') terminal = message;
          });
          child.once('close', (code) => resolve({ terminal, tail, code }));
          child.send({ kind: job.kind, input: job.input, jobId: job.id }, (error) => {
            if (error) {
              terminal = { error: error.message };
              child.kill();
            }
          });
        });
        await releaseWorker(this.active.child);
        clearTimeout(this.active.timer);
        this.active.child = null;
        if (job.status !== 'cancelling' && !terminal?.cancelled) {
          if (terminal?.type !== 'result' || code !== 0)
            throw new Error(terminal?.error ?? (tail || 'Preparation process stopped.'));
          this.active.completing = true;
          job.result = await this.onComplete(job, terminal.result);
          job.status = 'succeeded';
          job.stage = 'Готово';
        } else job.status = 'cancelling';
      }
    } catch (error) {
      if (job.status !== 'cancelling') {
        job.status = 'failed';
        job.stage = 'Не удалось подготовить';
        job.error = error.message;
      }
    } finally {
      const cancelling = job.status === 'cancelling';
      try {
        await releaseWorker(this.active.child);
        if (cancelling) {
          job.status = 'cancelled';
          job.stage = 'Отменено';
        }
      } catch (error) {
        job.status = 'failed';
        job.stage = 'Не удалось остановить подготовку';
        job.error = error.message;
      }
      job.finishedAt = new Date().toISOString();
      await this.save(job).catch((error) => console.error(error.message));
    }
  }
  async close() {
    this.closed = true;
    await this.enqueues.catch(() => {});
    await Promise.allSettled(
      [...this.jobs.values()]
        .filter((j) => ['queued', 'running'].includes(j.status))
        .map((j) => this.cancel(j.id)),
    );
    await this.running;
    await Promise.allSettled([...this.saves.values()]);
  }
}
