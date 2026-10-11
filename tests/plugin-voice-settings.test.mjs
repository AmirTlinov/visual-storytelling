import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pluginHost } from './plugin/host.mjs';
import { finishFixtureJob } from './plugin/authoring-fixture.mjs';

test(
  'release voice inspection hides private config and incomplete or removed providers can be disabled',
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-voice-settings-'));
    let host;
    try {
      host = await pluginHost({
        dataDirectory: join(directory, 'data'),
        serverCommand: resolve('.plugin-release/runtime/node'),
        serverEntry: resolve('.plugin-release/plugin/dist/server.mjs'),
      });
      const call = async (name, args) => {
        const result = await host.client.callTool({ name, arguments: args });
        assert.equal(result.isError, undefined, JSON.stringify(result));
        return result;
      };
      const { structuredContent: created } = await call('story_create', {
        title: 'Voice settings recovery',
        path: join(directory, 'project'),
        requestId: randomUUID(),
      });
      await finishFixtureJob(host.client, created.job.id);
      const projectId = created.project.id;
      const secret = 'dummy-private-credential-' + randomUUID();
      const cases = [
        {
          provider: 'api',
          enabled: false,
          adapter: 'voice/missing.mjs',
          model: { apiKey: secret },
          apiKey: secret,
          headers: { Authorization: 'Bearer ' + secret },
        },
        { provider: 'local', enabled: false, model: 'chosen-local-model' },
        { provider: 'macos', enabled: false, voice: 'removed-system-voice', apiKey: secret },
      ];
      for (const settings of cases) {
        const { structuredContent: current } = await call('story_inspect', { projectId });
        // Keep the hand-edited broken configuration quiet while testing the recovery tool.
        const { structuredContent: edited } = await call('story_edit', {
          projectId,
          sourceRevision: current.sourceRevision,
          requestId: randomUUID(),
          changes: [{ path: 'voice.json', content: JSON.stringify(settings, null, 2) + '\n' }],
        });
        await finishFixtureJob(host.client, edited.job.id);
        const inspected = await call('story_voice', { projectId });
        assert.equal(inspected.structuredContent.ready, false);
        assert.equal(inspected.structuredContent.provider, settings.provider);
        assert.equal(JSON.stringify(inspected).includes(secret), false, 'voice status must not echo secrets');
        assert.equal(Object.hasOwn(inspected.structuredContent.settings, 'apiKey'), false);
        assert.equal(Object.hasOwn(inspected.structuredContent.settings, 'headers'), false);
        if (settings.provider === 'api') {
          assert.equal(Object.hasOwn(inspected.structuredContent.settings, 'model'), false,
            'an object in a string field must not bypass redaction');
          assert.equal(inspected.structuredContent.readiness, 'configuration-required');
        }
        const request = {
          projectId,
          sourceRevision: edited.project.sourceRevision,
          requestId: randomUUID(),
          enabled: false,
        };
        // In particular, omit provider for the removed provider already stored in the file.
        const disabled = await call('story_voice', request);
        assert.equal(JSON.stringify(disabled).includes(secret), false);
        assert.equal(disabled.structuredContent.project.requestId, request.requestId);
        assert.notEqual(disabled.structuredContent.project.sourceRevision, request.sourceRevision,
          'saving the default language must create a real authoring revision');
        const completed = await finishFixtureJob(host.client, disabled.structuredContent.job.id);
        assert.equal(completed.result.sourceRevision, disabled.structuredContent.project.sourceRevision);
        assert.deepEqual(
          JSON.parse(await readFile(join(created.project.path, 'voice.json'), 'utf8')),
          { ...settings, language: 'ru-RU' },
          'disabling preserves the selected backend and model while recording the disabled state',
        );
        const repeated = await call('story_voice', request);
        assert.equal(repeated.structuredContent.project.repeated, true);
        assert.equal(repeated.structuredContent.job.id, disabled.structuredContent.job.id);
      }
    } finally {
      await host?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
