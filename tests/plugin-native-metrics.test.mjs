import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { SessionDirectory } from '../plugin/session-directory.mjs';
import { viewMetrics, viewReport } from '../plugin/mcp/schema.mjs';
import { pluginHost } from './plugin/host.mjs';

const metrics = { timeOrigin: 1791870000000, resourceMountedAt: 10, firstPreparedAt: 30 };
const report = (revision, timing, renderStatus = 'prepared') => ({
  stateRevision: revision,
  state: { time: 0, playing: false },
  checkpoint: { time: 0, progress: 0, mode: 'story', values: {} },
  renderStatus,
  metrics: timing,
});

test('presentation timing is a bounded numeric contract without scene or input content', () => {
  assert.deepEqual(viewMetrics.parse(metrics), metrics);
  for (const invalid of [
    { ...metrics, firstContentAt: Infinity },
    { ...metrics, firstContentAt: -1 },
    { ...metrics, timeOrigin: Number.MAX_VALUE },
    { ...metrics, inputs: { count: 12 } },
    { ...metrics, events: new Array(1000).fill('event') },
  ])
    assert.equal(viewReport.safeParse(report(0, invalid)).success, false);
});

test('prepared timing stays distinct; stale reports cannot replace first renderer evidence', async (t) => {
  const directory = new SessionDirectory();
  t.after(() => directory.close());
  const session = directory.open({ revision: 'initial', title: 'Timing', html: '' });
  const renderer = randomUUID();
  const attached = await directory.attach(session.id, renderer);
  const view = { sessionId: session.id, renderer, generation: attached.generation, wait: false };
  await directory.exchange({ ...view, report: report(1, metrics) });
  const prepared = directory.describe(session).presentationMetrics;
  assert.equal(prepared.first.firstPreparedAt, 30);
  assert.equal(prepared.first.firstContentAt, undefined);
  assert.equal(prepared.first.confirmedAt, undefined);
  const rendered = { ...metrics, firstContentAt: 50, confirmedAt: 50 };
  await directory.exchange({ ...view, report: report(2, rendered, 'rendered') });
  await directory.exchange({ ...view, report: report(1, { ...metrics, firstContentAt: 1 }) });
  assert.equal(directory.describe(session).presentationMetrics.first.firstContentAt, 50);
  await directory.detach(view);
  const nextRenderer = randomUUID();
  const next = await directory.attach(session.id, nextRenderer);
  await assert.rejects(directory.exchange({ ...view, report: report(3, metrics) }));
  await directory.exchange({
    ...view,
    renderer: nextRenderer,
    generation: next.generation,
    report: report(3, { ...metrics, timeOrigin: metrics.timeOrigin + 1000 }),
  });
  const observed = directory.describe(session).presentationMetrics;
  assert.equal(observed.first.renderer, renderer);
  assert.equal(observed.first.generation, attached.generation);
  assert.equal(observed.first.firstContentAt, 50);
  assert.equal(observed.current.renderer, nextRenderer);
  assert.equal(observed.current.firstContentAt, undefined);
});

test('returning to a session in the same app preserves its original generation and clock', async (t) => {
  const directory = new SessionDirectory();
  t.after(() => directory.close());
  const session = directory.open({ revision: 'initial', title: 'Timing', html: '' });
  const renderer = randomUUID();
  const attached = await directory.attach(session.id, renderer);
  const view = { sessionId: session.id, renderer, generation: attached.generation, wait: false };
  const initialMetrics = { ...metrics, firstContentAt: 50, confirmedAt: 50 };
  await directory.exchange({ ...view, report: report(1, initialMetrics, 'rendered') });
  const initial = structuredClone(directory.describe(session).presentationMetrics.first);
  // A changed client clock is a new timing identity even in the original generation.
  await directory.exchange({
    ...view,
    report: report(2, { ...metrics, timeOrigin: metrics.timeOrigin + 1000 }),
  });
  let observed = directory.describe(session).presentationMetrics;
  assert.deepEqual(observed.first, initial);
  assert.equal(observed.current.timeOrigin, metrics.timeOrigin + 1000);
  // A renderer keeps its identity/timeOrigin while navigation resets its per-session timings.
  await directory.detach(view);
  const returned = await directory.attach(session.id, renderer);
  const returnedView = { ...view, generation: returned.generation };
  await directory.exchange({
    ...returnedView,
    report: report(3, { ...initialMetrics, firstContentAt: 500, confirmedAt: 500 }, 'rendered'),
  });
  observed = directory.describe(session).presentationMetrics;
  assert.deepEqual(observed.first, initial);
  assert.equal(observed.current.generation, returned.generation);
  assert.equal(observed.current.firstContentAt, 500);
});

test(
  'real app reports timings through MCP, persists them and preserves first mount on remount',
  { timeout: 45000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'story-native-metrics-'));
    const root = fileURLToPath(new URL('../', import.meta.url));
    const dataDirectory = join(temporary, 'data');
    const host = await pluginHost({
      dataDirectory,
      initialTarget: {},
      serverEntry: join(root, '.plugin-release/plugin/dist/server.mjs'),
    });
    const browser = await chromium.launch(chromiumLaunchOptions({ headless: true }));
    try {
      const page = await browser.newPage();
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#catalog:not([hidden])').waitFor();
      const document = { recipe: 'division', inputs: { count: 13, divisor: 3 } };
      await page.evaluate((document) => window.pluginTest.partial({ document }), document);
      await app.frameLocator('#scene').locator('svg').first().waitFor();
      const created = await host.client.callTool({
        name: 'story_create',
        arguments: {
          title: 'Presentation timing',
          path: join(temporary, 'project'),
          requestId: randomUUID(),
          document,
        },
      });
      assert.equal(created.isError, undefined);
      const sessionId = created.structuredContent.sessionId;
      await page.evaluate((result) => window.pluginTest.result(result), created);
      const inspect = async () =>
        (
          await host.client.callTool({
            name: 'story_inspect',
            arguments: { sessionId },
          })
        ).structuredContent;
      await assertEventually(async () =>
        Boolean((await inspect()).presentationMetrics?.first.confirmedAt),
      );
      const initial = (await inspect()).presentationMetrics.first;
      assert.ok(initial.timeOrigin > 0);
      assert.ok(initial.inputAt >= initial.resourceMountedAt);
      assert.ok(initial.firstPreparedAt >= initial.inputAt);
      assert.ok(initial.firstContentAt >= initial.firstPreparedAt);
      assert.ok(initial.confirmedAt >= initial.firstContentAt);
      assert.ok(initial.attachCompletedAt >= initial.attachStartedAt);
      assert.ok(initial.firstReportStartedAt >= initial.attachCompletedAt);
      assert.equal(Object.hasOwn(initial, 'firstReportCompletedAt'), false);
      const saved = JSON.parse(
        await readFile(join(dataDirectory, 'sessions', sessionId + '.json'), 'utf8'),
      );
      assert.equal(saved.presentationMetrics.first.confirmedAt, initial.confirmedAt);
      await page.evaluate(() => window.pluginTest.remount());
      await assertEventually(async () => {
        const current = (await inspect()).presentationMetrics?.current;
        return current?.renderer !== initial.renderer && Boolean(current?.confirmedAt);
      });
      const reopened = (await inspect()).presentationMetrics;
      for (const key of ['renderer', 'generation', 'timeOrigin', 'firstContentAt', 'confirmedAt'])
        assert.equal(reopened.first[key], initial[key]);
      assert.ok(reopened.current.generation > initial.generation);
    } finally {
      await browser.close();
      await host.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

async function assertEventually(predicate) {
  const deadline = performance.now() + 10000;
  while (!(await predicate())) {
    assert.ok(performance.now() < deadline, 'timing was not reported before the deadline');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
