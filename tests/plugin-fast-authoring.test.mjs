import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginHost } from './plugin/host.mjs';

test(
  'create exposes editable files and pinned batch help before completion, then edits coalesce to the final revision',
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
      const created = await call('story_create', {
        title: 'Editable immediately',
        example: 'explorer-svg',
        path: join(directory, 'project'),
        requestId: randomUUID(),
      });
      assert.equal(created.authoring, 'ready');
      assert.match(created.project.sourceRevision, /^[a-f0-9]{64}$/);
      assert.ok(created.project.files['scene.js']);
      assert.equal(
        await readFile(join(created.project.path, 'scene.js'), 'utf8').then(Boolean),
        true,
      );
      await call('story_cancel', { jobId: created.job.id });
      await call('story_inspect', { jobId: created.job.id, waitMs: 15000 });
      const help = await call('story_help', {
        projectId: created.project.id,
        query: 'graph-lab',
        queries: ['SceneHandle', 'SceneShell.mount', 'explanationLayout', 'disclosure'],
      });
      assert.deepEqual(help.missing, []);
      assert.match(help.text, /interface SceneHandle/);
      assert.match(help.text, /mount/);
      assert.equal(help.examples[0].id, 'graph-lab');
      assert.ok(help.examples[0].editing.some(({ file }) => file === 'model.js'));
      assert.match(help.text, /explanationLayout/);
      const first = await call('story_edit', {
        projectId: created.project.id,
        sourceRevision: created.project.sourceRevision,
        requestId: randomUUID(),
        changes: [{ path: 'note.txt', content: 'first' }],
      });
      const second = await call('story_edit', {
        projectId: created.project.id,
        sourceRevision: first.project.sourceRevision,
        requestId: randomUUID(),
        changes: [{ path: 'note.txt', content: 'accepted' }],
      });
      let job;
      for (let attempt = 0; attempt < 6; attempt++) {
        job = await call('story_inspect', { jobId: second.job.id, waitMs: 15000 });
        if (!['queued', 'running', 'cancelling'].includes(job.status)) break;
      }
      assert.equal(job.status, 'succeeded', JSON.stringify(job));
      assert.equal(job.result.sourceRevision, second.project.sourceRevision);
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
