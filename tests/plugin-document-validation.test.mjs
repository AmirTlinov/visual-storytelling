import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginHost } from './plugin/host.mjs';

test(
  'prepared creation rejects unsupported surfaces and invalid timelines before project reservation or source writes',
  { timeout: 30000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'story-document-validation-'));
    const root = fileURLToPath(new URL('../', import.meta.url));
    let host;
    try {
      host = await pluginHost({
        dataDirectory: join(temporary, 'data'),
        initialTarget: {},
        serverEntry: join(root, '.plugin-release/plugin/dist/server.mjs'),
      });
      const documents = [
        {
          version: 2,
          models: [],
          views: [],
          chapters: [{ id: 'empty', title: 'Код главы', beats: [{ id: 'wait', seconds: 2 }] }],
        },
        {
          version: 2,
          models: [
            { id: 'a', module: 'division', inputs: { count: 3, divisor: 2 } },
            { id: 'b', module: 'division', inputs: { count: 4, divisor: 3 } },
          ],
          views: [
            { id: 'objects-a', kind: 'groups', model: 'a' },
            { id: 'objects-b', kind: 'groups', model: 'b' },
          ],
          chapters: [],
        },
        {
          recipe: 'division',
          inputs: { count: 3, divisor: 2 },
          chapters: [
            {
              id: 'experience',
              title: 'Некорректное время',
              beats: [
                {
                  id: 'group',
                  operation: { model: 'division', name: 'group' },
                  timing: { until: 'group' },
                  seconds: 1,
                },
              ],
            },
          ],
        },
      ];
      for (const [index, document] of documents.entries()) {
        const path = join(temporary, `invalid-${index}`);
        const response = await host.client.callTool({
          name: 'story_create',
          arguments: {
            title: 'Некорректный кандидат',
            path,
            document,
            requestId: randomUUID(),
          },
        });
        assert.equal(response.isError, true, JSON.stringify(response));
        await assert.rejects(access(path), { code: 'ENOENT' });
      }
      const projects = await readFile(join(temporary, 'data/projects.json'), 'utf8').catch(
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return '[]';
        },
      );
      assert.deepEqual(JSON.parse(projects), []);
    } finally {
      await host?.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
