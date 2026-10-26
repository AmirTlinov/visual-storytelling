import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginHost } from './plugin/host.mjs';

test(
  'create accepts a verified baseline with pinned batch help, then candidate edits coalesce',
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-fast-authoring-'));
    const host = await pluginHost({ dataDirectory: join(directory, 'data') });
    const call = async (name, args) => {
      const result = await host.client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result.structuredContent;
    };
    try {
      const description = (await host.client.listTools()).tools.find(
        ({ name }) => name === 'story_create',
      );
      assert.ok(description._meta?.ui?.resourceUri, 'live authoring owns the MCP App entry');
      assert.equal(description.inputSchema.required.includes('example'), false);
      const sessions = (await call('story_inspect', {})).sessions;
      const request = {
        title: 'Editable immediately',
        path: join(directory, 'project'),
        requestId: randomUUID(),
      };
      const created = await call('story_create', request);
      assert.equal(created.authoring, 'ready', created.job.error ?? JSON.stringify(created));
      assert.equal(created.sessionId, undefined);
      assert.deepEqual((await call('story_inspect', {})).sessions, sessions);
      assert.equal(created.project.entry, 'index.html');
      assert.equal(created.project.runtime.name, '@visual-storytelling/core');
      assert.match(created.project.runtime.build, /^[a-f0-9]{64}$/);
      assert.match(created.project.sourceRevision, /^[a-f0-9]{64}$/);
      assert.ok(created.project.files['scene.js']);
      const repeated = await call('story_create', request);
      assert.equal(repeated.project.id, created.project.id);
      assert.equal(repeated.job.id, created.job.id);
      assert.deepEqual((await call('story_inspect', {})).sessions, sessions);
      assert.equal(
        (
          await host.client.callTool({
            name: 'story_create',
            arguments: { ...request, title: 'Different request' },
          })
        ).isError,
        true,
      );
      assert.equal(
        await readFile(join(created.project.path, 'scene.js'), 'utf8').then(Boolean),
        true,
      );
      await call('story_cancel', { jobId: created.job.id });
      await call('story_inspect', { jobId: created.job.id, waitMs: 15000 });
      const help = await call('story_help', {
        projectId: created.project.id,
        query: 'gpt-model',
        queries: ['SceneHandle', 'SceneShell.mount', 'plot.interval', 'svgButton'],
      });
      assert.deepEqual(help.missing, []);
      assert.match(help.text, /interface SceneHandle/);
      assert.match(help.text, /mount/);
      assert.equal(help.examples[0].id, 'gpt-model');
      assert.ok(help.examples[0].editing.some(({ file }) => file === 'scene.js'));
      assert.match(help.text, /PlotIntervalOptions/);
      const first = await call('story_edit', {
        context: created.project.context,
        requestId: randomUUID(),
        changes: [{ path: 'note.txt', content: 'first' }],
      });
      const second = await call('story_edit', {
        context: first.project.context,
        requestId: randomUUID(),
        changes: [{ path: 'note.txt', content: 'accepted' }],
      });
      const originalCreation = await call('story_create', request);
      assert.deepEqual(
        originalCreation.project,
        created.project,
        'creation retries retain their authored receipt after later edits',
      );
      assert.deepEqual((await call('story_inspect', {})).sessions, sessions);
      let job;
      for (let attempt = 0; attempt < 6; attempt++) {
        job = await call('story_inspect', { jobId: second.job.id, waitMs: 15000 });
        if (!['queued', 'running', 'cancelling'].includes(job.status)) break;
      }
      assert.equal(job.status, 'succeeded', JSON.stringify(job));
      assert.equal(job.result.sourceRevision, job.result.project.sourceRevision);
      assert.equal(
        (await call('story_inspect', { projectId: created.project.id })).sourceRevision,
        job.result.sourceRevision,
      );
      assert.equal(
        (await call('story_inspect', { projectId: created.project.id, file: 'note.txt' })).content,
        'accepted',
      );
      const earlier = await call('story_inspect', { jobId: first.job.id });
      assert.equal(earlier.supersededBy, second.job.id);
    } finally {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
