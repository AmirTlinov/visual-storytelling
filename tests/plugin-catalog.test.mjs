import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pluginHost } from './plugin/host.mjs';

test(
  'no-input open presents the catalog without an empty scene or an implicit session',
  { timeout: 30000 },
  async () => {
    const host = await pluginHost(),
      browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const sessions = async () =>
        (await host.client.callTool({ name: 'story_inspect', arguments: {} })).structuredContent
          .sessions;
      const before = await sessions();
      const catalog = await host.client.callTool({ name: 'story_open', arguments: {} });
      assert.equal(catalog.structuredContent.status, 'choose-example');
      assert.equal(catalog.structuredContent.sessionId, undefined);
      assert.deepEqual(await sessions(), before);
      for (const example of catalog.structuredContent.examples) {
        assert(
          catalog.content.some(
            (item) =>
              item.type === 'text' &&
              item.text.includes(example.title) &&
              item.text.includes(example.id),
          ),
        );
      }
      await page.evaluate((result) => pluginTest.openResult(result), catalog);
      await app.getByRole('heading', { name: 'Выберите основу объяснения' }).waitFor();
      assert.equal(await app.locator('#scene').isVisible(), false);
      assert.equal(await app.locator('#scene').getAttribute('srcdoc'), null);
      assert.equal(
        await app.locator('#catalog-examples button').count(),
        catalog.structuredContent.examples.length,
      );
      const expected = catalog.structuredContent.examples.find(
        (example) => example.id === 'graph-lab',
      );
      const choice = app.getByRole('button', {
        name: `${expected.title} ${expected.summary}`,
        exact: true,
      });
      await choice.focus();
      await choice.press('Enter');
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      assert.equal(await app.locator('#catalog').isVisible(), false);
      assert.equal(await app.locator('#scene').isVisible(), true);
      const live = await sessions();
      const opened = live.filter(
        (session) => !before.some((previous) => previous.sessionId === session.sessionId),
      );
      assert.equal(opened.length, 1);
      assert.equal(opened[0].title, expected.title);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
