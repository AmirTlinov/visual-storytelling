import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { projectFiles } from '../plugin/project-files.mjs';

test(
  'MCP review uses pinned inputs, owns artifacts, cancels and retries through the job queue',
  { timeout: 180000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'story-review-job-'));
    const data = join(directory, 'data');
    const client = new Client({ name: 'review-job-contract', version: '1' });
    t.after(async () => {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    });
    await client.connect(
      new StdioClientTransport({
        command: resolve('.plugin-release/runtime/node'),
        args: [resolve('.plugin-release/plugin/dist/server.mjs')],
        stderr: 'inherit',
        env: { ...process.env, VISUAL_STORY_DATA_DIR: data },
      }),
    );
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args });
      assert.equal(response.isError, undefined, JSON.stringify(response));
      return response.structuredContent;
    };
    const wait = async (
      id,
      predicate = (job) => !['running', 'queued', 'cancelling'].includes(job.status),
      timeout = 120000,
    ) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const job = await call('story_inspect', { jobId: id });
        if (await predicate(job)) return job;
        if (['failed', 'cancelled', 'interrupted'].includes(job.status))
          throw new Error(JSON.stringify(job));
        await delay(50);
      }
      throw new Error('Review job deadline');
    };
    const created = await call('story_create', {
      title: 'Проверка ревизии',
      example: 'explorer-svg',
      path: join(directory, 'project'),
      requestId: randomUUID(),
    });
    assert.equal((await wait(created.job.id)).status, 'succeeded');
    const projectId = created.project.id;
    const project = await call('story_inspect', { projectId });
    const before = await projectFiles(project.path);
    const request = {
      projectId,
      sourceRevision: project.sourceRevision,
      requestId: randomUUID(),
      options: { from: 0, seconds: 0.3, frames: 3, width: 360, height: 480 },
    };
    const review = await call('story_review', request);
    assert.equal(review.kind, 'review');
    assert.equal((await call('story_review', request)).id, review.id);
    const completed = await wait(review.id);
    assert.equal(completed.status, 'succeeded', completed.error);
    assert.equal(completed.result.sourceRevision, before.revision);
    assert.equal(completed.result.source.kind, 'scene-seek');
    assert.match(completed.result.source.path, new RegExp(`/snapshots/${review.id}/dist$`));
    assert.match(
      completed.result.preview,
      /\/dependencies\/[^/]+\/node_modules\/@visual-storytelling\/core\/tools\/scene\.mjs/,
    );
    assert.ok(completed.result.files.includes(completed.result.path));
    assert.ok(completed.result.files.includes(completed.result.image));
    assert.ok(completed.result.files.includes(completed.result.framesImage));
    assert.ok(completed.result.files.every((file) => /\.(html|png)$/.test(file)));
    for (const file of completed.result.files) await access(file);
    const originalReport = await readFile(completed.result.path);
    const capture = JSON.parse(await readFile(completed.result.captureManifest, 'utf8'));
    assert.ok(capture.frames.length >= 3);
    assert.equal((await projectFiles(project.path)).revision, before.revision);

    // The browser scenario makes cancellation observable after the real CLI has launched.
    await writeFile(
      join(project.path, 'review-flow.json'),
      JSON.stringify({
        actions: [
          { type: 'wait', ms: 5000 },
          { type: 'click', selector: '#missing-review-target' },
        ],
        seconds: 0.1,
      }),
    );
    const scenarioProject = await call('story_inspect', { projectId });
    const scenario = await call('story_review', {
      projectId,
      sourceRevision: scenarioProject.sourceRevision,
      requestId: randomUUID(),
      options: { scenario: 'review-flow.json', width: 360, height: 480 },
    });
    await wait(
      scenario.id,
      (job) =>
        job.stage === 'Просматриваю сцену и сохраняю наблюдения…' &&
        access(
          join(project.path, 'artifacts', scenario.id + '-review', 'capture/frames.jsonl'),
        ).then(
          () => true,
          () => false,
        ),
    );
    await wait(
      scenario.id,
      async (job) => {
        assert.equal(job.status, 'running', 'the review stays active while its rebuild queues');
        const { sessions } = await call('story_inspect', {});
        return sessions
          .find((session) => session.sessionId === created.sessionId)
          ?.jobs.some(
            (job) =>
              job.kind === 'build' &&
              job.sourceRevision === scenarioProject.sourceRevision &&
              job.status === 'queued',
          );
      },
      8000,
    );
    await call('story_cancel', { jobId: scenario.id });
    assert.equal((await wait(scenario.id)).status, 'cancelled');
    await assert.rejects(access(join(project.path, 'artifacts', scenario.id + '-review')), {
      code: 'ENOENT',
    });
    await writeFile(
      join(project.path, 'later.txt'),
      'This was authored after the cancelled review.',
    );
    const retry = await call('story_retry', { jobId: scenario.id, requestId: randomUUID() });
    const retried = await wait(retry.id);
    assert.equal(retried.status, 'succeeded', retried.error);
    assert.equal(retried.result.sourceRevision, scenarioProject.sourceRevision);
    assert.notEqual(retried.result.sourceRevision, (await projectFiles(project.path)).revision);
    assert.equal(retried.result.source.kind, 'browser-capture');
    assert.ok(
      retried.result.insights.some((entry) => entry.kind === 'action-error'),
      'a failed interaction retains its completed review evidence',
    );
    await assert.rejects(access(join(data, 'snapshots', retry.id, 'later.txt')), {
      code: 'ENOENT',
    });

    // A generator cannot change authored inputs and label the report with the old revision.
    await writeFile(
      join(project.path, 'scene.json'),
      JSON.stringify({ generator: { runner: 'node', file: 'generate.mjs' } }),
    );
    await writeFile(
      join(project.path, 'generate.mjs'),
      `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
await writeFile('later.txt', 'changed by generator');
await writeFile(join(process.env.VISUAL_STORY_OUTPUT, 'index.html'), '<main>mutated</main>');
`,
    );
    const changed = await call('story_inspect', { projectId });
    const rejected = await call('story_review', {
      projectId,
      sourceRevision: changed.sourceRevision,
      requestId: randomUUID(),
    });
    const failed = await wait(rejected.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /changed its source inputs/);
    await assert.rejects(access(join(project.path, 'artifacts', rejected.id + '-review')), {
      code: 'ENOENT',
    });
    assert.equal(
      await readFile(join(project.path, 'later.txt'), 'utf8'),
      'This was authored after the cancelled review.',
    );
    assert.deepEqual(await readFile(completed.result.path), originalReport);
  },
);
