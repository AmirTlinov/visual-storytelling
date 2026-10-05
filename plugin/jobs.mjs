import { fork } from 'node:child_process';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readJSON, writeJSON } from './runtime/storage.mjs';
import { digest } from './project-files.mjs';

/** One bounded preparation queue; a worker keeps compilation and video off the MCP event loop. */
export class JobRunner {
  constructor(data, entry, onComplete = (_, result) => result) {
    this.data = data;
    this.entry = entry;
    this.onComplete = onComplete;
    this.jobs = new Map();
    this.queue = [];
    this.active = null;
    this.saves = new Map();
    this.enqueues = Promise.resolve();
    this.closed = false;
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
          (recent.has(job.id) && ['failed', 'cancelled', 'interrupted'].includes(job.status))
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
          active.child.kill('SIGTERM');
          active.timer = setTimeout(() => active.child.kill('SIGKILL'), 1000);
        }, 2000);
      }
      await this.save(job);
    }
    return this.describe(job);
  }
  retry(id, requestId) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown job.');
    if (!['failed', 'cancelled', 'interrupted'].includes(job.status))
      throw new Error('Only stopped preparations can be resumed.');
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
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      await this.save(job);
      if (job.status !== 'cancelling') {
        const { terminal, tail, code } = await new Promise((resolve) => {
          const child = fork(this.entry, [], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: process.env,
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
        if (job.status !== 'cancelling' && !terminal?.cancelled) {
          if (terminal?.type !== 'result' || code !== 0)
            throw new Error(terminal?.error ?? (tail || 'Preparation process stopped.'));
          this.active.completing = true;
          job.result = await this.onComplete(job, terminal.result);
          job.status = 'succeeded';
          job.stage = 'Готово';
        } else job.status = 'cancelling';
      }
      if (job.status === 'cancelling') {
        job.status = 'cancelled';
        job.stage = 'Отменено';
      }
    } catch (error) {
      if (job.status === 'cancelling') {
        job.status = 'cancelled';
        job.stage = 'Отменено';
      } else {
        job.status = 'failed';
        job.stage = 'Не удалось подготовить';
        job.error = error.message;
      }
    } finally {
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
