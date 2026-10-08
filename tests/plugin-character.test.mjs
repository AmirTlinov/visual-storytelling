import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pluginHost } from './plugin/host.mjs';

test(
  'packed Tesla reads local glTF assets under the declared MCP policy, seeks and edits the board',
  { timeout: 45000 },
  async () => {
    const release = process.env.VISUAL_STORY_TEST_RELEASE;
    const host = await pluginHost(
      release
        ? {
            serverCommand: join(release, 'runtime/node'),
            serverEntry: join(release, 'plugin/dist/server.mjs'),
          }
        : {},
    );
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 820, height: 960 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      const policy = (await fetch(host.url + '/app')).headers.get('content-security-policy');
      assert.match(policy, /connect-src data: blob:(?:;|$)/);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await page.goto(host.url);
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const opened = await host.client.callTool({
        name: 'story_open',
        arguments: { example: 'tesla-circuit' },
      });
      assert.equal(opened.isError, undefined);
      await page.evaluate((result) => window.pluginTest.openResult(result), opened);
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const sessionId = opened.structuredContent.sessionId;
      const call = async (name, arguments_ = {}) => {
        const result = await host.client.callTool({
          name,
          arguments: { sessionId, ...arguments_ },
        });
        assert.equal(result.isError, undefined, result.structuredContent?.error?.message);
        return result.structuredContent;
      };
      const control = async (commands) => {
        const state = await call('story_inspect');
        return call('story_control', {
          requestId: randomUUID(),
          buildRevision: state.buildRevision,
          stateRevision: state.stateRevision,
          commands,
        });
      };
      const scene = page.frames().find((frame) => frame.url() === 'about:srcdoc');
      await control([{ type: 'pause' }, { type: 'cue', id: 'workshop.explain', progress: 0.7 }]);
      assert.equal(
        await scene.evaluate(
          () =>
            document.querySelector('.ve-scene').scene.snapshot().content.surfaces.board.content
              .closed,
        ),
        false,
      );
      const button = app
        .frameLocator('#scene')
        .getByRole('button', { name: 'Замкнуть или разомкнуть цепь', exact: true })
        .filter({ visible: true });
      await button.press('Enter');
      const changed = await call('story_inspect', { detail: 'model' });
      assert.equal(changed.state.mode, 'explore');
      assert.equal(
        changed.state.parameters.find((parameter) => parameter.key === 'closed').value,
        true,
      );
      await control([{ type: 'cue', id: 'experiment.change', progress: 0.5 }]);
      await control([{ type: 'cue', id: 'workshop.explain', progress: 0.7 }]);
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      await mkdir('artifacts/coherent-authoring/mcp-character', { recursive: true });
      await page.screenshot({
        path: 'artifacts/coherent-authoring/mcp-character/tesla.png',
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      // Local loaders work, while fetch cannot connect to any external origin.
      const blocked = await scene.evaluate(async () => {
        const violation = new Promise((resolve) =>
          document.addEventListener(
            'securitypolicyviolation',
            (event) => resolve({ directive: event.effectiveDirective, uri: event.blockedURI }),
            { once: true },
          ),
        );
        const request = fetch('https://visual-story.invalid/not-allowed').then(
          () => false,
          () => true,
        );
        const [failed, policy] = await Promise.all([request, violation]);
        return { failed, ...policy };
      });
      assert.equal(blocked.failed, true);
      assert.equal(blocked.directive, 'connect-src');
      assert.match(blocked.uri, /^https:\/\/visual-story\.invalid/);
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
